from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from .serialization import write_json_atomic, write_jsonl

BOOK_ID = "psychiatrie-clinique-tome-2-2016-tc-media"
SOURCE_VERSION = "sha256:22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76"
CHAPTER_START = 73
CHAPTER_END = 85
STOPWORD_END = re.compile(r"(?i)\b(?:de|la|le|les|des|du|et|à|pour|avec|par|un|une)$")
AUTHOR_MARKERS = ("Ph. D.", "M.D.", "Professeur", "Psychologue,", "Psychiatre,", "Université", "Département", "Centre hospitalier", "Institut universitaire")
TOC_MARKER = "...."
NONCLINICAL_PATH_MARKERS = ("Références", "Reference", "Index", "Front matter", "Couverture", "Crédits", "Credits")
AGE_CLOSED = {"nouveau-né", "enfant", "enfants", "adolescent", "adolescents", "enfants et adolescents", "adulte", "adultes", "personne âgée", "personnes âgées"}
SUBJECTS = (
    "psychothérapie", "thérapies appuyées empiriquement", "thérapie cognitivo-comportementale",
    "thérapies comportementales", "thérapies cognitives", "alliance thérapeutique",
    "relation thérapeutique", "facteurs communs", "schéma dysfonctionnel", "schémas dysfonctionnels",
    "supervision clinique", "efficacité thérapeutique", "résultats thérapeutiques",
    "intervention", "approche", "traitement", "psychoéducation", "remédiation cognitive",
)
DEFINITION_SUBJECTS = set(SUBJECTS) - {"intervention", "approche", "traitement"}
ATTRIBUTE_PREDICATE = "associated_with"
COORDINATION_PATTERNS = (
    re.compile(r"(?is)^(?P<head>.+?)\s+non\s+seulement\s+(?P<first>.+?)\s+mais\s+aussi\s+(?P<second>.+)$"),
    re.compile(r"(?is)^(?P<head>.+?)\s+à\s+la\s+fois\s+(?P<first>.+?)\s+et\s+(?P<second>.+)$"),
    re.compile(r"(?is)^(?P<head>.+?)\s+(?:aussi|également)\s+(?P<first>.+?)\s+et\s+(?P<second>.+)$"),
)
MAX_ATOMIC_OBJECT_LENGTH = 120


def write_jsonl_atomic(path: Path, records: list[dict]) -> str:
    temporary = path.with_name(path.name + ".tmp")
    try:
        file_hash = write_jsonl(temporary, records)
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()
    return file_hash


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def chapter_number(path: str | None) -> int | None:
    match = re.search(r"/Chapitre\s+(\d+)\b", path or "")
    return int(match.group(1)) if match else None


def source_block(unit: dict, page: int, block_index: int) -> dict | None:
    for block in unit.get("data", {}).get("block_records", []):
        if block.get("source_page_index") == page and block.get("block_index") == block_index:
            return block
    return None


def source_span_key(candidate: dict) -> tuple[int, int] | None:
    match = re.match(r"p(\d+):b(\d+)", str(candidate.get("source_span") or ""))
    return (int(match.group(1)), int(match.group(2))) if match else None


def exact_source_span(block: dict, source_text: str, line_identity: dict | None = None) -> tuple[dict, int]:
    text = block["raw_text"]
    if line_identity:
        start = line_identity.get("raw_offset_start")
        end = line_identity.get("raw_offset_end")
        if isinstance(start, int) and isinstance(end, int) and text[start:end] == source_text:
            occurrence = text[:start].count(source_text) + 1
            return {"source_page_index": block["source_page_index"], "block_index": block["block_index"], "start_offset": start, "end_offset": end}, occurrence
    start = text.find(source_text)
    if start < 0:
        raise ValueError("candidate source text is absent from locked block")
    occurrence = text[:start].count(source_text) + 1
    return {"source_page_index": block["source_page_index"], "block_index": block["block_index"], "start_offset": start, "end_offset": start + len(source_text)}, occurrence


