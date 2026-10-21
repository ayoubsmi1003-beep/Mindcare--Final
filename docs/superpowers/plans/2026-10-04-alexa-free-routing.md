# Alexa free routing implementation plan

> Execute inline with the existing gateway. The user requested implementation on 2026-10-04 and confirmed that both Gemini and Groq use Free plans with paid billing disabled. Updated 2026-10-05.

**Goal:** Serve Alexa through free OpenRouter models and confirmed Gemini/Groq free quota, with bounded switching and real browser evidence.

**Architecture:** Reuse the existing qualified free pool, health tracking, inference deadline and unique egress gateway. Preserve local voice, privacy validation, SQL authorization and confirmation gates.

**Spec:** `docs/superpowers/specs/2026-10-04-alexa-global-rearchitecture-design.md`; this records the provider slice. The user explicitly authorized continuation of the broader goal. The RAG continuation is tracked in `2026-10-05-alexa-rag-browser.md`.

**Tech stack:** Existing TypeScript, Next.js, PostgreSQL, Vitest and browser connector; no new dependency.

## Constraints

- No paid model, paid fallback, automatic billing activation, raw patient identity or notes sent externally.
- OpenRouter explicit `:free`, zero catalogue pricing, `max_price: {prompt: 0, completion: 0}`, existing no-collection/ZDR policy.
- Gemini/Groq: key-bound, expiring free-tier confirmation and successful public synthetic probe; fresh synthetic deployment check before every call. Gemini Flash Lite and Groq GPT OSS 20B are the small eligible models; public questions prefer Groq, then Gemini.
- Two generation attempts maximum, one shared deadline, first attempt capped at four seconds when a backup exists. Never replay a published stream.
- No migration, registry fusion, clinical write, `.env`, `fr.ts` or unrelated UI change.

## Review focus

- Paid environment override and catalogue price drift must fail closed.
- Exhausted account quota can use an eligible different provider without retrying models on the same account.
- Auth, request-policy failure and cancellation stop switching.
- Gemini/Groq cannot send a byte on an unverified deployment or expired confirmation.
- A partial stream cannot be replayed.

## Execution

- [x] Write and run failing policy, transport and fallback tests.
- [x] Restore qualified free pool selection, zero-price transport and bounded deadlines.
- [x] Add Gemini/Groq free text adapters inside the unique gateway and explicit qualification.
- [x] Run focused tests, typecheck and build for the provider change. Language/sampling follow-up verification is recorded separately below.
- [x] Start the existing local database with the normal guard; qualify real free providers.
- [x] Authenticate and inspect actual Alexa answers in the browser; preserve screenshots and timings without patient data.
- [x] Record PASS / FAIL / NOT RUN and remaining blockers in `artifacts/alexa-free-routing-2026-10-04/RESULTS.md`.

## Verified progress and remaining acceptance

- PASS: 16 focused files, 286 tests, no failure/skip; TypeScript, targeted lint and production build. Independent review findings were reproduced and fixed: policy refusals must stop, SQL preflight shares the deadline, optional egress audit cannot stall switching, and qualification cannot report a cold pool as PASS.
- PASS: explicit response-language follow-up, 145 tests across public routing, gateway and privacy, plus TypeScript and targeted lint. The first English live answer was incorrectly French; the repeated answer with the explicit language instruction was English.
- PASS: actual OpenRouter zero-price qualification, Gemini Flash Lite qualification and Groq GPT OSS 20B qualification. These are synthetic provider checks, not clinical, browser or microphone acceptance.
- FAIL observed, repeated sample corrected: one real Arabic colour-list answer substituted light indigo for violet. Its unchanged output is preserved in `artifacts/alexa-free-routing-2026-10-04/providers-language-v2-before-temperature.json`. With Groq sampling pinned to zero, the new Arabic answer includes violet; French, Arabic and English samples were manually inspected and answered correctly in 2246/1227/1577 ms. This setting does not guarantee factual accuracy.
- PASS: all 31 routing/transport tests repeated after the sampling change. PARTIAL: the real Darija question was understood in 2805 ms, but its answer remains mostly standard Arabic. Latest raw public answers and timings: `artifacts/alexa-free-routing-2026-10-04/providers.json`.
- PASS: latest production build after language/sampling changes, exit 0, all 25 static pages generated; latest targeted gateway lint passes. Build skips type/lint internally; those were checked separately.
- PARTIAL: authenticated browser question/answer inspection completed. French, Arabic and English public answers were observed; Darija remained mostly standard Arabic. Two real turns timed out after Groq-to-Gemini switching. Login/password are resolved and outside the ongoing task. Subsequent routing/RAG failures and fixes remain recorded in the browser artifact batch.
- NOT RUN: real microphone-to-spoken-answer acceptance. The broader semantic assistant, longitudinal summaries and hybrid RAG requirements remain active under the global specification.

## Explicit maintenance

Free-tier proofs expire after 24 hours and are tied to the server key. When stale, the normal gateway refuses these providers; it does not spend calls on hidden per-question qualification. The historical maintenance command below is not used during the current browser-only acceptance work. Any new model call must originate from the visible browser, as the user requested.

```powershell
node scripts/eval-alexa-free-routing.mjs --qualify-only --groq-free-tier-confirmed --gemini-free-tier-confirmed
```

This makes real public synthetic qualification calls and writes local proof metadata without printing keys. Paid overrides remain ignored; no paid provider can be selected.
