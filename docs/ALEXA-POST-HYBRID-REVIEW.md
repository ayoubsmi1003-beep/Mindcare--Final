# Alexa V8 — post-hybrid engineering review

Status: diagnosis in progress (case audit running). No production install, no
schema change, no clinical write, no model/runtime change.

## 1. Baseline

- Branch `v8-alexa-final`, HEAD `35b927d`, up to date with
  `github/v8-alexa-final`.
- **33 pre-existing uncommitted local changes** are preserved: `electron/`,
  `scripts/`, several unit tests, `supabase/bootstrap/010_app_role.sql`, and
  the **local deletion of `214_purge_documents_synthetiques.sql`**. Migration
  214 was NOT restored.
- This cycle adds **6 source files, 2 unit tests, 4 integration diagnostics**
  (plus the existing smoke harness) and this report. The 33 pre-existing
  changes were not staged or committed.
- Model/runtime unchanged: `MiniCPM-V-4_7-1B-Q4_K_M.gguf`, llama.cpp `b11429`,
  4 096 context, CPU only.
- Hybrid retrieval is active in `.env`:
  `KNOWLEDGE_VECTOR=1`, `KNOWLEDGE_VECTOR_RECETTE=e5-base`.
- Git is now on the user PATH via PortableGit 2.56.0.4; the two formerly
  Git-dependent unit tests pass (7/7) without changing their assertions.

## 2. What the RAG path actually does (verified)

The decisive finding is architectural, not a missing model capability:

1. `readKnowledge` retrieves approved chunks (hybrid: lexical + 768-d e5-base).
2. `synthesizeKnowledge` asks the model to **select** quotes and declare
   coverage.
3. The validation loop then emits **`evidence.quote`**, never the model's
   sentence text:

```ts
// knowledge-synthesis.ts
for (const evidence of sentence.evidence) {
  const quote = knowledgeExcerptForSpeech(sansEnteteDeSection(evidence.quote, proof.section));
  events.push({ type: "sentence", text: knowledgeSynthesisCopy[locale].quote(quote), ... });
}
```

The comment above it is explicit: *"Keep the model as a quote selector; only
server-framed source text is emitted."*

Consequences:

- The user does **not** receive French model prose for any knowledge answer.
  They receive a verbatim approved passage (often English for Maudsley/Stahl)
  or, when selection is rejected, « La synthèse vérifiée est indisponible ».
- The `source-fallback language` observed on
  « Quels sont les risques rénaux du lithium ? » is the **selector** rejecting
  an English draft; it is not a translation of the published answer.
- Adding `"language"` to the extractive fallback made the app publish the
  English quote, but two safety tests correctly refused that path. The fallback
  was reverted.
- Therefore the French-output limitation is a **policy/architecture choice**
  (quote-only, no model paraphrase), not a model-language failure alone.
  Fixing it requires a new verified entailment/translation contract; a model
  swap would not change the published form.

### Representative trace (renal lithium paraphrase)

| Stage | Observation |
|---|---|
| Original question | « Quels sont les risques rénaux du lithium ? » |
| Intent | Knowledge (medication present) |
| Retrieval | hybrid, 5 proofs; top-ranked Maudsley `Adverse effects` |
| Evidence to model | 5 approved passages, under the 8 000-char budget |
| Raw model output | English draft / selection |
| Validation | `source-fallback language` |
| Published | « La synthèse vérifiée est indisponible… » + sources |
| Cause | output policy + selector validation, **not** missing evidence |

The same retrieval without the model (`readKnowledge` direct) returns `ok`
with 5 proofs; the 10-paraphrase probe returns 10/10 `ok`, off-corpus
`sans-preuve`.

A second trace on the multi-turn follow-ups confirms that retrieval is not the
blocker for « Et pour la grossesse ? » or « Et en cas d'insuffisance rénale ? »:

| Query | Lexical calls/rows | Vector rows | Selected | Top sections (no source text stored) |
|---|---:|---:|---:|---|
| Précautions sertraline | 7 / 6 | 24 | 5 | `Other Warnings/Precautions`, `Pregnancy`, `Pregnancy`, `Renal Impairment` |
| Précautions sertraline + grossesse (concatenated) | 8 / 17 | 24 | 5 | `Pregnancy` ×3, Maudsley pregnancy chapter, `Breast Feeding` |
| Précautions sertraline **pendant la grossesse** (focused) | 8 / 47 | 24 | 5 | `Pregnancy` ×3, `Breast Feeding`, pregnancy chapter |
| Posologie sertraline | 8 / 8 | 24 | 5 | `Primary Target Symptoms`, `How Long Until It Works`, `Dosing Tips` |
| Posologie sertraline + insuffisance rénale | 7 / 12 | 24 | 5 | `Renal Impairment`, Maudsley hepatic/renal chapter, `Children and Adolescents` |
| Risques rénaux du lithium | 1 / **0** | **24** | 5 | `Adverse effects`, `Additional information`, `Adverse effects` |
| Effets hématologiques de la clozapine | 2 / 9 | 24 | 5 | `Concurrent medications`, `Biochemical and haematological effects`, `Clozapine: seri…` |

