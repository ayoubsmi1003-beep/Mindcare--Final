# FINAL AUDIT — Stahl 7 canonical review phase (pre-chunking)

Date: 2026-09-24 · Gate: **medical review/activation NOT granted** · Scope: review,
atomization audit, queue classification, intra-book xref resolution only.
No re-extraction, no OCR, no chunking, no embeddings, no PostgreSQL.

## 1. Units atomized / reviewed / remaining

* Total units **2662** (2563 content + 99 back-matter index), stable IDs `stahl7-u-*`.
* Structural atomization **2662/2662 (100%)**: depth-3 path, title == last path
  element, non-empty subject/predicate/object/evidence, valid page ranges.
* All 99 index units reviewed against source parsing rules; 2563 content units
  structurally audited (content untouched this phase).
* **Correction executed (documented, source-verified)**: the previous index run
  produced 14 bogus units (drug entries like `amphetamine (d,l) , 45`,
  `l-methylfolate (adjunct) , 477`, combination lines misread as use/class
  headers), which also hid 8 genuine headers (ADHD, Narcolepsy, Weight
  management, ADHD-treatments, Cognitive enhancers, Stimulants,
  Wake-promoting agents). Parser fixed in `knowledge-stahl-index.py`
  (isomer-title keys, adjunct-isomer, combination entries); IDX regenerated:
  105 → 99 units, total 2668 → 2662. IDX regeneration verified byte-identical
  on re-run (SHA256 match).
* Remaining semantic review: **1100 queue items** (§2) + 241 short-evidence
  cells (§7) — nothing rewritten, nothing deleted.

## 2. Queue remaining by category (review-queue-audit.json)

| category | items |
|---|---|
| unit / dose-therapeutic (dosing sections) | 366 |
| unit / precaution-safety | 248 |
| unit / pregnancy-lactation | 236 |
| unit / drug-interaction | 98 |
| med / dose-bearing (all 152 monographs) | 152 |
| **total** | **1100** |

Every flagged unit is `needs_review` with `page_mapping_status=certain`;
no queue item was cleared. Structure anchors/tables: none in queue.

## 3. Concepts / meds integrity

* concepts **152/152 carry trade-name aliases** (was 147/152): 1465 alias
  trades total. The 5 isomer concepts (Amphetamine D / D,L, Methylfolate L,
  Methylphenidate D / D,L) now enriched from Index by Drug Name lines.
* meds **152/152** have brand_names + indications + drug_class (the 5 isomer
  monographs were empty before; now e.g. Amphetamine (D,L) → Adderrall ×2,
  Methylphenidate (D,L) → 16 brands, Methylfolate (L) → Deplin/Metafolin…).
* Indications/classes for isomer meds re-derived from Index by Use/Class
  headers (ADHD, Depression, Narcolepsy, Weight management…).
* 0 dangling: med unit_refs, xref from_units, xref med targets, xref unit
  targets. All 152 meds remain `needs_review` (dose-bearing, closed queue).

## 4. Intra-book xrefs resolved / remaining

