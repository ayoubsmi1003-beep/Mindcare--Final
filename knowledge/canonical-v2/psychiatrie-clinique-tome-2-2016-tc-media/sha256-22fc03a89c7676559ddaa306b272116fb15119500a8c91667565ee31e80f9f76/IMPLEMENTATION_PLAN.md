# Psychiatrie clinique Tome 2 Canonical Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a deterministic, provenance-complete canonical representation of only *Psychiatrie clinique : Approche bio-psycho-sociale*, Tome 2, from the immutable 826-page PDF, then freeze it at QA/review with no chunking, embeddings, database writes, or activation.

**Architecture:** A book-local Python 3.14 tool uses PyMuPDF 1.28.2 for independent native-page extraction, immutable raw records, allowlisted glyph repairs with a full ledger, piecewise printed-page mapping, structural/content-unit generation, and deterministic JSONL serialization. Clinical semantic proposals are produced in four isolated chapter batches, validated against one book-local contract, merged only after validation, and followed by fail-closed QA/replay/freeze.

**Tech Stack:** Python 3.14.7; PyMuPDF 1.28.2; fontTools available in the local Python environment; Python standard library (`argparse`, `hashlib`, `json`, `pathlib`, `re`, `unicodedata`, `unittest`); JSON and JSONL; SHA-256; no network; no OCR; no PostgreSQL; no shared package changes.

**Spec:** `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/KNOWLEDGE_INGESTION_PLAN.md`

## Global Constraints

- Process only `Books/psychiatrie-clinique-approche-bio-psycho-sociale-tome-2-.pdf`.
- Write only under `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/` and the already-created task manifest.
- Do not modify `package.json`, shared scripts, shared schemas, migrations, database tables, graphify/OCR artifacts, other books, `STATE.md`, `docs/archive/`, or `fr.ts`.
- Preserve `source_page_index` separately from exact `printed_page_number`; never invent a printed page.
- Preserve raw decoder output; every reading-layer repair is explicit in `repairs.jsonl`.
- No OCR, translation, synonym substitution, dose conversion, medical correction, clinical activation, chunking, embedding, or retrieval indexing.
- External references to Chapters 1–48 and other Tome 1 material are `unresolved_external`; no Tome 1 content is loaded.
- All medication numerics, routes, frequencies, contraindications, interactions, thresholds, tables, algorithms, ambiguous page mappings, and low-confidence records enter the review queue.
- `PASS`, `WARNING`, and `BLOCKED` must be evidence-backed; a skipped check is `NOT RUN`, never an implicit pass.
- Do not commit changes. This repository has concurrent uncommitted work; use the book-local checkpoint files as review boundaries.
- Use `python -m unittest` for the standalone tool. Run the repository `pnpm lint` and `pnpm typecheck` at final verification because those commands are provided by the project, even though shared files are not modified.

Before running any book-local Python command in this plan, set the following PowerShell values once in the current shell:

```powershell
$env:TARGET = 'knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76'
$env:PYTHONPATH = $env:TARGET
$env:PYTHONDONTWRITEBYTECODE = '1'
```

The target-relative imports in the book-local tests require `$env:PYTHONPATH`; this setup is part of every command sequence below.

Create these book-local implementation files:

```text
knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/
  tools/
    ingest_book.py
    canon_v2/
      __init__.py
      constants.py
      serialization.py
      source_lock.py
      page_extraction.py
      text_repair.py
      page_mapping.py
      structure.py
      units.py
      visuals.py
      medications.py
      semantic_contract.py
      qa.py
  schema/
    canonical-v2.1-tome2.schema.json
  tests/
    test_serialization.py
    test_source_lock.py
    test_page_extraction.py
    test_text_repair.py
    test_page_mapping.py
    test_structure.py
    test_units.py
    test_visuals.py
    test_medications.py
    test_semantic_contract.py
    test_qa.py
  semantic/
    proposals/
      part-a-49-54.jsonl
      part-b-55-65.jsonl
      part-c-66-72.jsonl
      part-d-73-85.jsonl
  work/
    chapters/
    replay/
```

`tools/ingest_book.py` is the only executable entry point. The `canon_v2` modules have no database or network imports. `semantic/proposals/` is an intermediate, validated input to the merge step; it is not an independent source of truth.

---

### Task 1: Define the book-local schema and deterministic serializer

**Files:**
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tools/canon_v2/constants.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tools/canon_v2/serialization.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tools/canon_v2/__init__.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/schema/canonical-v2.1-tome2.schema.json`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tests/test_serialization.py`

**Interfaces:**
- `canonical_json(value: object) -> str` returns UTF-8 JSON with sorted keys, compact separators, and one terminal newline.
- `sha256_bytes(value: bytes) -> str` returns lowercase hexadecimal SHA-256.
- `stable_id(kind: str, source_version: str, structural_path: str, source_span: str, occurrence: int) -> str` returns `kind + ":" + sha256(canonical fields)`.
- `write_json(path: Path, value: object) -> str` writes canonical JSON and returns its SHA-256.
- `write_jsonl(path: Path, records: Iterable[dict]) -> str` writes one canonical JSON object per line and returns the file SHA-256.
- `read_jsonl(path: Path) -> list[dict]` rejects malformed JSONL and non-object rows.
- `validate_record(record: dict) -> dict` validates the book-local envelope and closed enum vocabularies, returning the normalized record or raising `ValueError`.

- [ ] **Step 1: Write failing serializer tests.**

