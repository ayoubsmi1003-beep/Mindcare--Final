# 08 — Baseline results

## L4 campaign, before any behaviour change

| Field | Value |
|---|---|
| Run | `03f470f9-bf23-4dcd-82b8-886f8c06fe4a` (report in `.eval-out/alexa-v8-upgrade/`, not committed) |
| Code | `8854321`, which only adds docs and harness bindings on top of `b4bd811` |
| Pre-fix proof | The run's runtime bundle was built 16 s after that commit and contains none of the later code (`TurnTraceRecorder`, `frenchAidEligible`) |
| Database | `alexa_eval_v8_intelligence_20261027`: 1,558 patients, 8,143 consultations |
| Retrieval | Hybrid `e5-base` was on: all 114 knowledge traces ran lexical and vector search |
| Duration | About 3 h 20 min on this PC |
| Evaluator | `7c62c71b…`, private oracles `5756f404…` |

**Result: 158 PASS, 72 FAIL, 70 NOT VERIFIED, 0 NOT RUN.** The campaign status is FAIL.

| Category | Prior `51e367b0` (P/F/NV) | Baseline (P/F/NV) | Target PASS | Target already met? | Latency p50 / p95 (s) |
|---|---:|---:|---:|---|---:|
| Knowledge | 14/13/8 | 14/15/6 | ≥ 22 of 35 | No | 59.4 / 268.6 |
| Mixed | 4/19/7 | 3/20/7 | ≥ 15 of 30 | No | 34.4 / 136.5 |
| Retrieval | 3/17/0 | 5/15/0 | ≥ 10 of 20 | No | 11.4 / 76.1 |
| Follow-ups | 9/8/13 | 23/3/4 | ≥ 18 of 30 | **Yes** | 0.1 / 107.6 |
| Model routing | 4/13/3 | 10/9/1 | ≥ 9 of 20 | **Yes** | 0.9 / 58.4 |
| Patient consultation | 40/0/0 | 40/0/0 | 40 of 40 | Yes | 0.2 / 59.4 |
| Agenda | 23/2/5 | 26/2/2 | ≥ 23 | Yes | 0.1 / 101.6 |
| Finance | 15/3/7 | 20/2/3 | ≥ 15 | Yes | 0.1 / 125 |
| Documents | 16/4/10 | 17/3/10 | ≥ 16 | Yes | 0.1 / 137.3 |
| Actions | 1/4/35 | 0/3/37 | Reported | n/a | 45.7 / 145.9 |
| **Overall** | **129/83/88** | **158/72/70** | **≥ 170** | No | 1 / 139.4 |

## What this changes in the evaluation

The targets in `07-evaluation-design.md` stay as written. They were set from the older run, and commits before `b4bd811` had already improved several categories, so:

- **Follow-ups and model routing already meet their targets.** Passing them proves nothing about this work. Their test is now "more passes than the baseline, and no regression".
- **The overall target is only 12 passes above this baseline.** It's a floor, not the headline. The per-category gains matter more.
- **The real gaps are mixed, retrieval and knowledge**, which hold 50 of the 72 failures. This matches the practitioner's complaints.

## Failure causes

| Failed check | Cases | Reading |
|---|---:|---|
| `knowledge_case:source` and `page` | 34 each | The expected source and page weren't in the answer |
| `knowledge_case:answer_present`, `retrieval_succeeded` | 16 each | No usable answer, or nothing retrieved |
| `retrieval_contract:page_attribution` | 12 | Wrong page or none |
| `snapshot_case:frozen_assertion_*` | 13 | Frozen assertion missed |
| `route_contract:expected_pipeline` | 6 | Wrong pipeline |
| `action_contract:frozen_expected_action_outcome` | 3 | Action outcome differs |

Knowledge retrieval outcomes over 114 traces: 80 `ok`, 22 `faible`, 12 `sans-preuve`.

**70 NOT VERIFIED:** 37 are actions, because this campaign doesn't execute them. The others are 10 documents, 7 mixed, 6 knowledge, 4 follow-ups, 3 finance, 2 agenda and 1 routing. They are unproven, not passes.

## Strict gates observed in this run

