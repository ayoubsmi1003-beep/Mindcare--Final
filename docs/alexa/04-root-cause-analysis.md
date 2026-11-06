# 04 — Root-cause analysis

Ranked by how much of the doctor's experience each cause explains. **Evidence** says whether a cause is measured or found by reading code. Items found by reading get regression tests before their fix.

## Conversation

| # | Symptom | Exact cause | Location | Evidence | Fix type |
|---|---|---|---|---|---|
| C1 | Paraphrases misroute; each fix adds a phrase | Meaning decided by about 680 regex operations and 39 priority-ordered `direct*` functions; the model is last resort | `request-contract.ts`, `agent-loop.ts:952-1016` | Route contracts 10/20 fail; model_routing 4/13/3 | Architectural |
| C2 | Follow-ups work only for scripted phrasing | No conversation model; memory holds raw text and a re-guessed intent | `orchestrator.ts:362-366` | Follow-ups 9/8/13 | Architectural |
| C3 | Context vanishes after "merci" or the time | `runAlexaSingle` uses `contextKey=""`, which nulls the reference; patient deleted separately | `orchestrator.ts:475,345,365-369`, `conversation-state.ts:79` | Reading | Targeted, first |
| C4 | "Et la clozapine ?" becomes "la sertraline la clozapine" | String concatenation, not slot replacement; conditions stack | `orchestrator.ts:143-144,366` | Reading | Targeted, then frame |
| C5 | Mixed questions answer one side | Query concatenates every drug, dose and form string into an AND query, and the audit ran lexical-only | `agent-loop.ts:731-762`, audit §5 | 9/10 `sans-preuve` | Targeted + planner |
| C6 | Weak or refused general chat | Clinical blocklist on harmless text (`nom`, `stress`, `sommeil`, `ecris`), prose discarded, no history, 160 tokens | `model-gateway.ts:155-192,223`, `agent-loop.ts:1251,1426` | Reading | Targeted |
| C7 | General facts wrong | MiniCPM 1B factual errors | Model | Reliability doc §5.6 | **Model limit, kept by decision** |
| C8 | Slow, timeouts, budget exhaustion | 1B on CPU, large tool prompt in 4,096 context, 60 s unload forces full re-hash and reload | `local-model.ts:118-128,183` | 17-20 s per 1,089-token prompt | Runtime tuning; model limit |

## Knowledge

| # | Symptom | Exact cause | Location | Evidence | Fix type |
|---|---|---|---|---|---|
| K1 | Book has it, "synthèse indisponible" | Found evidence dropped: `language`, `entity`, `unsafe-text`, `provider`, `source-title` aren't extractive | `knowledge-synthesis.ts:124,131` | 10 `ok` → 4 cited; knowledge_case 23/94 with 75/93 traces `ok` | Targeted |
| K2 | Same | Language and unsafe gates judge text that's never published; the French reformulation is also dropped | `knowledge-synthesis.ts:237-259,294-299` | Reading | Targeted |
| K3 | Monograph facts rejected | A citable sentence must name the drug; numbers too. Stahl sentences under a heading often don't. One sentence over 1,200 characters blocks a chunk | `knowledge-synthesis.ts:164`, `knowledge-evidence-content.ts:65-84` | Aripiprazole dosing and lamotrigine mechanism fell back on `entity` | Targeted |
| K4 | Paraphrases return nothing | Hybrid off by default; packaged recipe missing | `knowledge-adapter.ts:253`, `preparer-paquet.mjs:312-381` | 9/10 mixed in lexical-only | Config + packaging |
| K5 | One unknown French word returns nothing | `plainto_tsquery` ANDs all terms, `simple` config | `123_knowledge_lexical_reader.sql:69,85` | "risques rénaux du lithium" 0 rows | Application-level recovery first |
| K6 | Dense adds little | Embeds first 128 tokens, no section; 0.83 floor; lot 0 only; capped and tie-losing | `remplir-vecteurs-768-docker.mjs:100,119-122`, `knowledge-adapter.ts:495-555` | R@5 0.710→0.742; Maudsley 0.50 both | Fusion now; re-embedding needs approval |
| K7 | Questions refused or over-filtered | "selon les recommandations" reads as unknown book; section filter excludes other books | `knowledge-query.ts:194-214,382,392,467` | Reading | Targeted |
| K8 | Weak results show nothing | `faible` publishes no passage | `knowledge-response.ts:79`, `knowledge-synthesis.ts:150` | 15/93 traces `faible` | Targeted |
| K9 | DSM quotes may be rejected | `source-title` nulls any quote naming a book, including "DSM-5" | `knowledge-response.ts:14,23-26` | Reading | Targeted |
| K10 | Reranker may be wrongly rejected | Dense rows passed as lexical and pre-filtered by a heuristic | `knowledge-adapter.ts:484`, `rerank-cross-encoder.ts:243-247` | Inference | Re-measure |
| K11 | No recovery | One retry only; neighbours unused | `knowledge-adapter.ts:618-622`, `expansion.ts` | Reading | Targeted |

## Application

| # | Symptom | Cause | Fix type |
|---|---|---|---|
| A1 | "Elle a des allergies ?" can't be answered | Gates exist, no tool section | Targeted |
| A2 | Statistics, dashboard and messages unreachable | No tool view over existing gates | Targeted |
| A3 | Ordonnance likely breaks the documents intent | Enum omits it (`patient-records.ts:10`) | Targeted |
| A4 | Actions rarely proposed | 1B model doesn't choose `prepare_action`; 35 of 40 action cases not verified | Understanding layer |

## Reliability and diagnosis

| # | Symptom | Cause | Fix type |
|---|---|---|---|
| R1 | Failures can't be explained | No correlation ID; route decisions unrecorded | Targeted, before large refactors |
| R2 | Occasional empty or mis-statused answers | `completed` with empty text; voice silent on partial | Targeted |
| R3 | Eval passes say little | Paraphrase test asserts nothing about the passage; no hybrid guard | Evaluation |

## Not the cause

- **Safety validators aren't over-rejecting patient data.** The mixed fallbacks came from retrieval, not language, schema or timeout gates.
- **Book names aren't required** by the code. The perceived dependency comes from K4, K5 and K7.
- **A better model alone wouldn't fix C1-C5, K1-K11 or A1-A3.** They fail before generation or after it, in deterministic code. C7 and part of C8 are the real model limits.

## Order of work

R1 first, since it makes everything else diagnosable. Then C3, C4, K1-K3, K7-K9 and A1-A3, the cheap and high-yield fixes. Then K4-K6, K10, K11 with measurement. Then C1, C2 and C5 through the understanding, frame and planner contracts, behind a flag that flips only if evaluation improves.
