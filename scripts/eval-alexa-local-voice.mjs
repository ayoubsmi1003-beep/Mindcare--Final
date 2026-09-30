/** Local native transport smoke/latency only. Generated speech does not qualify human STT or hardware. */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url), root = join(dirname(fileURLToPath(import.meta.url)), "..");
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(root, false, { info() {}, error() {} });
const viteRequire = createRequire(require.resolve("vite/package.json", { paths: [dirname(require.resolve("vitest/package.json"))] }));
const output = join(root, ".eval-out", "alexa-native", "runtime.mjs");
await mkdir(dirname(output), { recursive: true });
await viteRequire("esbuild").build({ entryPoints: [join(root, "src/server/voice/runtime.ts")], outfile: output,
  bundle: true, platform: "node", format: "esm", target: "node22", packages: "external", alias: { "@": join(root, "src") }, logLevel: "silent" });
const { demanderVoixNative, arreterVoixNative } = await import(pathToFileURL(output).href);
const samples = [], sessionId = "a".repeat(64);
for (const [language, text, segments] of [
  ["fr", "Bonjour. Le programme est disponible.", [{ texte: "Bonjour. Le programme est disponible.", langue: "fr" }]],
  ["ar", "مرحبا. البرنامج متوفر اليوم.", [{ texte: "مرحبا. البرنامج متوفر اليوم.", langue: "ar" }]],
  ["mixed", "Bonjour. مرحبا.", [{ texte: "Bonjour. ", langue: "fr" }, { texte: "مرحبا.", langue: "ar" }]],
]) {
  const start = performance.now();
  try {
    const result = await demanderVoixNative({ action: "tts", texte: text, segments, langue: segments[0].langue,
      id: crypto.randomUUID(), runId: crypto.randomUUID(), utteranceId: crypto.randomUUID(), sessionId });
    const audio = Buffer.from(result.audioBase64, "base64");
    // Inspect WAV in memory; never write or retain audio or transcripts.
    samples.push({ language, ok: audio.subarray(0, 4).toString() === "RIFF" && audio.length > 44,
      bytes: audio.length, sampleRate: result.sampleRate, model: result.model, inferenceMs: result.durationMs, ms: performance.now() - start });
  } catch (error) { samples.push({ language, ok: false, code: /^configuration:/.test(error.message) ? "CONFIGURATION" : /timeout/.test(error.message) ? "TIMEOUT" : "NATIVE_ERROR", ms: performance.now() - start }); }
  console.log(JSON.stringify(samples.at(-1)));
}
// Silence is a required rejection, not a fake transcript.
try {
  await demanderVoixNative({ action: "stt", pcmBase64: Buffer.alloc(32000).toString("base64"), sampleRate: 16000, langue: "auto",
    id: crypto.randomUUID(), runId: crypto.randomUUID(), utteranceId: crypto.randomUUID(), sessionId });
  samples.push({ language: "silence", ok: false });
} catch (error) { samples.push({ language: "silence", ok: error.message === "silence", code: error.message === "silence" ? "SILENCE_REJECTED" : "NATIVE_ERROR" }); }
arreterVoixNative();
const report = { type: "synthetic-native-smoke", hardware: "NOT_RUN", humanSpeech: "NOT_RUN", firstWordTargetMs: 800, samples };
await writeFile(join(root, "artifacts/alexa-free-pool-2026-09-30/native-voice.json"), JSON.stringify(report, null, 2));
if (samples.some((s) => !s.ok)) process.exitCode = 2;
