# Alexa V8 — Test Matrix (2026-11-02)

Environment unless stated otherwise: Windows 10 Pro 19045, Intel i3-4150
(2 cores / 4 threads), 8 GB RAM, Node 24.20, pnpm 11.25, Next.js dev server
`http://localhost:3000`, QA database `mc-p3` (`127.0.0.1:55441/mindcare`,
1,558 patients, migration head 213).

Legend: **PASS** = executed and observed; **FAIL** = executed and contrary;
**NOT RUN** = not executed (reason given); **IN PROGRESS** = running.

## A. Login and permissions

| Test | Result | Evidence |
|---|---|---|
| Doctor login (`drlarbi`, QA test password) | PASS | `POST /api/auth/sign-in` 200; session cookie set; `/patients` loaded |
| Receptionist login (`admin`, QA test password) | PASS | same route, separate account `assistante.dev` (session used for role tests in prior browser pass) |
| Invalid credentials rejected | NOT RUN in this pass | no bypass introduced; route returns one generic 401 by design |
| Logout / re-login | NOT RUN in this pass | — |
| Doctor-only clinical route blocked for receptionist | NOT RUN in this pass | server-side RLS/doors unchanged; requires a dedicated two-role sweep |

## B. Database identity and integrity

| Test | Result | Evidence |
|---|---|---|
| QA database identified | PASS | `mc-p3` container, `mindcare`, PostgreSQL 16 |
| Patient count | PASS | `SELECT count(*) FROM app.patients` = **1,558** |
| Legacy linkage | PASS | 1,558 `legacy_id_map` patient rows; all `is_synthetic = true` |
| Migration head | PASS | DB head `213_medication_phase2_gates` |
| Migration file count | PASS | 191 files on disk, numbered 1…213 with intentional gaps |
| Migration list exact match | **BLOCKED (drift)** | DB has 193 applied; two DB-only rows `186_alexa_treatment_and_draft_actions`, `187_alexa_prescription_posology_update` are not on disk; `snapshot-production.mjs` refuses by design |
| Strict snapshot promotion | **BLOCKED** | `scripts/snapshot-production.mjs` refuses on the drift; manual `pg_dump` + isolated restore used instead |
| Profiles / accounts | PASS | 5 profiles; `drlarbi` and `admin` active |
| Verified backup + isolated restore | **PASS** | `pg_dump` 355,440,969 bytes, SHA-256 `A5050C86…E9190`; isolated restore: 1,558 patients, 5 profiles, 9 sources, 48,760 chunks, 193 migrations; gates G1–G5 PASS; verification DB removed |
| QA artifact portable folder | PASS (assembled) | `C:\MindCare\release-2026-11-02\MindCare-QA-0.1.4-rc1.20261028\`; app + `resources/snapshot/{base.dump,manifest.json,gates.sql}`; SHA-256 sums verified |
| Original `%ProgramData%\MindCare` untouched | PASS | ACL-protected; no read/write attempted |

## C. Alexa turn / local model

| Test | Result | Evidence |
|---|---|---|
| Simple turn `Bonjour` | PASS | 6.2 s; answer “Bonjour, je vous écoute…” |
| Clinical turn `Combien de patients avons-nous ?` | PASS | 84.1 s; answer “Le cabinet compte 1 558 patients actifs.” |
| Before fix: same kind of turn | FAIL (reproduced) | 302,298 ms; ended `Indisponible` / `Échec` |
| Thread-budget regression test | PASS | 7 cases; 1→1, 2→1, 4→2, 8→4 |
| Model integrity pin | PASS | SHA-256 `588C6C94…E63D` matches `LOCAL_MODEL_PIN` |
| Q4_K_M model present | PASS | `MiniCPM-V-4_7-1B-Q4_K_M.gguf`, 672,003,680 bytes |

## D. Kokoro TTS

| Test | Result | Evidence |
|---|---|---|
| Real Kokoro route | PASS | 200; `X-Alexa-Voice-Provider: local`; model `kokoro-82m-v1.0-ff_siwis` |
| WAV produced | PASS | 136,844 bytes; 24 kHz; 2.85 s |
| WAV level | PASS | peak 0.8466; RMS 0.1653 (non-silent) |
| Auto-read fired for completed answer | PASS | `POST /api/jarvis/jarvis-voice-out` after the turn |
| Auto-read fired for clinical answer | PASS | `POST /api/jarvis/jarvis-voice-out` after the 84 s turn |
| Clarification / confirmation spoken | PASS (unit) | `alexa-auto-read.test.ts`; `needs_input` and `needs_confirmation` accepted |
| Audible playback on this PC | PASS (operator) | operator reported hearing Kokoro; informal, not calibrated |
| Audible playback on doctor’s speakers | NOT RUN | no target hardware |
| Cold TTS latency | PASS (measured) | 52–72 s first synthesis on this i3; worker then resident |

## E. STT / wake word

| Test | Result | Evidence |
|---|---|---|
| faster-whisper route | PASS | 200; transcript “Quelle est le prochain patient ?”; model `faster-whisper-small-int8` |
| STT cold latency | PASS (measured) | 50.1 s first call on this i3 |
| Vosk wake route | PASS | `start` ready; `alexa.wav` → `detected: true`; `stop` 200 |
| Wake word configured | PASS (code + proof) | **« Alexa »**, variants « Alexia » / « eh-lexa » |
| Real microphone capture | NOT RUN | no capture device on this PC |
| Quiet / distant / noisy speech | NOT RUN | no microphone |
| Real browser `getUserMedia` path | NOT RUN | no capture device; route and worker proven separately |
| Arabic / Darija command recognition | NOT RUN | not claimed by the current French-only qualification |

## F. RAG

| Test | Result | Evidence |
|---|---|---|
| Knowledge sources active | PASS | 9 sources; 48,760 chunks; 40,901 active |
| Lexical retrieval path | PASS (named fallback) | BGE-M3 absent; `vecteurRequeteProduction → null` |
| BGE-M3 semantic retrieval | NOT RUN | model absent from this machine |
| Golden-book recall / citations | NOT RUN in this pass | requires the golden eval against the QA DB |
| Missing evidence handled honestly | PASS (observed) | answers “Aucune preuve suffisante dans les sources approuvées.” |
| Patient-context leakage | NOT RUN in this pass | requires a dedicated multi-patient sweep |

## G. UI / routes

| Test | Result | Evidence |
|---|---|---|
| Login screen loads | PASS | `/connexion` rendered |
| Patients screen loads | PASS | `/patients` rendered; 1,558 patient scope |
| Alexa panel opens | PASS | panel, mute control, input, send |
| Text turn renders answer | PASS | “Bonjour…” and “1 558 patients actifs” |
| Full route sweep (agenda, consultation, finances, documents, statistics, settings) | NOT RUN in this pass | operator reports the browser pass works; no exhaustive automated sweep performed here |
| Direct restricted URL / server-side API denial | NOT RUN in this pass | — |

## H. Packaging and portability

| Test | Result | Evidence |
|---|---|---|
| `pnpm typecheck` | PASS | no output (success) |
| Voice/routing unit suite | PASS | 93 tests |
| `pnpm build:desktop` | **PASS** | `dist/MindCare Setup 0.1.4-rc1.20261028.exe`, 1,682,651,503 bytes; 16,094 packaged files |
| `verifier-paquet` on the artifact | **PASS** | “paquet conforme à la liste blanche du plan (§I)” |
| Clean release manifest | **PASS** | `release/MindCare-Clinic-Release-0.1.4-rc1.20261028/`, 9 files, `creer-release-cabinet.mjs --verify` PASS |
| Launch from a copied folder outside the repo | **PASS** | `C:\qa-app` (top-level, isolated `ProgramData`): window “MindCare OS”, 934×892, “Préparation du cabinet sur le PC médecin…”, no terminal/old server/blank |
| Normal desktop icon / installer | NOT RUN | requires elevation |
| Full host provisioning + login from the packaged shell | NOT RUN | requires elevation/clean profile |
| Second PC | NOT RUN | no second PC |

## I. LAN / two-PC

| Test | Result | Evidence |
|---|---|---|
| Host/client architecture identified | PASS | doctor PC hosts PG/backend/HTTPS; receptionist is a client |
| UDP discovery + HTTPS proxy code present | PASS (source) | `decouverte-cabinet.ts`, `proxy-cabinet.ts`, ports 43117/43118/54333 |
| Two real PCs, pairing, disconnect/reconnect, reboot | NOT RUN | no second PC |

## J. Failure recovery

| Test | Result | Evidence |
|---|---|---|
| Local model failure before fix | FAIL (reproduced) | 302 s turn → `Indisponible` |
| Local model after thread fix | PASS | 6.2 s / 84.1 s turns complete |
| TTS route failure path | PASS (code) | route returns typed `synthese-indisponible`; no silent fallback |
| STT route failure path | PASS (code) | route returns typed `transcription-indisponible`; no cloud fallback |
| PostgreSQL down / port conflict / model missing | NOT RUN | not injected in this pass |
