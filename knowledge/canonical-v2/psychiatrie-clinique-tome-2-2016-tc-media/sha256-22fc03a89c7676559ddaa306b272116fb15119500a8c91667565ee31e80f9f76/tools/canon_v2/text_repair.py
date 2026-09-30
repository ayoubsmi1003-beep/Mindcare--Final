from __future__ import annotations

import hashlib
import io
import json
import re
import shutil
from collections import Counter, defaultdict
from collections.abc import Iterable
from pathlib import Path

import pymupdf
from fontTools.ttLib import TTFont

from .constants import SOURCE_VERSION
from .serialization import canonical_json, read_jsonl
from .source_lock import sha256_file

PUA_START = 0xE000
PUA_END = 0xF8FF
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_CODEPOINT_LABEL = re.compile(r"^U\+[0-9A-F]{4,6}$")
_MAP_CONTENT_HASH_FIELD = "map_content_sha256"


def _map_content(rule_map: dict) -> dict:
    if not isinstance(rule_map, dict):
        raise ValueError("repair map must be an object")
    return {
        key: value
        for key, value in rule_map.items()
        if key != _MAP_CONTENT_HASH_FIELD
    }


def _map_content_hash(rule_map: dict) -> str:
    content = _map_content(rule_map)
    return hashlib.sha256(canonical_json(content).encode("utf-8")).hexdigest()


def _with_map_content_hash(rule_map: dict) -> dict:
    result = dict(rule_map)
    result.pop(_MAP_CONTENT_HASH_FIELD, None)
    result[_MAP_CONTENT_HASH_FIELD] = _map_content_hash(result)
    return result


