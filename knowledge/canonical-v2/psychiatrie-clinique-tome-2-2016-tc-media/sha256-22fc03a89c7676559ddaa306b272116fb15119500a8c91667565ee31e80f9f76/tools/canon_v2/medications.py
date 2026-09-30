from __future__ import annotations

import hashlib
import re

from .constants import BOOK_ID, INGESTION_VERSION, LANGUAGE, SOURCE_VERSION
from .serialization import stable_id

DOSE_RE = re.compile(
    r"(?<!\w)(\d+(?:[,.]\d+)?(?:[ \t]*(?:à|a|-|–|—)[ \t]*\d+(?:[,.]\d+)?)?[ \t]*(?:mg|mcg|µg|g|UI)(?:/(?:jour|j|dose|kg|min|heure|h))?)(?![A-Za-zµ])",
    re.IGNORECASE,
)
UNIT_RE = re.compile(r"^\d+(?:[,.]\d+)?(?:[ \t]*(?:à|a|-|–|—)[ \t]*\d+(?:[,.]\d+)?)?[ \t]*(?P<unit>mg|mcg|µg|g|UI)(?:/(?P<suffix>jour|j|dose|kg|min|heure|h))?$", re.IGNORECASE)
ROUTE_RE = re.compile(r"(?<![A-Za-z])(?:PO|IM|IV|ID|SC)(?![A-Za-z])|(?i:\b(?:intraveineux|intramusculaire|voie parentérale|voie orale)\b)")
FREQUENCY_RE = re.compile(r"(?i)\b(DIE|BID|TID|QID|AC|PR|PC|SI|HS|MAT|AM|PM|\d+\s+fois\s+par\s+(?:jour|semaine|mois|nuit))\b")
MEDICATION_CONTEXT_RE = re.compile(
    r"(?i)\b(médicament(?:s|ation)?|pharmacothérapie|pharmacologique|antidépresseur(?:s)?|antipsychotique(?:s)?|neuroleptique(?:s)?|benzodiazépine(?:s)?|ISRS|IRSN|ATC|lithium|lamotrigine|valpro(?:ate|ïque)|clozapine|olanzapine|risperdal|sertraline|citalopram|halopéridol|diazépam|zuclopenthixol|thiamine|hydroxyzine|bupropion|venlafaxine|duloxétine|mirtazapine)\b"
)
HIGH_RISK_RE = re.compile(r"(?i)\b(éviter|contre-indiqu|interag|effets? indésirable|danger|risque|sévrage|dépasser|maximum|morphine|ISRS\b)")
EXPLICIT_SECTION_RE = re.compile(r"(?i)^\s*(?:\d{2,3}(?:\.\d+){1,3}\.?\s+)?(traitement pharmacologique|pharmacothérapie|médicaments|posologie|modalités de prescription)\s*(?:\n|$)")


def _text(unit: dict) -> str:
    value = unit.get("text")
    if isinstance(value, str):
        return value
    value = unit.get("reading_text")
    return value if isinstance(value, str) else ""


def _page_index(unit: dict) -> int:
    value = unit.get("source_page_index")
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    value = unit.get("source_page_index_start")
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _unit_id(unit: dict) -> str | None:
    value = unit.get("unit_id")
    if isinstance(value, str):
        return value
    value = unit.get("id")
    return value if isinstance(value, str) else None


def _name_before(text: str, dose_match: re.Match[str]) -> tuple[str | None, str | None]:
    prefix = text[: dose_match.start()].strip()
    brand = None
    brand_match = re.search(r"\(([^()]*)\)\s*$", prefix)
    if brand_match is not None:
        brand = brand_match.group(1).strip() or None
        prefix = prefix[: brand_match.start()]
    if ":" in prefix:
        left, right = prefix.rsplit(":", 1)
        prefix = right if MEDICATION_CONTEXT_RE.search(right) is not None and ROUTE_RE.search(right) is None else left
    route_match = ROUTE_RE.search(prefix)
    if route_match is not None:
        prefix = (prefix[: route_match.start()] + prefix[route_match.end() :]).strip()
    prefix = prefix.strip(" \t\r\n:;,–—-")
    return prefix or None, brand


