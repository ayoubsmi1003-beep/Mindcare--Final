/**
 * `mesure-voix-locale` — measures the REAL local voice engines, no microphone.
 *
 *   node scripts/mesure-voix-locale.mjs            (uses resources/voix, or ALEXA_VOICE_* paths)
 *   node scripts/mesure-voix-locale.mjs --reveil   (wake word only: positives and confusable negatives)
 *
 * Fixtures are SYNTHESIZED here, at run time, into the system temp folder —
 * never into the repository (preflight rule 3: no audio on disk in the repo).
 * Two synthetic French speakers: Kokoro `ff_siwis` (the app's own voice) and
 * Windows SAPI "Hortense" when installed, plain and with additive noise.
 * Ground truth is the source text. No patient data is spoken.
 *
 * ⚠️ Synthetic speech proves the CHAIN and gives comparable latencies. It does
 * NOT measure accuracy on the doctor's voice, room acoustics or the real
 * false-wake rate. Those need a microphone (see ALEXA_RUNBOOK.md).
 *
 * Measured: Whisper final text (latency, WER), Vosk live partials (time to the
 * first words, per-chunk latency), wake word (positives / negatives), Kokoro
 * (time to first sentence audio, WAV validity). Output: artifacts/voix-mesures.json.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { availableParallelism, cpus, tmpdir, totalmem } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const VOIX = process.env.ALEXA_VOICE_ROOT ?? join(ROOT, "resources", "voix");
const ASSETS = process.env.ALEXA_VOICE_ASSETS ?? join(VOIX, "assets");
const PYTHON = process.env.ALEXA_VOICE_PYTHON ?? join(VOIX, "python", "python.exe");
const PACKAGES = process.env.ALEXA_VOICE_PACKAGES ?? join(VOIX, "packages");
const TMP = join(tmpdir(), "mindcare-voix-mesures");
const REVEIL_SEUL = process.argv.includes("--reveil");

/** Spoken by the synthetic speakers. Clinical-sounding, no patient data. */
const PHRASES = [
  { id: "rdv-demain", texte: "Quels sont les rendez-vous de demain ?" },
  { id: "patients-jour", texte: "Combien de patients aujourd'hui ?" },
  { id: "suivi-doses", texte: "Et les doses ?" },
  { id: "traitement", texte: "Quels sont les médicaments actuels de ce patient ?" },
  { id: "derniers-rdv", texte: "Je voudrais connaître les derniers rendez-vous de demain." },
  { id: "prescription", texte: "Prescrire sertraline cinquante milligrammes le matin pendant trois mois." },
  { id: "deux-temps", texte: "Affiche l'agenda de la semaine prochaine. Puis les paiements en attente." },
];
const REVEIL = [
  { id: "alexa", texte: "Alexa", attendu: true },
  { id: "alexa-phrase", texte: "Alexa.", attendu: true },
  { id: "alexandre", texte: "Alexandre", attendu: false },
  { id: "caisse", texte: "À la caisse", attendu: false },
  { id: "taxe", texte: "La taxe", attendu: false },
  { id: "bonjour", texte: "Bonjour docteur, comment allez-vous ?", attendu: false },
  { id: "alexis", texte: "Alexis", attendu: false },
  { id: "alexandra", texte: "Alexandra", attendu: false },
  { id: "dose", texte: "Le patient a pris sa dose", attendu: false },
  { id: "exces", texte: "À l'excès", attendu: false },
  { id: "alexa-commande", texte: "Alexa, quel est le prochain patient ?", attendu: true },
];

// ── workers ──────────────────────────────────────────────────────────────
function worker(script, env) {
  const p = spawn(PYTHON, ["-I", "-B", "-u", join(VOIX, script), PACKAGES, ASSETS], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true, env: { ...process.env, ...env } });
  let buf = "";
  const attente = new Map();
  let pret;
  const ready = new Promise((r, j) => { pret = { r, j }; });
  p.on("exit", (code) => { pret.j(new Error(`${script} exit ${code}`)); for (const a of attente.values()) a.j(new Error("exit")); });
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0;) {
      const l = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (l.ready === true || l.id === "ready") { pret.r(); continue; }
      if (l.ready === false) { pret.j(new Error(l.error ?? "ready")); continue; }
      const a = attente.get(l.id); attente.delete(l.id); a?.r(l);
    }
  });
  return {
    ready,
    ask(o) {
      const id = o.id ?? crypto.randomUUID();
      return new Promise((r, j) => { attente.set(id, { r, j }); p.stdin.write(JSON.stringify({ ...o, id }) + "\n"); });
    },
    stop() { p.kill(); },
  };
}
const scope = () => ({ sessionId: "a".repeat(64), runId: crypto.randomUUID(), utteranceId: crypto.randomUUID() });