def _has_valid_persisted_map(rule_map: dict) -> bool:
    if not isinstance(rule_map, dict):
        return False
    if rule_map.get("source_version") != SOURCE_VERSION:
        return False
    if rule_map.get("schema_version") != "canonical-v2.1-tome2-repair-map":
        return False
    if not isinstance(rule_map.get("rules"), dict):
        return False
    if not isinstance(rule_map.get("inventory"), dict):
        return False
    if not isinstance(rule_map.get("unresolved"), list):
        return False
    if not isinstance(rule_map.get("unresolved_codepoints"), list):
        return False
    content_hash = rule_map.get(_MAP_CONTENT_HASH_FIELD)
    if not isinstance(content_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", content_hash):
        return False
    return content_hash == _map_content_hash(rule_map)


def _is_private_use(character: str) -> bool:
    codepoint = ord(character)
    return PUA_START <= codepoint <= PUA_END


def _codepoint_label(character: str) -> str:
    return f"U+{ord(character):04X}"


def _parse_codepoint_label(label: str) -> int:
    if not isinstance(label, str) or not _CODEPOINT_LABEL.fullmatch(label):
        raise ValueError("derivation evidence has an invalid Unicode codepoint")
    return int(label[2:], 16)


def _rules(rule_map: dict) -> dict:
    if not isinstance(rule_map, dict):
        raise ValueError("repair map must be an object")
    rules = rule_map.get("rules", rule_map)
    if not isinstance(rules, dict):
        raise ValueError("repair rules must be an object")
    return rules


def _require_text(rule: dict, field: str) -> str:
    value = rule.get(field)
    if not isinstance(value, str) or not value:
        raise ValueError("verified repair rule requires " + field)
    return value


def _validate_verified_rule(rule: dict, rule_map: dict, character: str) -> None:
    expected_source_version = rule_map.get("source_version")
    if not isinstance(expected_source_version, str) or not expected_source_version:
        raise ValueError("verified repair rule requires map source_version")
    if rule.get("source_version") != expected_source_version:
        raise ValueError("verified repair rule source_version mismatch")
    if rule.get("raw_codepoint") != _codepoint_label(character):
        raise ValueError("verified repair rule raw_codepoint mismatch")
    _require_text(rule, "replacement")
    _require_text(rule, "rule_id")
    font_identity = _require_text(rule, "font_identity")
    font_sha256 = _require_text(rule, "font_sha256")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", font_identity):
        raise ValueError("verified repair rule font_identity is invalid")
    if not _HEX64.fullmatch(font_sha256):
        raise ValueError("verified repair rule font_sha256 is invalid")
    if font_identity != "sha256:" + font_sha256:
        raise ValueError("verified repair rule font identity mismatch")
    glyph_name = _require_text(rule, "glyph_name")
    page_indices = rule.get("evidence_page_indices")
    if not isinstance(page_indices, list) or not page_indices:
        raise ValueError("verified repair rule requires evidence_page_indices")
    if any(isinstance(page, bool) or not isinstance(page, int) or page < 0 for page in page_indices):
        raise ValueError("verified repair rule has invalid evidence_page_indices")
    contexts = rule.get("evidence_contexts")
    if not isinstance(contexts, list) or not contexts:
        raise ValueError("verified repair rule requires evidence_contexts")
    context_pages = set()
    for context in contexts:
        if not isinstance(context, dict):
            raise ValueError("verified repair rule has invalid evidence_contexts")
        page = context.get("source_page_index")
        text = context.get("text")
        if isinstance(page, bool) or not isinstance(page, int) or page < 0:
            raise ValueError("verified repair rule has invalid context page")
        if not isinstance(text, str) or not text:
            raise ValueError("verified repair rule has invalid context text")
        context_pages.add(page)
    if not context_pages.issubset(set(page_indices)):
        raise ValueError("verified repair rule context pages are not evidence pages")
    derivation = rule.get("derivation_evidence")
    if not isinstance(derivation, dict):
        raise ValueError("verified repair rule requires derivation_evidence")
    if derivation.get("method") != "embedded-font-cmap-glyph-identity":
        raise ValueError("verified repair rule derivation method is invalid")
    if derivation.get("raw_codepoint") != _codepoint_label(character):
        raise ValueError("verified repair rule derivation raw_codepoint mismatch")
    if derivation.get("glyph_name") != glyph_name:
        raise ValueError("verified repair rule derivation glyph_name mismatch")
    unicode_codepoint = _parse_codepoint_label(derivation.get("unicode_codepoint"))
    if derivation.get("font_identity") != font_identity:
        raise ValueError("verified repair rule derivation font identity mismatch")
    if rule["replacement"] != chr(unicode_codepoint):
        raise ValueError("verified repair rule replacement does not match derivation")


def _active_rule(rule_map: dict, character: str) -> dict | None:
    if not _is_private_use(character):
        return None
    rules = _rules(rule_map)
    rule = rules.get(character)
    if not isinstance(rule, dict):
        return None
    if rule.get("review_status") != "verified":
        return None
    _validate_verified_rule(rule, rule_map, character)
    return rule


def _event(
    raw_character: str,
    rule: dict,
    page_index: int,
    block_index: int,
    raw_offset: int,
) -> dict:
    if not isinstance(rule, dict):
        raise ValueError("repair rule must be an object")
    replacement = rule.get("replacement")
    rule_id = rule.get("rule_id")
    if not isinstance(replacement, str) or not replacement:
        raise ValueError("repair replacement must be a non-empty string")
    if not isinstance(rule_id, str) or not rule_id:
        raise ValueError("repair rule_id must be a non-empty string")
    codepoint = ord(raw_character)
    return {
        "page_index": int(page_index),
        "block_index": int(block_index),
        "raw_offset": int(raw_offset),
        "raw_codepoint": f"U+{codepoint:04X}",
        "raw_value": raw_character,
        "replacement": replacement,
        "rule_id": rule_id,
        "confidence": float(rule.get("confidence", 1.0)),
        "review_status": "verified",
    }


def repair_text(
    raw_text: str, rule_map: dict, page_index: int, block_index: int
) -> tuple[str, list[dict]]:
    """Apply only source-rederived map content; repair_pages is the trust boundary."""
    if not isinstance(raw_text, str):
        raise ValueError("raw_text must be a string")
    if not _has_valid_persisted_map(rule_map):
        return raw_text, []
    pieces = []
    repairs = []
    for raw_offset, raw_character in enumerate(raw_text):
        rule = _active_rule(rule_map, raw_character)
        if rule is None:
            pieces.append(raw_character)
            continue
        repairs.append(
            _event(raw_character, rule, page_index, block_index, raw_offset)
        )
        pieces.append(rule["replacement"])
    return "".join(pieces), repairs


def _font_cmap(font: TTFont) -> dict[int, set[str]]:
    cmap = defaultdict(set)
    for table in font["cmap"].tables:
        for codepoint, glyph_name in table.cmap.items():
            cmap[codepoint].add(glyph_name)
    return cmap


def _load_font(document: pymupdf.Document, xref: int) -> dict:
    font_name, extension, font_type, font_bytes = document.extract_font(xref)
    font = TTFont(io.BytesIO(font_bytes), fontNumber=0, lazy=True)
    return {
        "font_name": str(font_name),
        "extension": str(extension),
        "font_type": str(font_type),
        "font_sha256": hashlib.sha256(font_bytes).hexdigest(),
        "cmap": _font_cmap(font),
        "font": font,
    }


def _font_unicode_candidates(font_data: dict, glyph_names: set[str]) -> list[str]:
    return sorted(
        f"U+{codepoint:04X}"
        for codepoint, mapped_glyphs in font_data["cmap"].items()
        if not _is_private_use(chr(codepoint))
        and not 0xD800 <= codepoint <= 0xDFFF
        and glyph_names.intersection(mapped_glyphs)
    )


def _span_contexts(page: pymupdf.Page) -> Iterable[tuple[str, str]]:
    for block in page.get_text("dict").get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "")
                if any(_is_private_use(character) for character in text):
                    yield str(span.get("font", "")), text


