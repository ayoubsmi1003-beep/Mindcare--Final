#!/usr/bin/env node
/**
 * Verify the local voice bundle without starting a model.
 * Run in the repository or against the installed resources/voix directory.
 * `inventory.json` is compared with the hash recorded in `manifest.json`; no
 * stale hardcoded value can mask a changed bundle.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
function empreinteFichier(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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

await modele("assets/faster-whisper-small/config.json", 2_370, "b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828");
await modele("assets/faster-whisper-small/model.bin", 483_546_902, "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671");
await modele("assets/faster-whisper-small/tokenizer.json", 2_203_239, "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab");
await modele("assets/faster-whisper-small/vocabulary.txt", 459_861, "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913");
await modele("assets/kokoro-v1.0.fp16.onnx", 163_527_961, "f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96");
await modele("assets/voices-v1.0.bin", 28_214_398, "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d");
check("worker STT/TTS", existsSync(join(VOIX, "native-voice-worker.py")));
check("worker réveil", existsSync(join(VOIX, "wake-voice-worker.py")));
check("santé vocale", existsSync(join(VOIX, "health", "fr-bonjour.wav")));
check("modèle Vosk", existsSync(join(VOIX, "assets", "vosk-model-small-fr-0.22", "conf", "model.conf")));
check("runtime Python", existsSync(join(VOIX, "python", "python.exe")));
check("dépendances Python", existsSync(join(VOIX, "requirements.txt")));
check("faster-whisper", existsSync(join(VOIX, "packages", "faster_whisper")));
check("ctranslate2", existsSync(join(VOIX, "packages", "ctranslate2")));
check("av", existsSync(join(VOIX, "packages", "av")));
check("kokoro-onnx", existsSync(join(VOIX, "packages", "kokoro_onnx")));
check("vosk", existsSync(join(VOIX, "packages", "vosk")));
check("espeak-ng", existsSync(join(VOIX, "packages", "espeakng_loader", "espeak-ng.dll")));

const manifestePath = join(VOIX, "manifest.json");
let manifeste = null;
try {
  manifeste = JSON.parse(readFileSync(manifestePath, "utf8"));
} catch {
  manifeste = null;
}
check("manifeste", manifeste !== null && manifeste.schema === 2, manifeste === null ? "illisible/absent" : `schéma ${manifeste.schema}`);
if (existsSync(join(VOIX, "inventory.json"))) {
  const inventorySha = empreinteFichier(join(VOIX, "inventory.json"));
  check(
    "empreinte inventaire",
    typeof manifeste?.inventorySha256 === "string" && manifeste.inventorySha256 === inventorySha,
    inventorySha,
  );
} else {
  check("empreinte inventaire", false, "inventory.json absent");
}

const absents = [
  ["assets/ggml-*.bin", /^ggml-.*\.bin$/u],
  ["assets/fr_FR-*.onnx*", /^fr_FR-.*\.onnx(?:\.json)?$/u],
  ["assets/ar_JO-*.onnx*", /^ar_JO-.*\.onnx(?:\.json)?$/u],
];
for (const [nom, motif] of absents) {
  let restants = [];
  try {
    restants = readdirSync(join(VOIX, "assets")).filter((fichier) => motif.test(fichier));
  } catch {
    restants = [];
  }
  check(`retiré: ${nom}`, restants.length === 0, restants.join(", "));
}
check("retiré: public/wakeword", !existsSync(join(ROOT, "public", "wakeword")));

for (const route of ["jarvis-voice-in", "jarvis-voice-out", "jarvis-voice-session", "jarvis-wake"]) {
  const path = join(ROOT, "src", "app", "api", "jarvis", route, "route.ts");
  const source = existsSync(path) ? readFileSync(path, "utf8") : "";
  check(`route locale: ${route}`, source !== "" && !/gemini|groq|elevenlabs/i.test(source));
}
const voixSortante = join(ROOT, "src", "app", "api", "jarvis", "jarvis-voice-out", "route.ts");
const sourceVoixSortante = existsSync(voixSortante) ? readFileSync(voixSortante, "utf8") : "";
check(
  "voix sortante: aucune barrière cloud",
  sourceVoixSortante !== "" && !/classerCharge|serverAdmittedSpeech/u.test(sourceVoixSortante),
);
const fenetrePrincipale = join(ROOT, "electron", "main", "index.ts");
const sourceFenetrePrincipale = existsSync(fenetrePrincipale) ? readFileSync(fenetrePrincipale, "utf8") : "";
check(
  "lecture automatique: politique Electron",
  sourceFenetrePrincipale.includes('autoplayPolicy: "no-user-gesture-required"'),
);

const failed = checks.filter((entry) => !entry.ok);
const result = { ok: failed.length === 0, voiceRoot: VOIX, checks };
if (JSON_OUT) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else {
  for (const entry of checks) console.log(`${entry.ok ? "PASS" : "FAIL"} — ${entry.name}${entry.detail ? ` — ${entry.detail}` : ""}`);
  console.log(`\nVERDICT VOIX LOCALE : ${result.ok ? "PASS" : "FAIL"} (${checks.length - failed.length}/${checks.length})`);
}
process.exitCode = result.ok ? 0 : 1;
