# Local native voice bundle

Build with `node scripts/preparer-voix-native.mjs PYTHON_ROOT PACKAGES_ROOT ASSETS_ROOT`.
Only pinned CPython 3.12.14 / pywhispercpp 1.5.1 / Piper 1.8.0 and the five
hash-verified models/configurations are accepted. No download occurs at runtime.
The helper is a private authenticated server process; renderer IPC gains no shell capability.
All audio is PCM/WAV in RAM. Logout, scope change, cancellation and idle teardown discard work.
Set server `ALEXA_LOCAL_VOICE=true` only after device and license qualification.
The packaged Electron backend discovers `resources/voix` and supplies private paths.
Client flags (compiled into Next): `NEXT_PUBLIC_ALEXA_FAST_BRAIN`,
`NEXT_PUBLIC_ALEXA_READ_CACHE`, `NEXT_PUBLIC_ALEXA_VOICE_APPROVAL`,
`NEXT_PUBLIC_ALEXA_BARGE_IN`; all strict opt-in.

Model metadata, wheel hashes, licenses and upstream source pointers:
`scripts/native-voice-lock.json`. GPL source distribution and each voice model
license must be resolved before external installer distribution. Local bundle
qualification is separate from release qualification.
