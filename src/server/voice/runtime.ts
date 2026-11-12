import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { availableParallelism } from "node:os";
import { isAbsolute, join } from "node:path";

import { env } from "@/server/env";
import { resoudreCheminsVoix } from "./chemins";
import { MODELES_VOIX, verifierDossierModele, verifierFichierModele } from "./modeles";
import { CanalVoixNative, type EntreeVoix, type ReponseVoix } from "./protocole";

// The first load after install scans and maps 486 MB of model files; on a cold
// Windows cache that exceeded two minutes, while warm starts take 15-40 s.
const READY_TIMEOUT_MS = 180_000;
const STT_TIMEOUT_MS = 60_000;
const TTS_TIMEOUT_MS = 120_000;

/**
 * Whisper threads. Kokoro runs in its own process at the same time (prefetch,
 * barge-in), so Whisper takes half the logical cores, never fewer than 2.
 * Measured in ALEXA_STT_BENCHMARK.md.
 */
export function threadsWhisper(coeurs = availableParallelism()): number {
  return Math.max(2, Math.min(8, Math.floor(coeurs / 2)));
}

/** STT and TTS live in two processes: neither blocks the other. */
export type RoleVoix = "stt" | "tts";
const ROLES: readonly RoleVoix[] = ["stt", "tts"];

interface Travailleur {
  readonly processus: ChildProcessWithoutNullStreams;
  readonly canal: CanalVoixNative;
  readonly sessionId: string;
  readonly pret: Promise<void>;
}

interface EtatRole {
  courant: Travailleur | null;
  etat: "stopped" | "starting" | "ready" | "busy" | "error";
  dernierErreur: string | null;
}

interface EtatVoix {
  roles: Record<RoleVoix, EtatRole>;
  verification: Promise<void> | null;
  generation: number;
}

const nouveauRole = (): EtatRole => ({ courant: null, etat: "stopped", dernierErreur: null });
const globalVoix = globalThis as typeof globalThis & { __mindcareVoiceRuntimes?: EtatVoix };
const etat: EtatVoix = (globalVoix.__mindcareVoiceRuntimes ??= {
  roles: { stt: nouveauRole(), tts: nouveauRole() },
  verification: null,
  generation: 0,
});

function chemins() {
  return resoudreCheminsVoix({ cwd: process.cwd(), env: process.env });
}

async function verifierModeles(): Promise<void> {
  const c = chemins();
  if (!isAbsolute(c.assets) || !isAbsolute(c.python) || !isAbsolute(c.packages)) {
    throw new Error("configuration: chemins");
  }
  await verifierDossierModele(join(c.assets, MODELES_VOIX.stt.dir), MODELES_VOIX.stt);
  await verifierFichierModele(join(c.assets, MODELES_VOIX.ttsModel.file), MODELES_VOIX.ttsModel);
  await verifierFichierModele(join(c.assets, MODELES_VOIX.ttsVoices.file), MODELES_VOIX.ttsVoices);
}

function detruire(role: RoleVoix): void {
  const r = etat.roles[role];
  const courant = r.courant;
  r.courant = null;
  r.etat = "stopped";
  if (courant !== null) {
    courant.canal.echouer();
    courant.processus.kill();
  }
}

function ouvrir(role: RoleVoix, sessionId: string): Travailleur {
  const c = chemins();
  const r = etat.roles[role];
  if (env().ALEXA_LOCAL_VOICE === "false") throw new Error("configuration: voix-locale");
  if (r.courant !== null && r.courant.sessionId !== sessionId) detruire(role);
  if (r.courant !== null && !r.courant.processus.killed) return r.courant;

  r.etat = "starting";
  r.dernierErreur = null;
  const threads = String(threadsWhisper());
  const processus = spawn(c.python, ["-I", "-B", "-u", c.worker, c.packages, c.assets], {
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      NODE_ENV: "production",
      SystemRoot: process.env["SystemRoot"] ?? "",
      WINDIR: process.env["WINDIR"] ?? "",
      PATH: process.env["PATH"] ?? "",
      TEMP: process.env["TEMP"] ?? "",
      TMP: process.env["TMP"] ?? "",
      USERPROFILE: process.env["USERPROFILE"] ?? "",
      OMP_NUM_THREADS: threads,
      ALEXA_VOICE_ROLE: role,
      ALEXA_STT_THREADS: threads,
      ALEXA_VOICE_STT_MODEL: join(c.assets, MODELES_VOIX.stt.dir),
      ALEXA_KOKORO_MODEL: join(c.assets, MODELES_VOIX.ttsModel.file),
      ALEXA_KOKORO_VOICES: join(c.assets, MODELES_VOIX.ttsVoices.file),
      ALEXA_TTS_VOICE: "ff_siwis",
      ALEXA_TTS_LANG: "fr-fr",
      ALEXA_VOICE_HEALTH: process.env["ALEXA_VOICE_HEALTH"] ?? "1",
    },
  });

  const canal = new CanalVoixNative(
    (ligne) => {
      processus.stdin.write(ligne);
    },
    () => {
      if (r.courant?.processus === processus) detruire(role);
      processus.kill();
    },
  );

  let resolvePret!: () => void;
  let rejectPret!: (error: Error) => void;
  const pret = new Promise<void>((resolve, reject) => {
    resolvePret = resolve;
    rejectPret = reject;
  });
  // Prevent an unhandled rejection if the caller aborts before awaiting.
  pret.catch(() => {});

  let buffer = "";
  processus.stdout.setEncoding("utf8");
  processus.stdout.on("data", (fragment: string) => {
    buffer += fragment;
    if (buffer.length > 8_100_000) {
      rejectPret(new Error("runtime"));
      detruire(role);
      return;
    }
    for (;;) {
      const index = buffer.indexOf("\n");
      if (index < 0) break;
      const ligne = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      try {
        const valeur = JSON.parse(ligne) as { ready?: unknown; error?: unknown };
        if (valeur.ready === true) {
          r.etat = "ready";
          resolvePret();
          continue;
        }
        if (valeur.ready === false) {
          const code = typeof valeur.error === "string" ? valeur.error : "health";
          r.dernierErreur = code;
          r.etat = "error";
          rejectPret(new Error(code === "health" ? "configuration: sante" : "configuration: modele"));
          detruire(role);
          continue;
        }
        canal.recevoir(valeur);
      } catch {
        rejectPret(new Error("runtime"));
        detruire(role);
      }
    }
  });
  processus.stderr.resume(); // No transcripts or patient audio are logged.
  processus.on("error", () => {
    r.dernierErreur = "runtime";
    r.etat = "error";
    rejectPret(new Error("runtime"));
    detruire(role);
  });
  processus.on("exit", () => {
    if (r.courant?.processus === processus) {
      r.etat = "stopped";
      r.courant = null;
    }
    rejectPret(new Error("runtime"));
    canal.echouer();
  });

  const travailleur: Travailleur = { processus, canal, sessionId, pret };
  r.courant = travailleur;
  return travailleur;
}