```python
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from tools.canon_v2.serialization import canonical_json, stable_id, write_jsonl


class SerializationTests(unittest.TestCase):
    def test_canonical_json_is_order_independent(self):
        left = canonical_json({"b": 2, "a": 1})
        right = canonical_json({"a": 1, "b": 2})
        self.assertEqual(left, right)
        self.assertTrue(left.endswith("\n"))

    def test_stable_id_changes_with_occurrence(self):
        first = stable_id("unit", "sha256:abc", "Part 5/Chapter 49", "p1:0-10", 1)
        second = stable_id("unit", "sha256:abc", "Part 5/Chapter 49", "p1:0-10", 2)
        self.assertNotEqual(first, second)

    def test_jsonl_rejects_non_object(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "records.jsonl"
            path.write_text("[]\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                from tools.canon_v2.serialization import read_jsonl
                read_jsonl(path)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the focused test and verify the red state.**

Run from the repository root:

```powershell
python -m unittest "$env:TARGET\tests\test_serialization.py" -v
```

Expected result: import or symbol failure because the book-local modules do not exist yet.

- [ ] **Step 3: Implement the serializer and constants.**

`constants.py` must define:

```python
BOOK_ID = "psychiatrie-clinique-tome-2-2016-tc-media"
SOURCE_VERSION = "sha256:22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76"
SOURCE_PDF = "Books/psychiatrie-clinique-approche-bio-psycho-sociale-tome-2-.pdf"
SOURCE_PAGE_COUNT = 826
INGESTION_VERSION = "canonical-v2.1-tome2"
LANGUAGE = "fr"
```

`serialization.py` must use `json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))`, reject non-JSON values, and use UTF-8 without a BOM. The schema must define required fields and closed enums for `mapping_status`, `validation_status`, `content_type`, `printed_page_kind`, and `xref_status`.

- [ ] **Step 4: Run the focused test and JSON syntax validation.**

```powershell
python -m unittest "$env:TARGET\tests\test_serialization.py" -v
python -m json.tool "$env:TARGET\schema\canonical-v2.1-tome2.schema.json" > $null
```

Expected result: all serializer tests pass and the schema parses.

- [ ] **Step 5: Record the checkpoint.**

Write the test command outputs to `checkpoints/serialization.json` with command, exit code, timestamp, and Python version. Do not commit.

---

### Task 2: Lock the source and extract every page independently

**Files:**
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tools/canon_v2/source_lock.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tools/canon_v2/page_extraction.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tools/ingest_book.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tests/test_source_lock.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tests/test_page_extraction.py`

**Interfaces:**
- `register_source(pdf_path: Path, output_dir: Path, expected_hash: str = SOURCE_VERSION) -> dict` writes `source-lock.json` and returns the lock record.
- `extract_pages(pdf_path: Path, output_dir: Path, resume: bool = True) -> dict` writes `raw/pages.jsonl`, `raw/blocks.jsonl`, and `checkpoints/extract-pages.jsonl`.
- `extract_page(document: pymupdf.Document, page_index: int) -> dict` returns page metadata, raw text, block coordinates, and a per-page terminal status.
- `ingest_book.py register --pdf PATH --output PATH` and `ingest_book.py extract --pdf PATH --output PATH` are the CLI commands.

- [ ] **Step 1: Write source-lock and extraction tests.**

```python
import hashlib
import tempfile
import unittest
from pathlib import Path

import pymupdf

from tools.canon_v2.page_extraction import extract_pages
from tools.canon_v2.source_lock import register_source


class SourceAndPageTests(unittest.TestCase):
    def test_register_rejects_wrong_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = root / "book.pdf"
            document = pymupdf.open()
            document.new_page()
            document.save(pdf)
            document.close()
            with self.assertRaises(ValueError):
                register_source(pdf, root / "out", expected_hash="sha256:" + "0" * 64)

    def test_extract_records_blank_page(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = root / "book.pdf"
            document = pymupdf.open()
            document.new_page()
            document.new_page()
            document.save(pdf)
            document.close()
            summary = extract_pages(pdf, root / "out", resume=False)
            self.assertEqual(summary["page_count"], 2)
            self.assertEqual(summary["terminal_pages"], 2)
            self.assertEqual(summary["missing_pages"], 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the focused tests and verify the red state.**

```powershell
python -m unittest "$env:TARGET\tests\test_source_lock.py" "$env:TARGET\tests\test_page_extraction.py" -v
```

Expected result: import or symbol failure before implementation.

- [ ] **Step 3: Implement source locking.**

The lock must calculate SHA-256 in streaming chunks, compare it to the frozen value, open the PDF with PyMuPDF, record `page_count`, PDF metadata, parser version, and the source path. A mismatch must raise `ValueError` before creating extraction records. The lock must not read `.env`, contact a network, or open a database.

- [ ] **Step 4: Implement independent page extraction.**

For each zero-based page index, extract text blocks with coordinates and write one raw page record. A successful empty page is `blank`, not an error. A parser exception is `needs_review` with the exception class and page index. Resume skips only a checkpoint whose source hash, page index, and raw hash match; otherwise it re-extracts that page.

The raw page record must contain:

```python
{
    "source_page_index": 0,
    "source_page_display": 1,
    "raw_text": "",
    "raw_sha256": "",
    "block_count": 0,
    "blocks": [],
    "extraction_status": "auto_ok",
    "parser": "pymupdf-1.28.2"
}
```

- [ ] **Step 5: Implement the CLI commands.**

`register` and `extract` must resolve paths relative to the repository root, create only directories below the supplied output directory, and return nonzero on a source mismatch or unrecoverable page failure. The extract command must support `--resume` and `--no-resume`.

- [ ] **Step 6: Run the focused tests and inspect the real source.**

```powershell
python -m unittest "$env:TARGET\tests\test_source_lock.py" "$env:TARGET\tests\test_page_extraction.py" -v
python "$env:TARGET\tools\ingest_book.py" register --pdf "$env:PDF" --output "$env:TARGET"
python "$env:TARGET\tools\ingest_book.py" extract --pdf "$env:PDF" --output "$env:TARGET" --no-resume
```

Expected result: 826 page checkpoints, 826 raw page records including the blank source page, and no database or network access.

- [ ] **Step 7: Record the checkpoint.**

Write command, source hash, page count, raw file hashes, and any failed page indices to `checkpoints/register.json` and `checkpoints/extract-pages.jsonl`.

---

### Task 3: Build the verified glyph-repair map and repair ledger

**Files:**
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tools/canon_v2/text_repair.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tests/test_text_repair.py`