| Gate | Result |
|---|---|
| External egress | 0 across 360 turns |
| Turn with no text | 0 of 360 |
| Others | Not concluded from this run. They are checked in the final campaign and the unit layers |

## Honesty about turn endings

Of 360 turns: 180 `completed`, 86 `partial`, 49 `failed`, 35 `needs_input`, and 10 with no status on `done`. Latency is very uneven: closed-form reads return in under a second, while a turn that calls the model reaches 2 min at p95 and 350 s at worst, on an i3-4150 that is slower than the cabinet target.

## L2 retrieval, same commit

Run through `tests/integration/alexa-transform-eval.live.test.ts`, with hybrid `e5-base` on. `scripts/eval-book-rag.mjs` stops at its pre-flight here because `mindcare_app` can't read `app.schema_migrations`, so the test uses a copy of its matcher.

| Set | n | Recall@5 | Recall@1 | MRR |
|---|---:|---:|---:|---:|
| Golden v4, overall | 31 | 0.774 | 0.548 | 0.641 |
| Golden v4, DSM-5 | 10 | 1.00 | 0.90 | 0.95 |
| Golden v4, Maudsley | 10 | 0.50 | 0.20 | 0.32 |
| Golden v4, Stahl | 11 | 0.818 | 0.545 | 0.652 |
| FR→EN, overall | 32 | 0.625 | n/a | 0.548 |
| FR→EN held out | 13 | 0.692 | n/a | 0.458 |

The 3 unanswerable Golden cases return `sans-preuve`. Warm retrieval p95 was about 0.6 s on FR→EN.

The fixes committed through `a96fd40` left all of these unchanged. Recovery only runs when lexical search returns nothing, and that wasn't the failure here.

## L2 after the retrieval change (old and new code, same matcher)

Measured on 2026-11-07. The matcher now treats "Chapter 1" as exact, so it no longer also accepts Chapters 10 to 14. All "before" values were re-measured on `8854321` with it.

| Set | n | Independent? | Recall@5 before → after | MRR before → after |
|---|---:|---|---:|---:|
| **Held-out 3** | 15 | **Yes: written before any run. Re-run once after a review fix that wasn't tuned on it** | **0.600 → 0.733** | 0.513 → 0.700 |
| Held-out 3, Stahl | 8 | Yes | 0.625 → 0.875 | 0.525 → 0.875 |
| Held-out 3, Maudsley | 7 | Yes | 0.571 → 0.571 | 0.500 → 0.500 |
| Held-out 2 | 13 | No, its first measure preceded later rule changes | 0.615 → 0.692 | 0.387 → 0.464 |
| Held-out 1 | 13 | No, it steered the review fixes | 0.692 → 0.692 | 0.458 → 0.496 |
| FR→EN | 32 | No, tuned on | 0.625 → 0.938 | 0.548 → 0.856 |
| Golden v4, overall | 31 | No, partly tuned on | 0.774 → 0.839 | 0.641 → 0.740 |
| Golden v4, Stahl | 11 | No | 0.818 → 1.00 | 0.652 → 0.955 |
| Golden v4, Maudsley | 10 | No | 0.50 → 0.50 | 0.32 → 0.295 |
| Golden v4, DSM-5 | 10 | No | 1.00 → 1.00 | 0.95 → 0.95 |

Held-out 3 is the number to trust, and its sample is small. Against the targets in `07-evaluation-design.md`: Golden overall and Stahl are met, **Maudsley (≥ 0.65) is missed**, and FR→EN improved. The change helps questions about a named drug. It doesn't help Maudsley topic questions.

The 3 unanswerable Golden cases still return `sans-preuve`. This measures whether the right passage was retrieved, not whether the published answer is good.

## L3 conversation, same commit

**24 of 38 turns pass** across 18 flows, with p50 28 s and p95 145 s. These flows were written with the fixes in mind, so they are a regression check for those fixes, not an independent score.

Failures at baseline: turns that lose the patient after a neutral turn (F02, F03, F07, F16), a replaced drug that gets no new evidence (F04), absent features (F13), mixed and safety reads (F14, F17), and a general question that fails (F12).
