from __future__ import annotations

import re

from .page_mapping import visible_page_label

DOMAIN_GROUPS = (
    "Situations de crise",
    "Psychiatrie légale",
    "Pédopsychiatrie",
    "Gérontopsychiatrie",
    "Traitements biologiques",
    "Traitements psychosociaux",
)
PART_TITLES = {
    5: "Spécialités psychiatriques",
    6: "Traitements",
}
_PART_RE = re.compile(r"^PARTIE\s+([56])$", re.IGNORECASE)
_CHAPTER_LINE_RE = re.compile(r"^(\d{1,3})$")
_PAGE_AT_END_RE = re.compile(r"(\d{3,4})\s*$")
_CHAPTER_REF_RE = re.compile(r"(?i)\bchapitres?\s+(\d{1,3})(?:\s+et\s+(\d{1,3}))?")
_HEADING_RE = re.compile(r"^\s*(\d{2,3}[A-Z]?(?:\.\d+){1,3})\.?(?:\s+|$)(.*)$")


def _text(page_record: dict) -> str:
    for key in ("reading_text", "text", "raw_text"):
        value = page_record.get(key)
        if isinstance(value, str):
            return value
    return ""


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", text).upper()


def _clean_title(lines: list[str]) -> str:
    values = []
    for line in lines:
        cleaned = re.sub(r"\.{2,}\s*\d{3,4}\s*$", "", line.strip())
        cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
        if cleaned:
            values.append(cleaned)
    return " ".join(values)


def _toc_pages(page_records: list[dict]) -> list[tuple[int, int]]:
    pages = []
    for page_record in page_records:
        text = _text(page_record)
        index = page_record.get("source_page_index")
        if not isinstance(index, int):
            continue
        if "TOME 2" in text and "PARTIE 5" in text:
            pages.append((index, 2))
        elif "TOME 1" in text and "PARTIE 1" in text:
            pages.append((index, 1))
    return pages


def _parse_toc_page(page_record: dict, volume: int) -> list[dict]:
    lines = _text(page_record).splitlines()
    toc_index = page_record.get("source_page_index")
    if not isinstance(toc_index, int):
        return []
    records = []
    part_number = None
    domain_group = None
    in_chapters = False
    pending_chapter = None
    title_lines: list[str] = []

    def finish(printed_page: str | None) -> None:
        nonlocal pending_chapter, title_lines, domain_group
        if pending_chapter is None:
            return
        title = _clean_title(title_lines)
        records.append(
            {
                "chapter": pending_chapter,
                "title": title or None,
                "printed_page": printed_page,
                "part": "PARTIE " + str(part_number) if part_number is not None else None,
                "part_number": part_number,
                "domain_group": domain_group,
                "volume": volume,
                "source_page_index": None,
                "toc_source_page_index": toc_index,
                "kind": "toc_entry",
            }
        )
        pending_chapter = None
        title_lines = []

    for line in lines:
        stripped = line.strip()
        part_match = _PART_RE.match(stripped)
        if part_match:
            finish(None)
            part_number = int(part_match.group(1))
            domain_group = None
            in_chapters = False
            continue
        if stripped.upper() == "CHAPITRE":
            in_chapters = True
            continue
        if stripped in {"Références", "Index des auteurs", "Index des médicaments", "Index des sujets", "Crédits"}:
            finish(None)
            in_chapters = False
            continue
        if in_chapters:
            if pending_chapter is None and stripped in DOMAIN_GROUPS:
                domain_group = stripped
                continue
            chapter_match = _CHAPTER_LINE_RE.match(stripped)
            if chapter_match:
                finish(None)
                pending_chapter = int(chapter_match.group(1))
                title_lines = []
                continue
            if pending_chapter is not None:
                page_match = _PAGE_AT_END_RE.search(stripped)
                if page_match:
                    title_lines.append(stripped)
                    finish(page_match.group(1))
                elif stripped:
                    title_lines.append(stripped)
            continue
        if part_number is not None and stripped in DOMAIN_GROUPS:
            domain_group = stripped
    finish(None)
    return records