def make_record(kind: str, unit: dict, block: dict, source_text: str, source_span: dict, source_occurrence: int, extra: dict | None = None) -> dict:
    key = canonical({"kind": kind, "unit_id": unit["unit_id"], "source_span": source_span, "extra": extra or {}})
    record = {
        "proposal_id": f"task10-fix1-{kind}-{hashlib.sha256(key.encode('utf-8')).hexdigest()[:24]}",
        "book_id": BOOK_ID,
        "source_version": SOURCE_VERSION,
        "kind": kind,
        "unit_id": unit["unit_id"],
        "source_text": source_text,
        "source_layer": "raw",
        "source_span": source_span,
        "source_occurrence": source_occurrence,
        "source_page_index_start": block["source_page_index"],
        "source_page_index_end": block["source_page_index"],
        "printed_page_start": block.get("printed_page_number"),
        "printed_page_end": block.get("printed_page_number"),
        "structural_path": unit["structural_path"],
        "language": "fr",
        "confidence": 0.95,
        "extraction_status": "proposed",
        "validation_status": "needs_review",
    }
    if extra:
        record.update(extra)
    return record


def full_block_record(kind: str, unit: dict, block: dict, extra: dict | None = None) -> dict:
    text = block["raw_text"]
    span = {"source_page_index": block["source_page_index"], "block_index": block["block_index"], "start_offset": 0, "end_offset": len(text)}
    return make_record(kind, unit, block, text, span, 1, extra)


def is_nonclinical_unit(unit: dict) -> bool:
    path = unit.get("structural_path", "")
    if any(marker.casefold() in path.casefold() for marker in NONCLINICAL_PATH_MARKERS):
        return True
    if unit.get("content_type") in {"chapter_opening", "reference", "bibliography", "index_entry", "credits", "back_matter"}:
        return True
    for block in unit.get("data", {}).get("block_records", []):
        text = block.get("raw_text", "")
        if text.strip() and TOC_MARKER not in text and not any(marker in text for marker in AUTHOR_MARKERS):
            if re.search(r"[.!?](?=\s|$)", text):
                return False
    return True


def is_case_unit(unit: dict) -> bool:
    if unit.get("content_type") == "clinical_case":
        return True
    text = " ".join(block.get("raw_text", "") for block in unit.get("data", {}).get("block_records", []))
    return bool(re.search(r"(?i)histoire\s+de\s+cas|étude\s+de\s+cas|\bGeorges\b|\bIsabelle\b", text))


def heading_block(unit: dict) -> dict | None:
    for block in unit.get("data", {}).get("block_records", []):
        text = block.get("raw_text", "")
        if not text.strip() or TOC_MARKER in text or any(marker in text for marker in AUTHOR_MARKERS):
            continue
        compact = " ".join(text.split())
        if re.match(r"^\d+(?:\.\d+)*(?:\s|$)", compact):
            return block
        if len(text) <= 180 and not re.search(r"[.!?](?=\s|$)", text) and not re.search(r"^(?:la|le|les|un|une|des|ce|cette|il|elle)\b", compact, re.IGNORECASE):
            return block
    return None


def concept_from_heading(unit: dict) -> tuple[dict, str] | None:
    block = heading_block(unit)
    if block is None:
        return None
    term = block["raw_text"].strip()
    normalized = " ".join(term.split())
    if len(normalized) < 3 or normalized.isdigit() or STOPWORD_END.search(term) or re.search(r"\d{3,}|\.{4}", term):
        return None
    return block, term


def parent_path(path: str) -> str | None:
    parts = path.split("/")
    if len(parts) <= 4:
        return None
    return "/".join(parts[:-1])


def concept_id(path: str, term: str) -> str:
    value = canonical({"path": path, "term": " ".join(term.split())})
    return "concept:" + hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]


