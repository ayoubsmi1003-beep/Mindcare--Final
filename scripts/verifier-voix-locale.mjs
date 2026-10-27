#!/usr/bin/env node
/**
 * Verify the local voice bundle without starting a model.
 * Run in the repository or against the installed resources/voix directory.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const VOIX = process.argv.includes("--voix")
  ? resolve(process.argv[process.argv.indexOf("--voix") + 1])
  : join(ROOT, "resources", "voix");
const JSON_OUT = process.argv.includes("--json");
const checks = [];

function hash(path) {
  return new Promise((resolveHash, reject) => {
    const h = createHash("sha256");
    createReadStream(path).on("data", (chunk) => h.update(chunk)).on("error", reject).on("end", () => resolveHash(h.digest("hex")));
  });
}
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
}
async function modele(relativePath, bytes, sha256) {
  const path = join(VOIX, relativePath);
  try {
    const sizeOk = statSync(path).size === bytes;
    const hashOk = sizeOk && (await hash(path)) === sha256;
    check(relativePath, sizeOk && hashOk, sizeOk ? (hashOk ? "sha256 ok" : "sha256 invalide") : "taille invalide");
  } catch {
    check(relativePath, false, "absent");
  }
}

await modele("assets/ggml-large-v3-turbo-q5_0.bin", 574_041_195, "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2");
await modele("assets/kokoro-v1.0.fp16.onnx", 163_527_961, "f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96");
await modele("assets/voices-v1.0.bin", 28_214_398, "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d");
check("worker STT/TTS", existsSync(join(VOIX, "native-voice-worker.py")));
check("worker réveil", existsSync(join(VOIX, "wake-voice-worker.py")));
check("santé vocale", existsSync(join(VOIX, "health", "fr-bonjour.wav")));
check("modèle Vosk", existsSync(join(VOIX, "assets", "vosk-model-small-fr-0.22", "conf", "model.conf")));
check("runtime Python", existsSync(join(VOIX, "python", "python.exe")));
check("kokoro-onnx", existsSync(join(VOIX, "packages", "kokoro_onnx")));
check("vosk", existsSync(join(VOIX, "packages", "vosk")));
check("espeak-ng", existsSync(join(VOIX, "packages", "espeakng_loader", "espeak-ng.dll")));
check("inventaire", existsSync(join(VOIX, "inventory.json")));
check("manifeste", existsSync(join(VOIX, "manifest.json")));
for (const stale of ["assets/ggml-base.bin", "assets/fr_FR-siwis-medium.onnx", "assets/ar_JO-kareem-low.onnx"]) {
  check(`retiré: ${stale}`, !existsSync(join(VOIX, stale)));
}
if (existsSync(join(VOIX, "inventory.json"))) {
  const inventorySha = createHash("sha256").update(readFileSync(join(VOIX, "inventory.json"))).digest("hex");
  check("empreinte inventaire", inventorySha === "af3c524e64a24039c505169a1ef2c56011921b49cce8b3d747aec5f1aec40fc4", inventorySha);
}
for (const route of ["jarvis-voice-in", "jarvis-voice-out", "jarvis-voice-session", "jarvis-wake"]) {
  const path = join(ROOT, "src", "app", "api", "jarvis", route, "route.ts");
  const source = existsSync(path) ? readFileSync(path, "utf8") : "";
  check(`route locale: ${route}`, source !== "" && !/gemini|groq|elevenlabs/i.test(source));
}

const failed = checks.filter((entry) => !entry.ok);
const result = { ok: failed.length === 0, voiceRoot: VOIX, checks };
if (JSON_OUT) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else {
  for (const entry of checks) console.log(`${entry.ok ? "PASS" : "FAIL"} — ${entry.name}${entry.detail ? ` — ${entry.detail}` : ""}`);
  console.log(`\nVERDICT VOIX LOCALE : ${result.ok ? "PASS" : "FAIL"} (${checks.length - failed.length}/${checks.length})`);
}
process.exitCode = result.ok ? 0 : 1;
