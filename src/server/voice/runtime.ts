import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
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

interface Travailleur {
  readonly processus: ChildProcessWithoutNullStreams;
  readonly canal: CanalVoixNative;
  readonly sessionId: string;
  readonly pret: Promise<void>;
}

interface EtatVoix {
  courant: Travailleur | null;
  preparation: Promise<void> | null;
  verification: Promise<void> | null;
  idle: ReturnType<typeof setTimeout> | undefined;
  generation: number;
  sessionContinue: string | null;
  etat: "stopped" | "starting" | "ready" | "busy" | "error";
  dernierErreur: string | null;
}

const globalVoix = globalThis as typeof globalThis & { __mindcareVoiceRuntime?: EtatVoix };
const etat: EtatVoix = (globalVoix.__mindcareVoiceRuntime ??= {
  courant: null,
  preparation: null,
  verification: null,
  idle: undefined,
  generation: 0,
  sessionContinue: null,
  etat: "stopped",
  dernierErreur: null,
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

function detruire(): void {
  const courant = etat.courant;
  etat.courant = null;
  etat.etat = "stopped";
  clearTimeout(etat.idle);
  if (courant !== null) {
    courant.canal.echouer();
    courant.processus.kill();
  }
}

function ouvrir(sessionId: string): Travailleur {
  const c = chemins();
  if (env().ALEXA_LOCAL_VOICE === "false") throw new Error("configuration: voix-locale");
  if (etat.courant !== null && etat.courant.sessionId !== sessionId) detruire();
  if (etat.courant !== null && !etat.courant.processus.killed) return etat.courant;

  etat.etat = "starting";
  etat.dernierErreur = null;
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
      OMP_NUM_THREADS: "2",
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
      if (etat.courant?.processus === processus) detruire();
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
      detruire();
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
          etat.etat = "ready";
          resolvePret();
          continue;
        }
        if (valeur.ready === false) {
          const code = typeof valeur.error === "string" ? valeur.error : "health";
          etat.dernierErreur = code;
          etat.etat = "error";
          rejectPret(new Error(code === "health" ? "configuration: sante" : "configuration: modele"));
          detruire();
          continue;
        }
        canal.recevoir(valeur);
      } catch {
        rejectPret(new Error("runtime"));
        detruire();
      }
    }
  });
  processus.stderr.resume(); // No transcripts or patient audio are logged.
  processus.on("error", () => {
    etat.dernierErreur = "runtime";
    etat.etat = "error";
    rejectPret(new Error("runtime"));
    detruire();
  });
  processus.on("exit", () => {
    if (etat.courant?.processus === processus) {
      etat.etat = "stopped";
      etat.courant = null;
    }
    rejectPret(new Error("runtime"));
    canal.echouer();
  });

  const travailleur: Travailleur = { processus, canal, sessionId, pret };
  etat.courant = travailleur;
  return travailleur;
}

async function attendrePret(travailleur: Travailleur, signal?: AbortSignal): Promise<void> {
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
    detruire();
    throw cause;
  } finally {
    if (minuteur !== undefined) clearTimeout(minuteur);
  }
}

export async function preparerVoixNative(
  sessionId: string,
  signal?: AbortSignal,
  continueSession = false,
): Promise<void> {
  if (env().ALEXA_LOCAL_VOICE === "false" || signal?.aborted) throw new Error("configuration: voix-locale");
  if (!/^[a-f0-9]{64}$/u.test(sessionId)) throw new Error("configuration: session");
  const epoch = etat.generation;
  etat.verification ??= verifierModeles().catch((cause: unknown) => {
    etat.verification = null;
    throw cause;
  });
  await etat.verification;
  if (signal?.aborted || epoch !== etat.generation) throw new Error("annulee");

  const travailleur = ouvrir(sessionId);
  await attendrePret(travailleur, signal);
  if (signal?.aborted || epoch !== etat.generation) throw new Error("annulee");
  clearTimeout(etat.idle);
  if (continueSession) etat.sessionContinue = sessionId;
  etat.etat = "ready";
  etat.idle = setTimeout(() => arreterVoixNative(sessionId), 15 * 60_000);
  etat.idle.unref();
}

export async function demanderVoixNative(
  entree: EntreeVoix,
  signal?: AbortSignal,
): Promise<ReponseVoix> {
  await preparerVoixNative(entree.sessionId, signal);
  clearTimeout(etat.idle);
  const travailleur = etat.courant;
  if (travailleur === null) throw new Error("runtime");
  etat.etat = "busy";
  try {
    return await travailleur.canal.demander(
      entree,
      signal,
      entree.action === "stt" ? STT_TIMEOUT_MS : TTS_TIMEOUT_MS,
    );
  } finally {
    etat.etat = etat.courant === travailleur ? "ready" : "stopped";
    if (etat.courant === travailleur) {
      etat.idle = setTimeout(
        () => arreterVoixNative(entree.sessionId),
        etat.sessionContinue === entree.sessionId ? 15 * 60_000 : 60_000,
      );
      etat.idle.unref();
    }
  }
}

export function arreterVoixNative(sessionId?: string): void {
  if (sessionId !== undefined && etat.courant !== null && etat.courant.sessionId !== sessionId) return;
  etat.generation++;
  etat.preparation = null;
  etat.sessionContinue = null;
  etat.dernierErreur = null;
  detruire();
}

export interface StatutVoixNative {
  readonly provider: "local";
  readonly stt: string;
  readonly tts: string;
  readonly voice: string;
  readonly worker: EtatVoix["etat"];
  readonly ready: boolean;
  readonly lastError: string | null;
  readonly root: string;
}

export function statutVoixNative(): StatutVoixNative {
  const c = chemins();
  return {
    provider: "local",
    stt: MODELES_VOIX.stt.id,
    tts: `${MODELES_VOIX.ttsModel.id}-ff_siwis`,
    voice: "ff_siwis",
    worker: etat.etat,
    ready: etat.etat === "ready" || etat.etat === "busy",
    lastError: etat.dernierErreur,
    root: c.root,
  };
}
