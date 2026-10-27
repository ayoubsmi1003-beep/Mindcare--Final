"""Resident Vosk keyword-spotter. Local only: no network, no audio files, no transcript output."""
import sys, os, json, base64, time, socket, logging, re
from pathlib import Path

sys.stdin.reconfigure(encoding="utf-8", errors="strict")
sys.stdout.reconfigure(encoding="utf-8", errors="strict")
sys.path.insert(0, sys.argv[1])
logging.disable(logging.CRITICAL)


def no_network(*args, **kwargs):
    raise RuntimeError("network-disabled")


socket.socket.connect = no_network
os.environ["OMP_NUM_THREADS"] = "1"
from vosk import Model, KaldiRecognizer, SetLogLevel

SetLogLevel(-1)

assets = Path(sys.argv[2]).resolve()
model_name = os.environ.get("ALEXA_WAKE_MODEL", "vosk-model-small-fr-0.22")
model_dir = Path(model_name)
if not model_dir.is_absolute():
    model_dir = assets / model_name
if not model_dir.is_dir():
    raise RuntimeError("assets")

# The grammar keeps the decoder inside a closed vocabulary. The model is
# French; "alexa" is the configured wake word and the brand is spoken as-is.
GRAMMAR = '["alexa", "eh lexa", "[unk]"]'
model = Model(str(model_dir))
recognizer = KaldiRecognizer(model, 16000, GRAMMAR)
last = 0.0
REFRACTORY_S = 2.0
sys.stdout.write(json.dumps({"id": "ready", "ready": True}) + "\n")
sys.stdout.flush()


def reset():
    global recognizer
    recognizer = KaldiRecognizer(model, 16000, GRAMMAR)


def heard(text):
    return re.search(r"\balexa\b", text.lower()) is not None


for line in sys.stdin:
    if len(line) > 300_000:
        break
    try:
        req = json.loads(line)
    except Exception:
        # Malformed input is answered, never fatal: the resident worker must
        # survive a truncated write from a cancelled HTTP request.
        sys.stdout.write(json.dumps({"id": "", "ok": False, "code": "json"}) + "\n")
        sys.stdout.flush()
        line = ""
        continue
    if not isinstance(req, dict):
        sys.stdout.write(json.dumps({"id": "", "ok": False, "code": "json"}) + "\n")
        sys.stdout.flush()
        line = ""
        continue
    try:
        result = {"id": req["id"], "ok": True}
        action = req.get("action")
        if action == "audio":
            raw = base64.b64decode(req["pcmBase64"], validate=True)
            if len(raw) == 0 or len(raw) > 64_000 or len(raw) % 2:
                raise ValueError("volume")
            if recognizer.AcceptWaveform(raw):
                text = json.loads(recognizer.Result()).get("text", "")
            else:
                text = json.loads(recognizer.PartialResult()).get("partial", "")
            now = time.monotonic()
            detected = now - last >= REFRACTORY_S and bool(heard(text))
            if detected:
                last = now
                reset()
            result["detected"] = detected
        elif action == "reset":
            reset()
            result["detected"] = False
        elif action == "ping":
            # Liveness only: the recognizer state must not move.
            result["pong"] = True
        elif action == "stop":
            result["detected"] = False
            sys.stdout.write(json.dumps(result) + "\n")
            sys.stdout.flush()
            break
        else:
            raise ValueError("action")
        sys.stdout.write(json.dumps(result) + "\n")
        sys.stdout.flush()
    except Exception as exc:
        err = {
            "id": req.get("id", ""),
            "ok": False,
            "code": str(exc) if isinstance(exc, ValueError) else "runtime",
        }
        sys.stdout.write(json.dumps(err) + "\n")
        sys.stdout.flush()
    req = result = raw = None
    line = ""
