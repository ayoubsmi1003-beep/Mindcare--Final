# Alexa — presentation and qualification runbook

Use the approved current checkout. Protect all server credentials; do not show .env or API keys during the presentation. The development PC is an i3-4150/8GB, while the doctor's target is a fourth-generation i7/16GB. No microphone is currently available to the developer.

Startup:
1. Keep the existing PostgreSQL/Docker services running. The normal schema/origin guard must pass; do not bypass it or replace the existing connection.
2. Migrations120,121,122 are applied on this PC and immutable. An authorised new installation applies existing migrations through its normal provisioner. The installed Alexa checkpoint has27PASS assertions in a rollback transaction.
3. Build with pnpm build, then run pnpm start. Desktop assembly uses node scripts/preparer-paquet.mjs, which performs its own production standalone build. Use the current package verifier on the actual artifact.
4. Sign into the local synthetic account. Check the DONNÉES FICTIVES banner before demonstrating the Gemini exception.

Provider qualification:
- OpenRouter maintenance at POST /api/alexa/qualify is authenticated and same-origin. Ordinary turns never trigger catalogue discovery or qualification. Every candidate must be an explicit :free ID with all-zero pricing and pass real probes under ZDR, collection denial and zero maximum price. Account quota is checked before each probe, leaving a five-request reserve. The actual exhaustive test tried17models with zero successes; see ALEXA_FREE_MODEL_EVALUATION.md.
- Gemini requires the user-confirmed Free tier with no billing account linked, a real qualified small text model and the existing SQL synthetic-development gate before every call. Maintenance is explicit and uses synthetic inputs through the sole egress gateway. The local helper .cache/alexa/qualify-gemini-free.mjs loads credentials quietly. Qualification must be fresh and tied to this exact protected key. A quota/rate-limit error before streaming switches immediately to one already qualified free OpenRouter model within the remaining deadline, without sleeping or qualification loops. A cold pool returns local recorded facts; a partial answer is never retried. A real-patient deployment cannot use Gemini. No purchase, billing change, paid fallback or cloud speech.
- The Google quota is project-specific; do not promise500or1000daily calls based on a model name. Record actual successful probes and any returned free-quota dimensions. Billing must remain unlinked for free text generation. Provider results are not proof that all clinical questions are understood.

Demonstration order:
1. Open a synthetic patient and the consultation. Show the separate working note above the four SOAP fields. Save changes only through the existing allowed controls; never edit a signed/locked note.
2. Select sleep7/10, stress and mood. Subjective and working-note text must stay identical. These slider values are local to the open consultation; no new persistent metrics schema was introduced.
3. Open the case summary and Actualiser. Confirm the current and latest completed consultations are distinguished, working-note/draft fields are labelled unsigned, all available five areas have sources and the status is À jour after reload. Oversized/instruction-bearing fields are omitted whole with an explicit limit.
4. Ask for the last five completed consultations, current treatment, last treatment change and a bounded comparison. Check the reported dates/counts against the record. Last consultation never means the still-open consultation. Missing data must be reported.
5. Ask a general DSM-5 question and a Maudsley medication question. Expand Sources and check title/section/version. Book requests must not read the working patient. Unknown books and unobserved DSM-5-TR/DSM-IV editions return honest absence rather than substitute DSM-5. Whole excerpts remain source material, not personalised treatment advice.
6. Ask a named/possessive patient medication question and then a general medication question. Verify correct local scope and book separation. Check a follow-up, an unknown/ambiguous name and a patient change during a pending response. All writes retain the existing confirmation cycle.
7. Say/write Alexa or tu es là, then a natural request. Keyboard demonstration is available even if the microphone cannot be tested.

Voice:
Click the microphone to start a continuous local VAD session. It never opens automatically. The final local STT transcription is the only text allowed to initiate tools; partial transcription is review-only. Stop or interruption cancels the previous request and playback, releases capture resources and prevents late installation. The complete written response remains available when speech is shortened or fails. No fallback sends raw audio to Google/OpenRouter.

Without a physical microphone, demonstrate only the graceful unavailable state and keyboard path. The real pinned-engine French/Arabic RAM smoke is documented in ALEXA_STT_BENCHMARK.md; it does not prove WER, Darija, silence hallucination on natural recordings or doctor-PC latency. Collect the separate240phrases+60boundary corpus and run the benchmark on the targetPC before marking voice qualified. Always-on wake-word detection is not enabled.

Failure/recovery:
A stale scope/revision discards late output. A broken stream after a displayed fact remains partial and cannot be saved as a complete answer. Unknown/ambiguous identity never reuses a former patient. A failed provider keeps local record reads accessible. RAG absence/weakness/failure cannot be filled with an invented book claim. STT/TTS failure keeps typing available. Never automatically retry a business write with unknown outcome.

Packaging:
The final backend includes exactly six runtime scripts and pinned local voice resources; secrets, tests, source maps and development tools are excluded. The artifact checker must run after a fresh build. Optional electron-builder compression=store is an official packaging setting that avoids hours of compression on thisPC while increasing installer size. Installer generation is not installation, signing, live Electron acceptance or clinician approval. Existing PostgreSQL and unrelated app sessions must be preserved.

Release status and exact current proof counts are in ALEXA_EVALUATION.md and ALEXA_IMPLEMENTATION_STATUS.md. Do not present the synthetic demo as a qualified real-patient clinical release, perfect speech recognition or universal question understanding.
