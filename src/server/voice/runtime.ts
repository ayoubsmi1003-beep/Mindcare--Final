import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join, isAbsolute, resolve, sep, dirname } from "node:path";
import { env } from "@/server/env";
import { CanalVoixNative, type EntreeVoix, type ReponseVoix } from "./protocole";
const PINS = [{"file":"ggml-base.bin","sha256":"60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe"},{"file":"fr_FR-siwis-medium.onnx","sha256":"641d1ab097da2b81128c076810edb052b385decc8be3381814802a64a73baf99"},{"file":"ar_JO-kareem-low.onnx","sha256":"2887e9d68b125965c747e1371fa21e1cef19555ea98d0795a0d5d71188b13890"},{"file":"fr_FR-siwis-medium.onnx.json","sha256":"39479916c2db192b5ac9764daddd0c744d83e023ad890c6976c0633ae4df8959"},{"file":"ar_JO-kareem-low.onnx.json","sha256":"da328e52896826135508f797c1c77b45b35117e967c71befc377d654f100f328"}] as const;
let courant: { processus: ChildProcessWithoutNullStreams; canal: CanalVoixNative; sessionId: string } | null = null;
let preparation: Promise<void> | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
function configurationVoix() {
 const e = env(), root = e.ALEXA_VOICE_ASSETS ? dirname(e.ALEXA_VOICE_ASSETS) : join(process.cwd(), "resources", "voix");
 return { active: e.ALEXA_LOCAL_VOICE === "true", assets: e.ALEXA_VOICE_ASSETS ?? join(root, "assets"),
  python: e.ALEXA_VOICE_PYTHON ?? join(root, "python", "python.exe"), packages: e.ALEXA_VOICE_PACKAGES ?? join(root, "packages"),
  helper: join(e.ALEXA_VOICE_WORKER_DIR ?? join(process.cwd(), "scripts"), "native-voice-worker.py"), root };
}
async function empreinte(path: string): Promise<string> {
 const h = createHash("sha256"); for await (const b of createReadStream(path)) h.update(b as Buffer); return h.digest("hex");
}
async function verifierAssets(): Promise<void> {
 const config = configurationVoix(), root = config.assets;
 if (!root || !isAbsolute(root)) throw new Error("configuration: assets");
 for (const pin of PINS) {
  const h = createHash("sha256"); for await (const b of createReadStream(join(root, pin.file))) h.update(b as Buffer);
  if (h.digest("hex") !== pin.sha256) throw new Error("configuration: hash");
 }
 await access(join(root, "fr_FR-siwis-medium.onnx.json")); await access(join(root, "ar_JO-kareem-low.onnx.json"));
 // Pin the bundled interpreter and installed package inventory, including native DLLs.
 if (await empreinte(config.python) !== "372c2eae555b344520bf147be0096e009069aeca4e7f78d6aecea6d53158056a") throw new Error("configuration: python");
 const inventoryPath = join(config.root, "inventory.json");
 if (await empreinte(inventoryPath) !== "9b29537de4562809a6a641c18ec7d1c7e320be8a4fa6162f24ffbbe1d78cb281") throw new Error("configuration: inventory");
 const inventory = JSON.parse(await readFile(inventoryPath, "utf8")) as { path: string; sha256: string }[];
 for (const pin of inventory) {
  if (!pin.path.startsWith("python/") && !pin.path.startsWith("packages/")) continue;
  const base = pin.path.startsWith("packages/") ? config.packages : dirname(config.python);
  const path = resolve(base, pin.path.substring(pin.path.indexOf("/") + 1));
  if (!path.startsWith(resolve(base) + sep) || await empreinte(path) !== pin.sha256) throw new Error("configuration: packages");
 }
}
export function arreterVoixNative(sessionId?: string): void {
 const c = courant; if (sessionId !== undefined && c !== null && c.sessionId !== sessionId) return;
 generation++; clearTimeout(idle); courant = null;
 if (c !== null) { c.processus.kill(); c.canal.echouer(); }
}
function ouvrir(sessionId: string): NonNullable<typeof courant> {
 const e = configurationVoix();
 if (!e.active || !isAbsolute(e.python) || !isAbsolute(e.packages)) throw new Error("configuration: voix-locale");
 if (courant !== null && courant.sessionId !== sessionId) arreterVoixNative();
 if (courant !== null && !courant.processus.killed) return courant;
 // No shell and no inherited provider/database secrets in the native child.
 const processus = spawn(e.python, ["-I", "-B", "-u", e.helper, e.packages, e.assets], {
  shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  env: { NODE_ENV: "production", SystemRoot: process.env["SystemRoot"] ?? "", WINDIR: process.env["WINDIR"] ?? "", OMP_NUM_THREADS: "2" },
 });
 const canal = new CanalVoixNative((ligne) => { processus.stdin.write(ligne); }, () => {
  if (courant?.processus === processus) courant = null; processus.kill();
 });
 let buffer = "";
 processus.stdout.setEncoding("utf8");
 processus.stdout.on("data", (fragment: string) => {
  buffer += fragment;
  if (buffer.length > 8_100_000) { canal.echouer(); processus.kill(); return; }
  for (;;) { const index = buffer.indexOf("\n"); if (index < 0) break;
   const ligne = buffer.slice(0, index); buffer = buffer.slice(index + 1);
   try { canal.recevoir(JSON.parse(ligne) as unknown); } catch { canal.echouer(); }
  }
 });
 processus.stderr.resume(); // No transcripts or native diagnostics are logged.
 processus.on("error", () => canal.echouer());
 processus.on("exit", () => { canal.echouer(); if (courant?.processus === processus) courant = null; });
 courant = { processus, canal, sessionId }; return courant;
}
export async function demanderVoixNative(entree: EntreeVoix, signal?: AbortSignal): Promise<ReponseVoix> {
 if (env().ALEXA_LOCAL_VOICE !== "true" || signal?.aborted) throw new Error("configuration: voix-locale");
 const epoch = generation;
 preparation ??= verifierAssets().catch((e: unknown) => { preparation = null; throw e; });
 await preparation;
 if (signal?.aborted || epoch !== generation) throw new Error("annulee");
 clearTimeout(idle);
 const worker = ouvrir(entree.sessionId);
 try { return await worker.canal.demander(entree, signal, 30000); }
 finally {
  idle = setTimeout(() => { if (courant === worker) arreterVoixNative(entree.sessionId); }, 60000); idle.unref();
 }
}
