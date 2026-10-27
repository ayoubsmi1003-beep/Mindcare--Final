"""Pinned resident Whisper large-v3-turbo / Kokoro-82M worker.

No network, no audio files written by the app, no transcript logs.
All audio and text stay in RAM and travel only over the authenticated local
server's stdin/stdout protocol.
"""
import sys, os, json, base64, time, socket, logging, io, wave, re
from pathlib import Path

sys.stdin.reconfigure(encoding="utf-8", errors="strict")
sys.stdout.reconfigure(encoding="utf-8", errors="strict")
sys.path.insert(0, sys.argv[1])
logging.disable(logging.CRITICAL)


def no_network(*args, **kwargs):
    raise RuntimeError("network-disabled")


socket.socket.connect = no_network
os.environ["OMP_NUM_THREADS"] = "2"

import numpy as np
from importlib.metadata import version

if version("pywhispercpp") != "1.5.1":
    raise RuntimeError("runtime:pywhispercpp")
if version("kokoro-onnx") != "0.6.1":
    raise RuntimeError("runtime:kokoro-onnx")

from pywhispercpp.model import Model
from kokoro_onnx import Kokoro

assets = Path(sys.argv[2]).resolve()
whisper_path = Path(os.environ.get("ALEXA_VOICE_STT_MODEL", assets / "ggml-large-v3-turbo-q5_0.bin"))
if not whisper_path.is_absolute():
    whisper_path = assets / whisper_path
if not whisper_path.is_file():
    raise RuntimeError("assets:stt")

kokoro_path = Path(os.environ.get("ALEXA_KOKORO_MODEL", assets / "kokoro-v1.0.fp16.onnx"))
voices_path = Path(os.environ.get("ALEXA_KOKORO_VOICES", assets / "voices-v1.0.bin"))
if not kokoro_path.is_absolute():
    kokoro_path = assets / kokoro_path
if not voices_path.is_absolute():
    voices_path = assets / voices_path
if not kokoro_path.is_file() or not voices_path.is_file():
    raise RuntimeError("assets:tts")

TTS_VOICE = os.environ.get("ALEXA_TTS_VOICE", "ff_siwis")
TTS_LANG = os.environ.get("ALEXA_TTS_LANG", "fr-fr")
HEALTH = os.environ.get("ALEXA_VOICE_HEALTH", "1") == "1"

# Absolute paths prevent pywhispercpp's automatic downloader from ever running.
whisper = Model(
    str(whisper_path),
    n_threads=2,
    no_context=True,
    language="fr",
    translate=False,
    print_realtime=False,
    print_progress=False,
    print_special=False,
    print_timestamps=False,
    context_params={"use_gpu": False},
    redirect_whispercpp_logs_to=False,
)
kokoro = Kokoro(str(kokoro_path), str(voices_path))

FR_PROMPT = (
    "Alexa. Prochain patient. Dernière séance. Agenda. Ordonnance. "
    "Sertraline. Fluoxétine. Milligrammes. Anxiety. Insomnie. "
)
AR_PROMPT = "أليكسا. المريض القادم. آخر جلسة. برنامج اليوم. الدواء."


def normalize_pcm(samples: np.ndarray, peak: float = 0.95) -> np.ndarray:
    audio = np.asarray(samples, dtype=np.float32)
    if audio.size == 0:
        return audio
    maximum = float(np.max(np.abs(audio)))
    if maximum > peak:
        audio = audio * (peak / maximum)
    return np.clip(audio, -1.0, 1.0)


def wav_base64(samples: np.ndarray, rate: int) -> str:
    audio = normalize_pcm(samples)
    pcm = (audio * 32767.0).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def synth(text: str, langue: str):
    if langue != "fr":
        raise ValueError("langue-non-supportee")
    if not text.strip() or len(text) > 2000:
        raise ValueError("volume")
    samples, rate = kokoro.create(text, voice=TTS_VOICE, speed=1.0, lang=TTS_LANG)
    return wav_base64(samples, rate), rate