def source_qualifiers(text: str) -> tuple[object | None, object | None]:
    normalized = " ".join(text.split())
    without_onset = re.sub(r"\bavant\s+l’âge adulte\b", "", normalized, flags=re.IGNORECASE)
    if re.search(r"(?i)\b(?:aucune|absence|pas\s+d['’]).{0,50}(?:étude|recherche|donnée|information).{0,50}(?:adulte|adultes)", without_onset):
        return None, None
    values = []
    populations = []
    patterns = (
        (r"\bpersonnes?\s+âgées?\b", "personnes âgées"),
        (r"\bpatients?\s+âgés?\b|\baînés?\b", "personnes âgées"),
        (r"\bnouveau[- ]né(?:e|s)?\b", "nouveau-né"),
        (r"\benfants\s+(?:et|aux)\s+(?:les\s+)?adolescents\b", "enfants et adolescents"),
        (r"\benfants\s+et\s+(?:les\s+)?femmes\s+enceintes\b", "femmes enceintes"),
        (r"\badolescents?\b|\badolescence\b", "adolescents"),
        (r"\benfants?\b|\benfant\b", "enfants"),
        (r"\b(?:chez\s+les\s+adultes|patients?\s+adultes)\b", "adultes"),
        (r"\b(?:chez\s+l’adulte|à\s+l’âge\s+adulte)\b", "adulte"),
    )
    for pattern, value in patterns:
        match = re.search(pattern, without_onset, re.IGNORECASE)
        if match:
            if value not in values:
                values.append(value)
            if match.group(0) not in populations:
                populations.append(match.group(0))
    if "femmes enceintes" in populations:
        values = [value for value in values if value not in {"enfant", "enfants"}]
    if not values:
        numeric = (
            (r"\b65\s+ans\s+et\s+plus\b", "65 ans et plus"),
            (r"\b(?:plus\s+de|supérieur\s+à)\s+60\s+ans\b", "plus de 60 ans"),
            (r"\b\d+\s*(?:à|-|et)\s*\d+\s*(?:ans|mois)\b", None),
            (r"\b(?:avant|après|à\s+partir\s+de|plus\s+de|moins\s+de)\s+\d+\s*(?:ans|mois)\b", None),
            (r"\b(?:âge\s+)?\d+\s+ans\b", None),
            (r"\bà\s+\d+\s*(?:an|ans|mois)\b", None),
        )
        for pattern, fixed in numeric:
            match = re.search(pattern, without_onset, re.IGNORECASE)
            if match:
                value = fixed or match.group(0)
                return value, " ".join(match.group(0).split())
    if not values:
        return None, None
    age_group = values[0] if len(values) == 1 else values
    population = populations[0] if len(populations) == 1 else populations
    return age_group, population


def temporal_qualifier(text: str) -> str | None:
    patterns = (
        r"\baigu[ëe]s?\b", r"\bretard[ée]s?\b", r"\bprécoce(?:s)?\b", r"\bau\s+d[ée]but\b",
        r"\bà\s+la\s+phase\s+de\s+d[ée]but\b", r"\bpost[- ]traitement\b", r"\bapr[èe]s\s+le\s+traitement\b",
        r"\bapr[èe]s\s+la\s+phase\s+aigu[ëe]\b",
    )
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(0)
    return None


def split_coordinated_object(raw_object: str) -> list[str] | None:
    for pattern in COORDINATION_PATTERNS:
        match = pattern.match(raw_object)
        if match is None:
            continue
        parts = [match.group("head").strip(), match.group("first").strip(), match.group("second").strip()]
        if all(parts) and all(len(part) <= MAX_ATOMIC_OBJECT_LENGTH for part in parts):
            return parts
    return None


def atomic_claims(subject: str, sentence: str) -> list[tuple[str, str, str]]:
    escaped = re.escape(subject)
    boundary = r"(?=\s+(?:qui|où|à\s+travers)\b|[,;.(]|$)"
    patterns = (
        ("defined_by", rf"(?is)\b{escaped}\s+est\s+(?:un|une)\s+(.+?){boundary}"),
        ("treated_by", rf"(?is)\b{escaped}\s+(?:est|sont)\s+(?:indiqué|indiquée|utilisé|utilisée|prescrit|prescrite)\s+(.+?){boundary}"),
        ("treated_by", rf"(?is)\b{escaped}\s+(?:peut|doit|devrait)\s+(?:être\s+)?(?:indiqué|indiquée|utilisé|utilisée|prescrit|prescrite)\s+(.+?){boundary}"),
        ("contraindicated_with", rf"(?is)\b{escaped}\s+est\s+contre-indiqué(?:e|s)?\s+(.+?){boundary}"),
    )
    for predicate, pattern in patterns:
        match = re.search(pattern, sentence)
        if match is None:
            continue
        if predicate == "defined_by" and subject not in DEFINITION_SUBJECTS:
            continue
        raw_object = re.sub(
            r"(?i)[\s,]+(?:et/ou|et|ou|ainsi que|comme|tel que|notamment|y compris)$",
            "",
            match.group(1).strip(),
        ).strip()
        if not raw_object or len(raw_object) > 300:
            continue
        coordinated = split_coordinated_object(raw_object)
        if coordinated is not None:
            parts = [(predicate, coordinated[0])]
            parts.extend((ATTRIBUTE_PREDICATE, part) for part in coordinated[1:])
        else:
            parts = [(predicate, raw_object)]
        subject_start = re.search(re.escape(subject), sentence, re.IGNORECASE).start()
        claims = []
        for position, (part_predicate, object_text) in enumerate(parts):
            if not object_text:
                continue
            if re.search(r"(?i)\b(?:il|elle|on)\s+(?:est|sont|peut|doit|devrait)\b|\bcorrespond\b", object_text):
                continue
            start = sentence.index(object_text, match.start(1))
            evidence_end = start + len(object_text)
            tail = sentence[evidence_end:].lstrip()
            if tail.startswith("(") and position == len(parts) - 1:
                citation_end = tail.find(").")
                if citation_end >= 0:
                    evidence_end = len(sentence) - len(tail) + citation_end + 2
            evidence = sentence[subject_start:evidence_end].strip()
            claims.append((part_predicate, object_text, evidence))
        if claims:
            return claims
    return []



