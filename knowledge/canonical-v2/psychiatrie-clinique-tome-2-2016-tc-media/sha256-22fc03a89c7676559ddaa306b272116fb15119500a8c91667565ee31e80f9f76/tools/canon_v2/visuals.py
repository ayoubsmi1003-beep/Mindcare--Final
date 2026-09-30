from __future__ import annotations

import re

from .constants import BOOK_ID, INGESTION_VERSION, LANGUAGE, SOURCE_VERSION
from .serialization import stable_id

CAPTION_RE = re.compile(r"^\s*(TABLEAU|FIGURE|ENCADRÉ|ALGORITHME|SCHÉMA)\b([^\n]*)", re.IGNORECASE)
NUMBER_RE = re.compile(r"\b(\d{1,3}[A-Z]?(?:\.\d+)+)\b", re.IGNORECASE)
CONTENT_TYPES = {
    "TABLEAU": "table",
    "FIGURE": "figure",
    "ENCADRÉ": "box",
    "ALGORITHME": "algorithm",
    "SCHÉMA": "figure",
}
FOOTNOTE_RE = re.compile(r"^(?:\*|Note\s*:|Notes\s*:|Source\s*:|Sources\s*:|[a-z]\)\s)", re.IGNORECASE)
CONTINUATION_SIGNAL_RE = re.compile(r"(?i)(?:\bsuite\b|\(suite\)|à\s+suivre|continued?|continuation|en[- ]tête\s+(?:répété|repeated)|repeated\s+header)")


def _text(unit: dict) -> str:
    for key in ("text", "reading_text", "raw_text"):
        value = unit.get(key)
        if isinstance(value, str):
            return value
    return ""


def _page_index(record: dict) -> int:
    value = record.get("source_page_index")
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    start = record.get("source_page_index_start")
    return start if isinstance(start, int) and not isinstance(start, bool) else 0


def _unit_id(unit: dict) -> str | None:
    for key in ("unit_id", "id"):
        value = unit.get(key)
        if isinstance(value, str):
            return value
    return None


def _caption(text: str) -> tuple[str, str, str] | None:
    match = CAPTION_RE.match(text)
    if match is None:
        return None
    prefix = match.group(1).upper()
    caption = match.group(0).strip("\r\n")
    return prefix, caption, match.group(2).lstrip()


def _page_by_index(page_records: list[dict]) -> dict[int, dict]:
    return {_page_index(page): page for page in page_records if isinstance(page, dict)}


def _page_geometry(page: dict | None) -> dict:
    if page is None:
        return {"page_width": None, "page_height": None}
    return {
        "page_width": page.get("page_width"),
        "page_height": page.get("page_height"),
    }


def _caption_bbox(unit: dict) -> list | None:
    references = unit.get("source_block_references")
    if not isinstance(references, list) or not references:
        return None
    bbox = references[0].get("bbox") if isinstance(references[0], dict) else None
    return list(bbox) if isinstance(bbox, list) and len(bbox) == 4 else None


def _caption_occurrences(text: str) -> list[tuple[str, tuple[str, str, str]]]:
    occurrences = []
    for line in text.splitlines():
        caption_data = _caption(line)
        if caption_data is not None:
            occurrences.append((line.strip(), caption_data))
    return occurrences


def _caption_regions(units: list[dict], page_index: int, page: dict | None) -> list[tuple[object, list[float] | None, float, float, str]]:
    if page is None:
        return []
    height = page.get("page_height")
    height_value = float(height) if isinstance(height, (int, float)) else 0.0
    blocks = page.get("blocks")
    entries = []
    seen = set()
    if isinstance(blocks, list):
        for block in blocks:
            if not isinstance(block, dict):
                continue
            bbox = block.get("bbox")
            if not isinstance(bbox, list) or len(bbox) != 4:
                continue
            for key in ("text", "reading_text"):
                value = block.get(key)
                if not isinstance(value, str):
                    continue
                for line in value.splitlines():
                    caption_data = _caption(line)
                    if caption_data is None:
                        continue
                    caption = line.strip()
                    identity = (id(block), caption, tuple(bbox))
                    if identity in seen:
                        continue
                    seen.add(identity)
                    entries.append((block, list(bbox), float(bbox[1]), float(bbox[3]), caption))
    if not entries:
        for unit in units:
            if not isinstance(unit, dict) or _page_index(unit) != page_index:
                continue
            occurrences = _caption_occurrences(_text(unit))
            bbox = _caption_bbox(unit)
            if len(occurrences) == 1 and bbox is not None:
                entries.append((unit, bbox, float(bbox[1]), float(bbox[3]), occurrences[0][0]))
    entries.sort(key=lambda entry: (entry[2], entry[1][0], entry[4]))
    regions = []
    for position, entry in enumerate(entries):
        start = entry[2]
        end = entries[position + 1][2] if position + 1 < len(entries) else height_value or start + 1.0
        regions.append((entry[0], entry[1], start, max(end, start + 1.0), entry[4]))
    return regions