// ── audio helpers (16 kHz mono PCM16 everywhere) ─────────────────────────
function wavPcm(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV");
  let o = 12, rate = 0, data = null;
  while (o + 8 <= buf.length) {
    const id = buf.toString("ascii", o, o + 4), n = buf.readUInt32LE(o + 4);
    if (id === "fmt ") rate = buf.readUInt32LE(o + 12);
    if (id === "data") data = buf.subarray(o + 8, o + 8 + n);
    o += 8 + n + (n % 2);
  }
  const s = new Float32Array(data.length / 2);
  for (let i = 0; i < s.length; i++) s[i] = data.readInt16LE(i * 2) / 32768;
  return { samples: s, rate };
}
function to16k({ samples, rate }) {
  if (rate === 16000) return samples;
  // Box low-pass over one source period, then linear interpolation.
  const ratio = rate / 16000, out = new Float32Array(Math.floor(samples.length / ratio)), w = Math.max(1, Math.round(ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio, k = Math.floor(x); let acc = 0, n = 0;
    for (let j = k - Math.floor(w / 2); j <= k + Math.floor(w / 2); j++) if (j >= 0 && j < samples.length) { acc += samples[j]; n++; }
    out[i] = n ? acc / n : 0;
  }
  return out;
}
function pcm16(samples) {
  const b = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  return b;
}
/** Deterministic white noise at the given SNR (dB) — seeded, reproducible. */
function bruit(samples, snrDb, seed = 7) {
  let x = seed; const rnd = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff * 2 - 1; };
  const p = samples.reduce((n, v) => n + v * v, 0) / samples.length, a = Math.sqrt(p / 10 ** (snrDb / 10) * 3);
  return samples.map((v) => v + rnd() * a);
}
/** Half a second of silence each side: a real utterance never starts on the first sample. */
const encadrer = (s) => { const z = new Float32Array(8000); const o = new Float32Array(s.length + 16000); o.set(z); o.set(s, 8000); return o; };

