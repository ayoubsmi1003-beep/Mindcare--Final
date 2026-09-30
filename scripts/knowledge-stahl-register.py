# -*- coding: utf-8 -*-
"""Stahl Prescriber's Guide 7e - canonical-v2 registration (Phase 1).
Scope: THIS BOOK ONLY. No OCR, no source mutation. Verified 2026-09-24:
2697 pp, embedded TOC 7280 entries, 152 drug monographs, no printed
folios (identity page map), uniform L2 template, cp1252 quote artefacts
(repair at distill time, never here)."""
import json, hashlib, sys, io
from pathlib import Path
import pymupdf
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "Books" / "prescribers-guide-stahls-essential-psychopharmacology.pdf"
BOOK_ID = "stahl-prescribers-guide-7e-cup"
raw = SRC.read_bytes()
sha = hashlib.sha256(raw).hexdigest()
SOURCE_VERSION = f"sha256:{sha}"
OUT = ROOT / "knowledge" / "canonical-v2" / BOOK_ID / f"sha256-{sha}"
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "segments").mkdir(exist_ok=True)
doc = pymupdf.open(SRC)
N = doc.page_count
assert N == 2697, f"unexpected page count {N}"
rows = [{"source_page_index": i, "printed_page_number": str(i),
         "page_mapping_status": "certain"} for i in range(1, N + 1)]
(OUT / "pages.map.json").write_text(json.dumps({
    "book_id": BOOK_ID, "source_version": SOURCE_VERSION,
    "rule": "printed = source_page_index (identity); file carries no printed "
            "folio numbers (edge-span hunt + no page labels); running head is "
            "the current drug name only",
    "offset": 0,
    "verified_anchors": "TOC L1: Acamprosate=24, Agomelatine=34, "
                        "Alprazolam=49, Amitriptyline=89, Zuclopenthixol=2549, "
                        "Index by Drug Name=2568, Abbreviations=2671",
    "pages": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
toc = doc.get_toc(simple=True)
l1 = [(t, p) for lv, t, p in toc if lv == 1]
BACK = ("Index by Drug Name", "Index by Use", "Index by Class",
        "Abbreviations", "Endmatter")
drugs = [(t, p) for (t, p) in l1 if p >= 24 and t not in BACK]
assert len(drugs) == 152, f"expected 152 drug L1s, got {len(drugs)}"
TEMPLATE_L2 = ["Therapeutics", "Side Effects", "Dosing and Use",
               "Special Populations", "The Art of Psychopharmacology",
               "The Art of Switching (when present)", "Suggested Reading"]
sections = [{
    "section_id": "front-matter",
    "title": "Half title / Title / Imprints / Contents / Introduction / "
             "List of icons",
    "depth": 0, "source_page_start": 1, "source_page_end": 23,
    "printed_page_start": "1", "printed_page_end": "23",
    "page_mapping_status": "certain"}]
for i, (t, p) in enumerate(drugs):
    end = drugs[i + 1][1] - 1 if i + 1 < len(drugs) else 2567
    secs = [tt for lv, tt, pp in toc if lv == 2 and p <= pp <= end]
    sections.append({"section_id": f"drug-{i+1:03d}", "title": t, "depth": 1,
                     "drug_index": i + 1, "l2_sections": secs,
                     "source_page_start": p, "source_page_end": end,
                     "printed_page_start": str(p),
                     "printed_page_end": str(end),
                     "page_mapping_status": "certain"})
sections.append({"section_id": "back-matter",
                 "title": "Index by Drug Name / Index by Use / Index by "
                          "Class / Abbreviations / Endmatter",
                 "depth": 0, "source_page_start": 2568,
                 "source_page_end": 2697, "printed_page_start": "2568",
                 "printed_page_end": "2697", "page_mapping_status": "certain"})
(OUT / "structure.json").write_text(json.dumps({
    "book_id": BOOK_ID, "source_version": SOURCE_VERSION,
    "hierarchy": "Book -> Drug monograph (152, L1) -> L2 template section -> "
                 "L3 subsection",
    "toc_source": "embedded PDF TOC (7280 entries), L1 drug count 152",
    "toc_drug_range": "Acamprosate src24 .. Zuclopenthixol src2549; "
                      "back matter src2568..2697",
    "body_start_source_page": 24,
    "heading_detection": "TOC L1/L2/L3 authoritative; running head (drug "
                         "name, y~73.6, Times 15) wins on conflict; section "
                         "heads bold Times 15, L2 banner 21.2",
    "monograph_template_l2": TEMPLATE_L2,
    "unlocated_sections": [],
    "sections": sections}, ensure_ascii=False, indent=1), encoding="utf-8")
SEG = 25
sindex = {"segment_pages": SEG, "segments": []}
for start in range(1, N + 1, SEG):
    end = min(start + SEG - 1, N)
    name = f"seg-{start:04d}-{end:04d}.pdf"
    sub = pymupdf.open()
    sub.insert_pdf(doc, from_page=start - 1, to_page=end - 1)
    sub.save(OUT / "segments" / name, deflate=True)
    sub.close()
    sindex["segments"].append({"file": name, "src_1based_start": start,
                               "src_1based_end": end})
(OUT / "segments" / "index.json").write_text(
    json.dumps(sindex, ensure_ascii=False, indent=1), encoding="utf-8")
meta = doc.metadata
(OUT / "book.json").write_text(json.dumps({
    "approved_at": None, "approved_by": None,
    "authors_editors": "Stephen M. Stahl; editorial assistant Meghan M. "
                       "Grady; illustrations by Nancy Muntner",
    "book_id": BOOK_ID, "classification": "C4",
    "edition": "Seventh edition (Stahl's Essential Psychopharmacology: "
               "Prescriber's Guide)",
    "extraction_status": "registered", "ingestion_version": "canonical-v2.1",
    "isbn": "978-1-108-92601-0 (Paperback); 978-1-108-92602-7 (Spiral)",
    "language": "en", "local_sha256": sha.upper(),
    "provenance_status": "registered", "publication_year": 2021,
    "publisher": "Cambridge University Press",
    "source_identifier": "Books/prescribers-guide-stahls-essential-"
                         "psychopharmacology.pdf",
    "source_note": "Text-native PDF (PDF 1.4, 2697 pp, LETTER 612x792). "
                   "Embedded TOC 7280 entries incl. per-drug L2/L3. No "
                   "printed folios (identity page map). cp1252 quote "
                   "artefacts; repair at distill time, no OCR.",
    "source_page_count": N, "source_version": SOURCE_VERSION,
    "statut": "discovered", "subtitle": "Stahl's Essential Psychopharmacology",
    "title": "Prescriber's Guide", "validation_status": "needs_review"},
    ensure_ascii=False, sort_keys=True), encoding="utf-8")
print("BOOK_ID:", BOOK_ID)
print("SOURCE_VERSION:", SOURCE_VERSION)
print("PAGES:", N, "| segments:", len(sindex["segments"]))
print("DRUGS:", len(drugs), "| first:", drugs[0], "| last:", drugs[-1])
print("PDF title:", meta.get("title"), "| author:", meta.get("author"))
