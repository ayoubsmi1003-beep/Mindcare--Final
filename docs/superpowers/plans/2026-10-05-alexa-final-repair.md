# Alexa final repair — approved implementation

Authority: the user's approved plan in this chat, 5 October 2026.

TASK / SCOPE / ENTRYPOINT / STOP: repair the existing Alexa production path; local semantic understanding, audited patient reads, application tools, governed two-book retrieval, evidence and browser acceptance; `/api/alexa/turn`; all gates verified or remaining dependencies explicitly reported. No opportunistic refactor.

## Binding decisions

- Patient understanding and clinical context stay local. Cloud receives only admitted public questions or immutable approved book passages.
- Qualify Qwen3-1.7B GGUF with pinned llama.cpp. One semantic attempt, structured output, no private cloud fallback.
- Preserve PostgreSQL, DbPort, RLS, audit and propose/confirm/execute/verify/log.
- Keep the patient schema. Missing-phone queries can return zero; patient email is unsupported.
- Calibrate real local embeddings and cross-encoder before hybrid activation; lexical remains explicitly labelled until qualification succeeds.
- Acceptance: isolated real PostgreSQL/application, 160 distinct browser cases, no injected positive answers. Acoustic qualification is separate.
- Preserve existing changes, applied migrations, corpus/OCR, approvals, secrets, fr.ts and archives.

## Tasks

1. Contracts and architecture reconciliation.
2. Pinned local semantic runtime and server routing.
3. Filtered patient search/count, exact identity and bounded local references.
4. Application/general/action routing using existing capabilities.
5. Two-book restriction, hybrid/cross-encoder calibration.
6. Source-bound composition and cloud privacy enforcement.
7. Browser matrix, regression and truthful gate report.

## Current evidence

Planning baseline: 251 unit tests / 6 files PASS. This does not qualify PostgreSQL, providers, browser or audio.