**Interfaces:**
- `build_repair_map(raw_pages: Iterable[dict], pdf_path: Path) -> dict` returns explicit rules and unresolved codepoints.
- `repair_text(raw_text: str, rule_map: dict, page_index: int, block_index: int) -> tuple[str, list[dict]]` returns reading text and repair events.
- `repair_pages(raw_pages_path: Path, output_dir: Path) -> dict` writes `checkpoints/repair-map.json`, `repairs.jsonl`, and repaired page records.

- [ ] **Step 1: Write repair tests.**

```python
import unittest

from tools.canon_v2.text_repair import repair_text


class TextRepairTests(unittest.TestCase):
    def test_unmapped_private_use_character_is_preserved(self):
        text, repairs = repair_text("ab", {}, 3, 0)
        self.assertEqual(text, "ab")
        self.assertEqual(repairs, [])

    def test_explicit_mapping_is_logged_with_offsets(self):
        rules = {"": {"replacement": "fi", "rule_id": "pua-e00c-fi"}}
        text, repairs = repair_text("ab", rules, 3, 0)
        self.assertEqual(text, "afib")
        self.assertEqual(repairs[0]["raw_offset"], 1)
        self.assertEqual(repairs[0]["replacement"], "fi")

    def test_unknown_rule_cannot_change_numbers_or_doses(self):
        text, repairs = repair_text("100 mg", {}, 4, 0)
        self.assertEqual(text, "100 mg")
        self.assertEqual(repairs, [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the focused test and verify the red state.**

```powershell
python -m unittest "$env:TARGET\tests\test_text_repair.py" -v
```

Expected result: import or symbol failure before implementation.

- [ ] **Step 3: Implement conservative map discovery.**

Scan every raw page for private-use codepoints. For each affected font, use PyMuPDF font extraction and `fontTools.ttLib.TTFont` to inspect embedded glyph names and Unicode mappings. A rule is eligible only when the glyph identity and Unicode replacement agree across the source font data and at least one source context. Store the rule with raw codepoint, replacement, glyph name, font identity, evidence page numbers, and review state.

Unmapped private-use characters remain unchanged and generate a review event. Never use a broad Unicode replacement table, a language model guess, or OCR to fill them. The observed source inventory must be recorded in `checkpoints/repair-map.json`, including the total private-use count and every unresolved codepoint.

- [ ] **Step 4: Implement logged reading text.**

Apply only explicit rules. For each changed character, record page index, block index, raw offset, raw codepoint, replacement, rule ID, confidence, and review status. Preserve line breaks in raw records. A line-break join is allowed only when the block geometry and adjacent characters prove a hyphenated word; it receives its own rule and repair event.

- [ ] **Step 5: Run tests and inspect the real repair inventory.**

```powershell
python -m unittest "$env:TARGET\tests\test_text_repair.py" -v
python "$env:TARGET\tools\ingest_book.py" repair-map --pdf "$env:PDF" --output "$env:TARGET"
python "$env:TARGET\tools\ingest_book.py" repair --output "$env:TARGET" --resume
```

Expected result: a deterministic rule map, a non-empty repair ledger for verified glyphs, unchanged raw pages, and explicit unresolved events for any character that cannot be verified.

- [ ] **Step 6: Record the checkpoint.**

Write rule-map hash, raw-page hash, repair count by rule, unresolved count, and changed-page list to `checkpoints/text-repair.json`.

---

### Task 4: Map printed pages and reconstruct the book hierarchy

**Files:**
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tools/canon_v2/page_mapping.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tools/canon_v2/structure.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tests/test_page_mapping.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tests/test_structure.py`

**Interfaces:**
- `map_pages(page_records: list[dict], toc_records: list[dict]) -> list[dict]` returns one mapping row per source page.
- `build_structure(page_records: list[dict], toc_records: list[dict]) -> dict` returns the Part/domain-group/Chapter/Section/Subsection tree.
- `ingest_book.py map-pages --output PATH` and `ingest_book.py structure --output PATH` run the two stages.

- [ ] **Step 1: Write mapping and structure tests.**