The lithium renal query is decisive: **lexical returned zero rows, vector
returned 24, and the merge selected 5 approved proofs**. The failure is not
missing evidence. The top ranked section changes with the follow-up; the
remaining MULTI-01/02 failure is in query construction and selector output,
not in the absence of pregnancy/renal evidence.

## 3. 40-case audit

### 3.1 The 13 failing cases, before correction

The following table is built from the live smoke trace (`runAlexa` with a real
practitioner session, real patient, real DB, real local model). It records the
actual tool call, not the final error text. No patient identifier or note text
is reproduced.

| Case | Original question | Intended route | Actual route | Expected evidence | Actual evidence | Failure stage | Root cause | Category | Minimal safe correction | Regression test |
|---|---|---|---|---|---|---|---|---|---|---|
| SUM-03 | « Quels sont les antécédents médicaux du patient sélectionné ? » | `get_patient_context(summary)` | `get_patient_context(profile)` | dossier summary | administrative profile | tool selection | no `antécédents` vocabulary in admission; empty scope let the 1B model choose `profile` | routing / missing context | map `antécédents` to `summary`; plan intent `summary` | unit routing + live SUM-03 |
| SUM-05 | « Quels traitements sont actuellement actifs ? » | `get_patient_context(treatments, active)` | `search_knowledge` | current treatments | approved books; no evidence | tool selection | `treatmentStateRequest` did not match “sont actuellement actifs”; early clinical-knowledge return won | routing | broaden state regex; add treatment target before knowledge fallback | unit routing + live SUM-05 |
| SUM-09 | « Quelle est la situation financière de ce patient ? » | patient-finance / `query_finance` | no tool; `unsupported` | patient finance | none | plan/tool selection | finance vocabulary lacked “situation financière” | routing | add finance phrase; `query_finance(totals)` routed to the existing `readPatientFinance` gate | unit reads + live SUM-09 |
| SUM-10 | « Quels rendez-vous sont prévus pour ce patient ? » | `query_agenda` on a future window | `query_agenda` with invented `period`; `needs_input` | agenda | none | tool arguments | no default “upcoming” window; the model invented a period the request never stated | routing / tool semantics | direct future window for selected patient; executor defaults to +364 days for “prévus/à venir” | unit reads + live SUM-10 |
| SUM-12 | « Quelles sont les dates de la première et de la dernière consultation ? » | dossier summary / consultation bounds | period clarification | consultations | none | pre-tool period gate | “dernière” made `unboundedPeriod` false; `query_consultations` then required a bounded period | routing / query semantics | map to `summary`; return first/last dates deterministically from the clinical context | unit reads + live SUM-12 |
| SUM-14 | « Quelles allergies ou contre-indications sont consignées ? » | record read | `search_knowledge` | allergy/contraindication record | approved books; no evidence | tool selection | the clinical context gate exposes no allergy section; the only admitted path was knowledge | missing governed capability | **blocked**: do not infer allergies from books; propose a read-only allergy gate (migration/human decision) | blocked case |
| NOTE-03 | « Quels symptômes sont décrits dans la dernière note ? » | `get_patient_context(notes)` on latest visit | no tool; agent budget exhausted | latest note | none | agent loop | no direct latest-note path; five model rounds produced no executable call | tool execution / model loop | recognize “dernière note” as a latest-visit scope; direct note read | unit + live NOTE-03 |
| NOTE-09 | « Quels événements de vie sont rapportés dans les notes ? » | `get_patient_context(notes)` | notes call, then “Quel patient…” | note text | patient resolution | parser | `parsePatientMention` read “vie” as a patient name | routing / parser | add clinical nouns (`vie`, `grossesse`, `insuffisance`, …) to the identity stop list | unit parser + live NOTE-09 |
| NOTE-10 | « Quelles modifications de traitement ont été notées ? » | `get_patient_context(treatments, history)` | `search_knowledge` | treatment history | approved books; no evidence | tool selection | “notées” absent from `documentedTreatmentRequest`; early knowledge return won | routing | accept `noté/modifié` as record vocabulary; add treatment-history target | unit routing + live NOTE-10 |
| MULTI-01 | « Quelles précautions pour la sertraline ? » then « Et pour la grossesse ? » | knowledge follow-up on pregnancy | second answer reused the warning passage | pregnancy section | warnings section | selector / follow-up query | the follow-up was concatenated, not focused; the extractor anchored on “précautions” and the selector stayed on the first passage | query construction / selector | build a focused “sertraline pendant la grossesse” query; verify cited section | live multi-turn |
| MULTI-02 | « Quelle est la posologie de la sertraline ? » then « Et en cas d'insuffisance rénale ? » | knowledge follow-up on renal | second turn `LocalModelTimeout` | renal section | none | model timeout | follow-up still required an agent round; no focused direct query | timeout / query construction | focused direct query; avoid a model round for a one-condition follow-up | live multi-turn |
| MULTI-03 | « Résume la dernière consultation. » then « Et la précédente ? » | summary of latest visit | tool returned `clinical-synthesis-unavailable` | latest visit | evidence present, text unavailable | generation | bounded single-visit narrative model failed; the tool discarded its deterministic local sentences | generation | keep the deterministic, source-cited local summary when the narrative model fails | unit + live MULTI-03 |
| MULTI-05 | « Quels diagnostics sont actifs ? » then « Et lesquels sont résolus ? » | diagnoses active/resolved | `search_knowledge`, then `unsupported` | diagnoses | approved books / none | tool selection / follow-up | diagnosis-state questions had no patient anchor; second turn depended on the first failure | routing | add diagnosis-state record target; state follow-up | unit routing + live MULTI-05 |

