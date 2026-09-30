"""Pinned resident whisper.cpp/Piper worker. No audio files, network, or text logs."""
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
from importlib.metadata import version
if version("pywhispercpp") != "1.5.1" or version("piper-tts") != "1.8.0":
    raise RuntimeError("version")
import numpy as np
from pywhispercpp.model import Model
from piper.voice import PiperVoice
from piper.config import PiperConfig
import onnxruntime as ort
assets = Path(sys.argv[2]).resolve()
# An absolute existing path avoids the binding's automatic model downloader.
whisper_path = assets / "ggml-base.bin"
if not whisper_path.is_file():
    raise RuntimeError("assets")
whisper = Model(str(whisper_path), n_threads=2, no_context=True, language="auto",
                print_realtime=False, print_progress=False, print_special=False,
                print_timestamps=False, context_params={"use_gpu": False},
                redirect_whispercpp_logs_to=False)
voices = {}
def synth(text, language):
    name = "ar_JO-kareem-low.onnx" if language == "ar" else "fr_FR-siwis-medium.onnx"
    if language not in voices:
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        with open(assets / (name + ".json"), encoding="utf-8") as config_file:
            config = PiperConfig.from_dict(json.load(config_file))
        voices[language] = PiperVoice(session=ort.InferenceSession(str(assets / name), sess_options=options, providers=["CPUExecutionProvider"]), config=config, download_dir=assets)
    voice = voices[language]
    frames = bytearray()
    rate = voice.config.sample_rate
    for chunk in voice.synthesize(text):
        frames.extend(chunk.audio_int16_bytes)
        if len(frames) > rate * 2 * 120:
            raise ValueError("volume")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(rate); wav.writeframes(frames)
    return base64.b64encode(buf.getvalue()).decode("ascii"), rate, name
for line in sys.stdin:
    if len(line) > 1300000:
        break
    req = None
    try:
        req = json.loads(line)
        result = {k: req[k] for k in ("id", "runId", "utteranceId")}
        start = time.monotonic()
        if req["action"] == "stt":
            raw = base64.b64decode(req["pcmBase64"], validate=True)
            if len(raw) == 0 or len(raw) > 960000 or len(raw) % 2 or req["sampleRate"] != 16000:
                raise ValueError("volume")
            samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
            if np.sqrt(np.mean(samples * samples)) < 0.006:
                raise ValueError("silence")
            segments = whisper.transcribe(samples, language=req.get("langue", "auto"), no_context=True, extract_probability=True, initial_prompt="Alexa. Prochain patient. Dernière séance. Agenda. أليكسا. المريض القادم. آخر جلسة. برنامج اليوم.")
            if not segments or min(s.probability for s in segments) < 0.50:
                raise ValueError("confiance")
            result.update(texte="".join(s.text for s in segments).strip(), model="whisper.cpp-base-multilingual")
        elif req["action"] == "tts":
            if len(req["texte"]) > 2000 or req["langue"] not in ("fr", "ar"):
                raise ValueError("volume")
            audio, rate, model = synth(req["texte"], req["langue"])
            result.update(audioBase64=audio, mimeType="audio/wav", sampleRate=rate, model=model)
        else:
            raise ValueError("action")
        result.update(ok=True, durationMs=(time.monotonic() - start) * 1000)
    except Exception as exc:
        if req is None:
            break
        result = {k: req[k] for k in ("id", "runId", "utteranceId")}
        result.update(ok=False, code=str(exc) if isinstance(exc, ValueError) else "runtime")
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n"); sys.stdout.flush()
    req = result = raw = samples = segments = None
    line = ""

