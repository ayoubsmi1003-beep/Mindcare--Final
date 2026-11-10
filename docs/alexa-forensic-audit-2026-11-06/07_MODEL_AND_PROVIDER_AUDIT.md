# Model and provider audit

**Status: PARTIAL.** Model IDs below are source configuration, not proof of downloaded assets, active feature flags, installed software, production quality, latency or cost. No provider call or patient-data export was made. Full call-site and legacy-path inventory remains open.

| Purpose | Code-defined model / provider | Invocation or status | Boundaries and unknowns |
|---|---|---|---|
| Local text, native tool planning, clinical narrative and knowledge selection | `MiniCPM-V-4_7-1B-Q4_K_M.gguf`; local llama.cpp `b11429` | `model-policy.ts`; `local-model.ts`; callers include `agent-loop.ts`, `clinical-narrative.ts`, `knowledge-synthesis.ts`, `model-gateway.ts` | One local slot, `--parallel 1`, CPU `--gpu-layers 0`, context 4,096. Integrity hashes checked. Model quality, hardware and actual latency NOT VERIFIED. |
| Speech recognition | `faster-whisper-small-int8` local | `src/server/voice/modeles.ts`, `runtime.ts`, `src/app/api/jarvis/jarvis-voice-in/route.ts` | Assets pinned and validated. French/Arabic/Darija recognition and physical microphone NOT VERIFIED. |
| Speech synthesis | Kokoro 82M v1.0, voice `ff_siwis`, local | `voice/modeles.ts`, `runtime.ts`, `jarvis-voice-out/route.ts` | Route explicitly rejects any Arabic segment. Actual voice quality and physical speaker NOT VERIFIED. |
| Wake word | Vosk French small | `voice/modeles.ts`, `voice/wake-runtime.ts` | Actual activation, accuracy, false wakes and hardware NOT VERIFIED. |
| Query/document embeddings | multilingual E5 small 384 and base 768, local; separate BGE-M3 path | `knowledge/embeddings-secondaires.ts`, `vecteur-secondaire-production.ts`, `vecteur-production.ts` | See `06_RAG_FORENSIC_AUDIT.md` for versions and activation; installed assets/index coverage NOT VERIFIED. |
| Reranking | Local lexical/vector heuristic by default; opt-in mMARCO cross-encoder | `knowledge/rerank.ts`, `rerank-secondaire-production.ts` | Optional invocation can be skipped or fail back. Quality must be measured on the actual approved evaluation set. |
| Historic cloud/qualification constants | `gemini-3.5-flash`, `qwen/qwen3.8-27b:free`, `gemini-3.5-flash-lite`, `openai/gpt-oss-20b`, `gemini-3.8-live` | `model-policy.ts`, qualification code in `external-call.ts` | Constants are not proof of usable provider models or deployment use. Free Gemini/Groq qualification includes synthetic-deployment checks. |
| Retired cloud voice route | Historical Gemini Live code remains | `src/app/api/jarvis/jarvis-live/route.ts`; `external-call.ts`, `voixCloudAutorisee`, returns `false` | Route GET says retired and POST checks the false gate. No claim about other versions or deployments. |

`src/server/alexa/local-model-protocol.ts`, `buildLocalRequest`, sends `stream: false`. `model-gateway.ts`, `inferStreaming`, waits for a complete local response and then feeds it into a sentence validator. Consequently, this particular path emits validated sentences after buffering, not true token-by-token generation. Other event streaming paths must be traced independently. These facts are not timing measurements.

On the client, `src/services/alexa-turn.ts`, `envoyerTourAlexa`, parses server-sent sentence events into `batchAnswer`, merges continuation batches, and calls the ordinary `onSentence` callback with the combined answer after the loop. Stage and progress callbacks can occur earlier, and an error can expose a partial first batch. Therefore the presence of SSE alone does not prove progressively displayed/spoken sentences on this client path. Trace the calling UI and measure before making an end-to-end latency claim.

## Claude Opus 5.5

Anthropic's [official model overview](https://platform.claude.com/docs/en/models/opus-5-5/overview), consulted 2026-11-06, identifies the API model as `claude-opus-5-5` and describes a 1 million token context and 128,000 token maximum output on its standard API. Availability, limits, pricing and policies vary by platform and account and must be rechecked at implementation time. This is documentation evidence, not evidence that this cabinet has API access or permission to transmit patient data. Do not infer comparative clinical accuracy or application latency from the model name.

Engineering use for the requested handoff can be confined to source code and synthetic examples. Runtime use for patient information remains a separate, unapproved security and data-governance decision. The current local-first model gateway and deterministic tool/SQL authority must not be weakened. If an external provider is ever approved, introduce it behind a provider-neutral task interface with explicit payload classification, safe refusal, verified data handling, source-bound output validation, bounded time/cost and an independently tested local or deterministic fallback. A fallback cannot turn missing patient facts into an answer.

## Experiments before model selection

Use the same synthetic patient fixtures and approved non-identifying knowledge questions across candidate models. Separately measure intent decomposition, tool arguments, evidence recall, faithfulness, language preservation, unsupported-action claims, time to first **validated** response, total latency, token usage and privacy admission. Stratify direct questions, ambiguous follow-ups and mixed-domain tasks; record provider, pinned model ID, model build, prompt and corpus version. Any external candidate must receive only a separately approved payload. No comparative benchmark was run here.
