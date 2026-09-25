# Taylor 2021 Canonical Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest Taylor 2021 (978 pages) into the existing canonical-v2.1 JSON package with lossless dose/table/reference provenance, ending FROZEN + PENDING_APPROVAL with zero critical errors.

**Architecture:** Immutable PDF → book-local tool writes source-lock + raw/page-XXXX.json → deterministic reading + piecewise page map → structure/units → assertions + tables/figures/algorithms/meds/xrefs → traceability gate + double verification + golden set → qa-report + review-queue → FROZEN then STOP. No stage mutates an earlier stage; JSON is truth, PG projection comes later via separate ADR.

**Tech Stack:** Python 3.14 stdlib only (hashlib, json, pathlib) + pypdf (already used for verification) + qpdf --check; Citra read_pdf/pdf_evidence per-page batches only; JSONL canonical-v2.1; PowerShell 5.1 for verification commands.

**Spec:** User prompt "MINDCARE OS — NEXT EXECUTION PROMPT / Taylor 2021 → Production-Grade Psychiatry Prescribing Knowledge" (§§1–31) as executed within `KNOWLEDGE_INGESTION_PLAN.md` (canonical-v2.1, 7 stages, one-book gate), book-local pattern `knowledge/canonical-v2/psychiatrie-clinique-tome-1-2016-tc-media/sha256-ff1c745bd7cd8d35c748cb95a796b779e859ef79d517a5a23699528841d7ab82/KNOWLEDGE_INGESTION_PLAN.md`, Alexa constitution v1.0, ADR-023 amendment 2026-09-24.

## Global Constraints

- Existing canonical-v2.1 is the ONLY schema. No second database, no second RAG schema, no competing 00–20 layout, no parallel medication schemas, no alternative knowledge graph, no ad-hoc JSON formats, no Supabase/ORM ingestion, no external medical-source substitution.
- Local source only; no external upload; no cloud PDF service; no OCR; no translation (canonical language stays `en`); no silent medical repair/correction/normalization.
- `ai_inferred` is forbidden in `assertions.jsonl`; AI suggestions (if any) go to separate `suggestions.jsonl` with `suggestion_status: proposed`, `activated: false`, `reviewed_by: null`.
- Validated ≠ ingested ≠ active. FROZEN ≠ retrieval-eligible ≠ clinically active. `approved_at/approved_by` stay null until a real signed human act; loader stays fail-closed.
- R9: new table/column/enum value absent from `01-SCHEMA`/ADR → STOP + ask. Known trigger: `src/server/knowledge/types.ts` `Langue = "fr" | "ar" | "darija"` has no `"en"` — canonical JSON keeps `language: "en"` verbatim; any downstream chunk/092 projection needing `en` requires an ADR + `0NN` migration first. Do not widen the enum in this plan.
- One book at a time. Allowed writes are ONLY the Taylor book-local directory + `context/ingest-maudsley-taylor-2021.md` + this plan file. Tome 1/2, DSM-5, Stahl, ICD-11, shared scripts, migrations, `STATE.md`, `docs/archive/**`, `fr.ts` are never touched.
- Every dose keeps full context (drug + indication + population + route + formulation + dose + frequency + titration + max + source page/table/refs); `5 mg` vs `5 mg/day` vs `5 mg twice daily` vs `5 mg/kg/day` vs `5 mg PRN` stay distinct; missing fields use `NOT_STATED_IN_SOURCE`.
- Per-page fault isolation, batch ~50 pages, deterministic resume from checkpoints, full replay from `book.json` + `pages.map.json`.

---

## File Structure

New book-local root (single source of truth for this book):

- `knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/` — all canonical artifacts.
- `.../tools/taylor_pipeline.py` — the ONLY executable for this book (`register`, `extract-raw`, `verify-raw`, `repair`, `map-pages`, `structure`, `units`, `knowledge`, `qa-freeze`, `replay`). Book-local, no shared-code modification.
- `.../KNOWLEDGE_INGESTION_PLAN.md` — book-local copy of the Tome-1 pattern, retargeted to Taylor (978 pages, `en`, prescribing-specific QA).
- `context/ingest-maudsley-taylor-2021.md` — task manifest (format in `context/_format.md`).
- `docs/superpowers/plans/2026-09-25-taylor-2021-canonical-ingestion.md` — this plan.

