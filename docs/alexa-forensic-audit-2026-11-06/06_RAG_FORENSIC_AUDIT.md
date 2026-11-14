# RAG forensic audit

**Status: PARTIAL.** This document separates source-code facts, historic observations and missing runtime evidence. It is not a claim of clinical accuracy. The task manifest prohibits loading corpus/OCR content; none was opened. Source identities and indexing coverage in the deployed database are NOT VERIFIED.

## Ingestion and chunking

`src/server/knowledge/ingestion.ts`, `validerSource`, validates declared title, version, language, C4 classification, provenance, content hash, approval and review, and rejects fixtures. This pure validator does not write, extract, approve or activate a source. The actual import pipelines and their linkage to each book remain to be traced.

`src/server/knowledge/decoupage.ts`, `decouperDocument`, implements a structural paragraph chunker (`struct-v1`, NFKC normalization, long-paragraph threshold 2,000 characters); `texteIndexable` adds source/section context for embedding. Do not infer that all installed book chunks were produced by this chunker: specialist importers may use different paths and versions. OCR quality, overlap, parent/child reconstruction, page coverage and duplicate/null/stale chunks are NOT VERIFIED.

`src/server/alexa/knowledge-query.ts` contains aliases for three source labels, including one French and two English titles. Those constants identify code-recognized titles, not a current database inventory. Source approval is decided elsewhere; a recognized name does not grant approval.

## Embeddings