```python
import unittest

from tools.canon_v2.page_mapping import map_pages
from tools.canon_v2.structure import build_structure


class MappingAndStructureTests(unittest.TestCase):
    def test_body_mapping_uses_observed_anchor_and_keeps_status(self):
        pages = [
            {"source_page_index": 18, "text": "Chapitre 49"},
            {"source_page_index": 19, "text": "1084 Psychiatrie clinique"},
        ]
        toc = [{"chapter": 49, "printed_page": "1083", "source_page_index": 18}]
        rows = map_pages(pages, toc)
        self.assertEqual(rows[1]["printed_page_number"], "1084")
        self.assertEqual(rows[1]["mapping_status"], "certain")
        self.assertEqual(rows[0]["mapping_status"], "inferred")

    def test_external_reference_is_not_a_body_node(self):
        tree = build_structure(
            [{"source_page_index": 0, "text": "Table des matières", "kind": "toc"}],
            [{"chapter": 1, "printed_page": "20", "volume": 1}],
        )
        self.assertNotIn(1, [node["chapter"] for node in tree["chapters"] if "chapter" in node])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the focused tests and verify the red state.**

```powershell
python -m unittest "$env:TARGET\tests\test_page_mapping.py" "$env:TARGET\tests\test_structure.py" -v
```

Expected result: import or symbol failure before implementation.

- [ ] **Step 3: Implement piecewise page mapping.**

Parse visible printed labels from page headers, footers, and page text. Use the following evidence classes: `visible_label`, `toc_entry`, `body_anchor`, `index_label`, `credits_label`, `blank_page`, and `back_cover`. Calibrate the body offset only between verified body anchors. A page whose label is absent but whose position is inside a verified piecewise range is `inferred`, not `certain`.

The mapping output must contain all page-index rows, including front matter, blank page 825, and back-cover page 826. The page map must never assign a numeric printed page to a cover, blank, or back-cover page without visible evidence.

- [ ] **Step 4: Implement the Tome 2 structure.**

Read the Tome 2 TOC and retain `TOME 2`, `PARTIE 5`, `PARTIE 6`, domain groups, Chapters 49–85, and their printed start pages. Reject Chapters 1–48 as body nodes. Detect body chapter openings and numbered sections, link TOC nodes to body nodes, and retain unmatched text as `off_structure` or `orphan_context` with a QA flag.

- [ ] **Step 5: Run tests and the real mapping stages.**

```powershell
python -m unittest "$env:TARGET\tests\test_page_mapping.py" "$env:TARGET\tests\test_structure.py" -v
python "$env:TARGET\tools\ingest_book.py" map-pages --output "$env:TARGET"
python "$env:TARGET\tools\ingest_book.py" structure --output "$env:TARGET"
```

Expected result: 826 page-map rows, a two-part hierarchy containing Chapters 49–85, explicit external Tome 1 references, and no invented page labels.

- [ ] **Step 6: Record the checkpoint.**

Write the anchor list, piecewise rules, uncertain page indices, chapter count, unmatched TOC entries, and file hashes to `checkpoints/page-map.json` and `checkpoints/structure.json`.

---

### Task 5: Create typed content units, visual candidates, and medication candidates

**Files:**
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tools/canon_v2/units.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tools/canon_v2/visuals.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tools/canon_v2/medications.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tests/test_units.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tests/test_visuals.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tests/test_medications.py`

**Interfaces:**
- `build_units(page_records: list[dict], structure: dict) -> list[dict]` returns typed units with source spans and structural paths.
- `extract_visual_candidates(units: list[dict], page_records: list[dict]) -> list[dict]` returns table, figure, and algorithm candidates.
- `extract_medication_candidates(units: list[dict]) -> list[dict]` returns explicit medication and numeric candidates without normalization.
- `ingest_book.py units --output PATH`, `ingest_book.py visuals --output PATH`, and `ingest_book.py medications --output PATH` run the stages.

- [ ] **Step 1: Write unit, visual, and medication tests.**