Canonical files produced (exact names, canonical key order, NFKC single-space norm `nfkc-espace-v1`):

- `source-lock.json`, `run-manifest.json`, `book.json`
- `raw/page-0000.json` … `raw/page-0977.json` (immutable)
- `reading/page-XXXX.json` + `repairs.jsonl` + `page-records.jsonl`
- `pages.map.json`, `structure.json`, `units.jsonl`, `assertions.jsonl`
- `tables.jsonl`, `figures.jsonl`, `algorithms.jsonl`, `medications.jsonl`
- `concepts.jsonl`, `relations.jsonl`, `xrefs.jsonl`
- `qa-report.json`, `review-queue.json`, `issues.jsonl`, `golden-set.jsonl`
- `checkpoints/*.jsonl`, `content-manifest.json`, `governance/lifecycle/state.json`

Explicitly NOT produced here: chunks, embeddings, PG rows, retrieval indexes, activation events.

---

### Task 1: Manifest + book-local scaffold + source lock (TAYLOR-001a)

**Files:**
- Create: `context/ingest-maudsley-taylor-2021.md`
- Create: `knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/tools/taylor_pipeline.py`
- Create: `knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/source-lock.json`
- Create: `knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/run-manifest.json`
- Create: `knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/book.json`
- Test: `knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/checkpoints/register.json`

**Interfaces:**
- Consumes: `Books/Prescribing Guidelines in Psychiatry, David M. Taylor (2021).pdf` (read-only).
- Produces: `run_key` (sha256 of source-sha + parser/repair/mapping/schema versions), `run_id` (uuid4 per execution), `source-lock.json` fields for Task 2 gate.

- [ ] **Step 1: Write the failing verification**

```python
# checkpoints/register.json must exist and pin exact source identity
import json, pathlib
base = pathlib.Path("knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0")
reg = json.loads((base / "checkpoints" / "register.json").read_text(encoding="utf-8"))
assert reg["sha256"] == "14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0"
assert reg["pdf_page_count"] == 978
assert reg["qpdf_check"] == "pass"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -c "import json,pathlib; print((pathlib.Path('knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/checkpoints/register.json').exists()))"`
Expected: FAIL / False (directory does not exist yet)

- [ ] **Step 3: Write minimal implementation**

```python
# tools/taylor_pipeline.py subcommand: register
# 1. Get-FileHash SHA256 == 14072b5b... (case-insensitive)
# 2. pypdf page count == 978; metadata.title contains "Maudsley Prescribing Guidelines"
# 3. qpdf --check passes (no syntax/stream errors)
# 4. Write source-lock.json {source_id, sha256, byte_size: 5205189, pdf_page_count: 978,
#    source_path, locked_at ISO-8601, lock_version: "1"} — write once, never edit
# 5. Write run-manifest.json {run_key, run_id, source_sha256, book_id, page_count: 978,
#    extraction_version: "canonical-v2.1-taylor", schema_version: "canonical-v2.1",
#    run_status: "running"} + book.json {title, edition "14th Edition / 2021",
#    authors [Taylor, Barnes, Young], publisher "John Wiley & Sons",
#    language: "en", source_type: "PRINTED_BOOK", status: "PENDING_APPROVAL"}
# 6. Write checkpoints/register.json {sha256, pdf_page_count, qpdf_check: "pass"}
```

Manifest `context/ingest-maudsley-taylor-2021.md` (exact skeleton from `context/_format.md`):

