# Alexa — real free-provider evaluation

Evaluation date: 2 October 2026. This report records actual provider calls with synthetic inputs. A catalogue entry or a successful HTTP response is not sufficient qualification. No clinical patient data, notes, identifiers, audio or credentials appear in this report.

## OpenRouter: FAIL qualification

The user authorised every explicit free model family on 2 October, superseding the original Qwen-only choice. The transport still requires a literal :free model ID, all-zero prices, collection denial, zero-data-retention routing, required parameter support and zero maximum input/output price. Dynamic routers and paid fallback remain excluded.

The real catalogue and gateway test ended at 2026-10-02T21:45:05.469Z. Eighteen entries were observed: seventeen explicit free models were admitted and attempted; none qualified. The eighteenth entry was a dynamic router and was not tested. Account quota was 47 remaining, 3 used, 50 daily limit before and after the test. No account error was reported.

| Model | Result | Observed failure phase/code |
|---|---|---|
| apodex/apodex-1.1-mini:free | FAIL | Language labels / MALFORMED_RESPONSE |
| inclusionai/ling-3.0-flash-sante:free | FAIL | JSON / MALFORMED_RESPONSE |
| qwen/qwen3.8-27b:free | FAIL | Transport / MODEL_RATE_LIMIT |
| thinkingmachines/inkling-small:free | FAIL | Transport / POLICY_REJECTION |
| thinkingmachines/inkling:free | FAIL | Transport / POLICY_REJECTION |
| dots-studio/dots-3-note-preview:free | FAIL | Transport / MODEL_UNAVAILABLE |
| liquid/lfm-2.5-2.6b:free | FAIL | Transport / MODEL_UNAVAILABLE |
| nvidia/nemotron-3.5-lightning:free | FAIL | Transport / MODEL_UNAVAILABLE |
| poolside/laguna-s-2.1:free | FAIL | Transport / MODEL_UNAVAILABLE |
| poolside/laguna-xs-2.1:free | FAIL | Transport / MODEL_UNAVAILABLE |
| cohere/north-mini-code:free | FAIL | Transport / MODEL_UNAVAILABLE |
| nvidia/nemotron-3.5-content-safety:free | FAIL | Transport / MODEL_UNAVAILABLE |
| nvidia/nemotron-3-ultra-550b-a55b:free | FAIL | Transport / MODEL_UNAVAILABLE |
| nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free | FAIL | Transport / MODEL_UNAVAILABLE |
| google/gemma-4-26b-a4b-it:free | FAIL | Transport / MODEL_UNAVAILABLE |
| google/gemma-4-31b-it:free | FAIL | Transport / MODEL_UNAVAILABLE |
| nvidia/nemotron-3-super-120b-a12b:free | FAIL | Transport / MODEL_UNAVAILABLE |
| openrouter/free | NOT RUN | Dynamic router; no explicit qualified model identity |

The protocol first checks real streaming, JSON and French/Darija/mixed speech-act labels. Only a successful first phase proceeds to the issued minimal synthetic clinical projection and source/value validation. No candidate in this run passed the first phase, so the clinical probe did not run. These results do not prove seventeen clinical conversations were completed. Provider privacy requirements were not relaxed to obtain a response.

Closed local evidence: .cache/alexa/all-free-model-result.json and .cache/alexa/all-free-model-live.txt. The synthetic maintenance helper is .cache/alexa/qualify-all-free.mjs. Ordinary clinical turns never run catalogue qualification. Quota is reread before each real probe, with a five-request reserve. Unit transport fault injection and an independent actual-function review verified this reserve after a successful language probe; these are code evidence, separate from the real provider run.

## Gemini: synthetic development exception

The user subsequently requested the protected Gemini key, confirmed that its project has no billing account linked and is on the Free tier, and explicitly authorised the test-patient demonstration. This permits qualification of small text models for the synthetic development instance. It does not enable cloud speech or real-patient deployment.

Google's free-tier content policy allows use of inputs and outputs to improve products and human review. It does not meet the retained real-patient zero-retention/no-collection requirement. Gemini must therefore verify the existing PostgreSQL synthetic-development gate before transport. No names, raw notes or audio are added to its payload; the existing privacy transform and response/source validator remain in force.

Current account quota is project-specific. Model listing or a successful response cannot prove a large remaining daily quota. Qualification and runtime failures must retain actual quota/rate-limit evidence and must never activate billing, purchase credits or use a paid fallback.

Gemini real qualification: **PASS for two models** at 2026-10-02T22:24:51.899Z, using the actual protected key and the SQL-confirmed synthetic development instance. `gemini-3.5-flash-lite` passed streaming, multilingual structured output and the source-bound clinical probe (clinical probe latency 2,424 ms); `gemini-3.1-flash-lite` passed the same checks (4,396 ms). `gemini-2.5-flash-lite` returned `MODEL_UNAVAILABLE`. No real patient, raw note or audio was transmitted. Actual remaining account quota is unknown; no billing was enabled. Evidence: `.cache/alexa/gemini-free-model-result.json`.

On a runtime quota or rate-limit error before any sentence is published, Alexa switches immediately to an already qualified free OpenRouter model, allowing one OpenRouter attempt within the original deadline. It does not sleep, rediscover models or requalify the pool during the turn. The current privacy-compatible OpenRouter pool has no qualified model, so that fallback currently returns local recorded facts. There is no paid fallback and no retry of a partially displayed stream.

Primary provider documentation checked on 2 October 2026: [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection), [OpenRouter limits](https://openrouter.ai/docs/api-reference/limits), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini account limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Gemini data policy](https://ai.google.dev/gemini-api/terms), [Gemini billing](https://ai.google.dev/gemini-api/docs/billing).
