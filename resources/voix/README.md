# Local native voice bundle

Build with `node scripts/preparer-voix-native.mjs --repair` from the pinned
upstream artifacts. The packaged application never downloads a model.

| Asset | Role | License |
|---|---|---|
| `ggml-large-v3-turbo-q5_0.bin` | Whisper large-v3-turbo Q5_0, CPU | MIT |
| `kokoro-v1.0.fp16.onnx` | Kokoro-82M v1.0 ONNX export, CPU | Apache-2.0 weights; MIT export |
| `voices-v1.0.bin` | 54 Kokoro voices, including French `ff_siwis` | CC-BY 4.0 voice, Apache-2.0 model |
| `vosk-model-small-fr-0.22/` | Vosk French spotter, closed grammar “alexa” | Apache-2.0 |

Runtime: pinned CPython 3.12.14, `pywhispercpp 1.5.1`, `kokoro-onnx 0.6.1`,
`vosk 0.3.45`, ONNX Runtime CPU. No network occurs inside either worker.

Whisper is the only transcription model. Kokoro is the only speech model;
French uses `ff_siwis`. Kokoro v1.0 has no Arabic voice, so Arabic TTS is not
claimed and must not be silently pronounced with French phonemes.

The Python helper is a private authenticated server process; renderer IPC gains
no shell capability. Audio is PCM/WAV in RAM only. Logout, scope change,
cancellation and idle teardown discard work.

Set server `ALEXA_LOCAL_VOICE=true` only after device and license qualification.
The packaged Electron backend supplies absolute `resources/voix` paths.

Model metadata and integrity: `manifest.json` and `inventory.json`.
Dependency provenance: `lock.json`. Piper is intentionally absent.
