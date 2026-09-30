# KNOWLEDGE_INGESTION_PLAN.md — MindCare OS · Knowledge OS V2 (canonical book ingestion)

> Status: **APPROVED PLAN — design frozen, no mass ingestion started.**
> Date: 2026-09-24. Method: brainstorming (architectural path) + read-only verification.

```
TASK:      Canonical high-fidelity ingestion pipeline, one book at a time, before any chunking/embeddings.
SCOPE:     This document only (plan + schema). No corpus processing, no DB writes, no embeddings.
ENTRYPOINT: Books/DSM-5_Manuel-diagnostique-et-statistique-des-troubles-mentaux.pdf (Book #1, on approval)
STOP:      Plan reviewed + approved → STOP. Book #1 registration starts only on explicit next yes.
```

## Authority & reset (read first)

- Hierarchy: `CODE + TESTS EXÉCUTABLES` > `supabase/migrations/` > `contrats actifs` > `ARCHITECTURE.md` > `index ADR` > `STATE-INDEX.md` > history. This plan describes the target; executable truth lives in code + migrations. Contradiction → verified code wins, this doc is fixed.
- **Reset:** previous messy ingestion/chunking output (`knowledge/sources/corpus-a-*`, old chunk dumps, `.eval-out/`) is **OUT-OF-SCOPE**. Never reused, merged, repaired, or built upon. New root: `knowledge/canonical-v2/` (created at Book #1 execution, not by this plan).
- Constitution Alexa v1.0 applies: LLM reasoning + governed corpus, every significant clinical claim traceable; approved knowledge never silently rewritten; commit = médecin (`propose → confirm → execute → verify → log`).
- CLAUDE.md rules apply, especially **R9** (no new table/column/enum value absent from `01-SCHEMA`/ADR — **STOP + ask**), R4 (security in DB, never JS), R7 (no write without `confirmed_at`), R3 (no `DELETE` clinical), R1 (Tier-0 never leaves machine; books carry no PII but pipeline stays local).

## Verified anchors (evidence, not prose)

| Fact | Evidence |
|---|---|
| Runtime arch | `ARCHITECTURE.md`: UI → Services → DbPort → `/api/*` → `frontiere.ts` → `PgDataPort` → portes `app.*` (165 fns) → Jarvis kernel → egress unique |
| Knowledge truth | `supabase/migrations/092_knowledge_rag.sql`: `knowledge_sources` / `knowledge_chunks`, stable-hash chunk identity, tenant authority on sources, supersession trigger, HNSW+GIN, RLS, `C4 + active + approved + revue + non-superseded` in-SQL gating |
| Chunker v1 | `src/server/knowledge/decoupage.ts`: `CHUNKER_VERSION = "struct-v1"`, `NORMALISATION_CHUNK = "nfkc-espace-v1"`, `LIMITE_PARAGRAPHE = 2000`, stable ids independent of ordinal |
| Ingestion gate | `src/server/knowledge/ingestion.ts`: 9-field dossier, `fixture-interdite`, validated ≠ ingested ≠ active |
| Embedding recipe | `knowledge/recette-embedding-pinee.json`: `r2-2026-09-16`, BAAI/bge-m3, 1024d, cosine, L2 native, local ONNX, immutable |
| Eval | `scripts/eval-knowledge-retrieval.mjs` + `tests/eval/knowledge.golden.json`: 46 cases, recall/MRR/nDCG/citation/wrong-drug-dose/version — currently NOT RUN on real DB/pgvector |
| Book #1 source | Citra `read_pdf` 2026-09-24: DSM-5 FR, **1275 pages**, `sha256:be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53`, text-native (InDesign CS5.5, Elsevier Masson, `[9782294743382]`) |
| Known fault | Citra `search_pdf` on DSM-5 aborts globally on **p.1137** (`inline image missing ID operator`) → extraction MUST be per-page fault-isolated (§16) |

User decisions recorded 2026-09-24: Book #1 = DSM-5 in `Books/` · canonical store = **both** JSON + PG projection · text-native + explicit `source_page_index ↔ printed_page_number` mapping · green light = authorization to execute (NOT a self-approval of DB rows; `approved_at/approved_by` still require a real signed human act, gates stay fail-closed).

---

## 1. Architecture

```
Books/*.pdf ──Citra──▶ canonical-v2 JSON ──QA gates──▶ review queue ──Gate-C loader──▶ PG (092 + 0NN ext) ──(later)──▶ chunker ──▶ embeddings ──▶ search_lexical/vector ──▶ Alexa (evidence + provenance + context)
```

- Order is load-bearing: **source fidelity → structure → semantics → provenance → validation → canonical units → chunking → embeddings → retrieval.** No stage mutates the previous; each stage is pure, deterministic, replayable from its inputs.
- Knowledge OS vs model knowledge (Constitution §2): Alexa combines foundation reasoning with governed corpus. Corpus claims are cited with source/version/page; off-corpus = general knowledge, explicitly unverified, never cited to an invented source.
- New PG projection (`0NN`) is a *projection* of the JSON truth, never a second truth. Sync direction is one-way: JSON → loader → PG. Divergence → PG is wrong, re-project.

## 2. Pipeline (7 stages, strictly one book at a time)

1. **Register** — hash source bytes, freeze `book_id` + `source_version`, probe text layer per page, record page count.
2. **Map pages** — build dual-numbering table (§5), calibrate front-matter offset on anchors.
3. **Structure** — TOC → `Part → Chapter → Section → Subsection → Content Unit` with Citra document map + geometry + tables (§6).
4. **Semantics** — atomic objects with qualifiers preserved verbatim (§3 semantics: `may/can/associated with/suggests/should be considered/contraindicated/insufficient evidence/controversial`).
5. **Visuals** — tables / figures / algorithms as first-class records (§8).
6. **Meds + ontology + xrefs** — dedicated passes (§9, §6-ontology, §7-xrefs).
7. **QA + review + freeze** — `PASS / WARNING / BLOCKED` report, review queue, version freeze. Chunking/embeddings explicitly excluded from V2 ingestion.

Gate between books: Book N must reach `frozen` (or explicit `blocked` with reason) before Book N+1 registers. No parallel books, no merged sources.

## 3. Canonical schema (`canonical-v2.1`, JSON)

```
knowledge/canonical-v2/<book_id>/<source_version>/
  book.json  pages.map.json  structure.json  units.jsonl
  tables.jsonl  figures.jsonl  algorithms.jsonl  meds.jsonl
  concepts.jsonl  relations.jsonl  xrefs.jsonl  qa-report.json  review-queue.json
```

- Envelope of every object: `id` (stable content hash), `book_id`, `source_version`, `structural_path`, `content_type`, `semantic_domain`, `concept_ids`, `entity_ids`, `page_start/end` (source index), `printed_page_start/end`, `page_mapping_status`, `source_position` (ordinal), `parent_unit`, `related_units`, `table_figure_ids`, `language` (source verbatim, never translated), `provenance`, `confidence`, `validation_status`, `extraction_status`.
- Semantic triple core per object: `subject`, `predicate/relation`, `object` + `clinical_domain`, `population`, `age_group`, `context`, `temporal_qualifier`, `severity_qualifier`, `exception_condition`, `evidence_wording` (author's exact recommendation sentence), `source_passage_ref`, `confidence`, `extraction_status`.
- Determinism: canonical key order, NFKC + single-space normalization (`nfkc-espace-v1`, same constant as `decoupage.ts`), stable hashing (SHA-256 of canonical serialization). Same source + same code → byte-identical output. JSON Schema (`canonical-v2.1.schema.json`) validates every file; schema change → new `ingestion_version`, never in-place reinterpretation.

## 4. Metadata model (book identity, immutable)

`book_id` (slug, e.g. `dsm5-fr-2015-elsevier`), canonical title, subtitle, edition, publication year, authors/editors, publisher, ISBN (`9782294743382` for DSM-5 FR), language (`fr`), `source_identifier` (exact filename), `source_version` (`sha256:<hex>`), `source_page_count`, `ingestion_version` (`canonical-v2.1`), `provenance_status`. Example frozen at registration for DSM-5: title `[9782294743382] DSM-5 — Manuel diagnostique et statistique des troubles mentaux`, FR translation directors Crocq/Guelfi et al., Elsevier Masson, 1275 pp, hash `be145e65…`. New edition, reprint, or byte-different PDF = new `source_version`; lineage via `superseded_by` mirroring the `092` trigger semantics (same title + same tenant scope only).

## 5. Page-number strategy (dual, never conflated)

- `source_page_index`: 0-based PDF index (machine address).
- `printed_page_number`: string exactly as printed (roman numerals allowed in front matter), nullable.
- Per-page mapping status: `certain | uncertain | inferred | missing`.
- `pages.map.json`: one row per index `{source_page_index, printed_page_number|null, status, anchor:boolean}`. Front-matter offset recorded explicitly (e.g. body starts at index K = printed p.1; calibrated on ≥2 anchors: TOC page + first chapter page + one mid-book anchor).
- Every knowledge object carries both ranges + status. `uncertain/inferred/missing` → `validation_status: needs_review`, routed to review queue — never silently upgraded.
- Citra usage: `read_pdf` fast preset in per-page batches (markdown, tables, chunks, document map, geometry, layout, semantic hints); `pdf_evidence.inspect` for anchor confirmation; `search_pdf` for literal locators only. **No OCR, per user rule.** If a page lacks a text layer, it is recorded `missing` + quarantined, not reconstructed.

## 6. Structural model

Hierarchy `Book → Part → Chapter → Section → Subsection → Content Unit`, preserving author terminology verbatim. Detected via TOC first, then headings/numbered sections, then boxes/lists/footnotes/references/appendices/indexes/glossaries. Each unit keeps `structural_path` (e.g. `Troubles psychotiques / Schizophrénie / Critères diagnostiques`), title, dual page range, parent, preceding/following unit ids, `semantic_type` (`definition | criteria | specifier | severity | box | table-ref | list | footnote | reference | appendix | index | glossary | prose`). DSM-5 specifics: criteria blocks + specifiers + severity markers + differential sections are typed units, never flattened prose. Nothing outside the hierarchy: stray text gets a unit with `semantic_type: prose` + parent = nearest section + QA flag if truly orphaned.

## 7. Ontology / entity model (clinical concepts)

- Entity classes: disorders/diagnoses, symptoms/signs, diagnostic criteria, differentials, risk factors, treatments, drug classes, doses/dosing rules (only if explicit), contraindications, adverse effects, interactions, investigations, scales/tools, recommendations, populations/age groups.
- `concepts.jsonl`: `concept_id` (stable), canonical name, `source_terminology` verbatim, `aliases[]`, `related_concepts[]`, `source_refs[]`. Source language preserved; **no silent translation** of medical terms (Constitution §6: praticienne's FR term stays FR; darija/arabe kept as authored).
- `relations.jsonl`: typed edges `symptom_of | diagnostic_feature_of | differential_with | risk_factor_for | associated_with | treated_by | contraindicated_with | adverse_effect_of | monitored_by | subtype_of | parent_of | referenced_by | defined_by`, each with provenance + qualifier + pages. Orphan concepts (no incoming/outgoing edge and no unit link) = QA warning, never auto-linked.

## 8. Table / figure / algorithm model (first-class)

- Table: `table_id = <book_id>:table:<printed_page>:<seq>`, title/caption verbatim, dual pages, `headers[]`, `rows[][]` with cell coordinates, footnotes, units, abbreviations expanded only if the book defines them (else kept short + `abbreviation_unknown: true`), `host_unit` context id.
- Algorithm/flowchart: ordered `nodes[]` (`decision{condition} → branch → action → endpoint`) + `sequence`. Decision text verbatim; no inferred branches.
- Figure: caption, referenced concept ids, explanatory text, dual page, host-section link.
- Citra: `read_pdf` tables + `pdf_evidence.extract_regions` crops for visual confirmation; cell-relationship reconstruction is the highest-risk step → always in review queue for tables/algorithms. Information loss for visual convenience is a `BLOCKED` criterion.

## 9. Medication model (dedicated layer)

Only what the source states: generic, brand (if present), class, indication, target condition, population, dose, range, titration, min/max, route, frequency, duration, contraindications, precautions, adverse effects, interactions, monitoring, special populations, pregnancy, taper/discontinuation, comparative statements — each atomized with exact dual pages + context + author qualifier. **No normalization that erases clinical distinctions** (e.g. two salts/formulations stay distinct). Cross-book disagreements coexist as separate claims with separate provenance; reconciliation happens at retrieval-display time, never by overwriting. All dose numerics + units go to the review queue regardless of confidence.

## 10. Provenance model

Every fact answers "where exactly?": `book_id`, `source_version` (hash), `printed_pages`, `source_page_index` range, `structural_path`, `passage_ref` (unit id + ordinal), verbatim evidence wording + qualifier, `extraction_status`, `confidence` (extraction confidence only — **retrieval score is never shown as clinical confidence**, per `types.ts` §18). Retrieval contract (future): return **evidence + provenance + context** (host section + related table), never an isolated paragraph. Audit trail distinguishes AI suggestion from médecin decision (Constitution §9).

## 11. Validation model

`validation_status ∈ {auto_ok, needs_review, blocked, approved}`. Auto rules: schema-valid, pages `certain`, numeric/unit sane, med record complete-if-present, no invented pages, qualifier present where author hedged. Human lane (review queue): doses, contraindications, criteria, thresholds, tables, algorithms, ambiguous pages, conflicting interpretations, low confidence. Activation (`approved`) = real signed human act writing `approved_at/approved_by` (+ `reviewed_*`, `review_due_at`); the loader is fail-closed on nulls (mirrors `ingestion.ts` + `092` read gates). The 2026-09-24 green light authorizes execution; it does not pre-fill approvals in code or data.

## 12. QA gates (Book QA Report)

Automated checks per book: page continuity / missing / duplicated / mismapped; broken headings / broken tables; missing sections vs TOC; malformed med records; orphan concepts; unresolved xrefs; duplicate entities; contradictory extraction; suspicious numerics / doses / units; extraction gaps; off-structure text. Verdicts `PASS / WARNING / BLOCKED` with per-warning explanation + unit pointers. `BLOCKED` triggers: any `missing`-page fact, any broken table/algorithm, any unverified dose/criterion/threshold. **Uncertain medical info is never silently repaired** — it is quarantined + queued.

## 13. Versioning strategy

Three axes: `source_version` (content hash) × `ingestion_version` (`canonical-v2.1`) × downstream (`chunker_version`, `embedding_version` = recipe `r2-2026-09-16` pinned). Same source + same ingestion code → same ids (stable-hash identity, extending the `092`/`decoupage.ts` principle). New source or new ingestion code → new version rows + `superseded_by` lineage; old versions stay readable as history, excluded from default retrieval (same pattern as `092` governed-default vs history-variant). Migrations are never edited (`0NN_sujet.sql`); columns/tables/enums absent from `01-SCHEMA`/ADR trigger **STOP + ask** (R9).

## 14. Future chunking contract (consumed later — not executed now)

The `struct-v1` successor (`struct-v2`, TBD) consumes canonical units, not raw text: boundaries follow `structural_path` (never mid-criterion, mid-row, or mid-algorithm-node); each chunk embeds the header trail (`Book › Chapter › Section`, cf. `texteIndexable`); chunk id = hash(`source_version` + unit id + normalized text + occurrence); chunk rows persist dual pages + unit/concept/entity/table ids. Any chunking change → new `chunker_version` + targeted re-embedding; silent dimension/coexistence drift is forbidden (same discipline as `knowledge_chunks_recette_complete`).

## 15. Future embedding / RAG contract (not executed now)

Reuse pinned recipe `r2-2026-09-16` (bge-m3, 1024d, cosine, L2 native, local ONNX, zero network at runtime). Retrieval stays on `search_knowledge_lexical` / `search_knowledge_vector` with in-SQL `C4 + active + approved + revue + non-superseded` filtering. Promotion bar: `eval-knowledge-retrieval` (46 golden) + DB pass (M08-B) + Gate-B bench must pass on staging before any production corpus bit flips. Cross-encoder rerank (M13) optional, measured by `reranker-gain`, never assumed.

## 16. Failure / recovery strategy

- **Per-page fault isolation** (load-bearing: DSM-5 p.1137 kills global `search_pdf`, so no global-text operation is allowed to abort a book). Batch size ~50 pages; per-page try/quarantine/retry; quarantine list in QA report.
- Fallback ladder per page: `read_pdf` slice → `pdf_evidence.inspect` → `extract_regions` crop → record `missing` + queue. Never OCR, never invent, never skip silently.
- Deterministic resume from page checkpoints; full replay from `book.json` + `pages.map.json`.
- Hard STOPs (ask human): new PG table/column needed (R9) · systematic text-layer absence · printed-numbering undetectable · license/provenance doubt. All STOPs recorded in QA report + `NEXT`.

## 17. Exact workflow — Book #1 (DSM-5 FR, on next yes)

1. `register`: freeze `book_id=dsm5-fr-2015-elsevier`, `source_version=sha256:be145e65…`, 1275 pp, text-native. Create `knowledge/canonical-v2/dsm5-fr-2015-elsevier/<sha>/` skeleton.
2. `map-pages`: TOC + first-chapter + mid-book anchors → `pages.map.json` (offset + statuses). Confirm p.1137 quarantine path.
3. `structure`: Parts→Chapters→Sections in ~50-page Citra batches → `structure.json`.
4. `semantics`: per-chapter units + entities + verbatim qualifiers → `units.jsonl`, `concepts.jsonl`, `relations.jsonl`.
5. `visuals`: criteria boxes/tables/algorithms → `tables.jsonl`, `algorithms.jsonl`, `figures.jsonl` (all queued for review).
6. `meds+xrefs`: `meds.jsonl`, `xrefs.jsonl` (`see chapter X / see table X / as described above` resolved to explicit links or `unresolved`).
7. `qa-freeze`: `qa-report.json` (PASS/WARNING/BLOCKED) + `review-queue.json`; freeze `canonical-v2.1`. STOP — review.
8. Only after freeze review: ADR for `0NN` projector tables (if "both stores" needs more than `092` columns) + Gate-C loader spec + `struct-v2` proposal. No embeddings before that.

---

## DONE / NEXT (this deliverable)

- DONE: plan + schema + contracts above, grounded on verified code/migrations/Citra probes.
- NEXT (needs explicit yes): execute §17 step 1–2 (register + map-pages for DSM-5), then report + stop.
- OUT-OF-SCOPE (this turn): any corpus parsing beyond probes, any PG write, any chunking/embedding, any reuse of pre-V2 artifacts.