def _derive_rule(character: str, source_version: str, evidence: dict) -> dict | None:
    if not isinstance(evidence, dict):
        return None
    observations = evidence.get("observations")
    if not isinstance(observations, list) or not observations:
        return None
    normalized = []
    for observation in observations:
        if not isinstance(observation, dict):
            return None
        font_identity = observation.get("font_identity")
        font_sha256 = observation.get("font_sha256")
        glyph_names = observation.get("glyph_names")
        unicode_candidates = observation.get("unicode_candidates")
        pages = observation.get("pages")
        contexts = observation.get("contexts")
        if not isinstance(font_identity, str) or not re.fullmatch(
            r"sha256:[0-9a-f]{64}", font_identity
        ):
            return None
        if not isinstance(font_sha256, str) or not _HEX64.fullmatch(font_sha256):
            return None
        if font_identity != "sha256:" + font_sha256:
            return None
        if not isinstance(glyph_names, list) or len(glyph_names) != 1:
            return None
        glyph_name = glyph_names[0]
        if not isinstance(glyph_name, str) or not glyph_name:
            return None
        if not isinstance(unicode_candidates, list) or len(unicode_candidates) != 1:
            return None
        unicode_label = unicode_candidates[0]
        try:
            unicode_codepoint = _parse_codepoint_label(unicode_label)
        except ValueError:
            return None
        if not isinstance(pages, list) or not pages:
            return None
        if any(isinstance(page, bool) or not isinstance(page, int) or page < 0 for page in pages):
            return None
        if not isinstance(contexts, list) or not contexts:
            return None
        normalized.append(
            {
                "font_identity": font_identity,
                "font_sha256": font_sha256,
                "font_name": observation.get("font_name"),
                "glyph_name": glyph_name,
                "unicode_codepoint": unicode_codepoint,
                "unicode_label": unicode_label,
                "pages": pages,
                "contexts": contexts,
            }
        )
    font_identities = {item["font_identity"] for item in normalized}
    glyph_names = {item["glyph_name"] for item in normalized}
    unicode_codepoints = {item["unicode_codepoint"] for item in normalized}
    if len(font_identities) != 1 or len(glyph_names) != 1 or len(unicode_codepoints) != 1:
        return None
    font_identity = next(iter(font_identities))
    font_sha256 = next(iter(normalized))["font_sha256"]
    glyph_name = next(iter(glyph_names))
    unicode_codepoint = next(iter(unicode_codepoints))
    page_indices = sorted({page for item in normalized for page in item["pages"]})
    contexts = []
    seen_contexts = set()
    for item in normalized:
        for context in item["contexts"]:
            key = (context.get("source_page_index"), context.get("text"))
            if key not in seen_contexts:
                seen_contexts.add(key)
                contexts.append(context)
    if not contexts:
        return None
    return {
        "raw_codepoint": _codepoint_label(character),
        "replacement": chr(unicode_codepoint),
        "rule_id": f"pua-{ord(character):04x}-u{unicode_codepoint:04x}",
        "confidence": 1.0,
        "review_status": "verified",
        "source_version": source_version,
        "font_identity": font_identity,
        "font_sha256": font_sha256,
        "font_identities": [font_identity],
        "font_names": sorted({item["font_name"] for item in normalized if item["font_name"]}),
        "glyph_name": glyph_name,
        "evidence_page_indices": page_indices,
        "evidence_contexts": contexts[:8],
        "derivation_evidence": {
            "method": "embedded-font-cmap-glyph-identity",
            "raw_codepoint": _codepoint_label(character),
            "glyph_name": glyph_name,
            "unicode_codepoint": f"U+{unicode_codepoint:04X}",
            "font_identity": font_identity,
            "observation_count": len(normalized),
        },
    }