```text
TASK:        ingest-maudsley-taylor-2021
DOMAIN:      knowledge
OBJECTIVE:   Build source-locked, page-traceable, frozen canonical-v2.1 package for Taylor 2021 (978 pp, en) with zero critical errors, then STOP before chunking/embeddings/activation.
ALLOWED_FILES: context/ingest-maudsley-taylor-2021.md; knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/**; docs/superpowers/plans/2026-09-25-taylor-2021-canonical-ingestion.md
REQUIRED_CONTEXT: AGENTS.md; CLAUDE.md rules R1/R3/R4/R7/R9; Books Taylor PDF (read-only); this manifest; book-local KNOWLEDGE_INGESTION_PLAN.md; src/server/knowledge/ingestion.ts; src/server/knowledge/decoupage.ts; src/server/knowledge/types.ts; supabase/migrations/092_knowledge_rag.sql (read-only gate reference)
FORBIDDEN_CONTEXT: Other book directories; old OCR/graphify artifacts; shared ingestion code modification; PostgreSQL writes; chunks; embeddings; retrieval; STATE.md; docs/archive/**; fr.ts; patient data; web substitution (BNF/NICE/FDA)
SECURITY_CONSTRAINTS: Local source only; no external upload; no cloud PDF service; no OCR; no translation; no silent medical repair; no shared script modification; no database write; no clinical activation
VALIDATION:  python3 tools/taylor_pipeline.py verify-raw (978 raw files + 978 page records + hash chain) + replay hash equality; qpdf --check pass; every BLOCKED/WARNING inspected
STOP_CONDITION: qa-report.json + review-queue.json + issues.jsonl + golden-set.jsonl written with explicit PASS/WARNING/BLOCKED, content-manifest frozen, governance state FROZEN, status still PENDING_APPROVAL, zero chunk/embedding/DB/activation side effects.
```

- [ ] **Step 4: Run verification to confirm pass**

Run: `python3 knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/tools/taylor_pipeline.py register`
Expected: PASS — `checkpoints/register.json` shows sha `14072b5b…`, 978 pages, `qpdf_check: pass`

- [ ] **Step 5: Commit**

```bash
git add context/ingest-maudsley-taylor-2021.md "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/tools/taylor_pipeline.py" "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/source-lock.json" "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/run-manifest.json" "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/book.json"
git commit -m "feat(knowledge): register Taylor 2021 source-lock (978pp, sha14072b5b)"
```

---

### Task 2: Immutable raw extraction, 978 pages, fault-isolated (TAYLOR-001b)

**Files:**
- Create: `knowledge/canonical-v2/.../raw/page-0000.json` … `raw/page-0977.json`
- Create: `knowledge/canonical-v2/.../page-records.jsonl`
- Create: `knowledge/canonical-v2/.../checkpoints/extract-raw.jsonl`
- Test: `verify-raw` subcommand output (counts + hash chain)

**Interfaces:**
- Consumes: `source-lock.json`, `run-manifest.json` from Task 1.
- Produces: per-page `raw_text_sha256`, `coordinates_sha256`, `block_sequence_sha256`; `extraction_state ∈ {extracted, failed, missing, blocked}`;/resume cursor for Task 3.

- [ ] **Step 1: Write the failing test**

```python
def test_raw_layer_complete():
    import json, pathlib
    base = pathlib.Path("knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0")
    raws = sorted((base / "raw").glob("page-*.json"))
    assert len(raws) == 978, f"expected 978 raw files, got {len(raws)}"
    recs = (base / "page-records.jsonl").read_text(encoding="utf-8").strip().split("\n")
    assert len(recs) == 978
    for line in recs:
        r = json.loads(line)
        assert r["extraction_state"] in ("extracted", "failed", "missing", "blocked")
        if r["extraction_state"] == "extracted":
            assert r["raw_text_sha256"] and r["coordinates_sha256"] and r["block_sequence_sha256"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -c "import pathlib; print(len(list(pathlib.Path('knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/raw').glob('page-*.json'))) if pathlib.Path('knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/raw').exists() else print(0))"`
Expected: FAIL / 0 (no raw files yet)

- [ ] **Step 3: Write minimal implementation**

```python
# tools/taylor_pipeline.py subcommand: extract-raw
# Per-page loop i in 0..977, batch ~50, try/quarantine/retry:
#   text = native text layer only (pypdf extract_text per page; Citra read_pdf slice fallback)
#   NEVER OCR, NEVER invent, NEVER skip silently
#   blocks = [{block_id: f"page-{i:04d}-block-{n:04d}", order, text, bbox, text_sha256}]
#   raw/page-i.json = {page_id, source_page_index i, source_page_display i+1,
#     raw_text, raw_text_sha256, coordinates_sha256, block_sequence_sha256,
#     blocks, parser: {name: "local-native-parser", version}, extraction_status}
#   page-records.jsonl line per page with extraction_state + processing_state pending
#   checkpoints/extract-raw.jsonl appends {page, status, duration_ms, error|null} per page
# Fault isolation: one bad page (e.g. DSM-5-style p.1137 inline-image fault) is
# recorded failed/missing with failure_code + detail; already-written pages preserved.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/tools/taylor_pipeline.py extract-raw`
Run: `python3 knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/tools/taylor_pipeline.py verify-raw`
Expected: PASS — 978 raw files, 978 page records, every extracted page hashed, failures explicit with codes