### 3.2 Post-correction route check (same 13 cases)

`SMOKE` below means the turn completed and carried governed provenance. It is
**not** a semantic PASS; the case-level oracle is still missing.

| Case | Post-fix actual route | Status | Remaining issue |
|---|---|---|---|
| SUM-03 | `get_patient_context(summary)` | SMOKE | summary is the dossier's available history, not a dedicated “antécédents” table |
| SUM-05 | `get_patient_context(treatments, active)` | SMOKE | none observed |
| SUM-09 | `query_finance(totals, all)` → `readPatientFinance` | SMOKE | none observed |
| SUM-10 | `query_agenda(patientId)` with a bounded future window | SMOKE | none observed |
| SUM-12 | `get_patient_context(summary)` → first/last dates | SMOKE | none observed |
| SUM-14 | `search_knowledge` | **FAIL** | no governed allergy section; books cannot answer “consignées” |
| NOTE-03 | `get_patient_context(notes)` direct latest note | SMOKE | note excerpt is source text; symptom semantics not separately scored |
| NOTE-09 | `get_patient_context(notes, subjective)` direct | SMOKE | parser fixed; life events now read from the subjective note area without a synthesis round |
| NOTE-10 | `get_patient_context(treatments)` | SMOKE | none observed |
| MULTI-01 | first knowledge partial; second direct knowledge partial | SMOKE | focused pregnancy query and direct knowledge read; content is a quote/partial, not verified French prose |
| MULTI-02 | first knowledge partial; second direct knowledge partial | SMOKE | route fixed; second answer still `fallbackText=true` (verified synthesis unavailable) |
| MULTI-03 | `get_patient_context(summary, count=1)` → deterministic local summary | SMOKE | bounded summary is now partial but source-cited; not a verified narrative |
| MULTI-05 | `get_patient_context(diagnoses, active/resolved)` | SMOKE | none observed |

### 3.3 The ten mixed cases (separate root cause family)

The mixed cases expose a second, independent defect: the admission planner
usually admits **one side** of the question, not both. Where both sides are
admitted, the native prompt still tells the model to declare a single tool.
These are not the same root cause as SUM-14; they need a direct mixed
composition or a multi-tool admission contract.

