# WORKORDER - Stahl Prescriber's Guide 7e distillation (canonical-v2.1)
# Scope: THIS BOOK ONLY (stahl-prescribers-guide-7e-cup, sha256-cf23ef7b...).
# Other sessions own other books - never read/write their directories.

## Assignment

You are given 1+ PDF segments (`segments/seg-START-END.pdf`, 25 source
pages each). `segments/index.json` maps each file to absolute 1-based
source pages. `pages.map.json` is the IDENTITY map: printed = source
(the file carries no printed folio numbers; running head is the current
drug name only). `structure.json` gives the drug monograph + its L2
template sections for any source page.

Page furniture to DROP silently: the running drug-name head (y~73.6,
Times 15) - content starts below it. No folio digits exist to drop.

## Method per segment

1. Extract with **PyMuPDF** (`python`, `page.get_text()`;
   `get_text('dict')` when weight/size disambiguates a section head from
   body). PyMuPDF is the PRIMARY extractor for this book (sanctioned
   fallback in the DSM-5 workorder; Citra MCP not available in the
   orchestration session). Record `provenance.extractor = "pymupdf"`,
   `page_mapping_status = "certain"`.
2. Write extracted page text to a working file and distill FROM the file
   in slices; never paste raw output into chat.
3. NEVER use OCR. NEVER invent pages, numbers, doses, or criteria.
   Uncertain -> queue it.
4. ENCODING REPAIR (deterministic, content-preserving): the text layer
   carries Windows-1252 bytes mis-decoded as latin-1 around curled
   quotes/apostrophes (control chars surface as U+FFFD `?`). Normalize
   to proper ASCII/UTF-8 punctuation (apostrophe `'`, quotes, dashes)
   BEFORE writing `evidence_wording`. Verify: no U+FFFD remains in your
   output files. This is encoding repair, not wording change - never
   "repair" drug names, doses, or qualifiers.
## Outputs (append; one JSON object per line; deterministic key order)

- `units.jsonl`: same 34-key envelope as DSM-5/ICD-11, with
  `"book_id": "stahl-prescribers-guide-7e-cup"`,
  `"source_version": "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"`,
  `"ingestion_version": "canonical-v2.1"`, `"language": "en"`,
  `provenance: {"extractor": "pymupdf", "segment": "seg-XXXX-YYYY.pdf"}`.
  - `id` = `stahl7-u-<src_start>-<seq>` (zero-padded per segment).
  - `structural_path` = `["<Drug>", "<L2>", "<L3>"]`
    (e.g. `["Acamprosate", "Dosing and Use", "Usual Dosage Range"]`).
  - `content_type`: union of the DSM-5 + ICD-11 enums so the shared QA
    script passes unchanged (definition|criteria|specifier|severity|box|
    list|footnote|table-ref|algorithm-ref|prose|reference|index-entry|
    code-list|guideline|rule|step|example).
  - `semantic_domain`: therapeutics|adverse-effect|dosing|precaution|
    interaction|pharmacokinetics|special-population|pregnancy-lactation|
    art-of-psychopharmacology|switching|medication|reference|index.
  - Granularity: ONE unit per L3 subsection (verbatim text in
    `evidence_wording` + atomized subject/predicate/object); dosing
    blocks (Usual Dosage Range, How to Dose, Dosing Tips, How to Stop,
    Pharmacokinetics, Drug Interactions, Overdose) stay WHOLE - never
    split a dose statement across units.
  - Preserve author qualifiers verbatim (`may`, `can`, `suggests`,
    `should be considered`, `contraindicated`, `insufficient evidence`,
    `controversial`, plus Stahl `expert only`, `not recommended`,
    `use with caution`) inside `evidence_wording` AND qualifier fields.
- `meds.jsonl` (THIS BOOK ONLY - the medication layer is primary here):
  one row per drug monograph with verbatim dose text; key fields:
  drug_name, generic_available, drug_class, brand_names, indications,
  usual_dosage_range, dosage_forms, how_to_dose, dosing_tips, overdose,
  long_term_use, habit_forming, how_to_stop, pharmacokinetics,
  drug_interactions, warnings_precautions, do_not_use,
  special_populations, pregnancy, breast_feeding,
  art_of_psychopharmacology, art_of_switching, src/printed page range,
  unit_ids, validation_status.
  - `med_id` = `stahl7-m-<drug-slug>`.
  - Every dose-bearing row is `validation_status: needs_review` ALWAYS
    (doses are never `auto_ok`). Verbatim dose text only; never compute,
    convert, or normalize units.
- `tables.jsonl` (only if segment holds real tables - switching
  diagrams, dose-adjustment grids):
  `table_id = stahl7:table:<src_page>:<seq>`, same envelope as
  DSM-5/ICD-11, always `needs_review`. If layout ambiguous, keep raw
  cell order, never guess.
- `concepts.jsonl`: `concept_id = stahl7-c-<slug>` for each drug, class,
  indication, adverse effect, interaction, scale/tool mentioned, with
  source_refs to unit ids.