def stt_from_samples(samples: np.ndarray, langue: str):
    if samples.size == 0 or samples.size > 960_000:
        raise ValueError("volume")
    rms = float(np.sqrt(np.mean(samples * samples)))
    if rms < 0.004:
        raise ValueError("silence")
    language = "ar" if langue == "ar" else "fr"
    duration = samples.size / 16000.0
    # Whisper pads to 30 s. Reducing the encoder context for a short utterance
    # is the difference between a usable slow-CPU path and an unbounded wait.
    audio_ctx = int(min(1500, max(512, round(duration / 30.0 * 1500))))
    segments = whisper.transcribe(
        samples,
        language=language,
        translate=False,
        no_context=True,
        audio_ctx=audio_ctx,
        extract_probability=True,
        suppress_nst=True,
        temperature=0.0,
        initial_prompt=AR_PROMPT if language == "ar" else FR_PROMPT,
    )
    if not segments:
        raise ValueError("confiance")
    probabilities = [float(segment.probability) for segment in segments]
    if min(probabilities) < 0.40:
        raise ValueError("confiance")
    text = "".join(segment.text for segment in segments).strip()
    if not text:
        raise ValueError("confiance")
    return text


def health() -> None:
    if not HEALTH:
        return
    health_path = assets.parent / "health" / "fr-bonjour.wav"
    if not health_path.is_file():
        raise RuntimeError("assets:health")
    with wave.open(str(health_path), "rb") as wav:
        if wav.getframerate() != 16000 or wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            raise RuntimeError("assets:health")
        raw = wav.readframes(wav.getnframes())
    samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    text = stt_from_samples(samples, "fr")
    if "bonjour" not in text.lower():
        raise RuntimeError("health:stt")
    audio, rate = synth("Bonjour. La voix locale est prête.", "fr")
    if len(audio) < 44 or rate != 24000:
        raise RuntimeError("health:tts")


try:
    health()
    sys.stdout.write(
        json.dumps(
            {
                "ready": True,
                "stt": "whisper-large-v3-turbo-q5_0",
                "tts": "kokoro-82m-v1.0-ff_siwis",
                "voice": TTS_VOICE,
                "sampleRate": 24000,
            },
            ensure_ascii=True,
        )
        + "\n"
    )
    sys.stdout.flush()
except Exception as exc:
    sys.stdout.write(
        json.dumps({"ready": False, "error": str(exc) if isinstance(exc, ValueError) else "health"}, ensure_ascii=True)
        + "\n"
    )
    sys.stdout.flush()
    raise SystemExit(1)

for line in sys.stdin:
    if len(line) > 1_300_000:
        break
    req = None
    try:
        req = json.loads(line)
        result = {k: req[k] for k in ("id", "runId", "utteranceId")}
        start = time.monotonic()
        if req["action"] == "stt":
            raw = base64.b64decode(req["pcmBase64"], validate=True)
            if len(raw) == 0 or len(raw) > 960_000 or len(raw) % 2 or req["sampleRate"] != 16000:
                raise ValueError("volume")
            samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
            text = stt_from_samples(samples, req.get("langue", "fr"))
            result.update(texte=text, model="whisper-large-v3-turbo-q5_0")
        elif req["action"] == "tts":
            audio, rate = synth(req["texte"], req.get("langue", "fr"))
            result.update(audioBase64=audio, mimeType="audio/wav", sampleRate=rate, model="kokoro-82m-v1.0-ff_siwis")
        elif req["action"] == "health":
            health()
            result.update(ok=True, model="local", durationMs=(time.monotonic() - start) * 1000)
        elif req["action"] == "stop":
            result.update(ok=True, stopped=True)
            sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
            sys.stdout.flush()
            break
        else:
            raise ValueError("action")
        result.update(ok=True, durationMs=(time.monotonic() - start) * 1000)
    except Exception as exc:
        if req is None:
            break
        result = {k: req[k] for k in ("id", "runId", "utteranceId")}
        result.update(ok=False, code=str(exc) if isinstance(exc, ValueError) else "runtime")
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    sys.stdout.flush()
    req = result = raw = samples = None
    line = ""
