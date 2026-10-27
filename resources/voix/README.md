# Local native voice bundle

Prepare the pinned model assets and Python packages with `pnpm voix:preparer`
(`node scripts/preparer-voix-native.mjs --repair --packages`). The packaged
application never downloads a model. A failed or interrupted download stays in
a `.part` file and cannot be mistaken for an installed model.

**Prerequisite:** the embedded runtime `python/python.exe` (CPython 3.12.14)
must already be provisioned. `pnpm voix:preparer` installs the pinned wheels
into the git-ignored `packages/` directory with that interpreter and repairs
the model assets; it does not create the interpreter and does not build the
whole bundle from a bare clone. A fresh clone contains neither `python/` nor
`packages/`; copy or provision the embedded runtime first, then run the
command. Without it, the command stops with
`runtime Python absent : resources/voix/python/python.exe`.

| Asset | Role | License |
|---|---|---|
| `faster-whisper-small/` | faster-whisper small, CTranslate2 `int8`, CPU — `Systran/faster-whisper-small` revision `536b0662742c02347bc0e980a01041f333bce120` | MIT |
| `kokoro-v1.0.fp16.onnx` | Kokoro-82M v1.0 ONNX export, CPU | Apache-2.0 weights; MIT export |
| `voices-v1.0.bin` | 54 Kokoro voices, including French `ff_siwis` | CC-BY 4.0 voice, Apache-2.0 model |
| `vosk-model-small-fr-0.22/` | Vosk French spotter, closed grammar « alexa » | Apache-2.0 |

Runtime: pinned CPython 3.12.14, `faster-whisper 1.2.1`, `ctranslate2 4.8.4`,
`av 19.0.2`, `tokenizers 0.23.3`, `huggingface-hub 2.3.0`,
`onnxruntime 1.30.0`, `kokoro-onnx 0.6.1`, `vosk 0.3.45`, ONNX Runtime CPU.
Exact pins live in `requirements.txt`; `pnpm voix:preparer --packages` installs
them into the git-ignored `packages/` directory with the provisioned embedded
interpreter. No network
occurs inside either worker: `local_files_only=True` and a blocked
`socket.socket.connect` forbid any Hub or provider call.

faster-whisper small int8 is the only transcription model. Kokoro is the only
speech model; French uses `ff_siwis`. Kokoro v1.0 has no Arabic voice, so Arabic
TTS is not claimed and must not be silently pronounced with French phonemes.

The Python helper is a private authenticated server process; renderer IPC gains
no shell capability. Audio is PCM/WAV in RAM only. Logout, scope change,
cancellation and idle teardown discard work.

Set server `ALEXA_LOCAL_VOICE=true` only after device and license qualification.
The packaged Electron backend supplies absolute `resources/voix` paths.

Model metadata and integrity: `manifest.json` (schema 2, with the
`inventorySha256` contract) and `inventory.json`. Dependency provenance:
`lock.json`. `node scripts/preparer-voix-native.mjs --check` verifies the bundle
offline; `pnpm voix:verifier` runs the full local check. Retired speech engines
are intentionally absent: only the four assets above are shipped.
