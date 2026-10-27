# Third-party notices — local voice bundle

The clinic build includes the following local components:

- **faster-whisper 1.2.1** — MIT. Upstream: `SYSTRAN/faster-whisper`. Runtime for the bundled CTranslate2 conversion of OpenAI Whisper small (`Systran/faster-whisper-small`, revision `536b0662742c02347bc0e980a01041f333bce120`); Whisper small weights are MIT.
- **CTranslate2 4.8.4** — MIT. CPU inference engine used by faster-whisper (`int8`).
- **PyAV 19.0.2** — BSD-3-Clause. In-memory audio decoding.
- **tokenizers 0.23.3** — Apache-2.0. Tokenizer runtime for faster-whisper.
- **huggingface-hub 2.3.0** — Apache-2.0. Offline asset resolution only (`local_files_only=True`).
- **Kokoro-82M v1.0** — Apache-2.0 weights; ONNX export from `thewh1teagle/kokoro-onnx` release `model-files-v1.1`, used under its MIT export code. Official weights SHA-256: `496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4`.
- **Kokoro French voice `ff_siwis`** — CC-BY 4.0, derived from the SIWIS dataset. Attribution retained in `model-licenses/`.
- **Vosk 0.3.45 and `vosk-model-small-fr-0.22`** — Apache-2.0.
- **espeak-ng runtime and data** (`espeakng-loader`) — GPL-3.0-or-later. The clinic installation retains this notice and the upstream licence/source offer. The worker is a separate process; the application does not relicense the GPL component.
- **phonemizer 3.4.0** — GPL-3.0-or-later.
- **Retired speech engines and wake-word models** — absent from this bundle. No pre-trained wake-word model with a non-commercial (CC BY-NC-SA) licence is distributed in this clinic build.

The application's own source remains proprietary. GPL source-offer obligations for espeak-ng/phonemizer must be satisfied by the distributor before external redistribution.
