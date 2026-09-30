from __future__ import annotations

import re
from collections.abc import Iterable

EVIDENCE_CLASSES = (
    "visible_label",
    "toc_entry",
    "body_anchor",
    "index_label",
    "credits_label",
    "blank_page",
    "back_cover",
)

_NUMERIC_LINE = re.compile(r"^\s*(\d{1,4})\s*$")
_NUMERIC_PREFIX = re.compile(r"^\s*(\d{3,4})(?:\s+Psychiatrie clinique|\s*\n)")
_ROMAN_LINE = re.compile(r"^\s*((?:x{0,3})(?:ix|iv|v?i{0,3}))\s*$", re.IGNORECASE)
_INDEX_LINE = re.compile(r"^\s*([RICA]\d+)\s*$", re.IGNORECASE)


def _record_text(page_record: dict) -> str:
    for key in ("reading_text", "text", "raw_text"):
        value = page_record.get(key)
        if isinstance(value, str):
            return value
    return ""


def _page_height(page_record: dict) -> float:
    value = page_record.get("page_height")
    if isinstance(value, (int, float)):
        return float(value)
    for block in page_record.get("blocks", []):
        bbox = block.get("bbox") if isinstance(block, dict) else None
        if isinstance(bbox, list) and len(bbox) == 4 and isinstance(bbox[3], (int, float)):
            return float(bbox[3])
    return 783.0


def _label_candidate(value: str) -> tuple[str, str] | None:
    match = _NUMERIC_LINE.match(value)
    if match:
        return match.group(1), "visible_label"
    match = _ROMAN_LINE.match(value)
    if match:
        return match.group(1), "visible_label"
    match = _INDEX_LINE.match(value)
    if match:
        return match.group(1), "index_label"
    return None


def visible_page_label(page_record: dict) -> dict | None:
    text = _record_text(page_record)
    if not text.strip():
        return None
    height = _page_height(page_record)
    blocks = page_record.get("blocks", [])
    candidates: list[tuple[int, int, str, str]] = []
    if isinstance(blocks, list):
        for position, block in enumerate(blocks):
            if not isinstance(block, dict):
                continue
            block_text = block.get("text")
            bbox = block.get("bbox")
            if not isinstance(block_text, str) or not isinstance(bbox, list) or len(bbox) != 4:
                continue
            y0 = bbox[1] if isinstance(bbox[1], (int, float)) else None
            if not isinstance(y0, (int, float)):
                continue
            if y0 < height - 100 and y0 > 80:
                continue
            for line in block_text.splitlines():
                candidate = _label_candidate(line)
                if candidate is not None:
                    candidates.append((position, int(y0), candidate[0], candidate[1]))
    if candidates:
        navigation = "index" in text.lower() or "références" in text.lower() or "crédits" in text.lower()
        usable = []
        for candidate in candidates:
            _, y0, label, evidence = candidate
            if evidence == "visible_label" and navigation:
                continue
            if evidence == "visible_label" and y0 < height - 60 and y0 > 80:
                continue
            usable.append(candidate)
        index_candidates = [candidate for candidate in usable if candidate[3] == "index_label"]
        selected = min(index_candidates or usable, key=lambda item: (item[1], item[0])) if (index_candidates or usable) else None
        if selected is not None:
            _, _, label, evidence = selected
            return {"label": label, "evidence_class": evidence, "source": "block"}
    match = _NUMERIC_PREFIX.match(text)
    if match and not blocks:
        return {
            "label": match.group(1),
            "evidence_class": "visible_label",
            "source": "text",
        }
    return None


def _toc_number(toc_record: dict) -> str | None:
    for key in ("printed_page", "printed_page_number", "printed_page_start"):
        value = toc_record.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            return str(value)
        if isinstance(value, str):
            match = re.search(r"(?<!\d)(\d{1,4})(?!\d)", value)
            if match:
                return match.group(1)
    return None


def _is_external_toc(toc_record: dict) -> bool:
    volume = toc_record.get("volume")
    scope = str(toc_record.get("target_scope", "")).lower()
    return volume in (1, "1", "tome-1", "TOME 1") or scope in {
        "tome-1",
        "external",
    }


def _toc_source_index(toc_record: dict) -> int | None:
    value = toc_record.get("source_page_index")
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    return None


def _page_kind(page_index: int, page_record: dict, numeric_label: int | None, body_range: tuple[int, int] | None) -> str:
    text = _record_text(page_record)
    lowered = text.lower()
    if page_record.get("extraction_status") == "blank" or not text.strip():
        return "blank"
    if page_index == 825 or "cheneliere.ca/lalonde" in lowered:
        return "cover"
    if page_index in {0, 2}:
        return "cover"
    if "table des matières" in lowered or ("tome 1" in lowered and "partie 1" in lowered):
        return "front_matter"
    if page_index < 18:
        return "front_matter"
    if "crédits" in lowered or "credits" in lowered:
        return "credits"
    if "références" in lowered or "references" in lowered:
        return "references"
    if "index" in lowered and page_index > 700:
        return "subject_index"
    if body_range is not None and body_range[0] <= page_index <= body_range[1]:
        return "body"
    if numeric_label is not None and numeric_label >= 1000:
        return "body"
    return "unknown"


def _label_is_numeric(label: str | None) -> bool:
    return isinstance(label, str) and re.fullmatch(r"\d{1,4}", label) is not None


def _numeric_label_value(label: str | None) -> int | None:
    return int(label) if _label_is_numeric(label) else None