def _local_route_frequency(line: str, dose_match: re.Match[str] | None, next_dose_start: int | None) -> tuple[str | None, str | None]:
    if dose_match is None:
        route_match = ROUTE_RE.search(line)
        frequency_match = FREQUENCY_RE.search(line)
    else:
        end = next_dose_start if next_dose_start is not None else len(line)
        after = line[dose_match.end() : end]
        before = line[: dose_match.start()]
        route_match = ROUTE_RE.search(after) or ROUTE_RE.search(before)
        frequency_match = FREQUENCY_RE.search(after) or FREQUENCY_RE.search(before)
    return (route_match.group(0) if route_match is not None else None, frequency_match.group(0) if frequency_match is not None else None)


def _dose_segment(line: str, dose_match: re.Match[str], previous_match: re.Match[str] | None, next_match: re.Match[str] | None) -> tuple[str, re.Match[str]]:
    start = 0
    if previous_match is not None:
        between = line[previous_match.end() : dose_match.start()]
        delimiters = [match.end() for match in re.finditer(r"[;,\n.:|]+|\b(?:et|ou|puis|avec|plus|tandis)\b", between, flags=re.IGNORECASE)]
        start = previous_match.end() + (delimiters[-1] if delimiters else 0)
    end = len(line)
    if next_match is not None:
        between = line[dose_match.end() : next_match.start()]
        delimiters = [match.end() for match in re.finditer(r"[;,\n.:|]+|\b(?:et|ou|puis|avec|plus|tandis)\b", between, flags=re.IGNORECASE)]
        end = dose_match.end() + (delimiters[-1] if delimiters else 0)
    segment = line[start:end].strip()
    local_match = DOSE_RE.search(segment)
    if local_match is None:
        return segment, dose_match
    return segment, local_match


def _front_or_index(unit: dict) -> bool:
    path = unit.get("structural_path")
    path_text = path.casefold() if isinstance(path, str) else ""
    return "front matter" in path_text or "/index" in path_text or "index des" in path_text or unit.get("printed_page_kind") in {"front_matter", "author_index", "medication_index", "subject_index"}


def _explicit_medication_section(unit: dict, text: str) -> bool:
    data = unit.get("data")
    if isinstance(data, dict) and data.get("explicit_medication_section") is True:
        return True
    if unit.get("content_type") == "medication_statement":
        return True
    return EXPLICIT_SECTION_RE.match(text.lstrip()) is not None


def _explicit_section_line(text: str) -> tuple[str, int] | None:
    for position, line in enumerate(text.splitlines()):
        if EXPLICIT_SECTION_RE.match(line.strip()) is not None:
            return line.strip(), position
    return None


