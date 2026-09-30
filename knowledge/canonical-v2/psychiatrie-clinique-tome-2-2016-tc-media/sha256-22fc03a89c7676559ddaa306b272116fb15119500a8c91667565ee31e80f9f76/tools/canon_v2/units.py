from __future__ import annotations

import hashlib
import re
from collections import Counter

from .constants import BOOK_ID, INGESTION_VERSION, LANGUAGE, SOURCE_VERSION
from .serialization import stable_id

PART_TITLES = {5: "Spécialités psychiatriques", 6: "Traitements"}
HEADING_RE = re.compile(r"^\s*(\d{2,3}[A-Z]?(?:\.\d+){1,3})\.?(?:\s+|$)(.*)$", re.DOTALL)
VISUAL_PREFIXES = {
    "TABLEAU": "table",
    "FIGURE": "figure",
    "ENCADRÉ": "box",
    "ALGORITHME": "algorithm",
    "SCHÉMA": "figure",
}
NAVIGATION_TEXT_RE = re.compile(r"^(?:\d{1,4}\s*\n)?(?:Psychiatrie clinique|CHAPITRE\s*\d+|Chapitre\s+\d+|Références|R\d+|I\d+)", re.IGNORECASE)
EXPLICIT_MEDICATION_HEADINGS = {"traitement pharmacologique", "pharmacothérapie", "médicaments", "posologie", "modalités de prescription"}


def _text(page: dict) -> str:
    for key in ("reading_text", "text", "raw_text"):
        value = page.get(key)
        if isinstance(value, str):
            return value
    return ""


def _raw_text(page: dict) -> str:
    value = page.get("raw_text")
    return value if isinstance(value, str) else _text(page)


def _page_index(page: dict) -> int:
    value = page.get("source_page_index")
    return int(value) if isinstance(value, int) and not isinstance(value, bool) else 0


def _part_path(chapter: dict) -> str:
    part_number = chapter.get("part_number")
    if part_number not in PART_TITLES:
        part_value = chapter.get("part")
        match = re.search(r"(\d+)", str(part_value))
        part_number = int(match.group(1)) if match else (5 if int(chapter.get("chapter", 49)) <= 65 else 6)
    return "Partie " + str(part_number) + "/" + PART_TITLES[part_number]


def _chapter_for_page(page_index: int, chapters: list[dict]) -> dict | None:
    for chapter in chapters:
        start = chapter.get("page_start")
        end = chapter.get("page_end")
        if isinstance(start, int) and start <= page_index and isinstance(end, int) and page_index <= end:
            return chapter
        if isinstance(start, int) and page_index >= start and end is None:
            return chapter
    return None


def _fallback_path(page: dict) -> str:
    kind = page.get("printed_page_kind")
    labels = {
        "front_matter": "Tome 2/Front matter",
        "references": "Tome 2/Références",
        "author_index": "Tome 2/Index des auteurs",
        "medication_index": "Tome 2/Index des médicaments",
        "subject_index": "Tome 2/Index des sujets",
        "credits": "Tome 2/Crédits",
        "cover": "Tome 2/Couverture",
        "back_matter": "Tome 2/Back matter",
    }
    return labels.get(kind, "Tome 2/Hors structure/Page " + str(_page_index(page) + 1))


def _heading(text: str) -> tuple[str, str] | None:
    first_line = text.splitlines()[0] if text else ""
    match = HEADING_RE.match(first_line)
    if match is None:
        return None
    return match.group(1), match.group(2).strip() or match.group(1)


def _heading_records(chapter: dict) -> dict[str, dict]:
    records: dict[str, dict] = {}
    sections = [section for section in chapter.get("sections", []) if isinstance(section, dict)]
    for section in sections:
        number = section.get("number")
        if isinstance(number, str):
            records[number] = {"node": section, "kind": "section", "section": section}
    for subsection in chapter.get("subsections", []):
        if not isinstance(subsection, dict):
            continue
        number = subsection.get("number")
        if not isinstance(number, str):
            continue
        parent_number = ".".join(number.split(".")[:2])
        parent = next((section for section in sections if section.get("number") == parent_number), None)
        records[number] = {"node": subsection, "kind": "subsection", "section": parent}
    return records


