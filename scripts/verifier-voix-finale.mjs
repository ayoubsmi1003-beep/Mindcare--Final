#!/usr/bin/env node
/**
 * One-command proof of the local French voice stack — no microphone needed.
 *
 * It runs, in order:
 *   1. `node scripts/preparer-voix-native.mjs --check`   (bundle, offline)
 *   2. `node scripts/verifier-voix-locale.mjs --json`    (bundle, offline)
 *   3. the real faster-whisper/Kokoro integration test
 *   4. the real Vosk wake test (five reset cycles, variants, Bonjour negative,
 *      malformed-JSON survival)
 *
 * Every child receives an explicitly synthetic, unreachable database URL and
 * the tests only call the local voice runtime: this command never opens,
 * migrates or writes the cabinet database.
 *
 * `artifacts/` is git-ignored. The JSON report is evidence for the tree, HEAD
 * and instant it was produced; it is never a deliverable.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACTS = join(ROOT, "artifacts");
const RAPPORT = join(ARTIFACTS, "voix-finale.json");
const PREUVE_REVEIL = join(ARTIFACTS, "voix-reveil.json");
const VITEST = join(ROOT, "node_modules", "vitest", "vitest.mjs");
const ROOT_VOIX = join(ROOT, "resources", "voix");

const STT = "faster-whisper-small-int8";
const TTS = "kokoro-82m-v1.0-ff_siwis";
const WAKE = "vosk-fr-FR-small";
const REPEAT_CYCLES = 5;
const DB_SYNTHETIQUE = "postgresql://synthetic:unused@127.0.0.1:1/synthetic";

const env = {
  ...process.env,
  MINDCARE_VOICE_REAL: "1",
  MINDCARE_DATABASE_URL: DB_SYNTHETIQUE,
  MINDCARE_TEST_DATABASE_URL: DB_SYNTHETIQUE,
  MINDCARE_PACKAGED: "0",
  ALEXA_VOICE_ROOT: ROOT_VOIX,
  ALEXA_VOICE_ASSETS: join(ROOT_VOIX, "assets"),
  ALEXA_VOICE_PYTHON: join(ROOT_VOIX, "python", "python.exe"),
  ALEXA_VOICE_PACKAGES: join(ROOT_VOIX, "packages"),
  ALEXA_VOICE_WORKER: join(ROOT_VOIX, "native-voice-worker.py"),
  ALEXA_WAKE_WORKER: join(ROOT_VOIX, "wake-voice-worker.py"),
  ALEXA_LOCAL_VOICE: "true",
  ALEXA_VOICE_HEALTH: "1",
};
delete env.ALEXA_VOICE_WORKER_DIR;
delete env.ALEXA_WAKE_WORKER_DIR;

const commandes = [];
/** Every child that may still be running, so an unexpected failure can reap it. */
const enfantsActifs = new Set();

/** Resolve true when the child actually exited, false after the bounded wait. */
function attendreExit(enfant, delaiMs = 5_000) {
  if (enfant.exitCode !== null || enfant.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveAttente) => {
    let fini = false;
    const terminer = (sorti) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      enfant.off("close", surClose);
      enfant.off("exit", surExit);
      resolveAttente(sorti);
    };
    const surClose = () => terminer(true);
    const surExit = () => terminer(true);
    const minuteur = setTimeout(() => terminer(false), delaiMs);
    enfant.once("close", surClose);
    enfant.once("exit", surExit);
    if (enfant.exitCode !== null || enfant.signalCode !== null) terminer(true);
  });
}

/**
 * Kill a child and its descendants, then wait (bounded) for the direct child
 * to exit. `taskkill /T /F` is the only reliable tree kill on Windows; a plain
 * `child.kill()` leaves Vitest forks and the resident Python worker behind.
 */
async function tuerArbre(pid, enfant) {
  if (pid === undefined) return false;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // The process may already be gone between the timeout and the kill.
  }
  if (enfant === undefined) return true;
  return attendreExit(enfant, 5_000);
}


