# 03 — Current knowledge inventory

Corpus figures were measured read-only on 2026-11-06 on `alexa_eval_v8_intelligence_20261027`. The installed cabinet database was not inspected.

## Corpus

| Source | Language | Active chunks | Inactive | 768d vectors | Median / max characters |
|---|---|---:|---:|---:|---|
| DSM-5 | fr | 12,815 | 0 | 12,815 | 309 / 17,240 |
| The Maudsley Prescribing Guidelines | en | 9,344 | 7,859 | 9,344 | 249 / 6,534 |
| Prescriber's Guide (Stahl) | en | 3,076 | 0 | 3,076 | 789 / 1,337 |
| Medication catalogue (labels, no dosing) | fr | 15,638 | 0 | 0 | 60 / 146 |
| 5 internal policy sources | fr | 5-7 each | 0 | 0 | under 200 |

Other measured facts:
- All book chunks have vectors, so the 768d space is complete on this database. This matches `RUNTIME-CONFIGURATION.md`.
- ICD-11 and Psychiatrie clinique exist as files in `knowledge/canonical-v2/`, but have **no source row here**, and `BOOKS` (`knowledge-query.ts:6-15`) wouldn't admit them. They aren't part of this mission's corpus.
- **DSM conflict resolved:** the artifact `chunks-v2.jsonl` (14,079 rows, max 2,134 bytes) is not what's loaded. The database holds 12,815 active chunks with a maximum of 17,240 characters. That explains the `oversized-evidence-omitted` traces.

## Actual retrieval path

1. **Plan** (`knowledge-adapter.ts:304`): `planKnowledgeQuery`, all languages, scaffold removal, closed aliases, optional English and core variants, up to 6 bilingual heading queries.
2. **Lexical:** `search_knowledge_lexical`, 4 in parallel, limit 20. Postgres FTS on `to_tsvector('simple', unaccent(section+texte))` with `plainto_tsquery`, which ANDs all terms. Not BM25, no stemming, no trigram.
3. **Vector, flag-gated:** multilingual-e5-base, 768d, HNSW, 24 candidates, 0.83 floor, lot 0 only.
4. **Fusion:** RRF k=60 for lot 0 when dense rows exist; best-score merge across lots. Dense is capped at the best lexical score and loses ties.
5. **Rerank:** heuristic by default (55% coverage, 45% vector, bonuses).
6. **Selection:** top 5, containment dedupe, source diversity, 8,000-character budget. `recherche.ts:164-170` stops at the first overflow, dropping later items.
7. **Synthesis:** MiniCPM selects quotes by JSON schema. The server publishes the literal quotes.
8. **Citations:** provenance, edition and page come from markers or `unit_id`.

## Flags

| Flag | Default | Note |
|---|---|---|
| `KNOWLEDGE_VECTOR` | absent, so lexical-only | Must equal `1` |
| `KNOWLEDGE_VECTOR_RECETTE` | `e5-small`, whose table is empty | Must be `e5-base` |
| `KNOWLEDGE_RERANK` | absent | `mmarco` rejected (R@5 0.613 vs 0.742). Not on the server allowlist, so setting it in `runtime.env` aborts startup |
| `TERMINOLOGIE_BILINGUE_ACTIVE` | constant `true` | About 38 concepts |

**Packaging gap (by reading):** the recipe is read from `cwd/knowledge/` (`vecteur-secondaire-production.ts:53-56,105`), with cwd = serveur, but `preparer-paquet.mjs:312-381` copies no `knowledge/`. Setting the flag on an install would likely yield `vectoriel:"indisponible"`.

## Book name and language

- A book name is **not** required. All approved books are searched. Naming a known book narrows the search; naming an unknown one refuses.
- French to English uses aliases, about 38 mapped concepts, and e5 similarity when the flag is on. There is no translation step.
- **A French answer from an English source isn't possible today.** The best case is a verbatim English passage in a French frame; otherwise "indisponible".

## Where evidence is lost

| Stage | Loss |
|---|---|
| Plan | Null for over 500 characters, DSM other than 5, two books, unknown book; "selon les recommandations" reads as an unknown book (by reading) |
| Filters | "trouble dépressif caractérisé" sets a section filter excluding Maudsley and Stahl (by reading) |
| Lexical | One unknown word zeroes the lot, and the guard at `knowledge-query.ts:277-287` drops the English variant |
| Dense | First 128 tokens of `texte` only, without section; capped and tie-losing in fusion |
| Selection | Overflow stops the list; `faible` shows no passage; oversized passages omitted |
| Synthesis | `language`, `entity`, `unsafe-text`, `provider`, `source-title` aren't extractive, so the user sees "indisponible" |

## Recovery

One retry, without the section leaf, on an empty strict pass (`knowledge-adapter.ts:618-622`). No query rewrite. `expansion.ts` (neighbours) is referenced only by its unit test.

## Measured retrieval

| Measure | Value | Source |
|---|---|---|
| Golden v4 R@5, lexical / hybrid | 0.710 / 0.742 | Stahl report |
| By book, lexical / hybrid | DSM 1.0/1.0, Stahl 0.636/0.727, Maudsley 0.50/0.50 | same |
| French MRR / English MRR | 0.0455 / 0.3679 (pre-terminology table) | `terminologie-bilingue.ts:13-15` |

No FR→EN recall set covers all books, and no physician-signed gold set exists. Phase 2 adds both.