def _footnotes(page: dict | None, start: float | None, end: float | None) -> list[str]:
    if page is None or start is None or end is None:
        return []
    footnotes = []
    blocks = page.get("blocks")
    if not isinstance(blocks, list):
        return footnotes
    for block in blocks:
        if not isinstance(block, dict) or not isinstance(block.get("text"), str):
            continue
        bbox = block.get("bbox")
        if not isinstance(bbox, list) or len(bbox) != 4 or not (start <= float(bbox[1]) < end):
            continue
        if FOOTNOTE_RE.match(block["text"]):
            footnotes.append(block["text"])
    return footnotes


def _cell_relationships(page: dict | None, start: float | None, end: float | None) -> tuple[list[dict], int]:
    relationships = []
    if page is None or start is None or end is None or not isinstance(page.get("table_detections"), list):
        return relationships, 0
    for table in page["table_detections"]:
        if not isinstance(table, dict) or not isinstance(table.get("cells"), list):
            continue
        table_bbox = table.get("bbox")
        if not isinstance(table_bbox, list) or len(table_bbox) != 4:
            continue
        table_center = (float(table_bbox[1]) + float(table_bbox[3])) / 2.0
        if not (start <= table_center < end):
            continue
        for cell in table["cells"]:
            if not isinstance(cell, dict):
                continue
            relationships.append(
                {
                    "text": cell.get("text"),
                    "bbox": list(cell["bbox"]) if isinstance(cell.get("bbox"), list) and len(cell["bbox"]) == 4 else None,
                    "row": cell.get("row"),
                    "column": cell.get("column"),
                    "validation_status": "needs_review",
                }
            )
    return relationships, len(relationships)


def _logical_caption_key(content_type: str, visual_number: str | None, caption: str) -> tuple[str, str | None, str]:
    normalized = re.sub(r"\s*\(suite\)\s*$", "", caption, flags=re.IGNORECASE)
    normalized = re.sub(r"\s+", " ", normalized.strip().casefold())
    return content_type, visual_number, normalized


def _has_explicit_continuation_signal(caption: str, page: dict | None, caption_block: dict | None) -> bool:
    values = [caption]
    if isinstance(caption_block, dict):
        for key in ("text", "reading_text"):
            if isinstance(caption_block.get(key), str):
                values.append(caption_block[key])
    if isinstance(page, dict) and isinstance(caption_block, dict):
        blocks = page.get("blocks")
        if isinstance(blocks, list):
            for position, block in enumerate(blocks):
                if block is caption_block:
                    for neighbor in (position - 1, position + 1):
                        if 0 <= neighbor < len(blocks) and isinstance(blocks[neighbor], dict):
                            for key in ("text", "reading_text"):
                                if isinstance(blocks[neighbor].get(key), str):
                                    values.append(blocks[neighbor][key])
                    break
    return any(CONTINUATION_SIGNAL_RE.search(value) is not None for value in values)


def _caption_line(block: dict | None, caption: str, key: str) -> str | None:
    if not isinstance(block, dict) or not isinstance(block.get(key), str):
        return None
    for line in block[key].splitlines():
        if line.strip() == caption and _caption(line) is not None:
            return line
    return None


def _has_page_blocks(unit: dict, pages: dict[int, dict]) -> bool:
    start = unit.get("source_page_index_start") if isinstance(unit.get("source_page_index_start"), int) else _page_index(unit)
    end = unit.get("source_page_index_end") if isinstance(unit.get("source_page_index_end"), int) else start
    for page_index in range(start, end + 1):
        page = pages.get(page_index)
        blocks = page.get("blocks") if isinstance(page, dict) else None
        if isinstance(blocks, list) and any(isinstance(block, dict) and isinstance(block.get("text"), str) for block in blocks):
            return True
    return False


def _caption_page(unit: dict, pages: dict[int, dict], caption: str) -> tuple[dict | None, dict | None, int]:
    start = unit.get("source_page_index_start") if isinstance(unit.get("source_page_index_start"), int) else _page_index(unit)
    end = unit.get("source_page_index_end") if isinstance(unit.get("source_page_index_end"), int) else start
    for page_index in range(start, end + 1):
        page = pages.get(page_index)
        if page is None:
            continue
        blocks = page.get("blocks")
        if not isinstance(blocks, list):
            continue
        for block in blocks:
            if not isinstance(block, dict):
                continue
            if _caption_line(block, caption, "text") is not None or _caption_line(block, caption, "reading_text") is not None:
                return page, block, page_index
    fallback = pages.get(start)
    return fallback, None, start


