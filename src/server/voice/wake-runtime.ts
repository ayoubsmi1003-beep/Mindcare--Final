import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { join, isAbsolute } from "node:path";

import { env } from "@/server/env";
import { resoudreCheminsVoix } from "./chemins";
import { MODELES_VOIX } from "./modeles";

/**
 * Resident Vosk keyword spotter — local only.
 *
 * State lives on `globalThis`: Next can load a route module more than once
 * (route chunks, dev HMR), and a per-module worker would restart the model
 * mid-utterance. One process-global worker per app process is the contract.
 */

const MAX_PCM = 64_000;
const READY_TIMEOUT_MS = 30_000;
const DEBUG = process.env["ALEXA_WAKE_DEBUG"] === "1";

interface Reponse {
  readonly id: string;
  readonly ok: boolean;
  readonly detected?: boolean;
  readonly ready?: boolean;
  readonly code?: string;
}

interface Attente {
  id: string;
  resoudre: (r: Reponse) => void;
  rejeter: (e: Error) => void;
}

interface Etat {
  courant: { readonly processus: ChildProcessWithoutNullStreams; readonly sessionId: string; readonly pret: Promise<void> } | null;
  attente: Attente | null;
  tampon: string;
  chaine: Promise<unknown>;
  idle: ReturnType<typeof setTimeout> | undefined;
  preparation: Promise<void> | null;
}

const globalWake = globalThis as typeof globalThis & { __mindcareWake?: Etat };
const etat: Etat = (globalWake.__mindcareWake ??= {
  courant: null,
  attente: null,
  tampon: "",
  chaine: Promise.resolve(),
  idle: undefined,
  preparation: null,
});

function configuration() {
  const c = resoudreCheminsVoix({ cwd: process.cwd(), env: process.env });
  return {
    active: env().ALEXA_LOCAL_VOICE !== "false",
    assets: c.assets,
    packages: c.packages,
    python: c.python,
    helper: c.wakeWorker,
    root: c.root,
  };
}

async function verifier(): Promise<void> {
  const c = configuration();
  if (!isAbsolute(c.assets) || !isAbsolute(c.packages) || !isAbsolute(c.python)) {
    throw new Error("configuration: voix-locale");
  }
  await access(join(c.assets, MODELES_VOIX.wake.file, "conf", "model.conf"));
  await access(join(c.packages, "vosk", "libvosk.dll"));
  await access(c.python);
}

function detruire(): void {
  const c = etat.courant;
  etat.courant = null;
  clearTimeout(etat.idle);
  if (etat.attente !== null) {
    etat.attente.rejeter(new Error("runtime"));
    etat.attente = null;
  }
  if (c !== null) {
    if (DEBUG) console.info(JSON.stringify({ event: "wake.kill", pid: c.processus.pid }));
    c.processus.kill();
  }
}

function ouvrir(sessionId: string): NonNullable<Etat["courant"]> {
  if (etat.courant !== null && etat.courant.sessionId !== sessionId) detruire();
  if (etat.courant !== null && !etat.courant.processus.killed) return etat.courant;
  const c = configuration();
  const processus = spawn(c.python, ["-I", "-B", "-u", c.helper, c.packages, c.assets], {
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
      OMP_NUM_THREADS: "1",
      ALEXA_WAKE_MODEL: MODELES_VOIX.wake.file,
    },
  });

  let resolvePret!: () => void;
  let rejectPret!: (error: Error) => void;
  const pret = new Promise<void>((resolve, reject) => {
    resolvePret = resolve;
    rejectPret = reject;
  });
  pret.catch(() => {});

  processus.stdout.setEncoding("utf8");
  processus.stdout.on("data", (fragment: string) => {
    etat.tampon += fragment;
    if (etat.tampon.length > 200_000) {
      rejectPret(new Error("runtime"));
      detruire();
      return;
    }
    for (;;) {
      const fin = etat.tampon.indexOf("\n");
      if (fin < 0) break;
      const ligne = etat.tampon.slice(0, fin);
      etat.tampon = etat.tampon.slice(fin + 1);
      try {
        const reponse = JSON.parse(ligne) as Reponse;
        if (reponse.id === "ready") {
          resolvePret();
          continue;
        }
        if (etat.attente !== null && reponse.id === etat.attente.id) {
          const a = etat.attente;
          etat.attente = null;
          a.resoudre(reponse);
        }
      } catch {
        rejectPret(new Error("runtime"));
        detruire();
      }
    }
  });
  processus.stderr.resume(); // No transcripts or model diagnostics are logged.
  processus.on("error", () => {
    rejectPret(new Error("runtime"));
    detruire();
  });
  processus.on("exit", () => {
    rejectPret(new Error("runtime"));
    if (etat.courant?.processus === processus) detruire();
  });
  const courant = { processus, sessionId, pret };
  etat.courant = courant;
  if (DEBUG) console.info(JSON.stringify({ event: "wake.spawn", pid: processus.pid }));
  return courant;
}

