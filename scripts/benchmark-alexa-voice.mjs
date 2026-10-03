/** Offline corpus evaluation. Never downloads assets, fabricates audio, or emits transcripts. */
import { readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname, sep, join } from "node:path";
import { cpus, totalmem } from "node:os";

const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) options.set(process.argv[i], process.argv[i + 1]);
const help = "Usage: node scripts/benchmark-alexa-voice.mjs --corpus synthetic.jsonl --out report.json [--results measured-transcripts.json | --runtime resources/voix]";
const normalize = (text) => text.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/gu, " ").trim();
function distance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(a[i - 1] !== b[j - 1]));
    previous = next;
  }
  return previous[b.length];
}
const p95 = (values) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] : null;
const finite = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
async function hash(file) { const h = createHash("sha256"); for await (const chunk of createReadStream(file)) h.update(chunk); return h.digest("hex"); }
function wavPCM(wav) {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw Error("corpus-audio-format");
  let pcm = null, valid = false;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const type = wav.toString("ascii", offset, offset + 4), length = wav.readUInt32LE(offset + 4), begin = offset + 8;
    if (begin + length > wav.length) throw Error("corpus-audio-format");
    if (type === "fmt ") valid = length >= 16 && wav.readUInt16LE(begin) === 1 && wav.readUInt16LE(begin + 2) === 1 && wav.readUInt32LE(begin + 4) === 16000 && wav.readUInt16LE(begin + 14) === 16;
    if (type === "data") pcm = wav.subarray(begin, begin + length);
    offset = begin + length + length % 2;
  }
  if (!valid || !pcm || pcm.length === 0 || pcm.length > 960000 || pcm.length % 2) throw Error("corpus-audio-format");
  return pcm;
}
async function nativeResults(corpus, corpusDirectory, root) {
  if (process.platform !== "win32") throw Error("native-platform-unavailable");
  const inventoryFile = join(root, "inventory.json");
  if (await hash(inventoryFile) !== "9b29537de4562809a6a641c18ec7d1c7e320be8a4fa6162f24ffbbe1d78cb281") throw Error("native-inventory-unverified");
  for (const pin of JSON.parse(await readFile(inventoryFile, "utf8"))) {
    const file = resolve(root, pin.path);
    if (!file.startsWith(root + sep) || await hash(file) !== pin.sha256) throw Error("native-assets-unverified");
  }
  const child = spawn(join(root, "python", "python.exe"), ["-I", "-B", "-u", resolve("scripts/native-voice-worker.py"), join(root, "packages"), join(root, "assets")], {
    shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    env: { SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "", OMP_NUM_THREADS: "2" },
  });
  child.stderr.resume(); let pending = null, buffer = "", peak = 0, cpuMs = null, collecting = false;
  const run = promisify(execFile);
  const sample = async () => {
    if (collecting || !child.pid || child.killed) return;
    collecting = true;
    try {
      const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", `$p = Get-Process -Id ${child.pid} -ErrorAction Stop; @{rss=$p.WorkingSet64;cpuMs=($p.CPU * 1000)} | ConvertTo-Json -Compress`], { windowsHide: true, timeout: 3000 });
      const { rss, cpuMs: cpu } = JSON.parse(stdout);
      if (finite(rss)) peak = Math.max(peak, rss); if (finite(cpu)) cpuMs = cpu;
    } catch { /* Missing process metrics remain NOT RUN. */ }
    finally { collecting = false; }
  };
  const sampling = setInterval(() => { void sample(); }, 1000);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (fragment) => {
    buffer += fragment;
    if (buffer.length > 8100000) { pending?.reject(Error("native-protocol")); return; }
    for (;;) {
      const end = buffer.indexOf("\n"); if (end < 0) break;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { const response = JSON.parse(line); if (response.id === pending?.id) pending.resolve(response); }
      catch { pending?.reject(Error("native-protocol")); }
    }
  });
  child.on("error", () => pending?.reject(Error("native-unavailable")));
  child.on("exit", () => pending?.reject(Error("native-stopped")));
  const rows = [], stop = () => child.kill(); process.once("SIGINT", stop);
  try {
    for (const item of corpus) {
      const file = resolve(corpusDirectory, item.audio ?? "");
      if (!item.audio || !file.startsWith(corpusDirectory + sep)) throw Error("corpus-audio-path");
      const pcm = wavPCM(await readFile(file)), id = randomUUID(), start = performance.now(), beforeCpu = cpuMs;
      const response = await new Promise((res, rej) => {
        const timeout = setTimeout(() => rej(Error("native-timeout")), 90000);
        pending = { id, resolve: (r) => { clearTimeout(timeout); pending = null; res(r); }, reject: (e) => { clearTimeout(timeout); pending = null; rej(e); } };
        child.stdin.write(JSON.stringify({ id, sessionId: "0".repeat(64), runId: randomUUID(), utteranceId: randomUUID(), action: "stt", pcmBase64: pcm.toString("base64"), sampleRate: 16000, langue: "auto" }) + "\n");
      });
      const latencyMs = performance.now() - start; await sample();
      rows.push({ id: item.id, text: response.ok ? response.texte : "", latencyMs,
        processingMs: response.durationMs ?? null, peakRssBytes: peak || null, cpuMs: cpuMs !== null && beforeCpu !== null ? Math.max(0, cpuMs - beforeCpu) : null,
        refused: !response.ok, engine: response.model ?? null });
    }
    return { schema: 1, engine: "whisper.cpp-base-multilingual", evidenceSource: "local-native-run", hardware: { cpu: cpus()[0]?.model ?? "unknown", ramGiB: totalmem() / 2 ** 30, gpu: "not-used" }, rows };
  } finally { clearInterval(sampling); process.removeListener("SIGINT", stop); child.kill(); }
}
function report(corpus, result, source) {
  if (result.schema !== 1 || typeof result.engine !== "string" || !Array.isArray(result.rows)) throw Error("results-format");
  const rows = new Map(); for (const row of result.rows) {
    if (typeof row.id !== "string" || typeof row.text !== "string" || row.text.length > 8000 || rows.has(row.id)) throw Error("results-format"); rows.set(row.id, row);
  }
  if (rows.size !== corpus.length || corpus.some((c) => !rows.has(c.id))) throw Error("results-coverage");
  const languages = {}, latencies = [], resources = [], processorTimes = []; let controls = 0, silenceHallucinations = 0, medications = 0, correctMedications = 0, names = 0, correctNames = 0;
  for (const item of corpus) {
    const row = rows.get(item.id), ref = normalize(item.reference), hyp = normalize(row.text);
    if (finite(row.latencyMs)) latencies.push(row.latencyMs); if (finite(row.peakRssBytes)) resources.push(row.peakRssBytes);
    if (finite(row.cpuMs)) processorTimes.push(row.cpuMs);
    if (item.kind && item.kind !== "speech") { controls++; if (!ref && hyp) silenceHallucinations++; continue; }
    const metric = languages[item.language] ??= { utterances: 0, wordErrors: 0, referenceWords: 0, characterErrors: 0, referenceCharacters: 0 };
    const rw = ref ? ref.split(" ") : [], hw = hyp ? hyp.split(" ") : [];
    metric.utterances++; metric.wordErrors += distance(rw, hw); metric.referenceWords += rw.length;
    const rc = [...ref.replaceAll(" ", "")], hc = [...hyp.replaceAll(" ", "")];
    metric.characterErrors += distance(rc, hc); metric.referenceCharacters += rc.length;
    for (const name of item.medicationNames ?? []) { medications++; if (` ${hyp} `.includes(` ${normalize(name)} `)) correctMedications++; }
    for (const name of item.patientNames ?? []) { names++; if (` ${hyp} `.includes(` ${normalize(name)} `)) correctNames++; }
  }
  for (const metric of Object.values(languages)) { metric.wer = metric.referenceWords ? metric.wordErrors / metric.referenceWords : null; metric.cer = metric.referenceCharacters ? metric.characterErrors / metric.referenceCharacters : null; }
  const sufficientCorpus = controls >= 60 && ["fr", "ar", "darija", "mixed"].every((l) => (languages[l]?.utterances ?? 0) >= 60);
  const targetHardware = /\bi7[- ]4\d{3}/iu.test(result.hardware?.cpu ?? "") && result.hardware?.ramGiB >= 15.5;
  const failures = [];
  if (!sufficientCorpus) failures.push("insufficient-corpus"); if (!targetHardware) failures.push("doctor-hardware-not-qualified");
  for (const [language, limit] of [["fr", .12], ["ar", .18], ["darija", .25], ["mixed", .25]]) if (languages[language]?.wer === null || languages[language]?.wer === undefined || languages[language].wer > limit) failures.push(`wer-${language}`);
  if (!medications || correctMedications / medications < .98) failures.push("medication-accuracy"); if (!names || correctNames !== names) failures.push("patient-name-accuracy");
  if (silenceHallucinations) failures.push("silence-hallucination");
  if (latencies.length !== corpus.length || p95(latencies) > 2500) failures.push("stt-latency");
  if (resources.length !== corpus.length || Math.max(...resources) > 4 * 2 ** 30) failures.push("voice-memory-not-qualified");
  return { schema: 1, engine: result.engine, evidenceSource: source, hardware: result.hardware ?? null, corpusSha256: createHash("sha256").update(JSON.stringify(corpus)).digest("hex"),
    utterances: corpus.length - controls, controls, languages, medicationAccuracy: medications ? correctMedications / medications : null, patientNameAccuracy: names ? correctNames / names : null,
    silenceHallucinations, sttP95Ms: p95(latencies), nativePeakRssBytes: resources.length ? Math.max(...resources) : null,
    nativeCpuP95Ms: p95(processorTimes), cpuMeasurements: processorTimes.length === corpus.length ? "PASS" : "NOT RUN",
    resourceMeasurements: resources.length === corpus.length ? "PASS" : "NOT RUN", qualification: failures.length ? "FAIL" : "NOT RUN",
    sttQualification: failures.length ? "FAIL" : source === "local-native-run" ? "PASS" : "NOT RUN", failures,
    voiceEndToEnd: "NOT RUN", ttsNaturalness: "NOT RUN", combinedSttTtsMemory: "NOT RUN", partialTranscriptionLatency: "NOT RUN", wrongPatientSelection: "NOT RUN", interruptionLatency: "NOT RUN" };
}
try {
  if (process.argv.includes("--help")) { console.log(help); process.exit(0); }
  if (!options.get("--corpus") || !options.get("--out")) throw Error("arguments-required");
  const path = resolve(options.get("--corpus")), corpus = (await readFile(path, "utf8")).split(/\r?\n/u).filter((l) => l.trim()).map((line) => JSON.parse(line));
  const ids = new Set();
  for (const row of corpus) {
    if (typeof row.id !== "string" || !/^[\w-]{1,80}$/u.test(row.id) || ids.has(row.id) || row.synthetic !== true || !["fr", "ar", "darija", "mixed"].includes(row.language) || typeof row.reference !== "string" || row.reference.length > 8000 || (row.kind && !["speech", "silence", "noise", "ambiguity"].includes(row.kind))) throw Error("corpus-format");
    if ((row.medicationNames && !row.medicationNames.every((n) => typeof n === "string")) || (row.patientNames && !row.patientNames.every((n) => typeof n === "string"))) throw Error("corpus-format");
    ids.add(row.id);
  }
  if (!corpus.length || corpus.length > 5000) throw Error("corpus-size");
  const supplied = options.get("--results");
  const results = supplied ? JSON.parse(await readFile(resolve(supplied), "utf8")) : await nativeResults(corpus, dirname(path), resolve(options.get("--runtime") ?? "resources/voix"));
  const evaluation = report(corpus, results, supplied ? "supplied-transcripts" : "local-native-run");
  await writeFile(resolve(options.get("--out")), JSON.stringify(evaluation, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ qualification: evaluation.qualification, sttQualification: evaluation.sttQualification, corpus: evaluation.utterances + evaluation.controls, voiceEndToEnd: "NOT RUN" }));
} catch (cause) {
  console.error(JSON.stringify({ status: "FAIL", code: cause instanceof Error && /^[a-z-]+$/u.test(cause.message) ? cause.message : "benchmark-unavailable" })); process.exitCode = 2;
}
