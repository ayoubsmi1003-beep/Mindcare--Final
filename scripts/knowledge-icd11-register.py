# -*- coding: utf-8 -*-
"""
ICD-11 Reference Guide — canonical-v2 registration (Phase 1 + page map + structure anchors).
Deterministic, no OCR, no content mutation of the source. Source of truth = original PDF.
"""
import json, re, hashlib, sys, io
from pathlib import Path
import pymupdf

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "Books" / "ICD-11 Reference Guide.pdf"
BOOK_ID = "icd11-ref-guide-2022-who"

sha = hashlib.sha256(SRC.read_bytes()).hexdigest()
SOURCE_VERSION = f"sha256:{sha}"
OUT = ROOT / "knowledge" / "canonical-v2" / BOOK_ID / f"sha256-{sha}"
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "segments").mkdir(exist_ok=True)

doc = pymupdf.open(SRC)
N = doc.page_count
assert N == 473, f"unexpected page count {N}"

# ---- pages.map: printed = src_1based - 2 for src>=3 (471/471 anchors checked)
rows = []
for idx1 in range(1, N + 1):
    if idx1 == 1:
        rows.append({"source_page_index": idx1, "printed_page_number": None,
                     "page_mapping_status": "certain", "note": "cover"})
    elif idx1 == 2:
        rows.append({"source_page_index": idx1, "printed_page_number": None,
                     "page_mapping_status": "certain", "note": "blank page (no text)"})
    else:
        rows.append({"source_page_index": idx1, "printed_page_number": str(idx1 - 2),
                     "page_mapping_status": "certain"})
pages_map = {
    "book_id": BOOK_ID,
    "source_version": SOURCE_VERSION,
    "rule": "printed = source_page_index - 2 for source_page_index >= 3; src 1 cover, src 2 blank",
    "offset": -2,
    "verified_anchors": "471/471 body pages carry a printed number equal to src-2 (scripted check)",
    "pages": rows,
}
(OUT / "pages.map.json").write_text(
    json.dumps(pages_map, ensure_ascii=False, indent=1), encoding="utf-8")

# ---- TOC parse: spans src 4 (bottom) .. src 24 (printed 2..22)
SEC_PAT = re.compile(r"^(\d+(?:\.\d+){0,5})\s*(\S.*)$")
toc_entries = []
for i in range(3, 24):
    for raw in doc[i].get_text().splitlines():
        line = raw.strip()
        if not line:
            continue
        m = SEC_PAT.match(line)
        if m and len(m.group(2)) >= 2:
            toc_entries.append([m.group(1), m.group(2).strip()])
        elif toc_entries and not re.match(r"^\d+(\.\d+)*$", line):
            prev = toc_entries[-1]
            if (len(prev[1]) + len(line) < 110
                    and not line.startswith(("ICD-11 Reference Guide", "ICD-11 MMS"))
                    and not line.isdigit()):
                prev[1] = (prev[1] + " " + line).strip()

seen, uniq = set(), []
for sid, title in toc_entries:
    if sid not in seen:
        seen.add(sid)
        uniq.append((sid, title))

# ---- locate body anchors (body starts src 25; headings flat Calibri 12pt,
# detected only by numbered pattern; TOC list is the authoritative section set)
toc_titles = dict(uniq)
body_first = {}
for i in range(24, N):
    for raw in doc[i].get_text().splitlines():
        line = raw.strip()
        m = SEC_PAT.match(line)
        if m and m.group(1) in toc_titles and m.group(1) not in body_first:
            cand = m.group(2).strip().lower().replace("\u2013", "-")
            toc = toc_titles[m.group(1)].lower().replace("\u2013", "-")
            if cand[:10] == toc[:10]:
                body_first[m.group(1)] = i + 1

nodes = []
for sid, title in uniq:
    src = body_first.get(sid)
    nodes.append({
        "section_id": sid,
        "title": title,
        "depth": sid.count("."),
        "source_page_start": src,
        "printed_page_start": (str(src - 2) if src and src >= 3 else None),
        "page_mapping_status": "certain" if src else "uncertain",
    })
missing = [n["section_id"] for n in nodes if n["source_page_start"] is None]

structure = {
    "book_id": BOOK_ID,
    "source_version": SOURCE_VERSION,
    "hierarchy": "Book -> Part (0..3) -> numbered sections (depth = dot count)",
    "toc_source_pages": "src 4(bottom)..24 = printed 2(bottom)..22",
    "body_start_source_page": 25,
    "heading_detection": "numbered pattern ^N(.N){0,5} Title; typography flat "
                         "(Calibri 12pt everywhere, headings not bold/larger)",
    "unlocated_sections": missing,
    "sections": nodes,
}
(OUT / "structure.json").write_text(
    json.dumps(structure, ensure_ascii=False, indent=1), encoding="utf-8")

# ---- segments (25 source pages each)
SEG = 25
index = {"segment_pages": SEG, "segments": []}
for start in range(1, N + 1, SEG):
    end = min(start + SEG - 1, N)
    name = f"seg-{start:04d}-{end:04d}.pdf"
    sub = pymupdf.open()
    sub.insert_pdf(doc, from_page=start - 1, to_page=end - 1)
    sub.save(OUT / "segments" / name, deflate=True)
    sub.close()
    index["segments"].append(
        {"file": name, "src_1based_start": start, "src_1based_end": end})
(OUT / "segments" / "index.json").write_text(
    json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

# ---- book.json
book = {
    "approved_at": None,
    "approved_by": None,
    "authors_editors": "World Health Organization",
    "book_id": BOOK_ID,
    "classification": "C4",
    "edition": "Eleventh Revision (ICD-11), Reference Guide",
    "extraction_status": "registered",
    "ingestion_version": "canonical-v2.1",
    "isbn": None,
    "language": "en",
    "license": "CC BY-ND 3.0 IGO (WHO 2022): verbatim copying with citation allowed; "
               "no derivatives; internal clinical knowledge use to be confirmed by human",
    "local_sha256": sha.upper(),
    "provenance_status": "registered",
    "publication_year": 2022,
    "publisher": "World Health Organization, Geneva",
    "source_identifier": "Books/ICD-11 Reference Guide.pdf",
    "source_note": "WHO portable PDF of the ICD-11 Reference Guide (definitive version: "
                   "https://icd.who.int/browse11/l-m/en). File metadata show recompilation "
                   "via Microsoft Word LTSC (D:20260309); printed pagination verified "
                   "intact 1:1 (offset -2); text layer clean UTF-8, no OCR used.",
    "source_page_count": N,
    "source_version": SOURCE_VERSION,
    "statut": "discovered",
    "subtitle": "International Classification of Diseases for Mortality and Morbidity Statistics",
    "title": "ICD-11 Reference Guide",
    "validation_status": "needs_review",
}
(OUT / "book.json").write_text(
    json.dumps(book, ensure_ascii=False, sort_keys=True), encoding="utf-8")

print("BOOK_ID:", BOOK_ID)
print("SOURCE_VERSION:", SOURCE_VERSION)
print("PAGES:", N, "| segments:", len(index["segments"]))
print("TOC sections parsed:", len(uniq), "| located in body:", len(body_first),
      "| unlocated:", len(missing))
print("UNLOCATED:", missing[:40])
