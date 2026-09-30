# SEG-REPORT-A — seg-0026-0050.pdf (src 26–50, printed 24–48)

## Counts
- units: 46 (units-A.jsonl)
- tables: 4 (tables-A.jsonl)
- concepts: 29 new (concepts-A.jsonl); reused existing: icd11rg-c-icd-11, icd11rg-c-mms, icd11rg-c-who-fic, icd11rg-c-icf, icd11rg-c-ichi, icd11rg-c-whodas, icd11rg-c-nec-nos, icd11rg-c-tm, icd11rg-c-wm
- xrefs: 15 (xrefs-A.jsonl; 3 resolved, 12 unresolved)

## Structure sections covered
0.4 Glossary table body (printed 24–26, table only — heading unit icd11rg-u-23-002 lives in pilot merged units.jsonl); 1 / 1.1–1.1.6.2 (printed 26–36); 1.2–1.2.6 (printed 36–42); 1.3, 1.3.1 (printed 42–43); 1.4, 1.4.1 (printed 43–44); 1.5 (printed 44); 1.6–1.6.4 (printed 44–47); 2 / 2.1 (printed 47); 2.2, 2.3, 2.4-start (printed 48).

## needs_review items
1. `icd11rg:table:24:1` (Glossary) — borderless Word table; multi-line wrapped terms (e.g. "Causal relationship (coding)", "Derived classification", "Foundation Component", "The shoreline") reconstructed by joining wrapped lines. Verbatim wording preserved; cell boundaries inferred from layout order — needs_review per workorder.
2. `icd11rg:table:32:1` (Table 1, ICHI axes) — borderless; header "Axes / Inclusions / Example" with first column holding axis *descriptions* (no separate short axis-name column in text layer); last two Means rows have empty first cell (continuation rows). needs_review.
3. `icd11rg:table:38:1` (definition of disease property pattern) — borderless; needs_review.
4. `icd11rg:table:38:2` ('special groups' chapters) — borderless; chapter list jumps 4 → 18 → 22 verbatim (only special-groups chapters listed); needs_review.
5. `icd11rg-u-48-003` (2.4 Reference Guide) — text truncated at segment end ("...components, and intended"), continues on printed 49 (seg-0051-0075); hosted here per start-page rule.

## Cross-segment notes
- Glossary (0.4) heading unit `icd11rg-u-23-002` is in pilot output (units.jsonl, printed 23); its table body is hosted here as `icd11rg:table:24:1` (printed 24–26, src 26–28) with host_unit `icd11rg-u-23-002` per orchestrator instruction.
- Unit `icd11rg-u-48-003` (2.4 Reference Guide) STARTS at bottom of printed 48 and continues in segment B (printed 49). Segment B owner should NOT re-host this section; continuation noted.
- structure.json lists 2.17.3 "Find the starting point (Steps SP1 to SP8)" at source_page_start 73 (printed 71) — outside this segment; no action.

## Pages with no content
- None. All pages printed 24–48 carry content (running heads/page numbers dropped as furniture). Printed 24–26 are exclusively the Glossary table (plus Part 1 heading + 1.1 first paragraph at bottom of printed 26).

## Anomalies
- structure.json titles show mojibake for some headings (e.g. "ICD11") — replacement char in structure.json only; page text layer is clean; not edited (structure.json is off-limits).
- Figure 1 (printed 29) is an image; caption recorded as unit icd11rg-u-29-001; figure body not textually distillable (no OCR).
- "2 Part 2 - Using ICD-11" heading begins bottom of printed 47; combined with 2.1 in unit icd11rg-u-47-001.
- Deleted helper: `_extractA.py` removed at segment end (created transiently for extraction; outside allowed file set, cleaned up).