- `xrefs.jsonl`: cross-drug mentions ("see <Drug>", "augment with
  <Drug>") link `target_unit` to that drug's monograph unit when known,
  else `unresolved`.

## Provenance lessons (binding)

- TOC L1/L2/L3 starts in structure.json are authoritative, but the
  RUNNING HEAD (drug name) on the page wins on conflict - flag the
  conflict in your SEG report, do not modify structure.json.
- Encoding repair BEFORE writing; U+FFFD-free output.
- Write to LETTERED files to avoid append races: `units-<LETTER>.jsonl`,
  `meds-<LETTER>.jsonl`, `tables-<LETTER>.jsonl`,
  `concepts-<LETTER>.jsonl`, `xrefs-<LETTER>.jsonl` (orchestrator merges
  units/tables/concepts/xrefs deterministically by id; meds merge by
  med_id - same collision rule: FAIL on same id, different content).
- Dose safety: any dose string you cannot read with certainty (broken
  line, ambiguous unit, truncated cell) -> `needs_review` + explicit
  SEG-report line + review-queue entry. NEVER guess a number.

`SEG <file>: units=N meds=M tables=T concepts=K xrefs=X | pages with no
text: [...] | uncertain: [...] | dose-flags: [...] | notes` + files
written with line counts. Do NOT return extracted text.

## Back-matter decision (phase: QA, before chunking)

- src 2568-2682 (Index by Drug Name / Use / Class, Abbreviations) is
  distilled by `scripts/knowledge-stahl-index.py` into `units-IDX.jsonl`
  (105 `content_type: index-entry` units, `semantic_domain: reference`,
  `structural_path` rooted at `["Back matter", ...]`) + `xrefs-IDX.jsonl`
  (983 resolved links `stahl7-u-* -> stahl7-m-<slug>`).
- The same script enriches `concepts.jsonl` (aliases from Index by Drug
  Name: trade -> generic, 147 generics) and `meds.jsonl` (indications
  from Index by Use, classes from Index by Class, brand_names). The
  enrichment is idempotent (re-run safe: dedupe on segments, set-union).
- Index page references are PRINTED numbers under the identity page map
  (printed = source, offset 0); they are NOT copied into unit page
  fields - index units carry their own physical range (2568-2682).
- src 2683-2697 (Endmatter: blank/ads) intentionally yields NO units.
- structure-coverage gate only requires depth==1 drug sections; back
  matter is excluded from it by design. QA overall = WARNING only
  (intra-book xref residue 54/1016, expected before cross-book linking).
- NOTE: `knowledge-merge-jsonl.py` deliberately does NOT merge `meds-*`
  (solriamfetol boundary duplicate: meds-AH authoritative, meds-AI 1-page
  stub dropped). meds.jsonl is written by hand then enriched; never
  re-merge meds-* blindly.
- STOP here: no chunking, no embeddings, no DB writes in this phase.

## Review phase (audit + atomization + intra-book xrefs; pre-chunking)

- Fresh audit: `FINAL-AUDIT.md` + `review-queue-audit.json` (this dir).
  Units 2668 -> **2662** (2563 content + **99** IDX), xrefs **1073**
  (1049 resolved / 24 unresolved), queue **1100** classified unchanged
  (dose 366 / precaution 248 / pregnancy-lactation 236 / interaction 98 /
  med dose-bearing 152).
- IDX parser fix (documented correction): previous run misread isomer /
  adjunct / combination index lines as use+class headers -> 14 bogus units
  and 8 hidden genuine headers. `knowledge-stahl-index.py` now matches
  isomer-title keys (`d,l-amphetamine` -> `Amphetamine (D,L)`) and keeps
  combination lines as entries under their true header. IDX: 105 -> 99
  units (uses 81 -> 75, classes 23 -> 23, abbr 1); regeneration verified
  byte-identical (SHA256) so merged units/xrefs stay consistent.
- Enrichment now 152/152: concepts with aliases 147 -> 152 (1465 trade
  aliases), meds with brand_names+indications+drug_class 147 -> 152 (the 5
  isomer monographs were empty). concepts.jsonl enrichment lives ONLY in
  the merged file: sequence must stay merge -> index (index re-run after
  any merge; lettered concepts-* carry no aliases).
- Intra-book xref resolution (`knowledge-stahl-xrefs-resolve.py`, dry-run
  then apply on lettered xrefs-*): 30 existing rows + 1 new row
  (stahl7-u-1091-012 -> Pearls) resolved; residue 54 -> **24** with
  recorded classes: 12 pointer-within-same-unit, 7 table-caption-in-same-
  unit, 5 target-section-not-atomized. 0 cross-book rows (separated for
  the cross-book phase). Self-links and un-establishable targets refused.
- Provenance: index units 2628-2682; 0 units >= 2683 (2683-2697 excluded,
  untouched); U+FFFD 0; QA = WARNING only (xrefs-resolved 24/1073).
- OPEN decisions for human: dash vs colon `source_version` format in
  content units; printed-folio index page refs vs PDF page ids; heading
  casing clusters incl. `Specia Populations`; 241 short-evidence cells;
  42 duplicate-evidence groups (kept).
- STOP here: no chunking, no embeddings, no DB writes. PASS in
  FINAL-AUDIT.md = recommendation for human medical review only.