```python
import unittest

from tools.canon_v2.medications import extract_medication_candidates
from tools.canon_v2.units import build_units
from tools.canon_v2.visuals import extract_visual_candidates


class UnitTests(unittest.TestCase):
    def test_units_keep_source_span_and_parent(self):
        pages = [{"source_page_index": 19, "source_page_display": 20, "text": "49.1\nÉvaluation clinique", "raw_sha256": "a"}]
        structure = {"chapters": [{"chapter": 49, "id": "chapter-49", "page_start": 19}]}
        units = build_units(pages, structure)
        self.assertEqual(units[0]["structural_path"], "Partie 5/Spécialités psychiatriques/Chapitre 49/49.1")
        self.assertEqual(units[0]["source_page_index_start"], 19)

    def test_visual_caption_is_first_class(self):
        units = [{"id": "unit-1", "text": "TABLEAU 49.3 Facteurs de risque du suicide", "source_page_index": 26}]
        candidates = extract_visual_candidates(units, [])
        self.assertEqual(candidates[0]["content_type"], "table")
        self.assertEqual(candidates[0]["caption"], "TABLEAU 49.3 Facteurs de risque du suicide")

    def test_dose_is_preserved_verbatim(self):
        units = [{"id": "unit-2", "text": "thiamine 100 à 300 mg/jour", "source_page_index": 33}]
        records = extract_medication_candidates(units)
        self.assertEqual(records[0]["dose_text"], "100 à 300 mg/jour")
        self.assertEqual(records[0]["validation_status"], "needs_review")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the focused tests and verify the red state.**

```powershell
python -m unittest "$env:TARGET\tests\test_units.py" "$env:TARGET\tests\test_visuals.py" "$env:TARGET\tests\test_medications.py" -v
```

Expected result: import or symbol failure before implementation.

- [ ] **Step 3: Implement typed units.**

Split only at verified structural boundaries. Each unit stores a stable ID, `content_type`, title, parent ID, preceding/following IDs, structural path, source page index range, printed page range, mapping statuses, raw text hash, reading text, and source block references. A unit never crosses a chapter boundary. Empty pages are represented as page records, not fabricated units.

- [ ] **Step 4: Implement visual candidates.**

Detect source captions beginning with `TABLEAU`, `FIGURE`, `ENCADRÉ`, `ALGORITHME`, and `SCHÉMA`, retaining the exact caption and page geometry. Use PyMuPDF table detection when available, but mark every reconstructed cell relationship as `needs_review` until the proposal validation stage confirms it. Preserve cross-page continuation links and footnotes; do not invent missing cells or branches.

- [ ] **Step 5: Implement medication candidates.**

Detect explicit medication sections, generic/brand strings, dose expressions, route/frequency abbreviations, and treatment statements. Keep the original dose string, surrounding text, unit, route token, and page. Do not convert units, infer a frequency, normalize a salt, or turn a clinical case into a recommendation. Every numeric or high-risk candidate receives `needs_review`.

- [ ] **Step 6: Run tests and the real stages.**

```powershell
python -m unittest "$env:TARGET\tests\test_units.py" "$env:TARGET\tests\test_visuals.py" "$env:TARGET\tests\test_medications.py" -v
python "$env:TARGET\tools\ingest_book.py" units --output "$env:TARGET"
python "$env:TARGET\tools\ingest_book.py" visuals --output "$env:TARGET"
python "$env:TARGET\tools\ingest_book.py" medications --output "$env:TARGET"
```

Expected result: all source pages are represented, visual and medication candidates retain exact source text, and no candidate is clinically approved.

- [ ] **Step 7: Record the checkpoint.**

Write counts by content type, visual candidate count, table continuation count, medication candidate count, and unresolved-candidate count to `checkpoints/units.json`, `checkpoints/visuals.json`, and `checkpoints/medications.json`.

---

### Task 6: Define and test the semantic proposal contract

**Files:**
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tools/canon_v2/semantic_contract.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tests/test_semantic_contract.py`

**Interfaces:**
- `validate_proposal(record: dict, unit_index: dict) -> dict` returns the normalized record or raises `ContractError`.
- `validate_proposal_file(path: Path, unit_index: dict) -> dict` returns counts and errors.
- `merge_proposals(paths: list[Path], units: list[dict]) -> dict` writes validated `claims.jsonl`, `concepts.jsonl`, `relations.jsonl`, `xrefs.jsonl`, and a merge report.
- `ingest_book.py validate-semantic --output PATH` and `ingest_book.py merge-semantic --output PATH` run the contract and merge stages.

- [ ] **Step 1: Write contract tests.**

