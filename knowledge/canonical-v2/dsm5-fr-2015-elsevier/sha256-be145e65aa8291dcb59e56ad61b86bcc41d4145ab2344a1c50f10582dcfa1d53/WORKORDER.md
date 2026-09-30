# WORKORDER — DSM-5 FR segment distillation (canonical-v2.1)

## Assignment

You are given 1+ PDF segments (`segments/seg-START-END.pdf`, 25 source pages each).
`segments/index.json` maps each file to absolute 1-based source pages.
`pages.map.json` gives printed pages: `printed = source_1based - 59` (body); front matter roman or null.
`structure.json` gives the chapter for any source page. Watermark line
`http://doctidoc2.blogspot.com` on every page: DROP it silently (not content).

## Method per segment

1. `citra_read_pdf` with `include_markdown + include_tables + include_document_map`
   on YOUR segment file(s), one call per file. Output is truncated inline and saved
   to a tool-output file — distill FROM the saved file (Read it in slices), never
   paste raw output into chat.
2. If Citra fails on a segment file, fallback = PyMuPDF text via bash
   (`python -c` reading the segment, `get_text`), and record
   `provenance.extractor = "pymupdf-fallback"`, `page_mapping_status = "uncertain"`.
3. NEVER use OCR. NEVER invent pages, numbers, doses, or criteria. Uncertain → queue it.

## Outputs (append; one JSON object per line; deterministic key order as below)

- `units.jsonl`: `{"id","book_id":"dsm5-fr-2015-elsevier","source_version":"sha256:be145e65…","ingestion_version":"canonical-v2.1","structural_path":["Section…","Chapter…","Section…"],"title","content_type","semantic_domain","subject","predicate","object","population","age_group","context","temporal_qualifier","severity_qualifier","exception_condition","evidence_wording","concept_ids":[],"entity_ids":[],"page_start","page_end","printed_page_start","printed_page_end","page_mapping_status":"certain","source_position","parent_unit":null,"related_units":[],"table_figure_ids":[],"language":"fr","provenance":{"extractor":"citra-read-pdf","segment":"seg-XXXX-YYYY.pdf"},"confidence":"high|medium|low","extraction_status":"extracted","validation_status":"auto_ok|needs_review"}`
  - `id` = `dsm5fr-u-<printed_start>-<seq>` (`<seq>` zero-padded per segment).
  - `content_type` ∈ `definition|criteria|specifier|severity|box|list|footnote|table-ref|algorithm-ref|prose|reference|index-entry|code-list`.
  - Granularity: ONE unit per disorder-subsection (criteria block verbatim in
    `evidence_wording` + atomized subject/predicate/object), per definition box,
    per table reference, per differential list. Criteria text VERBATIM, in full.
  - Preserve author qualifiers (`peut`, `peut être associé`, `suggère`,
    `doit être envisagé`, `contre-indiqué`, `preuves insuffisantes`,
    `controversé`) inside `evidence_wording` AND the qualifier fields.
- `tables.jsonl` (only if segment holds tables): `{"table_id":"dsm5fr:table:<printed_page>:<seq>","title","page_start","page_end","printed_page_start","printed_page_end","headers":[],"rows":[],"footnotes":[],"units":[],"abbreviations":{},"host_unit":null,"validation_status":"needs_review"}`.
  Reconstruct headers/rows faithfully; if layout ambiguous, keep raw cell order +
  `validation_status needs_review`, never guess.
- `concepts.jsonl`: `{"concept_id":"dsm5fr-c-<slug>","canonical","source_terminology","aliases":[],"related":[],"source_refs":["<unit ids>"]}` for each disorder/symptom/scale/drug mentioned.
- `xrefs.jsonl`: `{"from_unit":"<unit id>","target_text":"verbatim (e.g. voir chapitre X)","target_unit":null,"status":"unresolved|resolved"}`.
- No `meds.jsonl` for DSM-5 (no dosing content; if a medication statement occurs,
  put it in units with `semantic_domain: medication` + `needs_review`).

## Provenance lessons (binding)

- Citra markdown may arrive mojibake (UTF-8 decoded as latin1). NORMALIZE to proper
  French accents deterministically before writing `evidence_wording` (encoding repair,
  not content change). Verify: no `Ã©`/`Ã¨` sequences remain in your output files.
- Chapter attribution: TOC starts in structure.json are authoritative, but RUNNING
  HEADS on the page win on conflict — flag the conflict in your SEG report, do not
  modify structure.json.
- Write to LETTERED files to avoid append races: `units-<LETTER>.jsonl`,
  `tables-<LETTER>.jsonl`, `concepts-<LETTER>.jsonl`, `xrefs-<LETTER>.jsonl`
  (orchestrator merges deterministically by id). <LETTER> is given in your brief.

`SEG <file>: units=N tables=M concepts=K xrefs=X | pages with no text: [...] |
uncertain: [...] | citra-failed-pages: [...] | notes` + files written with line
counts. Do NOT return extracted text.