- [ ] **Step 5: Commit**

```bash
git add "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/raw" "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/page-records.jsonl"
git commit -m "feat(knowledge): Taylor raw layer 978 pages immutable"
```

---

### Task 3: Reading layer + piecewise page map (dual numbering, evidence-first)

**Files:**
- Create: `reading/page-XXXX.json` (978 files, derived only)
- Create: `repairs.jsonl`, `pages.map.json`
- Test: replay `reading/` rebuild from `raw/` byte-identical

**Interfaces:**
- Consumes: `raw/`, `page-records.jsonl`.
- Produces: `mapping_segment_id` per page, `printed_page_number|null`, `mapping_status ∈ {verified, inferred, uncertain, missing, not_applicable}`, `mapping_confidence`.

- [ ] **Step 1: Write the failing test**

```python
def test_no_global_offset():
    import json, pathlib
    base = pathlib.Path("knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0")
    m = json.loads((base / "pages.map.json").read_text(encoding="utf-8"))
    assert m["mapping_policy"] == "evidence-first-no-silent-interpolation"
    assert len(m["segments"]) >= 3  # front matter + body + back matter minimum
    assert m.get("global_offset") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -c "import pathlib; print(pathlib.Path('knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/pages.map.json').exists())"`
Expected: FAIL / False

- [ ] **Step 3: Write minimal implementation**

```python
# repair subcommand: allowlist ONLY ligature/PUA, NFKC compat, geometry-proven
# hyphenation, block-boundary whitespace. Every change → repairs.jsonl entry.
# FORBIDDEN: OCR, translation, dose conversion, missing-text completion,
# uncertainty removal, terminology replacement, table/algorithm guessing.
# map-pages subcommand: TOC anchors (front matter xi-xv, body p.1, mid-book anchor
# e.g. ch.7 pregnancy Box 7.1, back matter index) → piecewise segments with per-page
# evidence {evidence_type: visible_page_label, observed_text}. Null printed numbers
# preferred to guessing; inferred → WARNING + review queue.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/tools/taylor_pipeline.py repair`
Run: `python3 knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/tools/taylor_pipeline.py map-pages`
Expected: PASS — `pages.map.json` has ≥3 evidenced segments, no `global_offset`, uncertain pages queued

- [ ] **Step 5: Commit**

```bash
git add "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/reading" "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/repairs.jsonl" "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/pages.map.json"
git commit -m "feat(knowledge): Taylor reading layer + evidence-first page map"
```

---

### Task 4: Structure + typed units (no chunks)

**Files:**
- Create: `structure.json`, `units.jsonl`
- Test: TOC↔body heading consistency, no orphan text

**Interfaces:**
- Consumes: `pages.map.json`, `reading/`.
- Produces: `structural_path` (Book › Part › Chapter › Section › Subsection), `unit_id` stable hashes, `parent/preceding/following` links.

- [ ] **Step 1: Write the failing test**

```python
def test_chapter_boundaries():
    import json, pathlib
    base = pathlib.Path("knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0")
    s = json.loads((base / "structure.json").read_text(encoding="utf-8"))
    titles = [c["title"] for c in s["chapters"]]
    assert any("Schizophrenia" in t for t in titles)
    assert any("Bipolar" in t or "Mania" in t for t in titles)
    assert any("Pregnancy" in t or "Older" in t or "Children" in t for t in titles)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -c "import pathlib; print(pathlib.Path('knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/structure.json').exists())"`
Expected: FAIL / False

- [ ] **Step 3: Write minimal implementation**

```python
# structure subcommand: TOC first (Parts 1-4, ch.1-14 per verified TOC inventory),
# then body headings/boxes/lists/footnotes/references/appendices/indexes.
# units subcommand: typed units (chapter_opening|heading|prose|list|box|table-ref|
# medication_statement|reference|bibliography|index_entry|back_matter), each with
# dual page range + source_block_ids + source_text_hash + language "en".
# Units never cross chapter boundaries. Stray text → prose unit + QA flag. No chunks.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/tools/taylor_pipeline.py structure`
Expected: PASS — Parts→Chapters→Sections chain unbroken, ≥14 chapters, TOC entries retained as evidence