def build_repair_map(raw_pages: Iterable[dict], pdf_path: Path) -> dict:
    pages = list(raw_pages)
    source_version = "sha256:" + sha256_file(Path(pdf_path))
    if source_version != SOURCE_VERSION:
        raise ValueError(
            "PDF does not match authoritative source version: " + source_version
        )
    raw_counts = Counter()
    raw_pages_by_codepoint = defaultdict(set)
    for page in pages:
        if not isinstance(page, dict):
            raise ValueError("raw page records must be objects")
        page_index = page.get("source_page_index")
        raw_text = page.get("raw_text")
        if not isinstance(page_index, int) or not isinstance(raw_text, str):
            raise ValueError("raw page records require source_page_index and raw_text")
        for character in raw_text:
            if _is_private_use(character):
                raw_counts[character] += 1
                raw_pages_by_codepoint[character].add(page_index)

    observed = defaultdict(
        lambda: {
            "pages": set(),
            "font_identities": set(),
            "font_names": set(),
            "glyph_names": set(),
            "unicode_candidates": set(),
            "contexts": [],
            "observations": [],
        }
    )
    font_cache = {}
    document = pymupdf.open(Path(pdf_path))
    try:
        for page_record in pages:
            page_index = page_record["source_page_index"]
            if not any(
                _is_private_use(character)
                for character in page_record["raw_text"]
            ):
                continue
            if page_index < 0 or page_index >= document.page_count:
                continue
            page = document[page_index]
            fonts_by_name = {}
            for font in page.get_fonts(full=True):
                try:
                    fonts_by_name[str(font[3])] = int(font[0])
                except (IndexError, TypeError, ValueError):
                    continue
            for font_name, context in _span_contexts(page):
                xref = fonts_by_name.get(font_name)
                if xref is None:
                    continue
                if xref not in font_cache:
                    font_cache[xref] = _load_font(document, xref)
                font_data = font_cache[xref]
                font_sha256 = str(font_data["font_sha256"])
                font_identity = "sha256:" + font_sha256
                context_record = {
                    "source_page_index": page_index,
                    "text": context,
                }
                for character in context:
                    if not _is_private_use(character):
                        continue
                    glyph_names = set(font_data["cmap"].get(ord(character), set()))
                    unicode_candidates = _font_unicode_candidates(
                        font_data, glyph_names
                    )
                    item = observed[character]
                    item["pages"].add(page_index)
                    item["font_identities"].add(font_identity)
                    item["font_names"].add(str(font_data["font_name"]))
                    item["glyph_names"].update(glyph_names)
                    item["unicode_candidates"].update(unicode_candidates)
                    if len(item["contexts"]) < 8:
                        item["contexts"].append(context_record)
                    item["observations"].append(
                        {
                            "font_identity": font_identity,
                            "font_sha256": font_sha256,
                            "font_name": str(font_data["font_name"]),
                            "glyph_names": sorted(glyph_names),
                            "unicode_candidates": unicode_candidates,
                            "pages": [page_index],
                            "contexts": [context_record],
                        }
                    )
    finally:
        document.close()
        for font_data in font_cache.values():
            font_data["font"].close()

    rules = {}
    for character in sorted(raw_counts, key=ord):
        evidence = observed.get(character)
        if evidence is None:
            continue
        rule = _derive_rule(character, source_version, evidence)
        if rule is not None:
            rules[character] = rule

    inventory = {}
    unresolved = []
    for character in sorted(raw_counts, key=ord):
        evidence = observed.get(
            character,
            {
                "pages": set(),
                "font_identities": set(),
                "font_names": set(),
                "glyph_names": set(),
                "unicode_candidates": set(),
                "contexts": [],
            },
        )
        label = _codepoint_label(character)
        record = {
            "count": raw_counts[character],
            "source_page_indices": sorted(raw_pages_by_codepoint[character]),
            "font_identities": sorted(evidence["font_identities"]),
            "font_names": sorted(evidence["font_names"]),
            "glyph_names": sorted(evidence["glyph_names"]),
            "unicode_candidates": sorted(evidence["unicode_candidates"]),
            "status": "verified" if character in rules else "unresolved",
        }
        inventory[label] = record
        if character not in rules:
            unresolved.append(
                {
                    "raw_codepoint": label,
                    "count": raw_counts[character],
                    "source_page_indices": sorted(raw_pages_by_codepoint[character]),
                    "reason": "no unique agreeing embedded-font cmap Unicode replacement",
                }
            )

    return _with_map_content_hash(
        {
            "schema_version": "canonical-v2.1-tome2-repair-map",
            "source_version": source_version,
            "parser": "pymupdf-" + pymupdf.__version__,
            "total_private_use_count": sum(raw_counts.values()),
            "private_use_codepoint_count": len(raw_counts),
            "rules": rules,
            "unresolved_codepoints": [item["raw_codepoint"] for item in unresolved],
            "unresolved": unresolved,
            "inventory": inventory,
        }
    )


