import { isAbsolute, join, normalize } from "node:path";

export interface EnvironnementVoix {
  readonly [nom: string]: string | undefined;
  readonly MINDCARE_PACKAGED?: string | undefined;
  readonly ALEXA_VOICE_ROOT?: string | undefined;
  readonly ALEXA_VOICE_ASSETS?: string | undefined;
  readonly ALEXA_VOICE_PYTHON?: string | undefined;
  readonly ALEXA_VOICE_PACKAGES?: string | undefined;
  readonly ALEXA_VOICE_WORKER?: string | undefined;
  readonly ALEXA_VOICE_WORKER_DIR?: string | undefined;
  readonly ALEXA_WAKE_WORKER?: string | undefined;
  readonly ALEXA_WAKE_WORKER_DIR?: string | undefined;
}

export interface CheminsVoix {
  readonly root: string;
  readonly assets: string;
  readonly python: string;
  readonly packages: string;
  readonly worker: string;
  readonly wakeWorker: string;
}

function absolu(value: string, champ: string): string {
  if (!isAbsolute(value)) throw new Error(`configuration: chemins (${champ})`);
  return normalize(value);
}

function estPackage(env: EnvironnementVoix): boolean {
  return env.MINDCARE_PACKAGED === "1" || env.MINDCARE_PACKAGED === "true";
}

/**
 * One resolver for development and the packaged Windows app.
 *
 * Packaged callers must supply an absolute root. Falling back to
 * `process.cwd()/resources/voix` in production is forbidden: the Next server
 * runs from `resources/serveur`, so that fallback points at a directory that
 * does not exist on the doctor's machine.
 */
export function resoudreCheminsVoix(input: {
  readonly cwd?: string;
  readonly env?: EnvironnementVoix;
} = {}): CheminsVoix {
  const env = input.env ?? {};
  const cwd = input.cwd ?? process.cwd();
  const rootExplicite = env.ALEXA_VOICE_ROOT?.trim();
  const root = rootExplicite
    ? absolu(rootExplicite, "ALEXA_VOICE_ROOT")
    : estPackage(env)
      ? (() => {
          throw new Error("configuration: chemins");
        })()
      : normalize(join(cwd, "resources", "voix"));

  const assets = env.ALEXA_VOICE_ASSETS?.trim()
    ? absolu(env.ALEXA_VOICE_ASSETS, "ALEXA_VOICE_ASSETS")
    : join(root, "assets");
  const python = env.ALEXA_VOICE_PYTHON?.trim()
    ? absolu(env.ALEXA_VOICE_PYTHON, "ALEXA_VOICE_PYTHON")
    : join(root, "python", "python.exe");
  const packages = env.ALEXA_VOICE_PACKAGES?.trim()
    ? absolu(env.ALEXA_VOICE_PACKAGES, "ALEXA_VOICE_PACKAGES")
    : join(root, "packages");

  const workerDir = env.ALEXA_VOICE_WORKER_DIR?.trim();
  const worker = env.ALEXA_VOICE_WORKER?.trim()
    ? absolu(env.ALEXA_VOICE_WORKER, "ALEXA_VOICE_WORKER")
    : workerDir
      ? join(absolu(workerDir, "ALEXA_VOICE_WORKER_DIR"), "native-voice-worker.py")
      : join(root, "native-voice-worker.py");

  const wakeDir = env.ALEXA_WAKE_WORKER_DIR?.trim() ?? workerDir;
  const wakeWorker = env.ALEXA_WAKE_WORKER?.trim()
    ? absolu(env.ALEXA_WAKE_WORKER, "ALEXA_WAKE_WORKER")
    : wakeDir
      ? join(absolu(wakeDir, "ALEXA_WAKE_WORKER_DIR"), "wake-voice-worker.py")
      : join(root, "wake-voice-worker.py");

  return { root, assets, python, packages, worker, wakeWorker };
}