* Total **1073** xrefs; resolved **1049** (1018 index→monograph links + 31
  content-unit links); unresolved **24 — all intra-book, deliberately kept**:
  * `intra-book/pointer-resolved-within-same-unit` — 12 (`see Warnings below`
    inside the only Warnings unit of the same monograph; target text sits in
    the same unit's evidence; self-links refused)
  * `intra-book/table-caption-in-same-unit` — 7 (`see Table N` where Table N's
    caption/content sits inside the same unit's evidence)

## 5. Unresolved cross-book xrefs (explicit separation)

* **0.** No row references another book. All 24 unresolved rows are intra-book
  pointers classified in §4. Cross-book linking remains a separate later
  phase; nothing outside this book was resolved or invented.

## 6. Provenance integrity

* Back-matter decision preserved: index units span **2628–2682**; pages
  2568–2627 (Index by Drug Name) consumed only as alias/enrichment input
  (no units — by design); **0 units ≥ 2683** (2683–2697 excluded, untouched).
* Page span of all units: 13–2682; QA `dual-page-consistency` offset 0 PASS;
  all pages `certain`; U+FFFD = **0** across units/meds/xrefs/concepts/
  structure/book; JSONL well-formed (QA schema/id/coverage gates PASS).
* ⚠ Format mismatch (pre-existing): content units embed `source_version` in
  dash form (`sha256-cf23ef…`) while book.json / structure.json / index units
  use colon form (`sha256:cf23ef…`). Same single version, two string formats —
  recommend normalizing to colon form after human approval; NOT mass-edited
  in this phase (needs a decision).
* ⚠ Index-internal page numbers (`Adderrall …, 45`, `Adhansia XR …, 487`) are
  the book's printed-folio references and do not equal PDF page IDs of the
  pointed monographs (45 → PDF 151, 487 → PDF 1416). Kept as verbatim index
  content; never used as provenance; dual-page mapping unchanged.

## 7. Ambiguity / loss risk

1. **1100 queue items** require human medical verification (dose, precaution,
   pregnancy, interaction, all med dose tables) — unchanged, none cleared.
2. 24 unresolved intra-book xrefs (§4) — targets not establishable from units
   alone; candidates for a later source-re-read pass.
3. 241 units with evidence < 40 chars (207 definition cells like
   `Generic? → Yes`, 11 list cells, 3 prose, 20 index lines): context carried
   by title + structural path; flagged, not modified.
4. 42 duplicate-evidence groups (351 rows): identical boilerplate repeated
   across monographs (the book's own repetition, e.g. shared warnings) —
   retained; no deduplication, no deletion.
5. Hierarchy heading casing clusters (17 variants across monographs, incl. the
   apparent printed typo `Specia Populations` in 3 units):
   chapter-consistent → treated as source-faithful page headings; NOT
   corrected (silent correction forbidden).
6. `Alcohol dependence, 255` kept verbatim as an index header (the source
   line itself carries the page pointer).
7. 164 units contain lowercase `see …` with no xref row: 150 are the
   boilerplate `(see index for additional brand…)` pointing generically at the
   back-matter index; the rest are prose-internal (`see below`-style) with no
   unique target — not converted into xrefs.
8. Printed-folio vs PDF-page divergence and dash/colon `source_version`
   mismatch (§6) remain open decisions for the human owner.

## 8. QA state & recommendation

* `knowledge-qa-book.py`: **OVERALL WARNING** — 11 PASS, 1 WARNING
  (xrefs-resolved 24/1073, documented in §4). Review queue regenerated = 1100,
  matches this audit. Structure coverage 152/152 (100%), gaps 0.
* Machine-readable audit: `review-queue-audit.json` (same directory).

### **Recommendation: PASS for human medical review.**
Canonical content is internally consistent, fully provenanced, and free of
malformed data; every known semantic uncertainty is enumerated above with
counts. **PASS grants no activation**: chunking, embeddings, PostgreSQL
writes, and RAG remain blocked until a human signs off on the 1100 queue
items and the §7 open decisions, per the hard gate.

  * `intra-book/target-section-not-atomized` — 5 (Temazepam `see Warnings
    below`; Carbamazepine/Gabapentin `see Children and…`; Brexanolone ×2
    `see How to Dose` — target sections absent from units; not establishable
    without a source re-read → NOT guessed)
* Resolved this phase (30 rows + 1 new): 11 `see Pearls`, 2 `see Warnings
  below` (Clonazepam, Lorazepam), 2 `see Children and…`, 2 `see How to Dose`,
  2 Aripiprazole Depot, Olanzapine Pamoate / Paliperidone Palmitate /
  Fluphenazine Decanoate / Haloperidol Decanoate / What-to-Do-About-Side
  Effects, 6 `see Table N` (unique caption-bearing sibling unit), plus 1 new
  row (Imipramine `stahl7-u-1091-012` → Pearls `stahl7-u-1098-019`) — every
  target verified as the unique section unit inside the same monograph, and
  every pointer phrase verified present in the referring unit's evidence.
* Method: `knowledge-stahl-xrefs-resolve.py` (deterministic; dry-run then
  apply; patched lettered xrefs-*.jsonl; merged via knowledge-merge-jsonl.py).