```python
import unittest

from tools.canon_v2.semantic_contract import ContractError, validate_proposal


class SemanticContractTests(unittest.TestCase):
    def setUp(self):
        self.unit_index = {
            "unit-49-1": {
                "id": "unit-49-1",
                "source_page_index_start": 19,
                "source_page_index_end": 19,
                "printed_page_start": "1084",
                "raw_text": "Le traitement doit être considéré.",
            }
        }

    def test_claim_requires_source_passage(self):
        with self.assertRaises(ContractError):
            validate_proposal({"kind": "claim", "unit_id": "unit-49-1"}, self.unit_index)

    def test_external_tome_reference_is_unresolved(self):
        record = validate_proposal({
            "proposal_id": "proposal-xref-1",
            "kind": "xref",
            "unit_id": "unit-49-1",
            "source_text": "voir le chapitre 3",
            "source_page_index_start": 19,
            "source_page_index_end": 19,
            "printed_page_start": "1084",
            "printed_page_end": "1084",
            "structural_path": "Partie 5/Spécialités psychiatriques/Chapitre 49",
            "language": "fr",
            "confidence": 1.0,
            "extraction_status": "proposed",
            "validation_status": "needs_review",
            "target": "chapter-3",
            "target_scope": "tome-1",
            "xref_status": "unresolved_external",
        }, self.unit_index)
        self.assertEqual(record["xref_status"], "unresolved_external")

    def test_dose_claim_enters_review(self):
        record = validate_proposal({
            "proposal_id": "proposal-medication-1",
            "kind": "medication",
            "unit_id": "unit-49-1",
            "source_text": "100 mg",
            "source_page_index_start": 19,
            "source_page_index_end": 19,
            "printed_page_start": "1084",
            "printed_page_end": "1084",
            "structural_path": "Partie 5/Spécialités psychiatriques/Chapitre 49",
            "language": "fr",
            "confidence": 1.0,
            "extraction_status": "proposed",
            "validation_status": "needs_review",
            "dose_text": "100 mg",
        }, self.unit_index)
        self.assertEqual(record["validation_status"], "needs_review")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the focused test and verify the red state.**

```powershell
python -m unittest "$env:TARGET\tests\test_semantic_contract.py" -v
```

Expected result: import or symbol failure before implementation.

- [ ] **Step 3: Implement the proposal schema.**

A proposal must contain `proposal_id`, `kind`, `unit_id`, `source_text`, `source_page_index_start`, `source_page_index_end`, `printed_page_start`, `printed_page_end`, `structural_path`, `language`, `confidence`, `extraction_status`, and `validation_status`. `kind` is one of `claim`, `concept`, `relation`, `xref`, `medication`, `visual_review`, or `coverage`.

A claim additionally requires subject, relation, object, qualifier fields, and evidence wording. A relation requires source and target concept IDs. A visual review requires the candidate ID and a page/region reference. A coverage record lists every unit ID considered and the reason for any skipped unit.

- [ ] **Step 4: Implement fail-closed validation.**

Reject a proposal if its unit ID is unknown, its source text is absent from the referenced raw/reading passage, its page range disagrees with the unit, its printed page is invented, or its relation target is unsupported. A Tome 1 target is accepted only as `unresolved_external`. A medication dose, contraindication, interaction, threshold, table, or algorithm receives `needs_review` even when the proposal is structurally valid.

- [ ] **Step 5: Run tests and create the chapter-bundle command.**

```powershell
python -m unittest "$env:TARGET\tests\test_semantic_contract.py" -v
python "$env:TARGET\tools\ingest_book.py" bundle --output "$env:TARGET" --chapters 49-54
python "$env:TARGET\tools\ingest_book.py" bundle --output "$env:TARGET" --chapters 55-65
python "$env:TARGET\tools\ingest_book.py" bundle --output "$env:TARGET" --chapters 66-72
python "$env:TARGET\tools\ingest_book.py" bundle --output "$env:TARGET" --chapters 73-85
```

Each bundle must contain source page indexes, printed page labels, unit IDs, raw/reading text, and no content from another book.

- [ ] **Step 6: Record the checkpoint.**

Write bundle hashes, unit counts, chapter ranges, and page ranges to `checkpoints/semantic-bundles.json`.

---

### Task 7: Extract semantic proposals for Chapters 49–54

**Files:**
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/semantic/proposals/part-a-49-54.jsonl`
- Test: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tests/test_semantic_contract.py`

**Interfaces:**
- Consumes: `work/chapters/part-a-49-54.jsonl`, `structure.json`, `units.jsonl`, and the semantic contract.
- Produces: one validated proposal stream for Chapters 49–54.

- [ ] **Step 1: Read only the Part A bundle and unit index.**

Read Chapters 49–54: *Urgences psychiatriques*, *Suicide*, *Agression, violence et dangerosité*, *Psychiatrie légale – droit civil*, *Psychiatrie légale – droit criminel et pénal*, and *Éthique et psychiatrie*. Do not read Chapters 1–48 or any other book.

- [ ] **Step 2: Write one coverage record per unit.**

For every unit in the bundle, write a `coverage` proposal. Mark a unit `covered` when its clinically relevant content has been assessed; mark it `not_clinical` only when the unit is navigation, repeated header, index, or bibliography material. Do not omit a unit silently.

- [ ] **Step 3: Extract only source-supported records.**

Create claims, concepts, relations, xrefs, medication records, and visual reviews supported by an exact source passage. Preserve modal words, clinical cases, legal qualifications, and source language. Mark all numerical, dose, risk, contraindication, table, and algorithm records `needs_review`.

- [ ] **Step 4: Validate the batch.**

```powershell
python "$env:TARGET\tools\ingest_book.py" validate-semantic --output "$env:TARGET" --proposal "$env:TARGET\semantic\proposals\part-a-49-54.jsonl"
```

Expected result: zero contract errors, complete unit coverage, and explicit review records.

- [ ] **Step 5: Record the batch checkpoint.**

Write proposal count, claim count, review count, unresolved xref count, and SHA-256 to `checkpoints/semantic-part-a.json`.

---

### Task 8: Extract semantic proposals for Chapters 55–65

**Files:**
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/semantic/proposals/part-b-55-65.jsonl`
- Test: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tests/test_semantic_contract.py`

**Interfaces:**
- Consumes: `work/chapters/part-b-55-65.jsonl`, `structure.json`, `units.jsonl`, and the semantic contract.
- Produces: one validated proposal stream for Chapters 55–65.

- [ ] **Step 1: Read only the Part B bundle.**

Read Chapters 55–65, covering child/adolescent psychiatry and geriatric psychiatry. Keep age-group qualifiers explicit and do not import pediatric or geriatric claims from another source.

- [ ] **Step 2: Write complete unit coverage records.**

Every unit in the bundle must be assessed and represented. Navigation and repeated headers may be marked `not_clinical`; clinical prose, cases, tables, scales, investigations, and recommendations must be covered or explicitly marked unresolved.

- [ ] **Step 3: Extract source-supported concepts and claims.**

Preserve developmental and age qualifiers, diagnostic uncertainty, scale names, contraindications, and source wording. Route all numerical thresholds, medication statements, clinical cases, and visual records to review.

- [ ] **Step 4: Validate the batch.**

```powershell
python "$env:TARGET\tools\ingest_book.py" validate-semantic --output "$env:TARGET" --proposal "$env:TARGET\semantic\proposals\part-b-55-65.jsonl"
```

Expected result: zero contract errors and complete unit coverage.

- [ ] **Step 5: Record the batch checkpoint.**

Write proposal count, claim count, review count, unresolved xref count, and SHA-256 to `checkpoints/semantic-part-b.json`.

---

### Task 9: Extract semantic proposals for Chapters 66–72

**Files:**
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/semantic/proposals/part-c-66-72.jsonl`
- Test: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tests/test_semantic_contract.py`

**Interfaces:**
- Consumes: `work/chapters/part-c-66-72.jsonl`, `structure.json`, `units.jsonl`, and the semantic contract.
- Produces: one validated proposal stream for Chapters 66–72.

- [ ] **Step 1: Read only the Part C bundle.**

Read Chapters 66–72: psychopharmacology, anxiolytics and hypnotics, antipsychotics, antidepressants, cognitive enhancers and stimulants, mood stabilizers, and electroconvulsive therapy/neuromodulation.

- [ ] **Step 2: Write complete unit coverage records.**

Preserve every medication section, table, treatment recommendation, contraindication, interaction, adverse effect, monitoring statement, and numerical dose as a source-backed proposal. Do not reconcile statements with other books or external pharmacology.

- [ ] **Step 3: Apply medication review policy.**

Every dose, route, frequency, duration, maximum, titration, contraindication, interaction, adverse effect, and monitoring statement is `needs_review`. A statement in a case or table is not promoted to a general recommendation without explicit source context.

- [ ] **Step 4: Validate the batch.**

```powershell
python "$env:TARGET\tools\ingest_book.py" validate-semantic --output "$env:TARGET" --proposal "$env:TARGET\semantic\proposals\part-c-66-72.jsonl"
```

Expected result: zero contract errors, complete unit coverage, and a non-empty medication review queue.

- [ ] **Step 5: Record the batch checkpoint.**

Write proposal count, medication count, high-risk count, review count, unresolved xref count, and SHA-256 to `checkpoints/semantic-part-c.json`.

---

### Task 10: Extract semantic proposals for Chapters 73–85

**Files:**
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/semantic/proposals/part-d-73-85.jsonl`
- Test: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tests/test_semantic_contract.py`

**Interfaces:**
- Consumes: `work/chapters/part-d-73-85.jsonl`, `structure.json`, `units.jsonl`, and the semantic contract.
- Produces: one validated proposal stream for Chapters 73–85.

- [ ] **Step 1: Read only the Part D bundle.**

Read Chapters 73–85, covering psychotherapy foundations and psychosocial treatments. Preserve therapy population, technique, indication, limitation, and evidence wording exactly as authored.

- [ ] **Step 2: Write complete unit coverage records.**

Assess every unit. Keep therapy claims distinct from medication claims and from fictional clinical cases. Mark recommendations, contraindications, limitations, tables, and figures for review when they contain clinical or numeric content.

- [ ] **Step 3: Preserve source boundaries.**

Do not infer efficacy, superiority, or applicability beyond the source sentence. Keep unresolved references to Tome 1 and to any external source marked `unresolved_external`.

- [ ] **Step 4: Validate the batch.**

```powershell
python "$env:TARGET\tools\ingest_book.py" validate-semantic --output "$env:TARGET" --proposal "$env:TARGET\semantic\proposals\part-d-73-85.jsonl"
```

Expected result: zero contract errors and complete unit coverage.

- [ ] **Step 5: Record the batch checkpoint.**

Write proposal count, therapy claim count, review count, unresolved xref count, and SHA-256 to `checkpoints/semantic-part-d.json`.

---

### Task 11: Merge validated proposals and run fail-closed QA

**Files:**
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tools/canon_v2/qa.py`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/tests/test_qa.py`

**Interfaces:**
- `merge_proposals(paths: list[Path], units: list[dict]) -> dict` writes canonical claim/entity/relation/xref files and rejects any invalid proposal.
- `run_qa(output_dir: Path) -> dict` writes `qa-report.json` and `review-queue.json` and returns the verdict.
- `ingest_book.py merge-semantic --output PATH` and `ingest_book.py qa --output PATH` run the stages.

- [ ] **Step 1: Write QA tests with synthetic failures.**

```python
import tempfile
import unittest
from pathlib import Path

