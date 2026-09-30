# SEG-REPORT-D — seg-0101-0125.pdf (src 101-125, printed 99-123)

## Counts
SEG seg-0101-0125.pdf: units=40 tables=29 concepts=9 xrefs=8
- units-D.jsonl (40 lines) — all json.loads OK
- tables-D.jsonl (29 lines) — all json.loads OK
- concepts-D.jsonl (9 lines) — all json.loads OK
- xrefs-D.jsonl (8 lines) — all json.loads OK

## Sections covered (structure.json anchors)
2.19.1.4 – 2.19.1.14 (SP3/SP4 accepted/rejected sequences); 2.19.2 intro + 2.19.2.1 – 2.19.2.23 (Step SP6 obvious cause); 2.19.3 intro (Step M1); 2.19.3.1 (Chapter 01 linkage tables, printed 116-122); 2.19.3.2 (Chapter 02, in situ neoplasms); 2.19.3.3 (Chapter 03, HIV/blood transfusion); 2.19.3.4 (Chapter 04, heading only).

## Pages with no content
None — every page printed 99-123 carries content (dense mortality rules/tables).

## Cross-segment notes
- printed 99 (src 101) OPENS mid-unit: continuation of 2.19.1.3 "Malignant neoplasms due to other conditions" (starts src 100 / printed 98, previous segment). The continuation carries bullet list (2A60.5 … 2C81) and a Consequence/Causal table. Hosted in the previous segment's files per "host where the unit STARTS"; NOT duplicated here. Previous segment should own 2.19.1.3 + its table and the xref "see section [2.21.5]".
- printed 123 (src 125) ENDS with headings 2.19.3.3 and 2.19.3.4; 2.19.3.3's table is on this page (hosted here); 2.19.3.4's heading is hosted here but its body (Anaphylaxis TUC table, 4A84.Z) starts at top of printed 124 → table hosted in Letter E as icd11rg:table:124:1 with host_unit icd11rg-u-123-003.

## needs_review items
1. icd11rg-u-114-001 (2.19.2.22 Secondary peritonitis): condition list renders only as link text "Secondary peritonitis and unspecified peritonitis"; no enumerated list extracted (probable value-set hyperlink in source PDF).
2. icd11rg-u-116-001 (2.19.3.1): hosts 13 borderless TUC linkage tables (printed 117-122); row/cell alignment ambiguous in extraction — tables carry raw cell order + needs_review.
3. icd11rg-u-123-002 (2.19.3.3): extraction-order jumble on printed 123 (Chapter-03 table extracts before the 2.19.3.2 heading); attribution via TOC anchor + [{03}] caption link.
4. icd11rg-u-123-003 (2.19.3.4): heading-only at end of printed 123; body (Anaphylaxis TUC table) confirmed at top of printed 124 in segment E — cross-segment, table hosted in E (icd11rg:table:124:1).
5. ALL 29 tables: borderless Word tables reconstructed from pymupdf reading order → validation_status needs_review per WORKORDER.
6. icd11rg:table:117:4, 118:2, 118:4, 121:1, 121:2, 123:2: row alignment explicitly ambiguous; raw cell order preserved, footnoted.

## Anomalies
- Source typo preserved verbatim: "MA14.0 Laboratory eidence of HIV" (printed 122, table 122:1); "pneumonia (CA40." unclosed parenthesis (printed 105); "1F27Cryptococcosis" missing space (printed 104) — noted, not repaired.
- 2.19.2.23 Neutropenia: text references "Value set for selected neoplasms categories" (hyperlink-style) before the bullet list — preserved verbatim.
- No page-mapping uncertainty: all pages mapped certain (printed = src - 2).
- Running heads dropped silently ("ICD-11 Reference Guide" odd pages, "ICD-11 MMS" even pages, bare page numbers).

## Files written
units-D.jsonl 40 | tables-D.jsonl 29 | concepts-D.jsonl 9 | xrefs-D.jsonl 8