def _unresolved_event(
    raw_character: str, page_index: int, block_index: int, raw_offset: int
) -> dict:
    return {
        "page_index": int(page_index),
        "block_index": int(block_index),
        "raw_offset": int(raw_offset),
        "raw_codepoint": _codepoint_label(raw_character),
        "raw_value": raw_character,
        "replacement": raw_character,
        "rule_id": "unresolved-" + _codepoint_label(raw_character).lower(),
        "confidence": 0.0,
        "review_status": "unresolved",
    }


def _block_ranges(raw_text: str, page_record: dict) -> list[tuple[int, int, int]]:
    ranges = []
    cursor = 0
    for block in page_record.get("blocks", []):
        if not isinstance(block, dict):
            continue
        block_text = block.get("text")
        if not isinstance(block_text, str) or not block_text:
            continue
        start = raw_text.find(block_text, cursor)
        if start < 0:
            start = raw_text.find(block_text)
        if start < 0:
            continue
        end = start + len(block_text)
        try:
            block_index = int(block.get("block_index", -1))
        except (TypeError, ValueError):
            block_index = -1
        ranges.append((start, end, block_index))
        cursor = max(cursor, end)
    return ranges


def _locate_event(event: dict, ranges: list[tuple[int, int, int]]) -> dict:
    page_offset = int(event["page_raw_offset"])
    for start, end, block_index in ranges:
        if start <= page_offset < end:
            event["block_index"] = block_index
            event["raw_offset"] = page_offset - start
            return event
    event["block_index"] = -1
    event["raw_offset"] = page_offset
    return event