| Case | Question | Admission observed (plan diagnostic) | Actual run | Root cause | Correction needed |
|---|---|---|---|---|---|
| MIX-01 | Compare patient treatment with approved lithium recommendations | `get_patient_context(treatments)` only | patient treatment only; `knowledgeOk=false` | “recommandations approuvées” is not an approved-source cue; kind of plan is `treatments` | admit patient + `search_knowledge`; direct mixed composition |
| MIX-02 | Treatment precautions in approved sources | `get_patient_context(treatments)`; parser reads “dont” as a name | `needs_input` | parser false positive + no knowledge admission | add “dont” to stop list; admit both |
| MIX-03 | Patient diagnoses documented in DSM-5 | `search_knowledge` only | knowledge only, no evidence | “documentés” does not trigger the patient diagnosis target; DSM does trigger knowledge | admit patient diagnoses + knowledge |
| MIX-04 | Interaction described in approved sources | `get_patient_context(treatments, active)` only | patient treatment only | “interaction … sources approuvées” is not treated as knowledge | admit both |
| MIX-05 | Biological monitoring recommended for this treatment | `search_knowledge` only | knowledge only, no evidence | “ce traitement” is not a patient anchor; no treatment target | admit patient treatment + knowledge |
| MIX-06 | Summarize dossier + points to verify in sources | `get_patient_context(summary)` only | patient summary only (structural SMOKE, semantic FAIL) | “sources” not recognized as approved-source request | admit summary + knowledge |
| MIX-07 | Adverse effects of patient treatments documented | `get_patient_context(treatments)` only | patient treatment only (structural SMOKE, semantic FAIL) | “effets indésirables” not a knowledge cue | admit both |
| MIX-08 | Treatment contraindicated by diagnoses | `get_patient_context(diagnoses)`; parser reads “contre-indiqué” as a name | `needs_input` | parser false positive + no knowledge admission | stop-word + admit both |
| MIX-09 | Precautions missing from dossier | `get_patient_context(treatments, active)` only | patient treatment only | “précautions … absentes du dossier” not a knowledge cue | admit both |
| MIX-10 | Prepare dossier synthesis with approved references | no tools (`preparation` plan) | `query_documents` | plan routes to preparation; admission is empty | route to summary + knowledge |

### 3.4 Remaining semantic cases, individually

`SMOKE` is structural only: the turn completed and carried provenance. It is
not a semantic PASS. `BLOCKED` means the route is plausible but no case-level
factual oracle exists; `FAIL` means the observed route cannot satisfy the
question.

| Case | Question (short) | Actual route | Status | Assessment / next action |
|---|---|---|---|---|
| SUM-01 | Full dossier summary | `get_patient_context(summary)` | SMOKE / BLOCKED | correct section; no fact-level oracle |
| SUM-02 | Last five consultations | `get_patient_context(summary)` | SMOKE / BLOCKED | count/section need a fact-level oracle |
| SUM-04 | Active diagnoses | `get_patient_context(diagnoses)` | SMOKE / BLOCKED | route correct |
| SUM-06 | Stopped treatments and why | `get_patient_context(treatments)` | SMOKE / BLOCKED | partial; one part failed generation; verify history inclusion |
| SUM-07 | Scales administered and scores | `get_patient_context(scales)` | SMOKE / BLOCKED | fixed: scales now admitted; no fact-level score oracle |
| SUM-08 | Documents issued | `query_documents` | SMOKE / BLOCKED | route correct |
| SUM-11 | Clinical evolution over one year | `get_patient_context(summary)` | SMOKE / BLOCKED | fixed: “clinique” no longer opens the cabinet view; longitudinal route admitted |
| SUM-13 | Missing administrative elements | `get_patient_context(profile)` | SMOKE / BLOCKED | route correct |
| SUM-15 | Last consultation without invented facts | `get_patient_context(summary)` | SMOKE / BLOCKED | fixed: “sans ajouter” no longer becomes a write proposal; deterministic summary partial |
| NOTE-01 | Last consultation notes | `get_patient_context(notes)` | SMOKE / BLOCKED | route correct |
| NOTE-02 | Mood and sleep in the note | `get_patient_context(notes)` ×2 | SMOKE / BLOCKED | partial, budget limited; no semantic oracle |
| NOTE-04 | Treatment plan in last note | `get_patient_context(notes)` | SMOKE / BLOCKED | route correct |
| NOTE-05 | Objective observations | `get_patient_context(notes)` | SMOKE / BLOCKED | route correct |
| NOTE-06 | Diagnoses in latest note | `get_patient_context(notes)` | SMOKE / BLOCKED | route correct |
| NOTE-07 | Medications mentioned in notes | `get_patient_context(notes)` ×2 | SMOKE / BLOCKED | partial, budget limited |
| NOTE-08 | Scales mentioned in notes | `get_patient_context(notes)` | SMOKE / BLOCKED | one part failed generation |
| MULTI-04 | Active then paused treatments | `get_patient_context(treatments)` both turns | SMOKE / BLOCKED | route correct; second turn state not fact-checked |

The full 40-case inventory is therefore: **11 semantic failures** (SUM-14,
MIX-01…MIX-10), **29 structural/blocked** cases, and **no case converted to
PASS without evidence**.

## 4. Model evaluation