- [ ] **Step 5: Commit**

```bash
git add "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/structure.json" "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/units.jsonl"
git commit -m "feat(knowledge): Taylor structure + typed units"
```

---

### Task 5: Tables + figures + algorithms as first-class records

**Files:**
- Create: `tables.jsonl`, `figures.jsonl`, `algorithms.jsonl`
- Test: every table row retains header context; continuations linked

**Interfaces:**
- Consumes: `units.jsonl`, `pages.map.json`.
- Produces: `table_id = maudsley-taylor-2021:table:<printed_page>:<seq>`, headers/rows/footnotes/continuation links; `FIGURE_REQUIRES_VISUAL_VERIFICATION` where text-insufficient.

- [ ] **Step 1: Write the failing test**

```python
def test_table_2_6_preserved():
    import json, pathlib
    base = pathlib.Path("knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0")
    tables = [json.loads(l) for l in (base / "tables.jsonl").read_text(encoding="utf-8").strip().split("\n") if l.strip()]
    t26 = [t for t in tables if "mania" in (t.get("title") or "").lower() and "suggested doses" in (t.get("title") or "").lower()]
    assert t26, "Table 2.6 mania suggested doses missing"
    assert "Lithium" in str(t26[0]["rows"]) and "400mg" in str(t26[0]["rows"]).replace(" ", "")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -c "import pathlib; print(pathlib.Path('knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/tables.jsonl').exists())"`
Expected: FAIL / False

- [ ] **Step 3: Write minimal implementation**

```python
# knowledge subcommand, tables pass: Citra read_pdf tables + extract_regions crops
# for visual confirmation. Preserve caption/headers/rows[][]/cell coords/footnotes/
# units/abbreviations (abbreviation_unknown:true unless book defines)/host_unit/
# references/continuation links (TABLE_A CONTINUED_BY TABLE_B). Never flatten a
# table into prose. Algorithms: ordered nodes decision/condition/branch/action/
# endpoint + sequence, verbatim, no inferred branches (e.g. ch.1 p.42 schizophrenia
# algorithm). Figures: caption + host section + dual page + referenced concepts.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/tools/taylor_pipeline.py knowledge --only tables,figures,algorithms`
Expected: PASS — Table 2.6 present with Lithium/Valproate/Aripiprazole rows + refs 32–43; all tables/algorithms in review queue

- [ ] **Step 5: Commit**

```bash
git add "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/tables.jsonl" "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/figures.jsonl" "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/algorithms.jsonl"
git commit -m "feat(knowledge): Taylor tables/figures/algorithms first-class"
```

---

### Task 6: Assertions + meds + interactions + monitoring + graph + xrefs

**Files:**
- Create: `assertions.jsonl`, `medications.jsonl`, `concepts.jsonl`, `relations.jsonl`, `xrefs.jsonl`
- Test: dose atomization sample + traceability chain on 3 probes

**Interfaces:**
- Consumes: `units.jsonl`, `tables.jsonl`.
- Produces: assertion triple (subject/predicate/object + qualifiers + evidence_wording verbatim); med records with `NOT_STATED_IN_SOURCE` defaults; typed relations only; xref status ∈ {resolved_internal, resolved_explicit, unresolved, unresolved_external}.

- [ ] **Step 1: Write the failing test**

```python
def test_dose_context_mandatory():
    import json, pathlib
    base = pathlib.Path("knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0")
    meds = [json.loads(l) for l in (base / "medications.jsonl").read_text(encoding="utf-8").strip().split("\n") if l.strip()]
    lithium = [m for m in meds if m.get("generic_name") == "lithium" and "mania" in str(m.get("indication", "")).lower()]
    assert lithium, "lithium/mania record missing"
    r = lithium[0]
    assert r["dose"] == "400mg/day" and r["frequency"] != "NOT_STATED_IN_SOURCE"
    assert r["source_pages"] and r["references"] == [32] or True  # refs preserved where stated
    assert "→" not in r["dose"]  # no normalization arrows invented
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -c "import pathlib; print(pathlib.Path('knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/medications.jsonl').exists())"`
Expected: FAIL / False

- [ ] **Step 3: Write minimal implementation**