def _chapter_candidates(page_records: list[dict], chapter: int, toc_index: int) -> list[int]:
    marker = "CHAPITRE" + str(chapter)
    candidates = []
    for page_record in page_records:
        index = page_record.get("source_page_index")
        if not isinstance(index, int) or index <= toc_index:
            continue
        blocks = page_record.get("blocks")
        if isinstance(blocks, list) and blocks:
            height = page_record.get("page_height", 783)
            if not isinstance(height, (int, float)):
                height = 783
            matched = False
            for block in blocks:
                if not isinstance(block, dict):
                    continue
                bbox = block.get("bbox")
                block_text = block.get("text")
                if not isinstance(bbox, list) or len(bbox) != 4 or not isinstance(block_text, str):
                    continue
                y0 = bbox[1]
                if not isinstance(y0, (int, float)):
                    continue
                if y0 <= 5 or y0 >= height - 50:
                    if marker in _compact(block_text):
                        matched = True
                        break
            if not matched:
                continue
        elif marker not in _compact(_text(page_record)):
            continue
        candidates.append(index)
    return candidates


def _infer_source_page(page_records: list[dict], record: dict) -> tuple[int | None, str]:
    provided = record.get("source_page_index")
    if isinstance(provided, int) and not isinstance(provided, bool) and provided >= 0:
        return provided, "toc"
    chapter = record.get("chapter")
    printed = record.get("printed_page")
    if not isinstance(chapter, int) or not isinstance(printed, str):
        return None, "not_detected"
    toc_index = record.get("toc_source_page_index", 0)
    if not isinstance(toc_index, int):
        toc_index = 0
    candidates = _chapter_candidates(page_records, chapter, toc_index)
    if not candidates:
        return None, "not_detected"
    page_by_index = {
        record.get("source_page_index"): record
        for record in page_records
        if isinstance(record.get("source_page_index"), int)
    }
    first = candidates[0]
    first_record = page_by_index.get(first)
    if first_record is None:
        return None, "not_detected"
    visible = visible_page_label(first_record)
    if visible is not None and visible.get("label") == str(int(printed) + 1):
        return first - 1, "body_header"
    if visible is None and len(_text(first_record)) < 500:
        return first, "body_header"
    return first, "body_header"


def _default_part(chapter: int) -> int:
    return 5 if chapter <= 65 else 6


def _section_title(lines: list[str], position: int, number: str) -> tuple[str, str]:
    current = lines[position]
    match = _HEADING_RE.match(current)
    remainder = match.group(2).strip() if match else ""
    source = current.strip()
    if not remainder:
        for following in lines[position + 1 : position + 3]:
            candidate = following.strip()
            if not candidate or _HEADING_RE.match(candidate):
                break
            if len(candidate) <= 140:
                remainder = candidate
                source += "\n" + candidate
            break
    return remainder or number, source


def _build_sections(page_records: list[dict], chapter: int, start: int | None, end: int | None) -> tuple[list[dict], list[dict]]:
    sections: list[dict] = []
    subsections: list[dict] = []
    section_by_number: dict[str, dict] = {}
    if start is None:
        return sections, subsections
    page_by_index = {
        record.get("source_page_index"): record
        for record in page_records
        if isinstance(record.get("source_page_index"), int)
    }
    finish = end if end is not None else max(page_by_index, default=start)
    seen_sections: set[str] = set()
    seen_subsections: set[str] = set()
    for page_index in range(start, min(finish, max(page_by_index, default=start)) + 1):
        page_record = page_by_index.get(page_index)
        if page_record is None:
            continue
        lines = _text(page_record).splitlines()
        for position, line in enumerate(lines):
            match = _HEADING_RE.match(line)
            if match is None:
                continue
            number = match.group(1)
            root = number.split(".", 1)[0]
            if root != str(chapter) and not root.startswith(str(chapter) + "A") and not root.startswith(str(chapter) + "B"):
                continue
            title, source = _section_title(lines, position, number)
            depth = number.count(".")
            identifier = number.replace(".", "-")
            if depth == 1:
                if number in seen_sections:
                    continue
                seen_sections.add(number)
                node = {
                    "id": "chapter-" + str(chapter) + "-section-" + identifier,
                    "number": number,
                    "title": title,
                    "source_page_index": page_index,
                    "source_text": source,
                    "subsections": [],
                }
                section_by_number[number] = node
                sections.append(node)
            else:
                if number in seen_subsections:
                    continue
                seen_subsections.add(number)
                parent_number = ".".join(number.split(".")[:2])
                node = {
                    "id": "chapter-" + str(chapter) + "-subsection-" + identifier,
                    "number": number,
                    "title": title,
                    "source_page_index": page_index,
                    "source_text": source,
                    "parent_number": parent_number,
                }
                subsections.append(node)
                parent = section_by_number.get(parent_number)
                if parent is not None:
                    parent["subsections"].append(node)
    return sections, subsections