The model was evaluated through the **real compact selector path**, on ten
representative French clinical questions, with the same hybrid retriever and
the same evidence envelope used by the product. The run is reproducible with
`tests/integration/alexa-generation-eval.live.test.ts` (gated by
`MINDCARE_ALEXA_GEN=1`). It stores no source text.

| # | Question | Proofs | ms | Published | Selector fallback |
|---|---|---:|---:|---|---|
| 1 | Risques rénaux du lithium | 5 | 76 508 | unavailable | `language` |
| 2 | Effets hématologiques de la clozapine | 5 | 46 290 | unavailable | `language` |
| 3 | Contre-indications du valproate chez la femme enceinte | 5 | 26 901 | cited | — |
| 4 | Débuter la sertraline chez une personne âgée | 5 | 44 357 | unavailable | `unsafe-text` |
| 5 | Mécanisme de la lamotrigine | 3 | 24 796 | unavailable | `entity` |
| 6 | Syndrome sérotoninergique | 5 | 28 643 | cited | — |
| 7 | Posologie de l'aripiprazole dans la schizophrénie | 2 | 947 | unavailable | `entity` |
| 8 | Surveillance biologique sous olanzapine | 5 | 19 307 | cited | — |
| 9 | Première intention dans le trouble bipolaire | 5 | 56 098 | cited | — |
| 10 | Précautions rénales avec le lithium | 5 | 56 516 | unavailable | `language` |

Summary: **4 cited / 10, 6 unavailable, 0 model failures**, fallbacks
`language` ×3, `unsafe-text` ×1, `entity` ×2. Node RSS peak: **578 MB**.
The first query paid the model/embedding warm-up (76 s); warm queries ranged
from **0.9 s to 56 s** depending on generation length.

### Interpretation

- **Faithfulness is not the right metric for published prose here.** The
  server deliberately emits `evidence.quote`, never `sentence.text`; the model
  cannot publish a paraphrase, dose or diagnosis of its own. The safety-relevant
  question is therefore whether the selector chooses an allowed, grounded
  quote — and the 4 cited answers did.
- **Preservation is enforced after selection.** `knowledge-synthesis.ts`
  re-checks each emitted quote against the proof (`quote-span`), the requested
  medication (`entity`), numeric bounds (`number`/`quantity`/
  `unicode-number`), negation/polarity (`quote-polarity`) and the source
  citation. A model-generated dosage or contraindication never reaches the
  user.
- **The 1B model copies English rather than writing French.** On the three
  `language` failures the diagnostic recorded `sentences: 2–3`, `english: 2–3`,
  `literalSingleSpan: 0`: the draft was English prose, not a single literal
  quote. The policy correctly refused it. This is the observed capability
  limit; it is not evidence that retrieval failed (all ten retrieved `ok`).
- **`entity` failures are selector/grounding failures, not retrieval
  failures.** Lamotrigine and aripiprazole both had approved proofs; the model
  cited a passage that did not preserve the requested entity.
- **`unsafe-text`** on the elderly-sertraline question was a rejected
  action/personal claim in the draft, not a missing warning.

### Runtime measurements

The separate `alexa-local-model-benchmark.live.test.ts` run on the same machine
measured:

| Metric | Cold | Warm |
|---|---:|---:|
| Total generation | 12 536 ms | 3 280 ms |
| Output tokens | 33 | 33 |
| Tokens/s | 2.63 | **10.06** |
| llama-server working set | — | **851 MB** |
| Node RSS | — | 66 MB |

During the ten-question selector run, Node RSS peaked at **578 MB**; during
the semantic audit, `llama-server` working set was observed around
**1.4–1.5 GB**. These are different workloads (embedding + agent prompt vs a
small warm generation), so both are reported rather than merged.

### Metrics not measured

- **TTFT**: the pinned llama.cpp client is non-streaming (`stream:false`), so
  time-to-first-token is not observable without changing the transport. Total
  generation latency is reported instead.
- **Selector tokens/s**: the selector request uses a JSON schema and a
  1 024-token ceiling; actual completion tokens were not persisted. The warm
  benchmark above is the best direct measurement available without new
  instrumentation.
- **Truncation**: zero `LocalModelTruncated` in this ten-question selector run.
  Separate dossier cases did hit `LocalModelTimeout` (MULTI-02) and exhausted
  the agent budget (NOTE-03); those are reported in the case table, not hidden
  in this aggregate.

## 5. Translation feasibility

### What was tested

A gated diagnostic (`MINDCARE_ALEXA_TRANSLATE=1`) takes the first usable
sentence of the top approved proof for ten clinical questions, asks the pinned
model to reformulate it in French with the existing
`KNOWLEDGE_FRENCH_REFORMULATION_PROMPT`, and applies deterministic checks:

- all numbers in the source are present, and no number was added;
- requested medication names are preserved;
- English negation/restriction words are not lost, and French negation is not
  added;
- the output has a French shape rather than copied English.

These checks are **necessary but not sufficient**. They do not prove
entailment, conditions, exceptions, causality, or source-reference
preservation. A “preserved” result is therefore a feasibility signal, not an
authorization to publish.

### Result

Ten approved passages, pinned model, production reformulation prompt:

| # | Question | Result | French | Missing drug | Numbers | Negation |
|---|---|---|---|---|---|---|
| 1 | Risques rénaux du lithium | preserved | yes | — | preserved | preserved |
| 2 | Effets hématologiques de la clozapine | preserved | yes | — | preserved | preserved |
| 3 | Contre-indications du valproate | **unsafe** | yes | **valproate** | preserved | preserved |
| 4 | Débuter la sertraline chez une personne âgée | preserved | yes | — | preserved | preserved |
| 5 | Mécanisme de la lamotrigine | **not French** | no | — | preserved | preserved |
| 6 | Syndrome sérotoninergique | preserved | yes | — | preserved | preserved |
| 7 | Posologie de l'aripiprazole | preserved | yes | — | preserved | preserved |
| 8 | Surveillance biologique sous olanzapine | preserved | yes | — | preserved | preserved |
| 9 | Première intention du trouble bipolaire | preserved | yes | — | preserved | preserved |
| 10 | Précautions rénales avec le lithium | preserved | yes | — | preserved | preserved |

Summary: **8 preserved, 1 unsafe, 1 not French, 0 model failures**. The unsafe
case is decisive: the translation dropped the medication name **valproate**.
That is exactly the class of omission the current quote-only policy is designed
to prevent. A lexical checker caught it here, but a production layer would need
a stronger entailment and source-reference contract before it could publish.

The result is also not a full victory for translation: one passage remained
English, and the “preserved” label only means the four lexical checks passed.
It does not prove that conditions and exceptions were preserved.

### Risk assessment

- A translation layer that only preserves numbers and drug names can still
  invert a contraindication, drop “unless/except”, or turn a conditional warning
  into a universal one.
- The production validator currently rejects `language` fallbacks precisely
  because it cannot prove those properties. Relaxing it to gain French output
  would weaken a clinical gate.
- The safe options are: (a) keep verbatim quotes and accept English source
  passages, or (b) build a separate entailment/translation contract with
  source-reference preservation and a human-reviewed rejection path. This
  report does not implement (b).

## 6. Prioritized plan

The order follows the trace evidence, not the final error text.

### P0 — deterministic routing and query semantics (implemented)

1. **Identity parser false positives** — `vie`, `grossesse`, `insuffisance`,
   `allergie`, `antécédent` are clinical nouns, not patient names.
   File: `src/shared/alexa/patient-mention.ts`.
   Test: `alexa-record-routing.test.ts` (parser).
2. **Record vocabulary lost to the knowledge fallback** — active treatments,
   diagnosis states, noted treatment changes and medical history now enter the
   patient target before `isClinicalKnowledgeQuestion` can send them to books.
   File: `src/shared/alexa/request-contract.ts`, `request-plan.ts`.
   Tests: `alexa-record-routing.test.ts`.
3. **Wrong administrative profile for “antécédents”** — maps to `summary`, not
   `profile`. Same files/tests.
4. **Agenda asked for a date it did not need** — “prévus/à venir” for a
   selected patient uses a bounded future window (+364 days), both in direct
   native dispatch and in the executor.
   Files: `src/server/alexa/agent-loop.ts`, `agent-tools.ts`.
   Test: `alexa-record-reads.test.ts` (window and direct path).
5. **First/last consultation dates** — the “dernière” token no longer forces a
   period clarification; the summary tool returns the first and last dates
   from the governed clinical context.
   Files: `request-contract.ts`, `agent-tools.ts`.
   Test: `alexa-record-reads.test.ts`.
6. **Patient financial situation** — uses the existing audited
   `readPatientFinance` path (`get_patient_workspace`, `list_patient_timeline`,
   `get_consultation_payment`), not a payment list and not books.
   Files: `request-contract.ts`, `request-plan.ts`, `agent-tools.ts`.
   Test: `alexa-record-reads.test.ts`.
7. **Latest note direct read** — “dernière note” now scopes the latest visit
   and can use the direct note reader instead of exhausting the model loop.
   Files: `agent-loop.ts`, `agent-tools.ts`.