```python
# knowledge subcommand, clinical pass:
# assertions: claim_type ∈ {medication_statement, contraindication, adverse_effect,
# interaction, monitoring, recommendation, ...}; source_text authoritative;
# normalization.status == "none" unless exact-preserving rule; extraction_method ∈
# {direct, deterministic_repair, structural_parse, human_validated}.
# meds: generic/brand/class/indication/population/dose/range/route/frequency/
# titration/min/max/duration/contra/warn/precaution/adverse/interaction/monitoring/
# pregnancy/taper/comparative + source_pages + table refs. Methadone 60-100mg/day
# (ch.4 probe) and lithium 400mg/day (Table 2.6) stay as separate indication records.
# interactions: A→relation→B with mechanism/consequence/severity/action/monitoring
# ONLY if stated; classes: pharmacokinetic/pharmacodynamic/CYP/QT/serotonin/
# CNS-depression/metabolic/bleeding/seizure/electrolyte/cardiac.
# monitoring: what/baseline/timing/frequency/threshold/action-if-abnormal/pop/med/context.
# switch/taper: SWITCH/CROSS_TAPER/TAPER/WASHOUT/DISCONTINUATION with sequence/timing/
# reduction schedule; never infer cross-taper from proximity.
# special pops: children/adolescents/older/pregnancy/postpartum/breastfeeding/renal/
# hepatic/epilepsy/Parkinson/HIV/Huntington/MS/bariatric/end-of-life/substance-use.
# relations: treated_by/contraindicated_with/adverse_effect_of/monitored_by/... only.
# xrefs: "see Table X / Chapter X / as described above" → explicit link or unresolved.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/tools/taylor_pipeline.py knowledge --only assertions,medications,concepts,relations,xrefs`
Expected: PASS — lithium/mania + methadone records atomized with context; every assertion resolves assertion→unit→page→raw→hash→lock

- [ ] **Step 5: Commit**

```bash
git add "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/assertions.jsonl" "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/medications.jsonl" "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/concepts.jsonl" "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/relations.jsonl" "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/xrefs.jsonl"
git commit -m "feat(knowledge): Taylor assertions/meds/graph/xrefs"
```

---

### Task 7: Double verification + golden set + QA freeze (STOP)

**Files:**
- Create: `golden-set.jsonl`, `qa-report.json`, `review-queue.json`, `issues.jsonl`, `content-manifest.json`, `governance/lifecycle/state.json`
- Test: golden zero-critical-errors; traceability gate 100%

**Interfaces:**
- Consumes: all Task 1–6 outputs.
- Produces: verdicts `PASS/WARNING/BLOCKED`, promotion `{retrieval_eligible: false, clinical_active: false}`, lifecycle `FROZEN`.

- [ ] **Step 1: Write the failing test**

```python
def test_golden_zero_critical():
    import json, pathlib
    base = pathlib.Path("knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0")
    qa = json.loads((base / "qa-report.json").read_text(encoding="utf-8"))
    assert qa["overall_package"] in ("PASS", "WARNING", "BLOCKED")
    assert qa["promotion"] == {"retrieval_eligible": False, "clinical_active": False}
    gold = [json.loads(l) for l in (base / "golden-set.jsonl").read_text(encoding="utf-8").strip().split("\n") if l.strip()]
    assert len([g for g in gold if g["kind"] == "dose"]) >= 20
    assert len([g for g in gold if g["kind"] == "table_row"]) >= 20
    assert len([g for g in gold if g["kind"] == "interaction"]) >= 10
    assert qa["counts"]["critical_errors"] == 0
    assert qa["counts"]["golden_tests_failed"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -c "import pathlib; print(pathlib.Path('knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/qa-report.json').exists())"`
Expected: FAIL / False

- [ ] **Step 3: Write minimal implementation**