from tools.canon_v2.qa import run_qa


class QaTests(unittest.TestCase):
    def test_missing_checkpoint_is_blocked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "checkpoints").mkdir()
            report = run_qa(root)
            self.assertEqual(report["verdict"], "BLOCKED")
            self.assertTrue(any(check["id"] == "page-checkpoint-coverage" and check["status"] == "FAIL" for check in report["checks"]))

    def test_explicit_warning_does_not_become_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "checkpoints").mkdir()
            (root / "qa-report.json").write_text("{}", encoding="utf-8")
            report = run_qa(root)
            self.assertIn(report["verdict"], {"WARNING", "BLOCKED"})


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the focused test and verify the red state.**

```powershell
python -m unittest "$env:TARGET\tests\test_qa.py" -v
```

Expected result: import or symbol failure before implementation.

- [ ] **Step 3: Implement deterministic merge.**

Sort proposal files by chapter order, proposal ID, and source offset. Reject duplicate IDs, unknown unit IDs, source-text mismatches, page mismatches, and Tome 1 content. Write one canonical JSON object per line and a merge report with counts and rejected proposal IDs.

- [ ] **Step 4: Implement QA checks.**

`run_qa` must check source hash, page count, one terminal checkpoint per page, raw/reading hash consistency, repair ledger coverage, page-map coverage, body chapter range 49–85, unit parent validity, unit page coverage, table/figure/algorithm review status, medication review status, semantic unit coverage, duplicate IDs, orphan concepts, unresolved xrefs, suspicious numerics, and replay metadata.

Use these rules:

```python
if any(check["status"] == "FAIL" for check in checks):
    verdict = "BLOCKED"
elif any(check["status"] == "WARNING" for check in checks):
    verdict = "WARNING"
else:
    verdict = "PASS"
```

A missing check is `NOT RUN`, which forces `BLOCKED` until the check is executed. Warnings identify exact files, page indexes, unit IDs, and review reason.