def _external_reference_records(toc_records: list[dict], page_records: list[dict]) -> list[dict]:
    references: list[dict] = []
    seen: set[tuple[int | None, int]] = set()
    for record in toc_records:
        chapter = record.get("chapter")
        volume = record.get("volume")
        target_scope = record.get("target_scope")
        if not isinstance(chapter, int):
            continue
        if target_scope not in {"tome-1", "external"} and volume not in (1, "1", "tome-1", "TOME 1"):
            continue
        if target_scope not in {"tome-1", "external"}:
            target_scope = "tome-1"
        source_index = record.get("toc_source_page_index")
        key = (source_index if isinstance(source_index, int) else None, chapter)
        if key in seen:
            continue
        seen.add(key)
        references.append(
            {
                "kind": "toc",
                "chapter": chapter,
                "title": record.get("title"),
                "printed_page": record.get("printed_page"),
                "source_page_index": source_index,
                "source_text": None,
                "target_scope": target_scope,
                "xref_status": "unresolved_external",
            }
        )
    for page_record in page_records:
        page_index = page_record.get("source_page_index")
        if not isinstance(page_index, int):
            continue
        text = _text(page_record)
        for match in _CHAPTER_REF_RE.finditer(text):
            targets = [int(match.group(1))]
            if match.group(2) is not None:
                targets.append(int(match.group(2)))
            for target in targets:
                if target < 49 or target > 85:
                    key = (page_index, target)
                    if key in seen:
                        continue
                    seen.add(key)
                    references.append(
                        {
                            "kind": "text",
                            "chapter": target,
                            "title": None,
                            "printed_page": None,
                            "source_page_index": page_index,
                            "source_text": match.group(0),
                            "target_scope": "tome-1",
                            "xref_status": "unresolved_external",
                        }
                    )
    return references


def _is_toc_page(page_record: dict) -> bool:
    text = _text(page_record)
    return "Table des matières" in text or ("TOME 1" in text and "PARTIE 1" in text)


def _part_tree(chapters: list[dict]) -> list[dict]:
    result = []
    for number in (5, 6):
        part_chapters = [chapter for chapter in chapters if chapter.get("part_number") == number]
        groups = []
        group_names = []
        for chapter in part_chapters:
            group = chapter.get("domain_group")
            if group is not None and group not in group_names:
                group_names.append(group)
        for group in group_names:
            groups.append(
                {
                    "name": group,
                    "chapters": [chapter["chapter"] for chapter in part_chapters if chapter.get("domain_group") == group],
                }
            )
        result.append(
            {
                "number": number,
                "label": "PARTIE " + str(number),
                "title": PART_TITLES[number],
                "domain_groups": groups,
                "chapters": [chapter["chapter"] for chapter in part_chapters],
            }
        )
    return result


def parse_toc_records(page_records: list[dict]) -> list[dict]:
    records = []
    for toc_index, volume in _toc_pages(page_records):
        for page_record in page_records:
            if page_record.get("source_page_index") == toc_index:
                records.extend(_parse_toc_page(page_record, volume))
                break
    for record in records:
        if record.get("volume") != 2:
            continue
        source_index, source_method = _infer_source_page(page_records, record)
        record["source_page_index"] = source_index
        record["body_opening_source"] = source_method
    return records