`src/server/knowledge/embeddings-secondaires.ts` fixes `intfloat/multilingual-e5-small` revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`, 384 dimensions, and `intfloat/multilingual-e5-base` revision `d128750597153bb5987e10b1c3493a34e5a4502a`, 768 dimensions. Both use `query: ` / `passage: `, masked mean pooling, L2 normalization, cosine and 128-token truncation. `knowledge/recette-embedding-secondaire-768.json` records the frozen base recipe. A separate BGE-M3 path exists (`src/server/knowledge/embeddings-local.ts`, `vecteur-production.ts`); its query-time activation must be traced as a distinct recipe, not assumed from its presence.

`src/server/alexa/knowledge-adapter.ts`, `dependancesReadKnowledge`, defaults the secondary slug to `e5-small` but activates vector retrieval only when `KNOWLEDGE_VECTOR=1` and the slug matches a pinned recipe. If off, `readKnowledge` identifies the path as lexical-only. Presence, active flags, query/index compatibility and coverage on the actual installed system are NOT VERIFIED.

**Specific configuration limitation:** the adapter's calibrated dense-threshold map contains the exact E5-base 768 triplet at 0.83; it does not contain the default E5-small 384 triplet. If only `KNOWLEDGE_VECTOR=1` is supplied without a recipe override, code can calculate an embedding and call the 384-dimensional gate, but then marks the recipe `not-calibrated` and does not admit those dense candidates. `tests/unit/alexa-knowledge-hybrid.test.ts` explicitly asserts `sans-preuve` / `vectoriel: non-calibre` when a synthetic E5-small-only neighbor exists. This is a deliberate fail-closed calibration rule with an operational consequence: the flag alone does not establish useful semantic retrieval, and work may be spent before refusal. The installed effective recipe remains unknown.

Deployment nuance: the current **modified working-tree** version of `electron/main/serveur-cabinet.ts`, `lireVariablesServeur`, supplies `KNOWLEDGE_VECTOR=1` and `KNOWLEDGE_VECTOR_RECETTE=e5-base` defaults when `options.paquet` is true, then overlays private variables. This is separate from the server adapter's defaults and may be overridden. It is not proof that an existing build contains these changes, that the assets or vectors are available, or that retrieval actually invoked the vector gate. Verify effective runtime traces before any rollout conclusion.

## Retrieval and reranking

`knowledge-query.ts`, `planKnowledgeQuery`, normalizes and expands with bounded literal French/English/Arabic aliases and `terminologie-bilingue.ts`; unknown clinical terms are not automatically translated. This is not general multilingual translation. Per-query relevance references prevent an English expansion from automatically being scored against only the French wording. Effectiveness on real French-to-English and Darija questions is NOT VERIFIED.

`knowledge-adapter.ts`, `readKnowledge`, runs lexical queries with at most four parallel gates and starts optional embedding concurrently. It validates source rows, filters inappropriate headings/bibliographies/indexes and omits a candidate above 8,192 UTF-8 bytes. It then supplies candidate batches to `src/server/knowledge/recherche.ts`, `orchestrerRecherche`; the latter can use rank fusion, invokes `rerankerAsync` when supplied and falls back on the heuristic on error. `LIMITES` declares 20 lexical candidates per query, 20 fused candidates, five final evidence items and an 8,000-character aggregate budget. The adapter requests up to 24 secondary vector candidates before subsequent constraints; do not conflate these limits.

The baseline is `HeuristiqueBaseline` (`src/server/knowledge/rerank.ts`). `KNOWLEDGE_RERANK=mmarco` injects the local cross-encoder `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1`, revision `1427fd652930e4ba29e8149678df786c240d8825` (recipe `knowledge/recette-rerank-secondaire.json`). `rerank-secondaire-production.ts` bounds it to eight pairs and 160 tokens and may skip expensive inference for a sufficiently strong heuristic result. The adapter traces invocations; seeing the option enabled alone does not prove inference ran or changed the final ranking.

The pinned recipe describes an earlier 20-question benchmark in which this reranker reduced Recall@5 from 65% to 55%. `docs/RUNTIME-CONFIGURATION.md` reports a later, different golden v4 benchmark with different numbers. Both are historical and not reproduced in this audit; do not combine them as one measurement or infer current clinical performance.

## Evidence and answer

`knowledge-adapter.ts`, `preuveAffichable`, carries source, chunk, version, section and page provenance when resolvable. `src/server/alexa/knowledge-synthesis.ts`, `synthesizeKnowledge`, validates evidence and several output properties, then emits selected approved quotations instead of publishing arbitrary model prose. This supports traceability but does not itself establish complete synthesis, correct cross-language translation or fidelity to a whole source. Unsupported, oversized, filtered or absent evidence can produce a partial answer or abstention.

**Budget truncation — conditional risk, not a verified clinical failure.** `src/server/knowledge/recherche.ts`, `appliquerBudgetOctets`, slices the first evidence to 8,000 JavaScript characters if it alone exceeds the budget and returns `tronque: true`. `readKnowledge` takes only `.retenues` from that return at final selection, so this flag is not propagated there. A direct synthetic helper test confirmed the slice and missing tail. An attempted full `readKnowledge` reproduction with a synthetic 8,000+ character candidate returned `sans-preuve` instead of selecting the candidate; therefore end-to-end reachability and actual loss of a qualifier are **NOT VERIFIED**. Test with a governed candidate known to pass ranking and within the separate 8,192-byte limit, then verify whether the response and source metadata report truncation. A downstream valid quote is not proof that omitted context did not qualify it.

An earlier repository report, `docs/ALEXA-MIXED-SYNTHESIS-AUDIT.md`, records 9/10 mixed cases without selected knowledge evidence in its lexical-only process. That is a confirmed observation *in that recorded run*, not proof of current installed configuration or universal failure. Four targeted unit files passed earlier in this audit (52 tests); another ten focused files passed (100 tests), including bilingual expansion, trace and gates. For example, `alexa-knowledge-execution-trace.test.ts` injects a synthetic SQL client and mocks local inference. These tests do not validate retrieval against the installed books.

## Diagnostic matrix

| Failure mode | Evidence | Consequence | Next correction hypothesis | Required experiment |
|---|---|---|---|---|
| Lexical-only when vector is not enabled | `dependancesReadKnowledge`; prior mixed audit | Paraphrases and FR→EN can miss evidence | Make effective mode visible and qualify a pinned recipe before activation | Same approved corpus and questions, lexical vs each verified vector recipe, record gate/model/dimension and Recall@K |
| Restricted bilingual expansion | `knowledge-query.ts` alias map | Unmapped concepts may remain in the wrong language | Compare existing aliases, multilingual embeddings and bounded query translation | Paired FR/EN and Arabic/Darija gold queries with reviewed passage relevance; measure per-language recall and meaning |
| Long evidence excluded | `MAX_PASSAGE_UTF8_BYTES` in `knowledge-adapter.ts` | Relevant long section may be unavailable | Review safe structural segmentation and preservation of qualifiers | Boundary cases with negation, dose, table and section provenance; compare full reviewed source to retrieved segments |
| Reranker opt-in can degrade ranking | recipe's historic benchmark, `rerankerAsync` path | Worse evidence despite running a model | Keep baseline until measured improvement | Same candidate pool and gold labels, paired nDCG/MRR/Recall@K and latency, log actual invocation/skip |
| Extractive publication | `knowledge-synthesis.ts` | Safe fallback may be incomplete or not natural French | Evaluate constrained evidence-linked synthesis, preserving abstention | Clinician review for cross-language factual fidelity, numerical/negation preservation, unsupported claims and provenance |

## Outstanding investigation

Trace actual source-file extraction, specialized chunkers, OCR and page mappings; enumerate approved source metadata and vector completeness in an explicitly identified isolated environment; trace each recipe through runtime/SQL/index; establish a reproducible baseline and inspect outputs. The manifest's corpus/OCR restriction prevents direct inspection under the present protocol; no restriction is silently bypassed. No model, indexing, configuration or database change is authorized by this audit.