def subject_variants(subject: str, sentence: str) -> list[str]:
    if subject == "intervention" and re.search(r"(?i)ce type d’intervention", sentence):
        return ["ce type d’intervention"]
    return [subject]


def add_claims(unit: dict, records: list[dict], seen: set[str]) -> None:
    if is_nonclinical_unit(unit) or is_case_unit(unit):
        return
    for block in unit.get("data", {}).get("block_records", []):
        text = block.get("raw_text", "")
        if TOC_MARKER in text or any(marker in text for marker in AUTHOR_MARKERS) or not re.search(r"[.!?](?=\s|$)", text):
            continue
        for sentence in re.split(r"(?<=[.!?])\s+", text.strip()):
            sentence = sentence.strip()
            if len(sentence) < 20 or not re.search(r"[.!?](?=\s|$)", sentence):
                continue
            for subject in SUBJECTS:
                for subject_text in subject_variants(subject, sentence):
                    if not re.search(re.escape(subject_text), sentence, re.IGNORECASE) or STOPWORD_END.search(subject_text):
                        continue
                    if re.match(r"(?i)^a\s+remédiation cognitive", sentence):
                        continue
                    for predicate, object_text, evidence in atomic_claims(subject_text, sentence):
                        key = f"{unit['unit_id']}|{block['source_page_index']}|{block['block_index']}|{subject_text}|{predicate}|{evidence}"
                        if key in seen:
                            continue
                        seen.add(key)
                        age_group, population = source_qualifiers(evidence)
                        record = full_block_record("claim", unit, block, {
                            "subject": subject_text,
                            "predicate_or_relation": predicate,
                            "object": object_text,
                            "clinical_domain": "Traitements psychosociaux",
                            "population": population,
                            "age_group": age_group,
                            "context": None,
                            "temporal_qualifier": temporal_qualifier(evidence),
                            "severity_qualifier": None,
                            "exception_or_condition": None,
                            "evidence_or_recommendation_wording": evidence,
                        })
                        records.append(record)


def add_xrefs(unit: dict, records: list[dict], seen: set[str]) -> None:
    for block in unit.get("data", {}).get("block_records", []):
        text = block.get("raw_text", "")
        for match in re.finditer(r"(?i)\b(?:chapitres?|tome)\s+[0-9]+(?:\s+et\s+[0-9]+)?", text):
            phrase = match.group(0)
            for number in [int(value) for value in re.findall(r"\d+", phrase)]:
                if re.search(r"\btome\b", phrase, re.IGNORECASE):
                    if number not in {1, 2}:
                        continue
                    target = f"Tome {number}"
                    scope = "tome-1" if number == 1 else "tome-2"
                    status = "unresolved_external" if number == 1 else "resolved"
                elif 1 <= number <= 48:
                    target = f"Chapitre {number}"
                    scope = "tome-1"
                    status = "unresolved_external"
                elif 49 <= number <= 85:
                    target = f"Chapitre {number}"
                    scope = "tome-2"
                    status = "resolved"
                else:
                    continue
                key = f"xref:{unit['unit_id']}|{block['source_page_index']}|{block['block_index']}|{target}"
                if key in seen:
                    continue
                seen.add(key)
                records.append(full_block_record("xref", unit, block, {
                    "target": target,
                    "target_scope": scope,
                    "xref_status": status,
                    "source_target_text": phrase,
                }))