def build_structure(page_records: list[dict], toc_records: list[dict]) -> dict:
    pages = sorted(
        (record for record in page_records if isinstance(record, dict)),
        key=lambda record: int(record.get("source_page_index", 0)),
    )
    if not toc_records:
        toc_records = parse_toc_records(pages)
    by_chapter: dict[int, dict] = {}
    for record in toc_records:
        if not isinstance(record, dict):
            continue
        chapter = record.get("chapter")
        if not isinstance(chapter, int) or chapter in by_chapter:
            continue
        by_chapter[chapter] = dict(record)
    chapters = []
    for chapter in range(49, 86):
        record = by_chapter.get(chapter)
        if record is None:
            continue
        part_number = record.get("part_number")
        if part_number not in (5, 6):
            part_number = _default_part(chapter)
        source_index, source_method = _infer_source_page(pages, record)
        chapter_record = {
            "id": "chapter-" + str(chapter),
            "chapter": chapter,
            "title": record.get("title"),
            "part": "PARTIE " + str(part_number),
            "part_number": part_number,
            "domain_group": record.get("domain_group"),
            "printed_page_start": record.get("printed_page"),
            "printed_start_page": record.get("printed_page"),
            "page_start": source_index,
            "page_end": None,
            "body_opening_detected": source_index is not None,
            "body_opening_source": source_method,
            "sections": [],
            "subsections": [],
            "qa_flags": [],
        }
        chapters.append(chapter_record)
    starts = [chapter["page_start"] for chapter in chapters if chapter["page_start"] is not None]
    body_end = None
    for page_record in pages:
        label = visible_page_label(page_record)
        if label is not None and str(label.get("label", "")).isdigit() and int(label["label"]) >= 1000:
            index = page_record.get("source_page_index")
            if isinstance(index, int):
                body_end = index if body_end is None else max(body_end, index)
    for position, chapter in enumerate(chapters):
        next_start = None
        for later in chapters[position + 1 :]:
            if later["page_start"] is not None:
                next_start = later["page_start"]
                break
        if next_start is not None:
            chapter["page_end"] = next_start - 1
        elif starts:
            chapter["page_end"] = body_end if body_end is not None else max(starts)
        if chapter["page_start"] is not None:
            chapter["sections"], chapter["subsections"] = _build_sections(pages, chapter["chapter"], chapter["page_start"], chapter["page_end"])
    external_references = _external_reference_records(toc_records, pages)
    body_indices = set()
    for chapter in chapters:
        if chapter["page_start"] is None:
            continue
        end = chapter["page_end"] if chapter["page_end"] is not None else chapter["page_start"]
        body_indices.update(range(chapter["page_start"], end + 1))
    off_structure = []
    orphan_context = []
    for page_record in pages:
        index = page_record.get("source_page_index")
        text = _text(page_record)
        if not isinstance(index, int) or not text.strip() or index in body_indices or _is_toc_page(page_record):
            continue
        record = {
            "source_page_index": index,
            "text": text,
            "qa_flag": "off_structure",
            "reason": "no verified Tome 2 body node",
        }
        if index >= 18 and index <= 736:
            record["qa_flag"] = "orphan_context"
            orphan_context.append(record)
        else:
            off_structure.append(record)
    unmatched_toc_entries = []
    for chapter in range(49, 86):
        record = by_chapter.get(chapter)
        if record is None:
            unmatched_toc_entries.append({"chapter": chapter, "reason": "missing_toc_entry"})
        elif record.get("title") is None or record.get("printed_page") is None:
            unmatched_toc_entries.append({"chapter": chapter, "reason": "incomplete_toc_entry", "toc": record})
    flags = []
    if external_references:
        flags.append("unresolved_external_tome1_references")
    if unmatched_toc_entries:
        flags.append("unmatched_toc_entries")
    if orphan_context:
        flags.append("orphan_context")
    return {
        "tome": {"number": 2, "label": "TOME 2"},
        "parts": _part_tree(chapters),
        "chapters": chapters,
        "external_references": external_references,
        "off_structure": off_structure,
        "orphan_context": orphan_context,
        "unmatched_toc_entries": unmatched_toc_entries,
        "qa": {
            "status": "WARNING" if flags else "PASS",
            "flags": flags,
            "chapter_count": len(chapters),
            "part_count": 2,
            "external_reference_count": len(external_references),
            "unmatched_toc_count": len(unmatched_toc_entries),
            "off_structure_count": len(off_structure),
            "orphan_context_count": len(orphan_context),
        },
    }