def extract_visual_candidates(units: list[dict], page_records: list[dict]) -> list[dict]:
    pages = _page_by_index(page_records)
    caption_regions = {
        page_index: _caption_regions(units, page_index, page)
        for page_index, page in pages.items()
    }
    candidates = []
    occurrence_by_visual = {}
    for unit in units:
        if not isinstance(unit, dict):
            continue
        unit_text = _text(unit)
        if not unit_text:
            continue
        for caption, caption_data in _caption_occurrences(unit_text):
            prefix, caption_text, remainder = caption_data
            content_type = CONTENT_TYPES[prefix]
            page, caption_block, page_index = _caption_page(unit, pages, caption)
            if caption_block is None and _has_page_blocks(unit, pages):
                continue
            number_match = NUMBER_RE.search(remainder)
            visual_number = number_match.group(1) if number_match is not None else None
            logical_key = _logical_caption_key(content_type, visual_number, caption_text)
            occurrence = occurrence_by_visual.get(logical_key, 0)
            occurrence_by_visual[logical_key] = occurrence + 1
            source_span = (
                "p" + str(page_index) + ":b" + str(caption_block.get("block_index", 0))
                if caption_block is not None
                else "p" + str(page_index) + ":caption"
            )
            structural_path = unit.get("structural_path") if isinstance(unit.get("structural_path"), str) else "Tome 2/Hors structure/Page " + str(page_index + 1)
            candidate_id = stable_id("visual", SOURCE_VERSION, structural_path, source_span + ":" + caption_text, occurrence)
            caption_bbox = list(caption_block["bbox"]) if caption_block is not None and isinstance(caption_block.get("bbox"), list) and len(caption_block["bbox"]) == 4 else _caption_bbox(unit)
            region_owner = caption_block if caption_block is not None else unit
            region_matches = [
                entry
                for entry in caption_regions.get(page_index, [])
                if entry[0] is region_owner and entry[4] == caption and entry[1] == caption_bbox
            ]
            same_block_regions = [
                entry
                for entry in caption_regions.get(page_index, [])
                if entry[0] is region_owner and entry[1] == caption_bbox
            ]
            region = region_matches[0] if len(region_matches) == 1 and len(same_block_regions) == 1 else None
            region_start = region[2] if region is not None else None
            region_end = region[3] if region is not None else None
            cell_relationships, unresolved_cell_count = _cell_relationships(page, region_start, region_end)
            previous = next(
                (
                    candidate
                    for candidate in reversed(candidates)
                    if _logical_caption_key(candidate["content_type"], candidate["visual_number"], candidate["caption"]) == logical_key
                    and candidate["structural_path"] == structural_path
                    and visual_number is not None
                    and page_index == candidate["source_page_index_end"] + 1
                    and _has_explicit_continuation_signal(caption_text, page, caption_block)
                ),
                None,
            )
            continuation_of = previous["candidate_id"] if previous is not None else None
            if previous is not None and previous["continuation_candidate_ids"] is None:
                previous["continuation_candidate_ids"] = []
            if previous is not None:
                previous["continuation_candidate_ids"].append(candidate_id)
            caption_raw_text = _caption_line(caption_block, caption, "text") if caption_block is not None else None
            caption_reading_text = _caption_line(caption_block, caption, "reading_text") if caption_block is not None else None
            if caption_raw_text is None:
                caption_raw_text = caption_text
            if caption_reading_text is None:
                caption_reading_text = caption_raw_text
            source_block_references = []
            if caption_block is not None:
                caption_reference = {"block_index": caption_block.get("block_index", 0)}
                if isinstance(caption_block.get("bbox"), list) and len(caption_block["bbox"]) == 4:
                    caption_reference["bbox"] = list(caption_block["bbox"])
                if isinstance(caption_block.get("text_sha256"), str):
                    caption_reference["text_sha256"] = caption_block["text_sha256"]
                source_block_references = [caption_reference]
            if isinstance(page, dict) and "printed_page_number" in page:
                page_printed = page["printed_page_number"]
                if page_printed is not None and (not isinstance(page_printed, str) or not page_printed.strip()):
                    raise ValueError("printed_page_number must be a non-empty string or null")
                printed_start = page_printed
            elif isinstance(page, dict):
                raise ValueError("page record is missing printed_page_number")
            else:
                raise ValueError("page record is required for printed-page provenance")
            printed_end = printed_start
            candidates.append(
                {
                    "candidate_id": candidate_id,
                    "kind": "visual_candidate",
                    "content_type": content_type,
                    "caption": caption_text,
                    "visual_number": visual_number,
                    "host_unit_id": _unit_id(unit),
                    "structural_path": structural_path,
                    "source_span": source_span,
                    "source_page_index_start": page_index,
                    "source_page_index_end": page_index,
                    "printed_page_start": printed_start,
                    "printed_page_end": printed_end,
                    "mapping_status": unit.get("mapping_status") if isinstance(unit.get("mapping_status"), str) else "missing",
                    "raw_text": caption_raw_text,
                    "reading_text": caption_reading_text,
                    "source_block_references": source_block_references,
                    "page_geometry": _page_geometry(page),
                    "caption_bbox": caption_bbox,
                    "footnotes": _footnotes(page, region_start, region_end),
                    "cell_relationships": cell_relationships,
                    "unresolved_cell_count": unresolved_cell_count,
                    "continuation_of": continuation_of,
                    "continuation_candidate_ids": None,
                    "language": LANGUAGE,
                    "book_id": BOOK_ID,
                    "source_version": SOURCE_VERSION,
                    "ingestion_version": INGESTION_VERSION,
                    "extraction_status": "proposed",
                    "validation_status": "needs_review",
                    "risk_flags": ["visual_reconstruction_review"],
                }
            )
    return candidates