### P1 — context assembly and lifecycle

8. **Bounded summary fallback** — if the optional narrative model fails on a
   single-visit summary, keep the deterministic, source-cited local sentences
   already assembled by the tool. This does not weaken validation; it avoids
   turning a readable dossier into a failed turn.
   File: `agent-tools.ts`.
9. **Focused knowledge follow-up** — “Et pour la grossesse ?” becomes
   “Quelles précautions pour la sertraline pendant la grossesse ?”; “Et en cas
   d'insuffisance rénale ?” becomes “Quelle est la posologie de la sertraline
   en cas d'insuffisance rénale ?”. The retrieval trace shows the pregnancy and
   renal sections already rank first; the remaining work is the selector.
   File: `orchestrator.ts`.

### P1.5 — mixed patient + knowledge composition (not implemented)

12. The ten MIX cases fail before generation because admission admits one side
    of the request. The smallest safe correction is a deterministic mixed read:
    build one patient part (`get_patient_context` with the section implied by
    the question) and one knowledge part (`search_knowledge` with the full
    question), execute both, and keep their evidence separate. Do not let the
    1B model compose clinical facts across the two domains. This requires a
    new regression test per MIX case and a clear presentation separator; it is
    deliberately not included in this correction cycle because it changes the
    answer surface.

### P2 — missing governed capability (blocked)

10. **Allergies / contraindications** — the clinical context gate exposes no
    allergy section. The only admitted path is currently `search_knowledge`,
    which cannot answer “consignées”. Do **not** infer allergy status from
    books. Proposed correction: add a read-only `allergies` section backed by
    the existing `list_patient_allergies` gate, with explicit provenance and an
    “absence of data is not absence of allergy” sentence. This needs a human
    decision because it expands the Alexa read surface. Until then, SUM-14 is
    **blocked**, not PASS.

### P3 — model / output policy

11. **French clinical prose** — the quote-only policy is deliberate. A
    translation layer is only acceptable with an entailment contract that
    preserves negation, conditions, exceptions, doses and source references.
    See §5. Do not relax `language`/`unsafe-text` fallbacks to raise the score.

### Files modified in this cycle

| File | Purpose |
|---|---|
| `src/shared/alexa/patient-mention.ts` | clinical nouns are not patient identities; medication-led multiword candidates are rejected |
| `src/shared/alexa/request-contract.ts` | record-state targets, scales/longitudinal, finance situation, first/last dates, allergy-record abstention, no-mutation guard, note area |
| `src/shared/alexa/request-plan.ts` | medical-history/finance intents, no-mutation guard |
| `src/server/alexa/agent-loop.ts` | direct latest-note, upcoming agenda, direct knowledge lifecycle |
| `src/server/alexa/agent-tools.ts` | patient-finance summary, upcoming agenda window, first/last dates, deterministic bounded-summary fallback |
| `src/server/alexa/orchestrator.ts` | focused knowledge follow-up |
| `tests/unit/alexa-record-routing.test.ts` | routing/parser/admission regressions |
| `tests/unit/alexa-record-reads.test.ts` | finance, agenda window, consultation bounds |
| `tests/integration/alexa-dossier-smoke.live.test.ts` | 40-case structural trace; no answer text stored |
| `tests/integration/alexa-generation-eval.live.test.ts` | 10-question selector/fallback evaluation |
| `tests/integration/alexa-translation-probe.live.test.ts` | 10-passage preservation probe |
| `tests/integration/alexa-retrieval-trace.live.test.ts` | lexical/vector/selection trace, no source text |
| `tests/integration/alexa-local-model-benchmark.live.test.ts` | tokens/s, latency, llama-server RSS |
| `docs/ALEXA-POST-HYBRID-REVIEW.md` | this report |

### Regression test plan

- Unit: parser, admission, plan, finance, agenda window, consultation bounds,
  focused follow-up, no-mutation, note area.
- Integration: the 40-case smoke harness with a real practitioner session and
  real local DB; it must keep recording `SMOKE`, never `PASS`.
- Knowledge: 10-question generation eval and 7-query retrieval trace; both
  assert `ok`/`sans-preuve` and selected proof provenance without storing text.
- Model: benchmark the pinned model on cold/warm generation and memory.
- Safety: the existing safety tests are unchanged; no `language`, `unsafe-text`
  or abstention gate was weakened.

### Rollback

- Before commit: `git checkout -- <file>` for each modified file; the local
  deletion of migration 214 must remain untouched.
- After commit: `git revert <commit>` restores the six source files and the
  tests together. No migration, RLS policy, patient row or runtime asset is
  changed by this work.