def _line_provenance(unit: dict, line: str, line_position: int) -> dict:
    data = unit.get("data")
    records = data.get("block_records") if isinstance(data, dict) else None
    line_records = []
    if isinstance(records, list):
        for record in records:
            if not isinstance(record, dict) or not isinstance(record.get("line_records"), list):
                continue
            for line_record in record["line_records"]:
                if isinstance(line_record, dict):
                    line_records.append((record, line_record))
    if line_position < 0 or line_position >= len(line_records):
        raise ValueError("medication block/page provenance is missing")
    record, line_record = line_records[line_position]
    page_index = record.get("source_page_index")
    block_index = record.get("block_index")
    raw_text = record.get("raw_text")
    reading_text = record.get("reading_text")
    raw_start = line_record.get("raw_offset_start")
    raw_end = line_record.get("raw_offset_end")
    reading_index = line_record.get("reading_line_index")
    reading_start = line_record.get("reading_offset_start")
    reading_end = line_record.get("reading_offset_end")
    raw_line = line_record.get("raw_text")
    reading_line = line_record.get("reading_text")
    valid = (
        isinstance(page_index, int)
        and isinstance(block_index, int)
        and isinstance(raw_text, str)
        and isinstance(reading_text, str)
        and isinstance(raw_start, int)
        and isinstance(raw_end, int)
        and isinstance(reading_index, int)
        and isinstance(reading_start, int)
        and isinstance(reading_end, int)
        and isinstance(raw_line, str)
        and isinstance(reading_line, str)
        and 0 <= raw_start <= raw_end <= len(raw_text)
        and 0 <= reading_start <= reading_end <= len(reading_text)
        and raw_text[raw_start:raw_end] == raw_line
        and reading_text[reading_start:reading_end] == reading_line
        and reading_line == line
    )
    if not valid:
        raise ValueError("medication block/page provenance is invalid")
    reference = {"block_index": block_index}
    if isinstance(record.get("bbox"), list) and len(record["bbox"]) == 4:
        reference["bbox"] = list(record["bbox"])
    if isinstance(record.get("text_sha256"), str):
        reference["text_sha256"] = record["text_sha256"]
    identity = {
        "source_page_index": page_index,
        "block_index": block_index,
        "raw_line_index": line_record.get("raw_line_index"),
        "raw_offset_start": raw_start,
        "raw_offset_end": raw_end,
        "reading_line_index": reading_index,
        "reading_offset_start": reading_start,
        "reading_offset_end": reading_end,
    }
    if "printed_page_number" in record:
        printed = record["printed_page_number"]
        if printed is not None and (not isinstance(printed, str) or not printed.strip()):
            raise ValueError("printed_page_number must be a non-empty string or null")
    else:
        raise ValueError("printed_page_number key is missing from medication block provenance")
    return {
        "ambiguous": False,
        "source_page_index": page_index,
        "source_span": "p" + str(page_index) + ":b" + str(block_index) + ":l" + str(line_record.get("raw_line_index") + 1) + ":o" + str(raw_start) + "-" + str(raw_end),
        "raw_text": raw_line,
        "reading_text": reading_line,
        "raw_sha256": hashlib.sha256(raw_line.encode("utf-8")).hexdigest(),
        "source_block_references": [reference],
        "source_line_identity": identity,
        "printed_page_number": printed,
    }


def _unit_text(dose_text: str) -> str | None:
    match = UNIT_RE.match(dose_text.strip())
    if match is None:
        return None
    suffix = match.group("suffix")
    return match.group("unit") + ("/" + suffix if suffix is not None else "")


def _risk_flags(text: str, dose_match: re.Match[str] | None, route: str | None, frequency: str | None, kind: str) -> list[str]:
    flags = []
    if dose_match is not None or kind == "numeric_dose":
        flags.append("numeric_dose")
    if route is not None:
        flags.append("route")
    if frequency is not None:
        flags.append("frequency")
    if kind == "high_risk_treatment_statement":
        flags.append("high_risk_treatment")
    if HIGH_RISK_RE.search(text) is not None:
        flags.append("high_risk_source_language")
    return list(dict.fromkeys(flags))


