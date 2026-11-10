# 01 — Alexa current-state audit

Audited at HEAD `b4bd811`, 2026-11-06. Source: code reading plus read-only aggregate queries on the synthetic evaluation database. Bugs marked "by reading" have not been reproduced yet; Phase 2 will measure them.

## 1. What a turn does today

Paths are under `src/`.

1. `services/alexa-turn.ts:56-71` builds `appContext` (patient, page, consultation, document).
2. `app/api/alexa/turn/route.ts` authenticates, selects native or legacy (`ALEXA_NATIVE_AGENT_ENABLED`, line 21), claims the turn (replay/pending/conflict, lines 40-63) and sets a 500 s deadline.
3. `server/alexa/orchestrator.ts:299-305`: `planRequest` short-circuits dialogue, clock, safe abstention and deterministic actions.
4. `orchestrator.ts:307-315`: reference read, listed-patient ordinal, then 16 chained regex rewriters that **replace the user's text**.
5. `orchestrator.ts:315-330`: patient continuation, then two deterministic aggregates.
6. `server/alexa/agent-loop.ts:826-897`: pre-gates and admission.
7. `agent-loop.ts:952-1016`: 39 `direct*` functions in fixed priority. A hit runs tools with no routing model.
8. `agent-loop.ts:1088-1422`: model loop only if nothing hit. 3 rounds, 6 calls, forced `declare_request`.
9. `orchestrator.ts:337-351`: unrouted no-patient fallback to knowledge, then presentation, reference save, `done`.

**Regex operations deciding meaning (grep approximation):** `request-contract` 312, `agent-loop` 183, `request-plan` 98, `orchestrator` 50, `patient-mention` 23, `agenda-plan` 10, others 5: about 680.

**Dead planners:** `understandPublicTurn` has no caller. `planLocalSemantic` is legacy-only and returns null without `qualification.json`. `inferAlexa` has no caller.

## 2. Models and runtime

| Item | Value |
|---|---|
| Text model | `MiniCPM-V-4_7-1B-Q4_K_M.gguf`, 672 MB (`model-policy.ts:9`) |
| Runtime | `llama-server` b11429: `-c 4096`, CPU only, one slot, temperature 0 |
| Threads | floor(logical/2), clamped 2-4 (`local-model.ts:35-38`) |
| Load | Lazy; ACL checks and SHA-256 of all artifacts at each start; unloads after 60 s idle |
| Speed | 2.63 tok/s cold, 10.06 warm; about 17-20 s for a 1,089-token prompt |
| Memory | 851 MB to about 1.5 GB |
| STT / TTS | `faster-whisper-small-int8` / Kokoro `ff_siwis`, local |
| Task routing | None locally: one model, tasks differ only by prompt, schema and budget |
| Provider abstraction | `LlmProvider` is cloud-only; local inference is a direct import |

**Machines:** this PC is an i3-4150 (2 cores, 4 threads), 7.9 GB RAM, no usable GPU. The documented cabinet target is an i7 gen 4 with 16 GB.

**Decision (2026-11-06):** MiniCPM stays for now. No cloud inference, no policy change. A provider interface is added for a later upgrade.

## 3. Cloud and privacy

- Alexa's conversation path is local only (`getAlexaModelPolicy`, `cloudFallback:false`). Voice cloud is hard-coded off.
- Gemini and Groq free tiers need `app.is_cloud_dev()` and fail closed.
- Classification (`egress/classification.ts`): C1, C2 and unknown are blocked. C3 needs the `alexa-clinical-minimal-v1` transform receipt. C4 is generic text or the issued book envelope.

### Risk R1: OpenRouter had no deployment gate (closed 2026-11-06)

Legacy `app/api/jarvis/jarvis-chat/route.ts:1003` calls `llm()`, whose OpenRouter branch ran on key presence alone. The classifier ran first and no usable free model was qualified, so this was never a confirmed leak. Every OpenRouter chat, quota and maintenance call now needs a passing `deploymentSynthetique`.

### Risk R3: `is_cloud_dev()` doesn't identify synthetic data (open, needs a decision)

- `resources/snapshot/purge-synthetic.sql` states that the 1,558 Syglab records are production records, flagged `is_synthetic = TRUE` only because they were imported under `cloud-dev`.
- `electron/main/orchestrateur.ts:728-733` skips the switch to `self-hosted` when a snapshot is restored, and it's the only code path that sets it. A restored install therefore most likely stays `cloud-dev` while holding real records. By reading; the installed database was not inspected.
- The same path also appears to skip the switch on a packaged standalone start, since `MINDCARE_ELECTRON_ENV` is only set for the cabinet server. Not proven reachable.

**Mitigated for egress:** `deploymentSynthetique` now refuses on any packaged install before reading the database. That covers OpenRouter, Gemini and Groq. The voice path's `garderVoix` has its own check, but cloud voice is hard-disabled.

**Not fixed:** the `environment` value itself stays wrong on such an install, and `is_synthetic` can't be trusted to mean "not real". Other code relying on either keeps that assumption. Correcting it changes installed data behaviour, so it needs a decision and its own review.

### Open risk R2: `appelGeminiDirect`

`external-call.ts:550` documents having no synthetic gate. It has no caller outside `egress/`. Retained risk, no live exposure found.

## 4. Memory

`WorkingReference` (`request-plan.ts:9-28`) holds intent, count, cursors, agenda day, filter, up to 20 listed patients, `selectedPatientId`, `lastRequest`. In-process map, 256 entries, 15-minute idle TTL.

**Not retained:** assistant answers, executed tools, resolved entities. The stored intent is re-guessed by regex after the turn (`orchestrator.ts:362`). The model sees no conversation history.

## 5. Outcomes

Terminal: `completed`, `partial`, `needs_input`, `needs_confirmation`, `failed`, `cancelled`. Knowledge: `ok`, `faible`, `sans-preuve`, `panne`, plus about 20 fallback reasons.

**Weak paths (by reading):**
- A `completed` turn with empty text gets "unavailable" injected but keeps `completed` (`route.ts:95`).
- Partial and mixed turns set `speechAllowed` false, so voice may stay silent (`orchestrator.ts:371`).
- The legacy compound loop can break with no `done` (`orchestrator.ts:464-466`).
- Pending parts print as `goal — reason`, echoing the question.

## 6. Observability

The durable record is `complete_jarvis_turn`, with `{version:3, events, task, reference, continuation}`, keyed by `conversationId` and `clientTurnId`. Console tags have no correlation ID. `observeCall/Result/Data` hooks exist but the route doesn't wire them. **Nothing records** which rewriter or `direct*` fired, the rewritten text, or the admission result.

## 7. Measured state before this work

| Source | Result | Caveat |
|---|---|---|
| V9 300-case campaign (`51e367b0`) | 129 PASS / 83 FAIL / 88 NOT VERIFIED | Uncommitted tree; later fixes not remeasured |
| Post-hybrid review | 60 PASS / 11 FAIL / 29 BLOCKED of 100 | 0 of 40 semantic cases passed |
| Knowledge selector | 10 retrieved `ok`, 4 cited, 6 unavailable | `language` ×3, `entity` ×2, `unsafe-text` ×1 |
| Mixed audit | 9 of 10 `sans-preuve` | Lexical-only process |
| Paraphrases | 8/10 lexical, 10/10 hybrid | Test logs `etat`; it doesn't check the passage |

Phase 2 re-baselines at this commit.