function sansAnsi(texte) {
  return texte.replace(/\u001b\[[0-9;]*m/gu, "");
}

function queue(texte, lignes = 40) {
  const propre = sansAnsi(texte).trimEnd();
  if (propre === "") return "";
  return propre.split(/\r?\n/u).slice(-lignes).join("\n");
}

function compterTests(sortie) {
  const texte = sansAnsi(sortie);
  const passe = /Tests\s+(\d+) passed/u.exec(texte);
  const echoue = /Tests\s+(\d+) failed/u.exec(texte);
  return {
    passed: passe === null ? 0 : Number(passe[1]),
    failed: echoue === null ? 0 : Number(echoue[1]),
  };
}

/** Spawn one child, stream its output to the console, keep the full capture. */
function executer(nom, args, timeoutMs = 0) {
  const debut = Date.now();
  console.log(`\n[voix] ${nom}`);
  console.log(`       node ${args.join(" ")}`);
  return new Promise((resolveExecution) => {
    let stdout = "";
    let stderr = "";
    let termine = false;
    let delaiDepasse = false;
    let minuteur;
    const terminer = (resultat) => {
      if (termine) return;
      termine = true;
      resolveExecution(resultat);
    };
    const base = () => ({
      nom,
      command: `node ${args.join(" ")}`,
      durationMs: Date.now() - debut,
      stdout,
      stderr,
    });
    const enfant = spawn(process.execPath, args, {
      cwd: ROOT,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    enfantsActifs.add(enfant);
    const oublier = () => enfantsActifs.delete(enfant);
    if (timeoutMs > 0) {
      minuteur = setTimeout(() => {
        delaiDepasse = true;
        stderr += `\n[voix] délai dépassé (${timeoutMs} ms) : arbre de processus arrêté\n`;
        void (async () => {
          await tuerArbre(enfant.pid, enfant);
          if (termine) return;
          oublier();
          terminer({
            ...base(),
            ok: false,
            exitCode: enfant.exitCode,
            signal: enfant.signalCode,
            timeout: true,
            error: "timeout",
          });
        })();
      }, timeoutMs);
    }
    enfant.stdout.setEncoding("utf8");
    enfant.stderr.setEncoding("utf8");
    enfant.stdout.on("data", (fragment) => {
      stdout += fragment;
      process.stdout.write(fragment);
    });
    enfant.stderr.on("data", (fragment) => {
      stderr += fragment;
      process.stderr.write(fragment);
    });
    enfant.on("error", (cause) => {
      if (minuteur !== undefined) clearTimeout(minuteur);
      oublier();
      terminer({
        ...base(),
        ok: false,
        exitCode: null,
        error: delaiDepasse ? "timeout" : cause.message,
        timeout: delaiDepasse,
      });
    });
    enfant.on("close", (code, signal) => {
      if (minuteur !== undefined) clearTimeout(minuteur);
      oublier();
      terminer({
        ...base(),
        ok: !delaiDepasse && code === 0,
        exitCode: code,
        signal,
        ...(delaiDepasse ? { timeout: true, error: "timeout" } : {}),
      });
    });
  });
}

function resultatCommande(resultat, tests = null) {
  const entree = {
    name: resultat.nom,
    command: resultat.command,
    ok: resultat.ok,
    exitCode: resultat.exitCode,
    durationMs: resultat.durationMs,
  };
  if (resultat.signal !== undefined) entree.signal = resultat.signal;
  if (resultat.error !== undefined) entree.error = resultat.error;
  if (tests !== null) entree.tests = tests;
  if (!resultat.ok) {
    entree.stdoutTail = queue(resultat.stdout);
    entree.stderrTail = queue(resultat.stderr);
  }
  commandes.push(entree);
  return entree;
}

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true });
  rmSync(RAPPORT, { force: true });
  rmSync(PREUVE_REVEIL, { force: true });

  let bundleOk = false;
  let verificateurOk = false;
  let verificateurJson = null;
  let voixOk = false;
  let reveilOk = false;
  let preuveReveil = null;
  let motif = "";

  const bundle = await executer("bundle voix (offline)", ["scripts/preparer-voix-native.mjs", "--check"], 180_000);
  bundleOk = bundle.ok;
  resultatCommande(bundle);
  if (!bundleOk) motif ||= "preparer-voix-native --check a échoué";

  const verificateur = await executer(
    "vérificateur de la voix locale",
    ["scripts/verifier-voix-locale.mjs", "--json"],
    180_000,
  );
  try {
    verificateurJson = JSON.parse(verificateur.stdout);
  } catch {
    verificateurJson = null;
  }
  // The command entry must reflect the JSON verdict, not only the exit code:
  // a verifier that prints {"ok":false} and exits 0 is still a failed proof.
  verificateur.ok = verificateur.exitCode === 0 && verificateurJson?.ok === true;
  verificateurOk = verificateur.ok;
  resultatCommande(verificateur);
  if (!verificateurOk) motif ||= "verifier-voix-locale --json a échoué";

  if (!existsSync(VITEST)) {
    motif ||= `vitest absent : ${VITEST}`;
  } else {
    const voix = await executer(
      "STT / TTS / silence / redémarrage (vrai worker)",
      ["node_modules/vitest/vitest.mjs", "run", "tests/integration/alexa-voice-final.test.ts", "--pool=threads"],
      600_000,
    );
    const testsVoix = compterTests(voix.stdout);
    voixOk = voix.ok && testsVoix.failed === 0 && testsVoix.passed >= 1;
    resultatCommande(voix, testsVoix);
    if (!voixOk) motif ||= "alexa-voice-final.test.ts a échoué";

    const reveil = await executer(
      "réveil Vosk, 5 cycles, variantes, négatif, JSON invalide (vrai worker)",
      ["node_modules/vitest/vitest.mjs", "run", "tests/integration/alexa-wake-real.test.ts"],
      240_000,
    );
    const testsReveil = compterTests(reveil.stdout);
    reveilOk = reveil.ok && testsReveil.failed === 0 && testsReveil.passed >= 3;
    resultatCommande(reveil, testsReveil);
    if (!reveilOk) motif ||= "alexa-wake-real.test.ts a échoué";

    // The wake test writes this file only after the five detections, both
    // variants, the Bonjour negative and the malformed-JSON survival passed.
    if (existsSync(PREUVE_REVEIL)) {
      try {
        preuveReveil = JSON.parse(readFileSync(PREUVE_REVEIL, "utf8"));
      } catch {
        preuveReveil = null;
      }
    }
    const preuveValide =
      preuveReveil !== null &&
      preuveReveil.wake === WAKE &&
      preuveReveil.repeatCycles === REPEAT_CYCLES &&
      Array.isArray(preuveReveil.chunks) &&
      preuveReveil.chunks.length === REPEAT_CYCLES &&
      Array.isArray(preuveReveil.variants) &&
      preuveReveil.variants.length === 2 &&
      preuveReveil.bonjourDetected === false &&
      preuveReveil.malformedJsonSurvived === true;
    if (!preuveValide) {
      reveilOk = false;
      motif ||= "preuve de réveil absente ou incomplète (artifacts/voix-reveil.json)";
    }
  }

  const verdict = bundleOk && verificateurOk && voixOk && reveilOk ? "PASS" : "FAIL";
  const repeatCycles = preuveReveil?.repeatCycles ?? 0;
  const rapport = {
    verdict,
    generatedAt: new Date().toISOString(),
    stt: STT,
    tts: TTS,
    wake: WAKE,
    repeatCycles,
    repeatChunks: preuveReveil?.chunks ?? [],
    wakeVariants: preuveReveil?.variants ?? [],
    bonjourDetected: preuveReveil?.bonjourDetected ?? null,
    malformedJsonSurvived: preuveReveil?.malformedJsonSurvived ?? null,
    database: "non contactée (MINDCARE_DATABASE_URL synthétique et injoignable)",
    bundle: verificateurJson,
    commands: commandes,
  };
  if (verdict === "FAIL") rapport.failure = motif || "échec non identifié";
  writeFileSync(RAPPORT, `${JSON.stringify(rapport, null, 2)}\n`);

  console.log(`\n[voix] rapport : artifacts/voix-finale.json`);
  console.log(
    `[voix] ${JSON.stringify({ verdict, stt: STT, tts: TTS, wake: WAKE, repeatCycles })}`,
  );
  console.log(`VERDICT VOIX FINALE : ${verdict}`);
  process.exitCode = verdict === "PASS" ? 0 : 1;
}

try {
  await main();
} catch (cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  console.error(`\n[voix] erreur inattendue : ${message}`);
  // Never leave a Vitest fork or the resident Python worker behind when the
  // orchestration itself fails outside a command's own timeout path.
  for (const enfant of [...enfantsActifs]) {
    await tuerArbre(enfant.pid, enfant);
    enfantsActifs.delete(enfant);
  }
  try {
    mkdirSync(ARTIFACTS, { recursive: true });
    writeFileSync(
      RAPPORT,
      `${JSON.stringify(
        {
          verdict: "FAIL",
          generatedAt: new Date().toISOString(),
          stt: STT,
          tts: TTS,
          wake: WAKE,
          repeatCycles: 0,
          failure: message,
          commands: commandes,
        },
        null,
        2,
      )}\n`,
    );
  } catch {
    // The verdict below is still the honest result; the report is best effort.
  }
  console.log(`VERDICT VOIX FINALE : FAIL`);
  process.exitCode = 1;
}