async function attendrePret(role: RoleVoix, travailleur: Travailleur, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error("annulee");
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const abandon = new Promise<never>((_, reject) => {
    minuteur = setTimeout(() => reject(new Error("timeout")), READY_TIMEOUT_MS);
    minuteur.unref?.();
    signal?.addEventListener("abort", () => reject(new Error("annulee")), { once: true });
  });
  try {
    await Promise.race([travailleur.pret, abandon]);
  } catch (cause) {
    // A caller giving up while the model loads must not throw the load away:
    // only a real failure or the ready deadline destroys the worker.
    if (!(cause instanceof Error && cause.message === "annulee")) detruire(role);
    throw cause;
  } finally {
    if (minuteur !== undefined) clearTimeout(minuteur);
  }
}

async function preparerRole(role: RoleVoix, sessionId: string, signal?: AbortSignal): Promise<Travailleur> {
  if (env().ALEXA_LOCAL_VOICE === "false" || signal?.aborted) throw new Error("configuration: voix-locale");
  if (!/^[a-f0-9]{64}$/u.test(sessionId)) throw new Error("configuration: session");
  const epoch = etat.generation;
  etat.verification ??= verifierModeles().catch((cause: unknown) => {
    etat.verification = null;
    throw cause;
  });
  await etat.verification;
  if (signal?.aborted || epoch !== etat.generation) throw new Error("annulee");
  const travailleur = ouvrir(role, sessionId);
  await attendrePret(role, travailleur, signal);
  if (signal?.aborted || epoch !== etat.generation) throw new Error("annulee");
  return travailleur;
}

/**
 * Loads both models once and keeps them resident for the session: no idle
 * kill. Reloading costs 15-40 s, which is exactly the "Alexa stopped working"
 * symptom. Only sign-out, an explicit stop or another session ends them.
 */
export async function preparerVoixNative(sessionId: string, signal?: AbortSignal, _continueSession = false): Promise<void> {
  await Promise.all(ROLES.map((role) => preparerRole(role, sessionId, signal)));
}

export async function demanderVoixNative(entree: EntreeVoix, signal?: AbortSignal): Promise<ReponseVoix> {
  const role: RoleVoix = entree.action;
  const travailleur = await preparerRole(role, entree.sessionId, signal);
  const r = etat.roles[role];
  r.etat = "busy";
  try {
    return await travailleur.canal.demander(entree, signal, role === "stt" ? STT_TIMEOUT_MS : TTS_TIMEOUT_MS);
  } finally {
    r.etat = r.courant === travailleur ? "ready" : "stopped";
  }
}

export function arreterVoixNative(sessionId?: string): void {
  for (const role of ROLES) {
    const r = etat.roles[role];
    if (sessionId !== undefined && r.courant !== null && r.courant.sessionId !== sessionId) continue;
    r.dernierErreur = null;
    detruire(role);
  }
  etat.generation++;
}

export interface StatutVoixNative {
  readonly provider: "local";
  readonly stt: string;
  readonly tts: string;
  readonly voice: string;
  readonly worker: EtatRole["etat"];
  readonly workers: Readonly<Record<RoleVoix, EtatRole["etat"]>>;
  readonly ready: boolean;
  readonly lastError: string | null;
  readonly root: string;
}

const pret = (e: EtatRole["etat"]) => e === "ready" || e === "busy";

export function statutVoixNative(): StatutVoixNative {
  const c = chemins();
  const { stt, tts } = etat.roles;
  const ready = pret(stt.etat) && pret(tts.etat);
  // One summary state for existing callers: the worst of the two.
  const worker = ready
    ? (stt.etat === "busy" || tts.etat === "busy" ? "busy" : "ready")
    : stt.etat === "error" || tts.etat === "error" ? "error"
      : stt.etat === "starting" || tts.etat === "starting" ? "starting" : "stopped";
  return {
    provider: "local",
    stt: MODELES_VOIX.stt.id,
    tts: `${MODELES_VOIX.ttsModel.id}-ff_siwis`,
    voice: "ff_siwis",
    worker,
    workers: { stt: stt.etat, tts: tts.etat },
    ready,
    lastError: stt.dernierErreur ?? tts.dernierErreur,
    root: c.root,
  };
}