## 7. 100-case status

### 7.1 The 60-case runner (deterministic and governed oracles)

`tests/integration/alexa-reliability-100.live.test.ts` reports:

| Category | PASS | FAIL | NOT RUN |
|---|---:|---:|---:|
| General | 10 | 0 | 0 |
| RAG | 20 | 0 | 0 |
| Medication | 10 | 0 | 0 |
| Patient aggregates | 15 | 0 | 0 |
| Reliability | 5 | 0 | 0 |
| **Total** | **60** | **0** | **40** |

The runner records the 40 semantic cases as `NOT RUN` because it has no
case-level oracle for them. They were then executed by
`tests/integration/alexa-dossier-smoke.live.test.ts`; that harness records
`SMOKE`, never `PASS`.

### 7.2 The 40 semantic cases (executed separately)

| Status | Count | Meaning |
|---|---:|---|
| PASS | 0 | No case-level factual oracle was available for this family. Not claimed. |
| FAIL | 11 | The observed route cannot satisfy the question: SUM-14 and MIX-01…MIX-10. |
| BLOCKED | 29 | Turn executed with provenance, route plausible, but no semantic oracle or a generation fallback remains: SUM-01–13 and SUM-15; NOTE-01–10; MULTI-01–05. |
| NOT RUN | 0 | All 40 were executed at least once. |

### 7.3 Combined 100-case inventory

| Bucket | Count |
|---|---:|
| PASS | 60 |
| FAIL | 11 |
| BLOCKED | 29 |
| NOT RUN | 0 |
| **Total** | **100** |

This is **not** a 100/100 success. The 29 blocked cases are not converted to
PASS; they are reported as executed but not semantically certified. The 11
failures are reproducible and listed in §3.

### 7.4 Latency and failure stage

- 60-case runner: 90 s total on the warm development machine.
- Semantic smoke: ~20–40 min for 40 cases; individual turns ranged from a few
  seconds to the 180 s deadline. The slowest observed stages were the local
  model selector/generation and the agent loop budget.
- Failure stages actually observed: admission/tool choice (SUM-14, MIX family;
  SUM-07/SUM-11/SUM-15 were in this class and are fixed), pre-tool period gate
  (SUM-12, fixed), agent budget (NOTE-03, NOTE-02/07), generation fallback
  (NOTE-08, MULTI-02, MULTI-03), and local model timeout/truncation
  (MULTI-01 before the direct knowledge bypass, MULTI-02 earlier).

### 7.5 Verification

| Check | Result |
|---|---|
| Unit suite (`pnpm vitest run`, Git on PATH) | **446 files, 5 801 tests passed, 126 skipped, 0 failed** |
| Typecheck (`pnpm typecheck`) | **PASS** |
| Build (`pnpm build`) | **PASS** |
| 60-case runner in isolation | **60 PASS / 0 FAIL / 40 NOT RUN**, 92.6 s |
| 40-case semantic smoke | executed; 11 FAIL / 29 BLOCKED, no PASS claimed |
| Safety tests | unchanged and passing; no `language`/`unsafe-text`/abstention gate weakened |

## 8. Recommendation

Retain **MiniCPM-V-4_7-1B-Q4_K_M + llama.cpp b11429** for this correction
cycle. The evidence does not support a model swap as the first fix:

- retrieval is healthy (10/10 paraphrases; all audited clinical questions
  return `ok` with approved proofs);
- the deterministic application routes and the quote-only validator are the
  actual blockers for most of the 40 semantic cases;
- the 1B model's observed defect is that it drafts English clinical prose
  instead of selecting a French literal quote, and the published answer is a
  quote, not that prose.

The next product decision is therefore explicit, not a benchmark accident:
either keep the current verbatim-quote contract (safe, sometimes English), or
fund a verified French translation/entailment layer. The translation probe
supports this caution: 8/10 passages preserved the lexical checks, but one
translation **dropped the medication name valproate** and one stayed English.
That is not a layer that can be enabled without an entailment contract and a
rejection path.

A stronger local model should only be benchmarked after that contract exists;
otherwise it would still be constrained by the same quote-only publication
rule. The immediate work is deterministic, not a model swap:

1. fix the mixed patient+knowledge composition (10 cases);
2. either add the governed allergy read for SUM-14 or keep it formally blocked;
3. add fact-level semantic oracles for the 29 blocked cases before claiming
   them as PASS.

The deterministic fixes for SUM-07, SUM-11 and SUM-15 are already in this
cycle. The honest status is **60 PASS / 11 FAIL / 29 BLOCKED / 0 NOT RUN**,
not 100/100.