def _read_rule_map(path: Path) -> dict:
    if not path.exists():
        raise ValueError("repair map is missing: " + str(path))
    with path.open("r", encoding="utf-8") as stream:
        value = json.load(stream)
    if not isinstance(value, dict):
        raise ValueError("repair map must be an object")
    return value


def _locked_source(output_dir: Path) -> Path:
    lock_path = output_dir / "source-lock.json"
    if not lock_path.exists():
        raise ValueError("source lock is missing: " + str(lock_path))
    try:
        with lock_path.open("r", encoding="utf-8") as stream:
            lock = json.load(stream)
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("source lock cannot be read") from error
    if not isinstance(lock, dict):
        raise ValueError("source lock must be an object")
    source_path = lock.get("source_path")
    source_version = lock.get("source_version")
    if not isinstance(source_path, str) or not source_path:
        raise ValueError("source lock requires source_path")
    if not isinstance(source_version, str) or not source_version:
        raise ValueError("source lock requires source_version")
    if source_version != SOURCE_VERSION:
        raise ValueError("source lock does not match authoritative source version")
    expected_source_version = lock.get("expected_source_version")
    if expected_source_version is not None and expected_source_version != SOURCE_VERSION:
        raise ValueError("source lock expected_source_version does not match authoritative source")
    pdf_path = Path(source_path)
    if not pdf_path.exists():
        raise ValueError("locked source PDF is missing: " + str(pdf_path))
    actual_source_version = "sha256:" + sha256_file(pdf_path)
    if actual_source_version != SOURCE_VERSION:
        raise ValueError("locked source PDF does not match authoritative source version")
    return pdf_path


def _canonical_map_hash(rule_map: dict) -> str:
    return hashlib.sha256(canonical_json(rule_map).encode("utf-8")).hexdigest()


def _artifact_paths(output_dir: Path, rule_map_path: Path) -> list[Path]:
    return [
        output_dir / "raw" / "repaired-pages.jsonl",
        output_dir / "repairs.jsonl",
        output_dir / "checkpoints" / "text-repair.json",
        rule_map_path,
    ]


def _atomic_write_bytes(path: Path, payload: bytes) -> None:
    temporary_path = path.with_name(path.name + ".tmp")
    try:
        temporary_path.write_bytes(payload)
        temporary_path.replace(path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


def _atomic_write_json(path: Path, value: object) -> str:
    payload = canonical_json(value).encode("utf-8")
    _atomic_write_bytes(path, payload)
    return hashlib.sha256(payload).hexdigest()


def _atomic_write_jsonl(path: Path, records: Iterable[dict]) -> str:
    records = list(records)
    if any(not isinstance(record, dict) for record in records):
        raise ValueError("JSONL rows must be objects")
    payload = "".join(canonical_json(record) for record in records).encode("utf-8")
    _atomic_write_bytes(path, payload)
    return hashlib.sha256(payload).hexdigest()


def _quarantine_artifacts(
    output_dir: Path,
    reason: str,
    raw_pages_path: Path,
    rule_map_path: Path,
) -> tuple[Path, list[str]]:
    source_lock_path = output_dir / "source-lock.json"
    identity = {
        "reason": reason,
        "raw_page_sha256": sha256_file(raw_pages_path) if raw_pages_path.exists() else None,
        "rule_map_sha256": sha256_file(rule_map_path) if rule_map_path.exists() else None,
        "source_lock_sha256": sha256_file(source_lock_path) if source_lock_path.exists() else None,
    }
    failure_id = hashlib.sha256(
        canonical_json(identity).encode("utf-8")
    ).hexdigest()
    quarantine_dir = output_dir / "quarantine" / "repair-failures" / failure_id
    moved = []
    for path in _artifact_paths(output_dir, rule_map_path):
        if not path.exists():
            continue
        relative = path.relative_to(output_dir)
        destination = quarantine_dir / relative
        if destination.exists():
            destination = quarantine_dir / (
                str(relative).replace("\\", "__") + "." + sha256_file(path)[:16]
            )
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), str(destination))
        moved.append(str(relative))
    return quarantine_dir, moved