// ── speakers ─────────────────────────────────────────────────────────────
async function voixKokoro(tts, texte) {
  const r = await tts.ask({ ...scope(), action: "tts", texte, langue: "fr" });
  if (!r.ok) throw new Error(`kokoro ${r.code}`);
  return to16k(wavPcm(Buffer.from(r.audioBase64, "base64")));
}
function voixSapi(texte, nom, debit) {
  if (process.platform !== "win32") return null;
  mkdirSync(TMP, { recursive: true });
  const f = join(TMP, `sapi-${nom}.wav`);
  const echappe = texte.replace(/'/g, "''");
  try {
    execFileSync("powershell", ["-NoProfile", "-Command",
      `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
      `$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'fr-FR' } | Select-Object -First 1; if (-not $v) { exit 3 }; ` +
      `$s.SelectVoice($v.VoiceInfo.Name); $s.Rate = ${debit}; ` +
      `$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono); ` +
      `$s.SetOutputToWaveFile('${f}', $fmt); $s.Speak('${echappe}'); $s.Dispose()`], { stdio: "ignore", timeout: 60_000 });
    const s = to16k(wavPcm(readFileSync(f))); rmSync(f, { force: true }); return s;
  } catch { return null; }
}

// ── scoring ──────────────────────────────────────────────────────────────
const mots = (s) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/'/g, " ").split(/\s+/).filter(Boolean);
function wer(ref, hyp) {
  const r = mots(ref), h = mots(hyp), d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return r.length ? d[r.length][h.length] / r.length : 0;
}
const stats = (v) => { const s = [...v].sort((a, b) => a - b), q = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); return s.length ? { n: s.length, p50: q(0.5), p95: q(0.95), max: Math.round(s.at(-1)) } : null; };

// ── run ──────────────────────────────────────────────────────────────────
const threads = String(Math.max(2, Math.min(8, Math.floor(availableParallelism() / 2))));
const base = { OMP_NUM_THREADS: threads, ALEXA_STT_THREADS: threads, ALEXA_VOICE_HEALTH: "1", ALEXA_TTS_VOICE: "ff_siwis", ALEXA_TTS_LANG: "fr-fr" };
const t0 = performance.now();
const tts = worker("native-voice-worker.py", { ...base, ALEXA_VOICE_ROLE: "tts" });
const stt = worker("native-voice-worker.py", { ...base, ALEXA_VOICE_ROLE: "stt" });
const vosk = worker("wake-voice-worker.py", { OMP_NUM_THREADS: "1", ALEXA_WAKE_MODEL: "vosk-model-small-fr-0.22" });
const chargement = {};
await Promise.all([["tts", tts], ["stt", stt], ["vosk", vosk]].map(async ([n, w]) => { await w.ready; chargement[n] = Math.round(performance.now() - t0); }));
console.log(`models ready (ms): ${JSON.stringify(chargement)} · whisper threads ${threads}`);

// Kokoro: time to first sentence audio, as the speech queue experiences it.
const kokoro = [];
if (!REVEIL_SEUL) for (const texte of ["Vous avez trois rendez-vous demain.", "Le patient prend actuellement de la sertraline, cinquante milligrammes le matin, depuis trois mois."]) {
  for (let i = 0; i < 3; i++) {
    const s = performance.now();
    const r = await tts.ask({ ...scope(), action: "tts", texte, langue: "fr" });
    const wav = Buffer.from(r.audioBase64 ?? "", "base64");
    const valide = r.ok && wav.toString("ascii", 0, 4) === "RIFF" && wav.length > 44 && r.sampleRate === 24000;
    kokoro.push({ caracteres: texte.length, ms: performance.now() - s, valide, secondesAudio: valide ? (wav.length - 44) / 2 / 24000 : 0 });
  }
}
const invalide = await tts.ask({ ...scope(), action: "tts", texte: "مرحبا", langue: "ar" });

// Corpus.
const corpus = [];
for (const p of [...(REVEIL_SEUL ? [] : PHRASES), ...REVEIL]) {
  const k = await voixKokoro(tts, p.texte);
  corpus.push({ ...p, locuteur: "kokoro", samples: encadrer(k) });
  corpus.push({ ...p, locuteur: "kokoro+bruit20dB", samples: encadrer(bruit(k, 20)) });
  for (const [nom, debit] of [["sapi", 0], ["sapi-lent", -3], ["sapi-rapide", 3]]) {
    const s = voixSapi(p.texte, `${p.id}-${nom}`, debit);
    if (s) corpus.push({ ...p, locuteur: nom, samples: encadrer(s) });
  }
}
console.log(`fixtures: ${corpus.length} (speakers: ${[...new Set(corpus.map((c) => c.locuteur))].join(", ")})`);

// Whisper final + Vosk live partials on the questions.
const lignes = [];
for (const c of corpus.filter((c) => !REVEIL.some((r) => r.id === c.id))) {
  const pcm = pcm16(c.samples);
  const s = performance.now();
  const r = await stt.ask({ ...scope(), action: "stt", pcmBase64: pcm.toString("base64"), sampleRate: 16000, langue: "fr" });
  const msFinal = performance.now() - s;
  await vosk.ask({ action: "partial-reset" });
  let premier = null, dernier = "", morceaux = [];
  for (let o = 0; o < pcm.length; o += 6400) {
    const m = performance.now();
    const v = await vosk.ask({ action: "partial", pcmBase64: pcm.subarray(o, o + 6400).toString("base64") });
    morceaux.push(performance.now() - m);
    if (v.texte && premier === null) premier = (o + 6400) / 32000;
    if (v.texte) dernier = v.texte;
  }
  lignes.push({ id: c.id, locuteur: c.locuteur, secondes: +(c.samples.length / 16000).toFixed(2), msFinal, werWhisper: r.ok ? wer(c.texte, r.texte) : 1, whisper: r.ok ? r.texte : `ERREUR ${r.code}`,
    premierPartielAudioS: premier, msMorceau: morceaux, werVosk: wer(c.texte, dernier) });
  console.log(`${c.locuteur.padEnd(17)} ${c.id.padEnd(14)} whisper ${Math.round(msFinal)} ms WER ${(lignes.at(-1).werWhisper * 100).toFixed(0)}% · vosk WER ${(lignes.at(-1).werVosk * 100).toFixed(0)}% · 1ers mots à ${premier ?? "-"} s`);
}

// Silence must yield nothing.
const silence = await stt.ask({ ...scope(), action: "stt", pcmBase64: pcm16(new Float32Array(32000)).toString("base64"), sampleRate: 16000, langue: "fr" });

// Wake word: 500 ms chunks, as the standby spotter receives them.
const reveil = [];
for (const c of corpus.filter((c) => REVEIL.some((r) => r.id === c.id))) {
  await vosk.ask({ action: "reset" });
  await new Promise((r) => setTimeout(r, 2100)); // refractory window between cases
  const pcm = pcm16(c.samples); let detecte = false;
  for (let o = 0; o < pcm.length && !detecte; o += 16000) detecte = (await vosk.ask({ action: "audio", pcmBase64: pcm.subarray(o, o + 16000).toString("base64") })).detected === true;
  reveil.push({ id: c.id, locuteur: c.locuteur, attendu: c.attendu, detecte });
}

tts.stop(); stt.stop(); vosk.stop();

const q = lignes.filter((l) => l.locuteur.startsWith("kokoro") || l.locuteur.startsWith("sapi"));
const rapport = {
  date: new Date().toISOString(),
  machine: { cpu: cpus()[0]?.model, logiques: availableParallelism(), ramGo: +(totalmem() / 2 ** 30).toFixed(1), whisperThreads: +threads },
  avertissement: "Synthetic speakers only (Kokoro ff_siwis, Windows SAPI fr-FR). Proves the chain and latency on this machine; not human-voice accuracy, not room acoustics, not the doctor's i7.",
  chargementMs: chargement,
  whisperFinalMs: stats(q.map((l) => l.msFinal)),
  whisperWer: { moyen: +(q.reduce((n, l) => n + l.werWhisper, 0) / q.length).toFixed(3), parLocuteur: Object.fromEntries([...new Set(q.map((l) => l.locuteur))].map((k) => [k, +(q.filter((l) => l.locuteur === k).reduce((n, l) => n + l.werWhisper, 0) / q.filter((l) => l.locuteur === k).length).toFixed(3)])) },
  voskPartielParMorceau200msMs: stats(q.flatMap((l) => l.msMorceau)),
  voskPremiersMotsSecondesAudio: stats(q.filter((l) => l.premierPartielAudioS !== null).map((l) => l.premierPartielAudioS * 1000)),
  voskWerApercu: +(q.reduce((n, l) => n + l.werVosk, 0) / q.length).toFixed(3),
  kokoroPhraseMs: stats(kokoro.map((k) => k.ms)),
  kokoroWavValides: kokoro.every((k) => k.valide),
  kokoroArabeRefuse: invalide.ok === false ? invalide.code : "ACCEPTE",
  silenceRefusee: silence.ok === false ? silence.code : `TRANSCRIT: ${silence.texte}`,
  reveil: { positifs: reveil.filter((r) => r.attendu).map((r) => `${r.locuteur}/${r.id}:${r.detecte}`), fauxPositifs: reveil.filter((r) => !r.attendu && r.detecte).map((r) => `${r.locuteur}/${r.id}`),
    rappel: +(reveil.filter((r) => r.attendu && r.detecte).length / Math.max(1, reveil.filter((r) => r.attendu).length)).toFixed(3) },
  lignes: lignes.map(({ msMorceau, ...l }) => ({ ...l, msFinal: Math.round(l.msFinal) })),
};
mkdirSync(join(ROOT, "artifacts"), { recursive: true });
writeFileSync(join(ROOT, "artifacts", REVEIL_SEUL ? "voix-reveil-mesures.json" : "voix-mesures.json"),
  JSON.stringify(REVEIL_SEUL ? { date: rapport.date, machine: rapport.machine, reveil: rapport.reveil } : rapport, null, 2) + "\n");
console.log(JSON.stringify(REVEIL_SEUL ? { reveil: rapport.reveil } : { ...rapport, lignes: undefined }, null, 2));
if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
