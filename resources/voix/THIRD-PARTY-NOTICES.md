# Third-party notices — local voice bundle

The clinic build includes the following local components:

- **Whisper.cpp / ggml large-v3-turbo Q5_0** — MIT. Upstream: `ggerganov/whisper.cpp`, revision `5359861c739e955e79d9a303bcbc70fb988958b1`. Bundled model file SHA-256: `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`.
- **pywhispercpp 1.5.1** — MIT.
- **Kokoro-82M v1.0** — Apache-2.0 weights; ONNX export from `thewh1teagle/kokoro-onnx` release `model-files-v1.1`, used under its MIT export code. Official weights SHA-256: `496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4`.
- **Kokoro French voice `ff_siwis`** — CC-BY 4.0, derived from the SIWIS dataset. Attribution retained in `model-licenses/`.
- **Vosk 0.3.45 and `vosk-model-small-fr-0.22`** — Apache-2.0.
- **espeak-ng runtime and data** (`espeakng-loader`) — GPL-3.0-or-later. The clinic installation retains this notice and the upstream licence/source offer. The worker is a separate process; the application does not relicense the GPL component.
- **phonemizer 3.4.0** — GPL-3.0-or-later.
- **Piper** — intentionally retired and absent from this bundle.
- **openWakeWord pre-trained “Alexa” model** — intentionally retired. The upstream pre-trained models are CC BY-NC-SA 4.0 and are not distributed in this clinic build.

The application's own source remains proprietary. GPL source-offer obligations for espeak-ng/phonemizer must be satisfied by the distributor before external redistribution.