def _candidate(unit: dict, text: str, kind: str, occurrence: int, source_name: str | None, brand_name: str | None, dose_match: re.Match[str] | None, dose_text: str | None, unit_text: str | None, route: str | None, frequency: str | None, line_provenance: dict) -> dict:
    page_index = line_provenance.get("source_page_index")
    source_span = line_provenance.get("source_span")
    structural_path = unit.get("structural_path") if isinstance(unit.get("structural_path"), str) else "Tome 2/Hors structure/Unresolved"
    candidate_id = stable_id("medication", SOURCE_VERSION, structural_path, (source_span or "unresolved") + ":" + (dose_text or kind), occurrence)
    raw_text = line_provenance.get("raw_text")
    reading_text = line_provenance.get("reading_text")
    raw_sha256 = line_provenance.get("raw_sha256")
    source_line_identity = line_provenance.get("source_line_identity")
    source_start = page_index
    source_end = page_index
    printed_start = line_provenance["printed_page_number"]
    printed_end = printed_start
    return {
        "candidate_id": candidate_id,
        "kind": "medication_candidate",
        "candidate_kind": kind,
        "host_unit_id": _unit_id(unit),
        "structural_path": structural_path,
        "source_span": source_span,
        "source_page_index_start": source_start,
        "source_page_index_end": source_end,
        "printed_page_start": printed_start,
        "printed_page_end": printed_end,
        "mapping_status": unit.get("mapping_status") if isinstance(unit.get("mapping_status"), str) else "missing",
        "source_name_text": source_name,
        "brand_name_text": brand_name,
        "dose_text": dose_text,
        "unit_text": unit_text,
        "dose_unit_text": unit_text,
        "route_text": route,
        "frequency_text": frequency,
        "source_context_text": text,
        "raw_text": raw_text,
        "raw_sha256": raw_sha256,
        "reading_text": reading_text,
        "source_line_identity": source_line_identity,
        "source_block_references": line_provenance["source_block_references"],
        "language": LANGUAGE,
        "book_id": BOOK_ID,
        "source_version": SOURCE_VERSION,
        "ingestion_version": INGESTION_VERSION,
        "extraction_status": "proposed",
        "validation_status": "needs_review",
        "risk_flags": _risk_flags(text, dose_match, route, frequency, kind),
        "recommendation_status": "source_text_only",
    }


def extract_medication_candidates(units: list[dict]) -> list[dict]:
    records = []
    occurrences = {}
    for unit in units:
        if not isinstance(unit, dict):
            continue
        text = _text(unit)
        if not text.strip():
            continue
        explicit_section = _explicit_medication_section(unit, text)
        if _front_or_index(unit) and not explicit_section:
            continue
        unit_record_start = len(records)
        for line_position, line in enumerate(text.splitlines()):
            dose_matches = list(DOSE_RE.finditer(line))
            if dose_matches and (MEDICATION_CONTEXT_RE.search(line) is not None or explicit_section):
                for dose_position, dose_match in enumerate(dose_matches):
                    segment, local_match = _dose_segment(
                        line,
                        dose_match,
                        dose_matches[dose_position - 1] if dose_position > 0 else None,
                        dose_matches[dose_position + 1] if dose_position + 1 < len(dose_matches) else None,
                    )
                    dose_text = local_match.group(1)
                    unit_text = _unit_text(dose_text)
                    route, frequency = _local_route_frequency(segment, local_match, None)
                    source_name, brand_name = _name_before(segment, local_match)
                    line_provenance = _line_provenance(unit, line, line_position)
                    key = (_unit_id(unit) or str(_page_index(unit)), line_position, "numeric", dose_position)
                    occurrence = occurrences.get(key, 0)
                    occurrences[key] = occurrence + 1
                    records.append(_candidate(unit, line.strip(), "numeric_dose", occurrence, source_name, brand_name, local_match, dose_text, unit_text, route, frequency, line_provenance))
            if MEDICATION_CONTEXT_RE.search(line) is not None and HIGH_RISK_RE.search(line) is not None:
                route, frequency = _local_route_frequency(line, None, None)
                line_provenance = _line_provenance(unit, line, line_position)
                key = (_unit_id(unit) or str(_page_index(unit)), line_position, "high_risk")
                occurrence = occurrences.get(key, 0)
                occurrences[key] = occurrence + 1
                records.append(_candidate(unit, line.strip(), "high_risk_treatment_statement", occurrence, None, None, None, None, None, route, frequency, line_provenance))
        if explicit_section and len(records) == unit_record_start:
            explicit_line = _explicit_section_line(text)
            section_line, section_position = explicit_line if explicit_line is not None else (text.strip(), 0)
            route, frequency = _local_route_frequency(section_line, None, None)
            line_provenance = _line_provenance(unit, section_line, section_position)
            key = (_unit_id(unit) or str(_page_index(unit)), "explicit")
            occurrence = occurrences.get(key, 0)
            occurrences[key] = occurrence + 1
            records.append(_candidate(unit, section_line, "explicit_medication_section", occurrence, None, None, None, None, None, route, frequency, line_provenance))
    return records