def _base_row(page_record: dict, page_index: int, body_range: tuple[int, int] | None) -> dict:
    text = _record_text(page_record)
    visible = visible_page_label(page_record)
    label = visible["label"] if visible is not None else None
    printed_number = label
    kind = _page_kind(page_index, page_record, _numeric_label_value(label), body_range)
    evidence: list[str] = []
    if page_record.get("extraction_status") == "blank":
        evidence.append("blank_page")
    if page_index == 825 or "cheneliere.ca/lalonde" in text.lower():
        evidence.append("back_cover")
    if kind == "credits":
        evidence.append("credits_label")
    if visible is not None:
        evidence.append(visible["evidence_class"])
        if visible["evidence_class"] == "index_label" and kind in {"subject_index", "references", "credits"}:
            if visible["evidence_class"] == "index_label" and "crédits" in text.lower():
                evidence.append("credits_label")
    if printed_number is not None and kind == "body" and _label_is_numeric(printed_number) and int(printed_number) >= 1000:
        evidence.append("body_anchor")
    evidence = [item for item in EVIDENCE_CLASSES if item in evidence]
    status = "certain" if visible is not None else "missing"
    if kind == "blank" or kind == "cover" and page_index == 825:
        status = "not_applicable"
    if printed_number is not None and status == "missing":
        status = "certain"
    return {
        "source_page_index": page_index,
        "source_page_display": page_record.get("source_page_display", page_index + 1),
        "printed_page_number": printed_number,
        "printed_page_label": label,
        "printed_page_kind": kind,
        "mapping_status": status,
        "evidence_classes": evidence,
        "mapping_anchor": "visible:" + label if visible is not None else None,
        "piecewise_rule_id": None,
    }


def _visible_body_anchors(rows: list[dict], body_range: tuple[int, int] | None) -> list[tuple[int, int]]:
    if body_range is None:
        return []
    anchors = []
    for row in rows:
        index = row["source_page_index"]
        number = row["printed_page_number"]
        if body_range[0] <= index <= body_range[1] and _label_is_numeric(number) and int(number) >= 1000:
            anchors.append((index, int(number)))
    return anchors


def _assign_piecewise(rows: list[dict], toc_records: list[dict], body_range: tuple[int, int] | None) -> None:
    by_index = {row["source_page_index"]: row for row in rows}
    toc_by_index: dict[int, list[dict]] = {}
    for record in toc_records:
        if _is_external_toc(record):
            continue
        source_index = _toc_source_index(record)
        if source_index is None:
            continue
        number = _toc_number(record)
        if number is None:
            continue
        toc_by_index.setdefault(source_index, []).append(record)
    anchors = _visible_body_anchors(rows, body_range)
    for source_index, records in toc_by_index.items():
        row = by_index.get(source_index)
        if row is None or row["printed_page_kind"] != "body":
            continue
        for record in records:
            number = _toc_number(record)
            if number is None:
                continue
            chapter = record.get("chapter")
            row["printed_page_number"] = number
            row["printed_page_label"] = number
            row["printed_page_kind"] = "body"
            row["mapping_status"] = "inferred"
            row["evidence_classes"] = ["toc_entry", "body_anchor"]
            row["mapping_anchor"] = "toc:chapter-" + str(chapter) + ":" + number
            row["piecewise_rule_id"] = "toc-anchor:" + str(chapter)
            break
    if body_range is None:
        return
    for left_index, left_number in anchors:
        for right_index, right_number in anchors:
            if right_index <= left_index:
                continue
            if right_index - left_index != right_number - left_number:
                continue
            rule_id = "body-piecewise:" + str(left_index) + "-" + str(right_index)
            for page_index in range(left_index + 1, right_index):
                row = by_index.get(page_index)
                if row is None or row["printed_page_number"] is not None:
                    continue
                if row["printed_page_kind"] != "body":
                    continue
                row["printed_page_number"] = str(left_number + page_index - left_index)
                row["printed_page_label"] = row["printed_page_number"]
                row["printed_page_kind"] = "body"
                row["mapping_status"] = "inferred"
                row["evidence_classes"] = ["body_anchor"]
                row["mapping_anchor"] = "piecewise:" + str(left_index) + "-" + str(right_index)
                row["piecewise_rule_id"] = rule_id
    if not anchors:
        for row in rows:
            if body_range[0] <= row["source_page_index"] <= body_range[1] and row["printed_page_number"] is None and row["printed_page_kind"] == "body":
                row["mapping_status"] = "uncertain"


def map_pages(page_records: list[dict], toc_records: list[dict]) -> list[dict]:
    pages = sorted(
        (record for record in page_records if isinstance(record, dict)),
        key=lambda record: int(record.get("source_page_index", 0)),
    )
    valid_toc = [record for record in toc_records if isinstance(record, dict) and not _is_external_toc(record)]
    toc_indices = [
        _toc_source_index(record)
        for record in valid_toc
        if _toc_source_index(record) is not None
    ]
    body_candidates = [
        int(record.get("source_page_index", 0))
        for record in pages
        if _label_is_numeric(visible_page_label(record)["label"] if visible_page_label(record) else None)
        and int(visible_page_label(record)["label"]) >= 1000
    ]
    body_range = None
    if toc_indices or body_candidates:
        start = min(toc_indices + body_candidates)
        end = max(body_candidates) if body_candidates else max(toc_indices)
        body_range = (start, end)
    rows = [_base_row(record, int(record.get("source_page_index", 0)), body_range) for record in pages]
    _assign_piecewise(rows, valid_toc, body_range)
    return rows