def _write_blocked_checkpoint(
    output_dir: Path,
    raw_pages_path: Path,
    reason: str,
    quarantine_dir: Path | None = None,
    moved: list[str] | None = None,
) -> None:
    blocked = {
        "status": "BLOCKED",
        "reason": reason,
        "raw_page_path": str(raw_pages_path),
        "raw_page_sha256": sha256_file(raw_pages_path)
        if raw_pages_path.exists()
        else None,
        "quarantine_path": str(quarantine_dir.relative_to(output_dir))
        if quarantine_dir is not None
        else None,
        "quarantined_outputs": moved or [],
        "canonical_repaired_page_present": False,
        "canonical_repairs_present": False,
    }
    blocked_path = output_dir / "checkpoints" / "text-repair.json"
    blocked_path.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write_json(blocked_path, blocked)


def _quarantine_stale_outputs(
    output_dir: Path,
    reason: str,
    raw_pages_path: Path,
    rule_map_path: Path,
) -> None:
    quarantine_dir, moved = _quarantine_artifacts(
        output_dir, reason, raw_pages_path, rule_map_path
    )
    _write_blocked_checkpoint(
        output_dir,
        raw_pages_path,
        reason,
        quarantine_dir,
        moved,
    )


def repair_pages(
    raw_pages_path: Path, output_dir: Path, resume: bool = True
) -> dict:
    raw_pages_path = Path(raw_pages_path)
    output_dir = Path(output_dir)
    rule_map_path = output_dir / "checkpoints" / "repair-map.json"
    try:
        pages = read_jsonl(raw_pages_path)
        pdf_path = _locked_source(output_dir)
        derived_rule_map = build_repair_map(pages, pdf_path)
        stored_rule_map = _read_rule_map(rule_map_path)
        if _canonical_map_hash(stored_rule_map) != _canonical_map_hash(derived_rule_map):
            raise ValueError("repair map does not match frozen source re-derivation")
        rule_map = derived_rule_map
    except (OSError, ValueError, json.JSONDecodeError) as error:
        _quarantine_stale_outputs(output_dir, str(error), raw_pages_path, rule_map_path)
        raise

    repaired_dir = output_dir / "raw"
    checkpoints_dir = output_dir / "checkpoints"
    repaired_path = repaired_dir / "repaired-pages.jsonl"
    repairs_path = output_dir / "repairs.jsonl"
    checkpoint_path = checkpoints_dir / "text-repair.json"
    try:
        quarantine_dir, moved = _quarantine_artifacts(
            output_dir,
            "refreshing canonical repair outputs",
            raw_pages_path,
            rule_map_path,
        )
        repaired_dir.mkdir(parents=True, exist_ok=True)
        checkpoints_dir.mkdir(parents=True, exist_ok=True)
        _write_blocked_checkpoint(
            output_dir,
            raw_pages_path,
            "repair transaction in progress",
            quarantine_dir,
            moved,
        )
        _atomic_write_json(rule_map_path, rule_map)
        all_events = []
        repaired_pages = []
        repair_count_by_rule = Counter()
        unresolved_count_by_codepoint = Counter()
        changed_page_indices = []
        total_repairs = 0
        total_unresolved = 0

        for page_record in pages:
            if not isinstance(page_record, dict):
                raise ValueError("raw page records must be objects")
            page_index = int(page_record["source_page_index"])
            raw_text = page_record.get("raw_text")
            if not isinstance(raw_text, str):
                raise ValueError("raw page records require raw_text")
            reading_text, page_repairs = repair_text(
                raw_text, rule_map, page_index, -1
            )
            ranges = _block_ranges(raw_text, page_record)
            page_events = []
            for event in page_repairs:
                event["page_raw_offset"] = int(event["raw_offset"])
                page_events.append(_locate_event(event, ranges))
            for raw_offset, character in enumerate(raw_text):
                if not _is_private_use(character) or _active_rule(rule_map, character) is not None:
                    continue
                event = _unresolved_event(character, page_index, -1, raw_offset)
                event["page_raw_offset"] = raw_offset
                page_events.append(_locate_event(event, ranges))
            page_events.sort(
                key=lambda event: (event["page_raw_offset"], event["rule_id"])
            )
            for event in page_events:
                event["event_id"] = (
                    f"repair:{page_index}:{event['page_raw_offset']}:{event['rule_id']}"
                )
                all_events.append(event)
                if event["review_status"] == "unresolved":
                    unresolved_count_by_codepoint[event["raw_codepoint"]] += 1
                else:
                    repair_count_by_rule[event["rule_id"]] += 1
            page_repaired = dict(page_record)
            page_repaired["reading_text"] = reading_text
            page_repaired["reading_sha256"] = hashlib.sha256(
                reading_text.encode("utf-8")
            ).hexdigest()
            page_repaired["repair_references"] = [
                event["event_id"] for event in page_events
            ]
            page_repaired["repair_count"] = sum(
                1 for event in page_events if event["review_status"] != "unresolved"
            )
            page_repaired["unresolved_count"] = sum(
                1 for event in page_events if event["review_status"] == "unresolved"
            )
            repaired_pages.append(page_repaired)
            total_repairs += page_repaired["repair_count"]
            total_unresolved += page_repaired["unresolved_count"]
            if page_events:
                changed_page_indices.append(page_index)

        repaired_pages_sha256 = _atomic_write_jsonl(repaired_path, repaired_pages)
        repairs_sha256 = _atomic_write_jsonl(repairs_path, all_events)
        checkpoint = {
            "command": "repair --output "
            + str(output_dir)
            + (" --resume" if resume else " --no-resume"),
            "rule_map_path": "checkpoints/repair-map.json",
            "rule_map_sha256": sha256_file(rule_map_path),
            "rule_map_content_sha256": _map_content_hash(rule_map),
            "rule_map_file_sha256": sha256_file(rule_map_path),
            "raw_page_path": str(raw_pages_path),
            "raw_page_sha256": sha256_file(raw_pages_path),
            "repaired_page_path": "raw/repaired-pages.jsonl",
            "repaired_page_sha256": repaired_pages_sha256,
            "repairs_path": "repairs.jsonl",
            "repairs_sha256": repairs_sha256,
            "page_count": len(pages),
            "repair_count": total_repairs,
            "repair_count_by_rule": dict(sorted(repair_count_by_rule.items())),
            "unresolved_count": total_unresolved,
            "unresolved_count_by_codepoint": dict(
                sorted(unresolved_count_by_codepoint.items())
            ),
            "changed_page_indices": changed_page_indices,
            "unresolved_codepoints": rule_map.get("unresolved_codepoints", []),
            "status": "PASS",
        }
        _atomic_write_json(checkpoint_path, checkpoint)
    except Exception as error:
        _quarantine_stale_outputs(output_dir, str(error), raw_pages_path, rule_map_path)
        raise

    result = dict(checkpoint)
    result["rule_map"] = rule_map
    result["page_records"] = repaired_pages
    result["events"] = all_events
    return result