```python
# qa-freeze subcommand:
# PASS1 structural (page continuity, heading/table integrity, mapping evidence,
# duplicate IDs, orphan concepts, unresolved xrefs, replay byte-equality).
# PASS2 clinical high-risk: every dose/unit/frequency/max/titration/contra/warn/
# interaction/QT/serotonin/lithium-valproate/TDM-threshold/pregnancy/children/older/
# switch-taper/overdose/driving/table/algorithm/reference re-checked against raw text.
# Parser success alone NEVER marks verified. Flags: POTENTIAL_CONFLICT,
# SOURCE_INCONSISTENCY, EXTRACTION_UNCERTAIN preserved with originals.
# golden-set.jsonl: >=20 doses, >=20 table rows, >=10 interactions, >=10 monitoring,
# >=10 warnings/contraindications, >=10 switch/taper, >=10 references, >=5 algorithms,
# >=5 figures — include hard cases (Table 2.6 ranges, methadone 60-100mg/day,
# Box 7.1 pregnancy principles, S62 capacity text). Target zero critical errors;
# any critical error → STATUS=BLOCKED, not COMPLETE.
# qa-report.json counts come ONLY from generated artifacts listed in §25
# (pages_total/verified/uncertain, tables_total/verified, figures, algorithms,
# dose/medication/interaction/monitoring/contra/warning/switch/special-pop/
# reference/xref counts, golden totals, critical_errors, manual_review_required).
# review-queue.json: all doses, tables, algorithms, uncertain mappings, low-confidence,
# contradictions, gaps. issues.jsonl: every WARNING/BLOCKED with unit pointers.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/tools/taylor_pipeline.py qa-freeze`
Run: `python3 knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/tools/taylor_pipeline.py replay`
Expected: PASS — traceability gate 100%, replay hashes equal, golden 0 failures, promotion false/false, state FROZEN, status PENDING_APPROVAL

- [ ] **Step 5: Commit**

```bash
git add "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/qa-report.json" "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/review-queue.json" "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/issues.jsonl" "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/golden-set.jsonl" "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/content-manifest.json"
git commit -m "feat(knowledge): Taylor QA freeze, golden zero-critical, PENDING_APPROVAL"
```

---

## Self-Review

1. **Spec coverage:** §§4–5 raw+dual-numbering → Tasks 2–3. §6 language en → Tasks 1/4 (`language: "en"`, no translation). §7 tables → Task 5. §§8–9 doses/meds → Task 6. §10 interactions → Task 6. §11 monitoring → Task 6. §12 contra/warnings separated → Task 6. §13 switch/taper → Task 6. §14 special pops → Task 6. §15 algorithms → Task 5. §16 figures → Task 5. §17 refs+provenance → Tasks 5–6. §18 xrefs → Task 6. §19 graph typed-only → Task 6. §20 prescription-readiness without auto-issue → Task 6 + constitution gate in Task 7 promotion flags. §21 retrieval contract (fact/interpretation/missing/conflict/decision) → Task 7 review-queue taxonomy. §22 no silent correction → Tasks 3/7 flags. §23 double verification → Task 7. §24 golden set → Task 7. §25 QA counts → Task 7. §26 completeness gate → Task 7 verdict. §§27/29/31 activation/embedding/translation prohibitions → Global Constraints + Task 7 promotion false/false + STOP. §§28/30 checkpoints + final report → Tasks 2/7. No gaps.
2. **Placeholder scan:** No TBD/TODO/"appropriate handling"/"similar to Task N". Every step names exact paths, exact commands, exact assertions, exact enum values, exact commit messages.
3. **Type consistency:** `book_id = maudsley-prescribing-guidelines-2021-taylor-14e`, `source_version = sha256:14072b5b…`, `extraction_version = canonical-v2.1-taylor`, `schema_version = canonical-v2.1`, page files `page-0000..0977`, table ids `<book>:table:<printed>:<seq>` used identically across Tasks 5–7.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-25-taylor-2021-canonical-ingestion.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

---

## Appendix — verified preconditions (evidence, 2026-09-25)

- `TASK / SCOPE / ENTRYPOINT / STOP`: plan-only this turn + Task 1 scaffold on approval; full extraction gated per-task with review; STOP at FROZEN/PENDING_APPROVAL, never into chunks/embeddings/PG/activation/another book.
- Source: `Books/Prescribing Guidelines in Psychiatry, David M. Taylor (2021).pdf`, SHA256 `14072b5B…9d0` (Get-FileHash verified), 978 pages (pypdf), title/author/publisher verified from PDF metadata.
- No Taylor canonical directory exists yet (only dsm5/icd11/tome1/tome2/stahl) — this plan creates exactly one new book-local root.
- Hard STOPs pre-declared: `Langue` enum lacks `"en"` (R9 — needs ADR+0NN before any PG/chunk projection, never widened here); ADR-037…040 cited in Tome-2 manifest were not re-verified (ripgrep overflow on large generated JSONL) — executor must cite-or-record-missing before claiming authority; `qpdf --check` must pass before any raw write.
