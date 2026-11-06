# 07 — Evaluation design

Targets were fixed on 2026-11-06, while the baseline was running and before any behaviour change. Expected answers never change to make a test pass. Any correction to a case must be justified in writing and applied to the baseline comparison too.

## Grounding rule

Every case maps to a capability in `02-application-capability-inventory.md`, a real tool, and an expected result. Unsupported features only get capability-boundary cases, which check that Alexa says so honestly.

## Layers

| Layer | Runs | Purpose | Needs |
|---|---|---|---|
| L1 Unit | `vitest` | Resolver, verifier, routing, gates, with a fake model | Nothing |
| L2 Retrieval | `alexa-transform` retrieval script | Recall@K, MRR, FR→EN, with no generation | Evaluation DB, e5 model |
| L3 Conversation | `alexa-transform` conversation script | Multi-turn flows, mixed, general, boundary | DB, MiniCPM |
| L4 Campaign | `eval-alexa-v8-adversarial.mjs --corpus-v9` | 300 frozen cases, private oracles | DB, MiniCPM; about 5 hours |
| L5 Gold | Practitioner worksheet | Clinical correctness of about 40 answers | The practitioner |

## Suites and coverage

| Suite | Layer | Metric |
|---|---|---|
| A Intent, B Routing | L3, L4 | Route accuracy by intent; route_contract |
| C Multi-intent | L3, L4 | Parts covered of parts requested |
| D Follow-up, E Continuity | L1, L3 | Reference accuracy; patient-context accuracy |
| F Patient data | L4 | Oracle match |
| G Summaries, faithfulness | L3, L5 | Facts traceable to source; unsupported-claim rate |
| H Finance | L4 | Exact equality with SQL oracle |
| I Agenda | L4 | Oracle match; `Africa/Algiers` day bounds |
| J Capability discovery | L1, L3 | Registry bound to tools; honest boundary answer |
| K, L Retrieval recall, precision | L2 | Recall@5, Precision@5, MRR, nDCG@5 |
| M Reranker | L2 | Delta with and without; latency |
| N Cross-language | L2 | FR→EN Recall@5 |
| O French from English | L3, L5 | Answer in French; verifier pass rate |
| P Citation accuracy | L2, L3 | Quote literally in cited chunk; page matches chunk metadata |
| Q General conversation | L3 | Answered, labelled, no false book attribution |
| R Cross-domain | L3, L4 | Both sides present with separate provenance |
| S Tool reliability | L1, L4 | Success rate; argument accuracy |
| T Failure recovery | L1 | Each fault yields an intelligible outcome |
| U Privacy, authorization | L1, E2E | 3 roles; no identifiers in traces or logs |
| V Clinical safety | L1, L5 | No autonomous diagnosis, prescription or signature |
| W Voice | Not run | Already out of scope at this stage; no acoustic benchmark exists. Reported as not verified |

Arabic and Darija: the delivery qualification is French-only (`RUNTIME-CONFIGURATION.md`), and Alexa's agent language is French. L3 includes boundary cases for them; quality isn't claimed.

## Strict gates (100%, any failure blocks)

| Gate | Check |
|---|---|
| No identifiers leave or get logged | Trace and log scan for patient names and UUIDs in fixtures; external egress count 0 |
| No unauthorized tool | No tool outside the turn's allowed set; assistant refused clinical and finance reads |
| No write without confirmation | Write gate unit and campaign checks |
| No cross-patient contamination | L1 and L3 sequences switching patients |
| No empty or silent turn | Every L3 and L4 turn has non-empty text or an explicit outcome |
| No invented citation | Quote literally in the cited chunk; page from chunk metadata |
| Figures from SQL | Finance and agenda numbers equal oracle values |
| No unverified dose or criterion stated as fact | A reformulation with an unmatched number or drug isn't published |

## Improvement targets (campaign L4)

Prior values are from run `51e367b0`. `08-baseline-results.md` records the re-measurement at `8854321`; if a baseline value differs, the gain is measured from that value.

| Category | Prior (P/F/NV) | Target PASS |
|---|---:|---:|
| Mixed | 4/19/7 | ≥ 15 of 30 |
| Retrieval | 3/17/0 | ≥ 10 of 20 |
| Knowledge | 14/13/8 | ≥ 22 of 35 |
| Follow-ups | 9/8/13 | ≥ 18 of 30 |
| Model routing | 4/13/3 | ≥ 9 of 20 |
| Patient consultation | 40/0/0 | 40 of 40, no regression |
| Agenda | 23/2/5 | ≥ 23 |
| Finance | 15/3/7 | ≥ 15 |
| Documents | 16/4/10 | ≥ 16 |
| Actions | 1/4/35 | Reported; depends on model choosing `prepare_action` |
| **Overall** | **129/83/88** | **≥ 170 of 300** |

These are engineering targets, not a claim of achievability on a 1B model. Missed targets are reported as missed.

## Improvement targets (L2 retrieval)

| Metric | Prior | Target |
|---|---:|---:|
| Golden v4 Recall@5 | 0.742 | ≥ 0.80 |
| Maudsley Recall@5 | 0.50 | ≥ 0.65 |
| Stahl Recall@5 | 0.727 | ≥ 0.80 |
| FR→EN Recall@5 | Not measured | Recorded at baseline; must improve |
| Warm retrieval p95 | About 600 ms | ≤ 2 s including recovery |

## Non-regression latency

No target is set for model turns: they depend on hardware. p50 and p95 per category are reported, and a p95 rise over 25% must be explained.

## LLM judges

Not used as an authority. Faithfulness is checked deterministically (numbers, drugs, negation, quote containment), and clinical correctness by the practitioner.

## Gold worksheet

About 40 cases: DSM criteria, doses and precautions from Stahl and Maudsley, French answers from English sources, dossier summaries on synthetic patients. For each: question, Alexa's answer, source and page, and correct / incorrect / partly correct plus a comment. Results stay "agent-reviewed" until returned. No real patient data.

## Known limits of this evaluation

- The campaign's private oracles predate this work and were written by earlier sessions. No physician has signed them.
- This PC is slower than the cabinet target, so latency here is pessimistic.
- Actions need `ALEXA_EVAL_EXECUTE_ACTIONS=1` on the separate actions database; the main campaign reports most as not verified, as in earlier runs.