export async function preparerReveil(sessionId: string, signal?: AbortSignal): Promise<void> {
  if (configuration().active === false || signal?.aborted) throw new Error("configuration: voix-locale");
  if (!/^[a-f0-9]{64}$/u.test(sessionId)) throw new Error("configuration: session");
  etat.preparation ??= verifier().catch((cause: unknown) => {
    etat.preparation = null;
    throw cause;
  });
  await etat.preparation;
  if (signal?.aborted) throw new Error("annulee");
  clearTimeout(etat.idle);
  const courant = ouvrir(sessionId);
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      courant.pret,
      new Promise<never>((_, reject) => {
        minuteur = setTimeout(() => reject(new Error("timeout")), READY_TIMEOUT_MS);
        minuteur.unref?.();
      }),
    ]);
  } catch (cause) {
    detruire();
    throw cause;
  } finally {
    if (minuteur !== undefined) clearTimeout(minuteur);
  }
  etat.idle = setTimeout(() => arreterReveil(sessionId), 10 * 60_000);
  etat.idle.unref();
}

function demanderUne(
  sessionId: string,
  action: "audio" | "reset",
  pcmBase64?: string,
  signal?: AbortSignal,
): Promise<Reponse> {
  return new Promise((resoudre, rejeter) => {
    if (signal?.aborted) return rejeter(new Error("annulee"));
    const processus = ouvrir(sessionId).processus;
    const id = crypto.randomUUID();
    const minuteur = setTimeout(() => {
      detruire();
      rejeter(new Error("timeout"));
    }, 15_000);
    const annuler = () => {
      clearTimeout(minuteur);
      etat.attente = null;
      rejeter(new Error("annulee"));
    };
    signal?.addEventListener("abort", annuler, { once: true });
    etat.attente = {
      id,
      resoudre: (r) => {
        clearTimeout(minuteur);
        signal?.removeEventListener("abort", annuler);
        if (!r.ok) return rejeter(new Error(r.code ?? "runtime"));
        resoudre(r);
      },
      rejeter: (e) => {
        clearTimeout(minuteur);
        signal?.removeEventListener("abort", annuler);
        rejeter(e);
      },
    };
    try {
      processus.stdin.write(JSON.stringify({ id, action, pcmBase64 }) + "\n");
      if (DEBUG) console.info(JSON.stringify({ event: "wake.send", pid: processus.pid, action }));
    } catch {
      detruire();
      rejeter(new Error("runtime"));
    }
  });
}

/** Serialised: a 500 ms chunk decodes in ~16 ms, so a queue never grows. */
export function demanderReveil(
  sessionId: string,
  action: "audio" | "reset",
  pcmBase64?: string,
  signal?: AbortSignal,
): Promise<{ detected: boolean }> {
  if (action === "audio" && (!pcmBase64 || pcmBase64.length > MAX_PCM * 2)) {
    return Promise.reject(new Error("volume"));
  }
  const tour = etat.chaine.then(async () => {
    await preparerReveil(sessionId, signal);
    const r = await demanderUne(sessionId, action, pcmBase64, signal);
    if (DEBUG) console.info(JSON.stringify({ event: "wake.result", detected: r.detected === true }));
    return { detected: r.detected === true };
  });
  etat.chaine = tour.catch(() => {});
  return tour;
}

export function arreterReveil(sessionId?: string): void {
  if (sessionId !== undefined && etat.courant !== null && etat.courant.sessionId !== sessionId) return;
  detruire();
}

export function reveilActif(): boolean {
  return etat.courant !== null;
}