- [ ] **Step 5: Run tests, merge, and QA.**

```powershell
python -m unittest "$env:TARGET\tests\test_qa.py" -v
python "$env:TARGET\tools\ingest_book.py" merge-semantic --output "$env:TARGET"
python "$env:TARGET\tools\ingest_book.py" qa --output "$env:TARGET"
```

Expected result: canonical JSONL files, a complete review queue, and an evidence-backed `PASS`, `WARNING`, or `BLOCKED` verdict.

- [ ] **Step 6: Record the checkpoint.**

Write the QA report hash, review queue hash, counts by status, and all failing check IDs to `checkpoints/qa.json`.

---

### Task 12: Replay, freeze, and final verification

**Files:**
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/manifest.json`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/review-queue.json`
- Create: `knowledge/canonical-v2/psychiatrie-clinique-tome-2-2016-tc-media/sha256-22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76/qa-report.json`

**Interfaces:**
- `replay(source_pdf: Path, output_dir: Path, replay_dir: Path) -> dict` reruns deterministic stages into a separate directory and compares file hashes.
- `freeze(output_dir: Path, qa_report: dict) -> dict` writes `manifest.json` only when every page has a terminal checkpoint and the QA verdict is explicit.
- `ingest_book.py replay --pdf PATH --output PATH --replay PATH` and `ingest_book.py freeze --output PATH` run the final stages.

- [ ] **Step 1: Write replay and freeze tests.**

```python
import tempfile
import unittest
from pathlib import Path

from tools.canon_v2.qa import freeze


class FreezeTests(unittest.TestCase):
    def test_freeze_rejects_missing_page_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                freeze(root, {"verdict": "PASS", "checks": []})

    def test_freeze_rejects_missing_explicit_verdict(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                freeze(root, {"checks": []})


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the focused test and verify the red state.**

```powershell
python -m unittest "$env:TARGET\tests\test_qa.py" -v
```

Expected result: freeze tests fail before implementation because `freeze` is not yet implemented.

- [ ] **Step 3: Implement replay comparison.**

Replay into `work/replay/`, never over the canonical directory. Compare source lock, raw page hashes, repair ledger, page map, structure, units, candidate files, merged semantic files, QA report, and review queue. A mismatch is `BLOCKED` with the exact differing file and hashes. A replay timeout or missing dependency is `NOT RUN`, never `PASS`.

- [ ] **Step 4: Implement freeze.**

Freeze writes a manifest containing source version, ingestion version, all relative output paths, file sizes, SHA-256 hashes, QA verdict, page checkpoint count, and freeze timestamp. Freeze refuses to write `active`, `approved`, or a database projection. `WARNING` may be frozen as a research artifact only when every warning is present in `review-queue.json`.

- [ ] **Step 5: Run the full book-local verification.**

```powershell
$env:PYTHONIOENCODING = 'utf-8'
python -m unittest discover -s "$env:TARGET\tests" -p 'test_*.py' -v
python -m compileall -q "$env:TARGET\tools"
python "$env:TARGET\tools\ingest_book.py" replay --pdf "$env:PDF" --output "$env:TARGET" --replay "$env:TARGET\work\replay"
python "$env:TARGET\tools\ingest_book.py" freeze --output "$env:TARGET"
```

Expected result: all book-local tests pass, compilation succeeds, replay hashes match, and the manifest records an explicit QA verdict.

- [ ] **Step 6: Run repository verification commands.**

```powershell
pnpm lint
pnpm typecheck
```

Record each command's exit code and output summary in `checkpoints/repository-verification.json`. A failure caused by concurrent unrelated changes is reported as `FAIL` or `NOT RUN` for this task; it must not be silently treated as a book-local pass.

- [ ] **Step 7: Inspect scope and stop.**

Run a path-filtered status check and confirm that this task changed only the two book-local output areas and the task manifest. Confirm that no database, migration, shared script, root plan, graphify artifact, or other book was modified. Stop after reporting `DONE / CHANGED / DELETED / VERIFIED / NOT DONE / OUT-OF-SCOPE / NEXT` with the exact QA verdict and review count.

---

## Execution Order and Checkpoints

1. Complete Tasks 1–5 locally and verify deterministic raw/page/structure outputs.
2. Dispatch Tasks 7–10 only after Task 6 validates the contract and bundles exist; all four batches remain within this Tome 2 source.
3. Run Task 11 only after all four proposal files validate independently.
4. Run Task 12 once; freeze only after replay and QA evidence exists.
5. Do not run any database, migration, chunking, embedding, retrieval, or clinical-approval command.

## Plan Self-Review

- **Spec coverage:** source lock, dual text layers, piecewise page authority, hierarchy, typed units, tables/figures/algorithms, medications, semantic entities/relations/xrefs, provenance, QA, review queue, versioning, replay, and stop boundary each have an explicit task.
- **Completeness scan:** no unfinished marker or deferred instruction is used; every command, interface, file, and acceptance condition is named.
- **Type consistency:** `source_page_index` is always zero-based; `source_page_display` is one-based; `source_version` is always the frozen SHA-256 string; `printed_page_number` is nullable; proposal and unit IDs are stable strings; QA verdicts are exactly `PASS`, `WARNING`, or `BLOCKED`.
- **Scope check:** all implementation and generated files are book-local; no shared application subsystem is modified.
- **Clinical safety check:** all uncertain mappings, doses, numeric thresholds, medication claims, tables, algorithms, and low-confidence records fail closed into review.