def candidate_source(candidate: dict, unit: dict) -> tuple[dict | None, str, dict | None, int | None]:
    span_key = source_span_key(candidate)
    if span_key is None:
        return None, "", None, None
    page, block_index = span_key
    block = source_block(unit, page, block_index)
    if block is None:
        return None, "", None, None
    source_text = candidate.get("raw_text")
    if not isinstance(source_text, str) or not source_text:
        return None, "", block, page
    try:
        span, occurrence = exact_source_span(block, source_text, candidate.get("source_line_identity"))
    except ValueError:
        return None, "", block, page
    return block, source_text, span, occurrence


def add_candidate_records(unit: dict, candidates: list[tuple[str, dict]], records: list[dict], seen: set[str]) -> None:
    for kind, candidate in candidates:
        block, source_text, span, occurrence = candidate_source(candidate, unit)
        if block is None or span is None or occurrence is None:
            continue
        extra = {
            "candidate_id": candidate["candidate_id"],
            "host_unit_id": unit["unit_id"],
            "candidate_source_span": candidate["source_span"],
            "candidate_source_line_identity": candidate.get("source_line_identity"),
            "candidate_source_text": source_text,
            "alignment_status": "aligned",
        }
        if kind == "medication":
            extra.update({
                "candidate_kind": candidate.get("candidate_kind"),
                "source_name_text": candidate.get("source_name_text"),
                "brand_name_text": candidate.get("brand_name_text"),
                "dose_text": candidate.get("dose_text"),
                "dose_unit_text": candidate.get("dose_unit_text"),
                "route_text": candidate.get("route_text"),
                "frequency_text": candidate.get("frequency_text"),
            })
        else:
            bbox = candidate.get("caption_bbox")
            references = candidate.get("source_block_references") or []
            if not isinstance(bbox, list) and references and isinstance(references[0], dict):
                bbox = references[0].get("bbox")
            if isinstance(bbox, list) and len(bbox) == 4:
                region_reference = {"source_page_index": block["source_page_index"], "bbox": bbox}
            else:
                region_reference = {"source_page_index": block["source_page_index"], "region_id": candidate["candidate_id"]}
            extra.update({"caption": candidate.get("caption"), "content_type": candidate.get("content_type"), "region_reference": region_reference})
        key = f"candidate:{candidate['candidate_id']}"
        if key in seen:
            continue
        seen.add(key)
        records.append(make_record(kind, unit, block, source_text, span, occurrence, extra))


