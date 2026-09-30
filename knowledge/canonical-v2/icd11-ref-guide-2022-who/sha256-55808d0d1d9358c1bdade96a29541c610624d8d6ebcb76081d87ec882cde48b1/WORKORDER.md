# WORKORDER — ICD-11 Reference Guide segment distillation (canonical-v2.1)

## Assignment

You are given 1+ PDF segments (`segments/seg-START-END.pdf`, 25 source pages each).
`segments/index.json` maps each file to absolute 1-based source pages.
`pages.map.json` gives printed pages: `printed = source_1based - 2`
(src 1 = cover, src 2 = blank, both null). Mapping verified 471/471 — status `certain`.
`structure.json` gives the numbered section for any source page (504 sections,
TOC authoritative). Page furniture to DROP silently: running heads
`ICD-11 Reference Guide` / `ICD-11 MMS` and the bare printed page number.

## Method per segment

1. Extract with **PyMuPDF** (`python`, `page.get_text()`; `get_text('dict')` when
   table/figure captions or bold spans matter). PyMuPDF is the PRIMARY extractor
   for this book (Citra MCP not available in the orchestration session; it was the
   sanctioned fallback in the DSM-5 workorder). Record
   `provenance.extractor = "pymupdf"` and `page_mapping_status = "certain"`
   (map is verified; only drop to `uncertain` if a specific page disagrees).
2. Write extracted page text to a working file and distill FROM the file in slices;
   never paste raw output into chat.
3. NEVER use OCR. NEVER invent pages, numbers, codes, or criteria. Uncertain → queue it.
4. Text layer is clean UTF-8 (©, –, ‘’ verified). If you ever emit `Ã©`-style
   mojibake, that is an encoding bug in YOUR pipeline: fix deterministically, never
   "repair" wording.

## Outputs (append; one JSON object per line; deterministic key order as below)

- `units.jsonl`: `{"id","book_id":"icd11-ref-guide-2022-who","source_version":"sha256:55808d0d…","ingestion_version":"canonical-v2.1","structural_path":["2","2.17","2.17.3"],"title","content_type","semantic_domain","subject","predicate","object","population","age_group","context","temporal_qualifier","severity_qualifier","exception_condition","evidence_wording","concept_ids":[],"entity_ids":[],"page_start","page_end","printed_page_start","printed_page_end","page_mapping_status":"certain","source_position","parent_unit":null,"related_units":[],"table_figure_ids":[],"language":"en","provenance":{"extractor":"pymupdf","segment":"seg-XXXX-YYYY.pdf"},"confidence":"high|medium|low","extraction_status":"extracted","validation_status":"auto_ok|needs_review"}`
  - `id` = `icd11rg-u-<printed_start>-<seq>` (`<seq>` zero-padded per segment).
  - `content_type` ∈ `definition|guideline|rule|step|example|criteria|box|list|footnote|table-ref|algorithm-ref|prose|reference|index-entry|code-list`.
    (DSM-5 enum extended with `guideline|rule|step|example` — this book is normative
    coding guidance; mortality steps SP1–SP8 / M1–M4 are `step`, worked examples
    are `example`.)
  - Granularity: ONE unit per numbered-subsection topic, per coding rule, per
    mortality/morbidity step (SP/M rules verbatim), per worked example, per
    definition, per table reference. Normative text VERBATIM in `evidence_wording`.
  - Preserve author qualifiers AND normative force verbatim: `may`, `can`,
    `suggests`, `should be considered`, `contraindicated`, `insufficient evidence`,
    `controversial`, plus ICD-normative `must`, `should`, `do not accept`,
    `always`, `never`. These are clinically/coding meaningful — never soften them.
- `tables.jsonl` (only if segment holds tables): `{"table_id":"icd11rg:table:<printed_page>:<seq>","title","page_start","page_end","printed_page_start","printed_page_end","headers":[],"rows":[],"footnotes":[],"units":[],"abbreviations":{},"host_unit":null,"validation_status":"needs_review"}`.
  Reconstruct headers/rows faithfully; if layout ambiguous (borderless Word
  tables!), keep raw cell order + `validation_status needs_review`, never guess.
- `concepts.jsonl`: `{"concept_id":"icd11rg-c-<slug>","canonical","source_terminology","aliases":[],"related":[],"source_refs":["<unit ids>"]}` for each classification concept
  (stem code, extension code, cluster coding, UCOD…), disease entity, scale
  (e.g. WHODAS 2.0), or tool mentioned. ICD codes (e.g. `5A60`, `PB80-PD3Z`)
  belong in `evidence_wording` and as concept aliases, verbatim.
- `xrefs.jsonl`: `{"from_unit":"<unit id>","target_text":"verbatim (e.g. see 2.17.3)","target_unit":null,"status":"unresolved|resolved"}`.
  Section-number xrefs (`see 2.21.4`) resolve to the unit owning that section when
  known, else `unresolved`.
- No `meds.jsonl` expected (coding reference, no dosing; if a medication statement
  occurs, put it in units with `semantic_domain: "medication"` + `needs_review`).

## Provenance lessons (binding)

- Flat typography: headings are plain Calibri 12pt, NOT bold/larger. Detect
  section starts ONLY via the numbered pattern + structure.json. Running heads
  win on conflict with TOC attribution — flag in SEG report, do not edit
  structure.json.
- Tables are borderless Word tables; captions `Table N:` / `Figure N:` are
  Calibri-Bold. Reconstruct cells conservatively.
- Write to LETTERED files to avoid append races: `units-<LETTER>.jsonl`,
  `tables-<LETTER>.jsonl`, `concepts-<LETTER>.jsonl`, `xrefs-<LETTER>.jsonl`
  (orchestrator merges deterministically by id). <LETTER> is given in your brief.
- No repair log needed for this source: 473/473 pages extract cleanly, no
  quarantined pages (contrast DSM-5 p.1137/1140).

`SEG <file>: units=N tables=M concepts=K xrefs=X | pages with no text: [...] |
uncertain: [...] | notes` + files written with line counts.
Do NOT return extracted text.
