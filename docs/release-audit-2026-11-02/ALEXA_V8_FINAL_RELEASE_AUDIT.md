# Alexa V8 Final — Release Audit (2026-11-02)

> Status: **AUDIT COMPLETE for the executable evidence; on-site gates remain
> NOT RUN.** Every PASS below was executed and observed. Nothing is inferred
> from source alone.

## 1. Baseline discovered (read-only)

| Item | Verified value |
|---|---|
| Repository | `C:\MindCare\alexa-v8-final` |
| Branch / HEAD | `v8-alexa-final` / `6e1eda2` (tag `alexa-v8-current-20261102`) |
| Version | `0.1.4-rc1.20261028` |
| Architecture | Next.js 15 + Electron 33 + embedded PostgreSQL 16 + local Python voice worker |
| QA database | Docker container `mc-p3`, `127.0.0.1:55441/mindcare`, PostgreSQL 16 |
| Migration files on disk | **191** files, numbered 1…213 (intentional gaps at 31, 35, 100–107, 147–157, 202–204) |
| Applied migrations | **193** rows; head `213_medication_phase2_gates`; two DB-only rows (`186_alexa_treatment_and_draft_actions`, `187_alexa_prescription_posology_update`) are not on disk |
| Patients | **1,558** (all 1,558 are legacy Syglab identities linked in `app.legacy_id_map`; real PII, not generated fixtures) |
| Profiles | 5 |
| Test accounts | `drlarbi` (active, `owner.dev`), `admin` (active, `assistante.dev`) |
| Knowledge base | 9 active sources, 48,760 chunks, 40,901 active |
| RAG embeddings | BGE-M3 absent; production retrieval is the named **lexical-only** fallback |
| Voice assets | Kokoro 82M fp16 + `ff_siwis`, faster-whisper small int8, Vosk FR small, embedded CPython 3.12 |
| Installed app on this PC | old `0.1.3-rc1.20261013`; `C:\Program Files\MindCare OS` is empty; scheduled task last result = 1 |
| Microphone | none on this PC (render endpoints only) |
| Second PC / VM | none available |

## 2. Defects found and fixed

### D1 — Alexa turns took 302 s and failed (release-blocking)

**Root cause.** `localModelThreadCountFor(available)` forced **1 thread** on a
4-thread CPU. The agent sends a large system/tool prompt before the first token.
Measured directly with the pinned Q4_K_M model and a 1,089-token prompt:

| Threads | Prompt processing | Generation |
|---|---|---|
| 1 | 8.2 tok/s (133 s) | 11.4 tok/s |
| 2 | **54.0 tok/s (20 s)** | 10.8 tok/s |
| 4 | 63.1 tok/s (17 s) | 7.7 tok/s |

The first live turn (`Bonjour Alexa, peux-tu me dire qui tu es ?`) took
**302,298 ms** and ended in `Indisponible` / `Échec`. After the fix, the same
kind of turn completed in **6.2 s** with a real answer.

**Minimal correction.** `src/server/alexa/local-model.ts`:
`available <= 2 ? 1 : max(2, min(4, floor(available / 2)))`.
No model change, no Q4 change (the pinned file is already
`MiniCPM-V-4_7-1B-Q4_K_M.gguf`, SHA-256
`588C6C94C82F756B86DBA35C42ED9BA9EC187D65824EB52F039C347DF563E63D`).

**Regression tests.** `tests/unit/alexa-local-model-threads.test.ts` (7 cases).

### D2 — clarifications and confirmation prompts were silent

**Root cause.** `fautLireAuto` only accepted `alexaStatus === "completed"`.
`needs_input` and `needs_confirmation` are complete answer bodies but were
skipped, contradicting the 2026-10-24 voice spec (“chaque réponse texte se lit”).

**Minimal correction.** `src/services/lecture-auto.ts` now accepts
`completed`, `needs_input`, and `needs_confirmation`; `partial`, `failed`, and
`cancelled` remain silent.

**Regression tests.** `tests/unit/alexa-auto-read.test.ts` (17 cases).

### D3 — migration drift between disk and QA database (governance, not a code defect)

The disk has **191** migration files (numbers 1…213 with intentional gaps). The
live QA database `mc-p3` has **193** applied rows: the same 191 plus
`186_alexa_treatment_and_draft_actions` and
`187_alexa_prescription_posology_update`, which are not on disk.

`scripts/snapshot-production.mjs` compares the two lists exactly and therefore
**refuses to promote** `resources/snapshot/base.dump`. This is the correct
fail-closed behaviour, not a backup failure. The two missing files are not
recreated or edited (applied migrations are immutable). The QA backup was taken
manually with `pg_dump` and restored into a disposable database; the drift is
recorded for the human decision. The application’s startup check tolerated the
two extra rows in this audit (`verifier-base` started against `mc-p3`).

## 3. Voice evidence actually executed

### 3.1 Kokoro TTS route (real worker)

Authenticated `POST /api/jarvis/jarvis-voice-out` against the running app with
`texte = "Bonjour. La voix locale Kokoro est prête."`.

```
login 200
tts 200 elapsed_ms 72146 bytes 136844
provider local
model kokoro-82m-v1.0-ff_siwis
sample_rate 24000
content_type audio/wav
duration_s 2.85
peak 0.8466
rms 0.1653
```

WAV saved outside the repository:
`C:\Users\ABC Informatique\AppData\Local\Temp\opencode\tts-proof.wav`.

The operator confirmed hearing Kokoro playback in the running app (informal
audible confirmation, not a calibrated device measurement).

### 3.2 faster-whisper STT route (real worker)

Authenticated `POST /api/jarvis/jarvis-voice-in` with the synthetic 16 kHz
fixture `tests/fixtures/voix/commande.wav`.