def _heading_path(base_path: str, record: dict | None) -> str:
    if record is None:
        return base_path
    node = record["node"]
    number = node.get("number")
    if record["kind"] == "subsection":
        section = record.get("section")
        section_number = section.get("number") if isinstance(section, dict) else ".".join(str(number).split(".")[:2])
        return base_path + "/" + str(section_number) + "/" + str(number)
    return base_path + "/" + str(number)


def _is_navigation_block(page: dict, block: dict) -> bool:
    bbox = block.get("bbox")
    if isinstance(bbox, list) and len(bbox) == 4:
        height = page.get("page_height")
        if isinstance(height, (int, float)):
            if bbox[1] < 5 or bbox[3] > float(height) - 20:
                return True
    text = block.get("text")
    return isinstance(text, str) and NAVIGATION_TEXT_RE.match(text.strip()) is not None


def _block_records(page: dict) -> tuple[list[dict], list[dict]]:
    blocks = page.get("blocks")
    if not isinstance(blocks, list):
        text = _text(page)
        if not text.strip():
            return [], []
        return [{"block_index": 0, "text": text, "bbox": None, "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()}], []
    content = []
    navigation = []
    for block in blocks:
        if not isinstance(block, dict) or not isinstance(block.get("text"), str) or not block["text"].strip():
            continue
        if _is_navigation_block(page, block):
            navigation.append(block)
        else:
            content.append(block)
    return content, navigation


def _reading_block_text(page: dict, block: dict, block_count: int) -> str:
    direct = block.get("reading_text")
    if isinstance(direct, str):
        return direct
    raw_page = _raw_text(page)
    reading_page = _text(page)
    raw_block = block.get("text") if isinstance(block.get("text"), str) else ""
    if block_count == 1 and reading_page:
        return reading_page
    start = raw_page.find(raw_block)
    if start >= 0 and len(raw_page) == len(reading_page):
        return reading_page[start : start + len(raw_block)]
    return raw_block


def _source_block_reference(block: dict) -> dict:
    reference = {"block_index": block.get("block_index", 0)}
    if isinstance(block.get("bbox"), list) and len(block["bbox"]) == 4:
        reference["bbox"] = list(block["bbox"])
    if isinstance(block.get("text_sha256"), str):
        reference["text_sha256"] = block["text_sha256"]
    return reference


def _line_records(raw_text: str, reading_text: str) -> list[dict]:
    raw_lines = raw_text.splitlines(keepends=True)
    reading_lines = reading_text.splitlines(keepends=True)
    aligned = len(raw_lines) == len(reading_lines)
    records = []
    raw_offset = 0
    for raw_index, raw_line in enumerate(raw_lines):
        raw_content = raw_line.rstrip("\r\n")
        raw_start = raw_offset
        raw_end = raw_start + len(raw_content)
        raw_offset += len(raw_line)
        record = {
            "raw_line_index": raw_index,
            "raw_offset_start": raw_start,
            "raw_offset_end": raw_end,
            "raw_text": raw_content,
            "reading_line_index": raw_index if aligned else None,
            "reading_offset_start": None,
            "reading_offset_end": None,
            "reading_text": None,
        }
        if aligned:
            reading_line = reading_lines[raw_index].rstrip("\r\n")
            reading_start = sum(len(value) for value in reading_lines[:raw_index])
            record["reading_offset_start"] = reading_start
            record["reading_offset_end"] = reading_start + len(reading_line)
            record["reading_text"] = reading_line
        records.append(record)
    return records


def _block_record(page: dict, block: dict, reading_text: str) -> dict:
    record = _source_block_reference(block)
    raw_text = block.get("text") if isinstance(block.get("text"), str) else ""
    record["source_page_index"] = _page_index(page)
    record["raw_text"] = raw_text
    record["reading_text"] = reading_text
    record["line_records"] = _line_records(raw_text, reading_text)
    if "printed_page_number" not in page:
        raise ValueError("printed_page_number key is missing from page record")
    printed = page["printed_page_number"]
    if printed is not None and (not isinstance(printed, str) or not printed.strip()):
        raise ValueError("printed_page_number must be a non-empty string or null")
    record["printed_page_number"] = printed
    return record


def _join_texts(values: list[str]) -> str:
    result = ""
    for value in values:
        if not value:
            continue
        if result and not result.endswith("\n"):
            result += "\n"
        result += value
    return result


def _has_explicit_medication_heading(text: str, boundary: dict | None) -> bool:
    if boundary is not None:
        title = boundary["node"].get("title")
        if isinstance(title, str) and title.strip().casefold() in EXPLICIT_MEDICATION_HEADINGS:
            return True
    for line in text.splitlines():
        value = re.sub(r"^\d{2,3}(?:\.\d+){1,3}\.?\s+", "", line.strip(), flags=re.IGNORECASE)
        if value.casefold() in EXPLICIT_MEDICATION_HEADINGS:
            return True
    return False


def _content_type(text: str, chapter_opening: bool, boundary: dict | None, page: dict) -> str:
    if chapter_opening:
        return "chapter_opening"
    stripped = text.lstrip()
    for prefix, content_type in VISUAL_PREFIXES.items():
        if stripped.upper().startswith(prefix):
            return content_type
    if boundary is not None:
        return "heading"
    lowered = stripped.lower()
    if lowered.startswith("étude de cas") or "\nétude de cas" in lowered:
        return "clinical_case"
    if any(line.lstrip().startswith(("•", "–", "-")) for line in text.splitlines()):
        return "list"
    first_line = stripped.splitlines()[0].strip().casefold() if stripped else ""
    if first_line in {"traitement pharmacologique", "pharmacothérapie", "médicaments", "posologie", "modalités de prescription"}:
        return "medication_statement"
    kind = page.get("printed_page_kind")
    if kind == "credits":
        return "credits"
    if kind == "references":
        return "reference"
    if kind in {"author_index", "medication_index", "subject_index"}:
        return "index_entry"
    return "prose"


def _new_group(page: dict, block: dict, reading_text: str, chapter: dict | None, boundary: dict | None, chapter_opening: bool, navigation: list[dict] | None = None) -> dict:
    base_path = _part_path(chapter) + "/Chapitre " + str(chapter.get("chapter")) if chapter is not None else _fallback_path(page)
    heading_record = boundary
    parent_id = chapter.get("id") if chapter is not None else None
    if heading_record is not None:
        parent_id = heading_record["node"].get("id")
    return {
        "chapter": chapter,
        "chapter_opening": chapter_opening,
        "boundary": heading_record,
        "base_path": base_path,
        "structural_path": _heading_path(base_path, heading_record),
        "parent_id": parent_id,
        "blocks": [block],
        "raw_texts": [block.get("text", "")],
        "reading_texts": [reading_text],
        "navigation": list(navigation or []),
        "pages": [page],
    }


def _append_group(group: dict, page: dict, block: dict, reading_text: str, navigation: list[dict]) -> None:
    group["blocks"].append(block)
    group["raw_texts"].append(block.get("text", ""))
    group["reading_texts"].append(reading_text)
    group["navigation"].extend(navigation)
    group["pages"].append(page)


def _unit_from_group(group: dict, occurrences: Counter[tuple[str, str]]) -> dict:
    pages = group["pages"]
    first_page = pages[0]
    last_page = pages[-1]
    raw_text = _join_texts(group["raw_texts"])
    reading_text = _join_texts(group["reading_texts"])
    page_indices = []
    for page in pages:
        index = _page_index(page)
        if index not in page_indices:
            page_indices.append(index)
    first_index = page_indices[0]
    last_index = page_indices[-1]
    first_display = first_page.get("source_page_display") if isinstance(first_page.get("source_page_display"), int) else first_index + 1
    last_display = last_page.get("source_page_display") if isinstance(last_page.get("source_page_display"), int) else last_index + 1
    if "printed_page_number" not in first_page or "printed_page_number" not in last_page:
        raise ValueError("printed_page_number key is missing from unit boundary page record")
    first_printed = first_page["printed_page_number"]
    last_printed = last_page["printed_page_number"]
    for printed in (first_printed, last_printed):
        if printed is not None and (not isinstance(printed, str) or not printed.strip()):
            raise ValueError("printed_page_number must be a non-empty string or null")
    valid_mapping_statuses = {"certain", "inferred", "uncertain", "missing", "not_applicable"}
    page_mapping_statuses = [
        page.get("mapping_status") if page.get("mapping_status") in valid_mapping_statuses else "missing"
        for page in pages
    ]
    if "uncertain" in page_mapping_statuses:
        aggregate_mapping = "uncertain"
    elif "missing" in page_mapping_statuses:
        aggregate_mapping = "missing"
    elif "not_applicable" in page_mapping_statuses:
        aggregate_mapping = "not_applicable"
    elif page_mapping_statuses and all(status == "certain" for status in page_mapping_statuses):
        aggregate_mapping = "certain"
    else:
        aggregate_mapping = "inferred"
    validation_status = "needs_review" if aggregate_mapping in {"uncertain", "missing", "not_applicable"} else "auto_ok"
    first_mapping = aggregate_mapping
    last_mapping = aggregate_mapping
    block_refs = [_source_block_reference(block) for block in group["blocks"]]
    block_records = [
        _block_record(page, block, group["reading_texts"][position])
        for position, (page, block) in enumerate(zip(group["pages"], group["blocks"]))
    ]
    nav_refs = []
    for block in group["navigation"]:
        reference = _source_block_reference(block)
        if reference not in nav_refs:
            nav_refs.append(reference)
    source_span = "+".join("p" + str(_page_index(page)) + ":b" + str(block.get("block_index", 0)) for page, block in zip(pages, group["blocks"]))
    structural_path = group["structural_path"]
    occurrence = occurrences[(structural_path, source_span)]
    occurrences[(structural_path, source_span)] += 1
    unit_id = stable_id("unit", SOURCE_VERSION, structural_path, source_span, occurrence)
    boundary = group["boundary"]
    title = boundary["node"].get("title") if boundary is not None and isinstance(boundary["node"].get("title"), str) else None
    if title is None:
        title = reading_text.splitlines()[0].strip() if reading_text.splitlines() else None
    repair_references = []
    for page in pages:
        for reference in page.get("repair_references", []) if isinstance(page.get("repair_references"), list) else []:
            if isinstance(reference, str) and reference not in repair_references:
                repair_references.append(reference)
    source_block_references = block_refs
    raw_hash = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()
    provenance = {
        "book_id": BOOK_ID,
        "source_version": SOURCE_VERSION,
        "ingestion_version": INGESTION_VERSION,
        "extractor": "canon_v2.units",
        "extractor_version": "task5-v2",
        "source_page_indices": page_indices,
        "structural_path": structural_path,
        "source_span": source_span,
        "host_record_id": None,
        "raw_passage_reference": source_span,
        "repair_references": repair_references,
        "extraction_status": first_page.get("extraction_status") if isinstance(first_page.get("extraction_status"), str) else "proposed",
        "mapping_status": first_mapping,
        "validation_status": validation_status,
    }
    return {
        "schema_version": INGESTION_VERSION,
        "book_id": BOOK_ID,
        "source_version": SOURCE_VERSION,
        "ingestion_version": INGESTION_VERSION,
        "language": LANGUAGE,
        "unit_id": unit_id,
        "kind": "content_unit",
        "structural_path": structural_path,
        "source_span": source_span,
        "occurrence": occurrence,
        "content_type": _content_type(reading_text, group["chapter_opening"], boundary, first_page),
        "title": title,
        "parent_id": group["parent_id"],
        "preceding_context_id": None,
        "following_context_id": None,
        "source_page_index": first_index,
        "source_page_index_end": last_index,
        "source_page_display": first_display,
        "source_page_display_end": last_display,
        "source_page_index_start": first_index,
        "source_page_display_start": first_display,
        "printed_page_number": first_printed,
        "printed_page_number_end": last_printed,
        "printed_page_start": first_printed,
        "printed_page_end": last_printed,
        "printed_page_kind": first_page.get("printed_page_kind") if first_page.get("printed_page_kind") in {"front_matter", "body", "references", "author_index", "medication_index", "subject_index", "credits", "cover", "blank", "unknown"} else "unknown",
        "mapping_status": first_mapping,
        "mapping_status_start": first_mapping,
        "mapping_status_end": last_mapping,
        "mapping_anchor": first_page.get("mapping_anchor") if isinstance(first_page.get("mapping_anchor"), str) else None,
        "mapping_evidence": {"source_page_index": first_index, "text_span": source_span, "extraction_version": "task5-v2", "observed_label": first_printed},
        "raw_text": raw_text,
        "raw_sha256": raw_hash,
        "reading_text": reading_text,
        "repair_references": repair_references,
        "source_block_references": source_block_references,
        "data": {
            "navigation_block_references": nav_refs,
            "mapping_status_by_page": page_mapping_statuses,
            "block_records": block_records,
            "explicit_medication_section": _has_explicit_medication_heading(reading_text, boundary),
        },
        "xref_status": "not_applicable",
        "validation_status": validation_status,
        "provenance": provenance,
    }


def build_units(page_records: list[dict], structure: dict) -> list[dict]:
    pages = sorted((page for page in page_records if isinstance(page, dict)), key=_page_index)
    chapters = sorted((chapter for chapter in structure.get("chapters", []) if isinstance(chapter, dict) and isinstance(chapter.get("page_start"), int)), key=lambda chapter: chapter["page_start"])
    occurrences: Counter[tuple[str, str]] = Counter()
    units = []
    active_group = None
    current_chapter = None
    current_heading = None
    heading_records = {}
    for page in pages:
        page_index = _page_index(page)
        chapter = _chapter_for_page(page_index, chapters)
        if chapter is not current_chapter:
            if active_group is not None:
                units.append(_unit_from_group(active_group, occurrences))
            active_group = None
            current_chapter = chapter
            current_heading = None
            heading_records = _heading_records(chapter) if chapter is not None else {}
        content_blocks, navigation = _block_records(page)
        if not content_blocks:
            continue
        for block in content_blocks:
            reading_text = _reading_block_text(page, block, len(content_blocks))
            detected = _heading(reading_text)
            boundary = heading_records.get(detected[0]) if detected is not None else None
            if boundary is not None and boundary is not current_heading:
                if active_group is not None:
                    units.append(_unit_from_group(active_group, occurrences))
                active_group = _new_group(
                    page,
                    block,
                    reading_text,
                    chapter,
                    boundary,
                    chapter is not None and page_index == chapter.get("page_start") and active_group is None,
                    navigation,
                )
                current_heading = boundary
            elif active_group is None:
                opening = chapter is not None and page_index == chapter.get("page_start")
                active_group = _new_group(page, block, reading_text, chapter, current_heading, opening, navigation)
            else:
                _append_group(active_group, page, block, reading_text, navigation)
        if chapter is None:
            if active_group is not None:
                units.append(_unit_from_group(active_group, occurrences))
            active_group = None
    if active_group is not None:
        units.append(_unit_from_group(active_group, occurrences))
    for position, unit in enumerate(units):
        unit["preceding_context_id"] = units[position - 1]["unit_id"] if position > 0 else None
        unit["following_context_id"] = units[position + 1]["unit_id"] if position + 1 < len(units) else None
    return units
