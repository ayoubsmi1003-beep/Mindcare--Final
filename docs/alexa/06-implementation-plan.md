# 06 — Implementation plan and checklist

Living checklist. Each batch: failing test first, fix, targeted suite, commit.

## Environment

| Item | Value |
|---|---|
| Evaluation database | `127.0.0.1:55445/alexa_eval_v8_intelligence_20261027`, trust auth, container `mindcare-v8-intelligence-20261027` |
| Fingerprint enforced by harness | 1,558 patients, 8,143 consultations, 0 non-synthetic |
| Model root | `ALEXA_LOCAL_MODEL_ROOT=C:\MindCare\alexa-v8-final\.cache\alexa\minicpm`. A junction fails the asset check, correctly |
| Campaign | `node scripts/eval-alexa-v8-adversarial.mjs --corpus-v9 --capture-answers`, about 5 hours |
| Campaign environment | `MINDCARE_ALEXA_EVAL_DATABASE_URL`, `MINDCARE_ALEXA_EVAL_ADMIN_URL`, `ALEXA_NATIVE_AGENT_ENABLED=1`, `KNOWLEDGE_VECTOR=1`, `KNOWLEDGE_VECTOR_RECETTE=e5-base` |
| Results | `.eval-out/alexa-v8-upgrade/` (gitignored; junction to the main checkout) |
| Rule | One heavy job at a time. The harness bundles at start, so editing during a run is safe |

## Batches

### B0 — Baseline (Phase 2)
- [x] Harness runs on this worktree
- [ ] 300-case baseline at `8854321`
- [ ] `07-evaluation-design.md`, `08-baseline-results.md`
- [ ] Multi-turn and FR→EN datasets in `tests/eval/alexa-transform/v1/`
- [ ] Gold worksheet for the practitioner

### B1 — Trace and targeted fixes (Phase 3.1, 6)
- [ ] Courtesy, clock and abstention turns preserve conversation state (C3)
- [ ] A book question preserves the selected patient (C3)
- [ ] Corrupted literal at `orchestrator.ts:201`
- [ ] `completed` with empty text can't be reported (R2)
- [ ] `ordonnance` in `patient-records.ts:10` (A3)
- [ ] `TurnTrace` with closed codes (R1)
- [ ] `TurnOutcome` on `done`

### B2 — Evidence no longer discarded (Phase 4.7)
- [ ] `LocalModelTruncated` and provider failures: extractive fallback (found by the smoke case ADV-301)
- [ ] `language`, `entity`, `source-title`: fall back to the cited passage (K1)
- [ ] Gates judge what's published (K2)
- [ ] Monograph sentences under a drug heading are citable (K3)
- [ ] `faible` shows labelled passages (K8)
- [ ] DSM-5 quotes no longer rejected as `source-title` (K9)

### B3 — Retrieval (Phase 4.1-6)
- [ ] Planner: "selon les recommandations", section filter (K7)
- [ ] Mixed: canonical subject, one query per medication (C5)
- [ ] Term-subset lexical recovery (K5)
- [ ] Fusion across lots, floor and cap recalibration, measured (K6)
- [ ] Reranker rewired and re-measured (K10)
- [ ] Bounded recovery with neighbours (K11)
- [ ] Recipe packaged, flags written, health check, hybrid guard (K4)

### B4 — Frame and follow-ups (Phase 3.3)
- [ ] `ConversationFrame`, payload v4
- [ ] `FollowupResolver` replaces `knowledgeFollowupQuestion`
- [ ] Patient-domain follow-ups
- [ ] Cross-patient contamination tests

### B5 — French synthesis (Phase 4.8-9), security review required
- [ ] French claim with evidence IDs
- [ ] Deterministic verifier
- [ ] Reformulation label, sources beside the claim
- [ ] Disagreement presentation

### B6 — General conversation (Phase 3.6)
- [ ] Guards reduced to real risks
- [ ] Prose publication, bounded history, 320 tokens, label

### B7 — Understanding, plan, inference (Phase 3.2, 3.4, 3.5)
- [ ] `InferenceProvider` and task registry
- [ ] Unload window configurable and measured
- [ ] `CapabilityRegistry` with binding test
- [ ] `TurnUnderstanding` behind a flag
- [ ] Dependency graph, parallel reads

### B8 — Application reads (Phase 5)
- [ ] Allergies, adverse events, adherence, measurements
- [ ] Medication timeline, workload
- [ ] Statistics, dashboard, internal messages
- [ ] Case summary and status; observability
- [ ] No-show write (needs a migration: last)

### B9 — Safety and gate (Phase 6)
- [ ] OpenRouter deployment gate (risk R1): to be proposed to the user
- [ ] `scripts/alexa-why.mjs`
- [ ] `pnpm eval:alexa`
- [ ] Tool states

### B10 — Final (Phase 7)
- [ ] Full campaign compared with the baseline
- [ ] Typecheck, lint, unit, `eval:jarvis`, E2E; app with no model
- [ ] `09`, `10`, `11`, `STATE.md`

## Why this order

B1 gives the diagnostics everything else needs. B2 and B3 are the highest yield and need no model change. The understanding layer (B7) comes late on purpose: on this hardware it costs the most per turn, and its value depends on what the deterministic work leaves unresolved.