```
stt 200 elapsed_ms 50086
texte "Quelle est le prochain patient ?"
model faster-whisper-small-int8
```

### 3.3 Vosk wake route (real worker)

Authenticated `POST /api/jarvis/jarvis-wake` with `action=start`, then 500 ms PCM
chunks from `tests/fixtures/voix/alexa.wav`.

```
wake start 200 {"ready":true,"engine":"vosk-fr-FR-small"}
wake detected true
wake stop 200
```

### 3.4 End-to-end text turn + auto-read

| Question | Turn duration | Answer | Auto-read |
|---|---|---|---|
| `Bonjour` | **6.2 s** | “Bonjour, je vous écoute. Vous pouvez me demander les consultations, le traitement ou le résumé d’un dossier.” | `POST /api/jarvis/jarvis-voice-out` fired; 200 in 52 s cold |
| `Combien de patients avons-nous ?` | **84.1 s** | “Le cabinet compte 1 558 patients actifs.” | `POST /api/jarvis/jarvis-voice-out` fired |

The 84 s clinical turn includes the agent tool call and the data read. The
target doctor PC is an i7/16 GB, faster than this i3/8 GB audit machine; no
target-PC latency claim is made here.

## 4. Build and artifacts

| Item | Verified value |
|---|---|
| Build command | `pnpm build:desktop` |
| Installer | `dist/MindCare Setup 0.1.4-rc1.20261028.exe`, **1,682,651,503 bytes** |
| Installer SHA-256 | `DA7BB8DE74CEA7A4933B69E3F86417440AFFF59AFF4EBC84A486EFA1D69AA222` |
| Packaged files | 16,094 files; 26 entries in `app.asar` |
| Package verifier | **PASS** — “paquet conforme à la liste blanche du plan (§I)” |
| Clean release | `release/MindCare-Clinic-Release-0.1.4-rc1.20261028/`, 9 files, manifest verified |
| Clean release manifest | version `0.1.4-rc1.20261028`, sourceHead `6e1eda2…`, migrations 191 / head `213_medication_phase2_gates` |
| QA dump | `355,440,969` bytes, SHA-256 `A5050C86F5BC63A5BBD43655E73C0756CF593CD4C89D8F03AB896BC7132E9190` |
| QA restore verification | isolated DB: **1,558 patients, 5 profiles, 9 sources, 48,760 chunks, 193 migrations; gates G1–G5 PASS**; verification DB removed |
| QA portable artifact | `C:\MindCare\release-2026-11-02\MindCare-QA-0.1.4-rc1.20261028\` (app + snapshot + dump + manifest) |

### Packaged executable first screen

Launched `MindCare OS.exe` from `C:\qa-app` (top-level path, isolated
`ProgramData`) after the build. Window **“MindCare OS”**, 934 × 892, on screen.
Content: **“Préparation du cabinet sur le PC médecin…”**, **“Utiliser ce PC
comme PC médecin”**, the machine name, the unicast fallback, and
**“Rechercher à nouveau”**. No terminal, no old server screen, no blank window.

The full host provisioning and login from the packaged shell were not executed:
they require elevation and a clean Windows profile.

## 5. Tests executed

| Check | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `tests/unit/alexa-local-model-threads.test.ts` | PASS (7) |
| `tests/unit/alexa-auto-read.test.ts` | PASS (17) |
| 8 voice/routing unit files (93 tests total) | PASS |
| Prior `pnpm voix:preuve` (2026-10-27) | PASS (real STT/TTS/wake, synthetic WAVs, DB untouched) |
| Targeted ESLint on the four changed files | PASS (no output) |

## 6. Not run / blocked

| Gate | Status | Reason |
|---|---|---|
| Real microphone wake word, distance, noise, quiet speech | NOT RUN | no capture device on this PC |
| Real audible playback on the doctor’s speakers | NOT RUN | no target speakers; operator heard Kokoro on this PC |
| Two-PC LAN pairing, disconnect/reconnect, reboot | NOT RUN | no second PC/VM |
| Installer launch from the normal desktop icon | NOT RUN | requires elevation; the unpacked executable first screen is PASS |
| Full host provisioning + login from the packaged shell | NOT RUN | requires elevation/clean Windows profile |
| Clean empty-database first run | NOT RUN | requires elevation/clean Windows profile |
| QA first-run restore from the portable folder | NOT RUN | requires elevation/clean Windows profile; the dump itself is restore-verified |
| BGE-M3 semantic RAG | NOT RUN (named lexical fallback) | model absent; lexical-only path is active |
| Second-PC portability | NOT RUN | no second PC |

## 7. Code changes

| File | Change |
|---|---|
| `src/server/alexa/local-model.ts` | thread budget 1 → 2 on 4-thread CPUs; 4 on 8-thread |
| `src/services/lecture-auto.ts` | speak `needs_input` and `needs_confirmation` |
| `tests/unit/alexa-local-model-threads.test.ts` | updated measured expectations |
| `tests/unit/alexa-auto-read.test.ts` | added clarification/confirmation cases |

No database migration, no model file, no packaging-config change.

## 8. Verdict

**CONDITIONALLY READY.** The voice path is genuinely working on this machine:
Kokoro synthesizes non-silent French audio, faster-whisper transcribes a
synthetic command correctly, Vosk detects “Alexa”, the agent turn now completes
in seconds, and auto-read calls Kokoro for completed answers. The installer
builds and passes the package verifier.

The remaining release-blocking evidence is **on-site hardware**: the real
microphone, the doctor’s speakers, the two real PCs, the reboot, and the clean
Windows first run. Those are explicitly NOT RUN, not passed. The 1,558 QA rows
are real PII; the QA artifact is confidential and must not be installed on a
production PC. The clean package contains no patients.