def generate(output_dir: Path, proposal_path: Path | None = None) -> dict:
    rows = read_jsonl(output_dir / "work" / "chapters" / "part-d-73-85.jsonl")
    if len(rows) != 250:
        raise ValueError("locked Part D bundle must contain exactly 250 units")
    units = {row["unit"]["unit_id"]: row["unit"] for row in rows}
    unit_by_page_block = defaultdict(list)
    for row in rows:
        unit = row["unit"]
        for block in unit.get("data", {}).get("block_records", []):
            unit_by_page_block[(block["source_page_index"], block["block_index"])].append(row)
    candidates = []
    for row in rows:
        unit = row["unit"]
        for candidate in row.get("medication_candidates", []):
            candidates.append((unit, "medication", candidate))
        for candidate in row.get("visual_candidates", []):
            candidates.append((unit, "visual_review", candidate))
    candidates_by_unit = defaultdict(list)
    unresolved_candidates = []
    for original_unit, kind, candidate in candidates:
        span_key = source_span_key(candidate)
        matches = unit_by_page_block.get(span_key, []) if span_key is not None else []
        host = original_unit
        if matches:
            if any(match["unit"]["unit_id"] == original_unit["unit_id"] for match in matches):
                host = next(match["unit"] for match in matches if match["unit"]["unit_id"] == original_unit["unit_id"])
            else:
                host = matches[0]["unit"]
        candidates_by_unit[host["unit_id"]].append((kind, candidate))
        if not matches:
            unresolved_candidates.append({"candidate_id": candidate["candidate_id"], "kind": kind, "source_span": candidate.get("source_span"), "reason": "no_locked_unit_contains_candidate_page_block"})
    records = []
    seen = set()
    concept_by_path = {}
    concept_by_unit = {}
    for row in rows:
        unit = row["unit"]
        nonclinical = is_nonclinical_unit(unit)
        coverage_block = max((block for block in unit.get("data", {}).get("block_records", []) if block.get("raw_text", "").strip()), key=lambda block: len(block["raw_text"]), default=None)
        if coverage_block is None:
            raise ValueError("unit has no locked source block")
        coverage_status = "not_clinical" if nonclinical else "covered"
        reasons = {unit["unit_id"]: "nonclinical: TOC, author, affiliation, heading-only, or reference/index content only."} if nonclinical else {}
        records.append(full_block_record("coverage", unit, coverage_block, {
            "considered_unit_ids": [unit["unit_id"]],
            "coverage_status": coverage_status,
            "skipped_reasons": reasons,
        }))
        if not nonclinical:
            concept = concept_from_heading(unit)
            if concept is not None:
                block, term = concept
                concept_id_value = concept_id(unit["structural_path"], term)
                records.append(full_block_record("concept", unit, block, {
                    "concept_id": concept_id_value,
                    "canonical_name": " ".join(term.split()),
                    "source_term": term,
                }))
                concept_by_path[unit["structural_path"]] = concept_id_value
                concept_by_unit[unit["unit_id"]] = (block, concept_id_value)
        add_candidate_records(unit, candidates_by_unit[unit["unit_id"]], records, seen)
        add_xrefs(unit, records, seen)
    for row in rows:
        unit = row["unit"]
        concept = concept_by_unit.get(unit["unit_id"])
        if concept is None:
            continue
        parent = parent_path(unit.get("structural_path", ""))
        parent_id = concept_by_path.get(parent)
        if parent_id is None:
            continue
        key = f"relation:{parent_id}|{concept[1]}"
        if key in seen:
            continue
        seen.add(key)
        records.append(full_block_record("relation", unit, concept[0], {
            "relation_type": "parent_of",
            "source_concept_id": parent_id,
            "target_concept_id": concept[1],
        }))
    for row in rows:
        add_claims(row["unit"], records, seen)
    ids = set()
    for record in records:
        if record["proposal_id"] in ids:
            raise ValueError("duplicate proposal ID")
        ids.add(record["proposal_id"])
    output = proposal_path or (output_dir / "semantic" / "proposals" / "part-d-73-85.jsonl")
    output.parent.mkdir(parents=True, exist_ok=True)
    write_jsonl_atomic(output, records)
    return {
        "proposal_path": str(output),
        "proposal_count": len(records),
        "coverage_count": sum(record["kind"] == "coverage" for record in records),
        "kind_counts": dict(sorted(Counter(record["kind"] for record in records).items())),
        "unresolved_candidate_count": len(unresolved_candidates),
        "unresolved_candidates": unresolved_candidates,
    }


def replay(output_dir: Path, replay_path: Path | None = None) -> dict:
    replay_path = replay_path or (output_dir / "work" / "replay" / "part-d-73-85.jsonl")
    summary = generate(output_dir, replay_path)
    approved_path = output_dir / "semantic" / "proposals" / "part-d-73-85.jsonl"
    if not approved_path.exists():
        raise ValueError("approved Part D proposal is missing")
    replay_hash = hashlib.sha256(replay_path.read_bytes()).hexdigest()
    approved_hash = hashlib.sha256(approved_path.read_bytes()).hexdigest()
    manifest = {
        "book_id": BOOK_ID,
        "source_version": SOURCE_VERSION,
        "generator_source": "tools/canon_v2/semantic_part_d.py",
        "input_bundle": "work/chapters/part-d-73-85.jsonl",
        "input_bundle_sha256": hashlib.sha256((output_dir / "work" / "chapters" / "part-d-73-85.jsonl").read_bytes()).hexdigest(),
        "replay_path": "work/replay/part-d-73-85.jsonl",
        "approved_proposal_path": "semantic/proposals/part-d-73-85.jsonl",
        "proposal_count": summary["proposal_count"],
        "coverage_count": summary["coverage_count"],
        "kind_counts": summary["kind_counts"],
        "proposal_sha256": replay_hash,
        "approved_proposal_sha256": approved_hash,
        "replay_mode": "deterministic_regeneration_from_locked_bundle",
        "generator_shared_with_approved_proposal": True,
        "independence_claim": "none: replay reuses the same generator as the approved proposal, so it verifies deterministic regeneration only and not an independent implementation",
        "match": replay_hash == approved_hash,
    }
    if not manifest["match"]:
        raise ValueError("replay proposal hash does not match approved proposal")
    manifest_path = replay_path.with_name("part-d-73-85-manifest.json")
    write_json_atomic(manifest_path, manifest)
    return manifest
