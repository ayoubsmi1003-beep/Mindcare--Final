import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { availableParallelism } from "node:os";
import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { request as httpRequest } from "node:http";
import { semanticRequestSchema } from "@/shared/alexa/semantic-request";
import { LOCAL_SEMANTIC_PROMPT } from "@/i18n/alexa-semantic";
import { ALEXA_CONVERSATION_MODEL } from "./model-policy";
import { localAssetLayout, verifyLocalAssetAccess } from "./local-model-assets";
import { LocalModelSlot } from "./local-model-slot";
import {measureLocalModelPhase} from './local-model-timing';
import { assertLocalContextFits, buildLocalRequest, localModelTimeoutMs, parseLocalAnswer, parseLocalCompletion, type LocalCompletion, type LocalMessage, type LocalTextOptions } from "./local-model-protocol";

export const LOCAL_MODEL_PIN = {
  model: ALEXA_CONVERSATION_MODEL,
  sha256: "588c6c94c82f756b86dba35c42ed9ba9ec187d65824eb52f039c347df563e63d",
  architecture: "qwen35", runtime: "b11429",
  archiveSha256: "1283323272b04cd07905816a597a0da810918102de958f4ff6f7bbaa70ed2efe",
  runtimeManifestSha256: "a57e54357f5ca5a5fa0d70de662a076fc2150232bccd183abaf5d83982694465",
} as const;
/** The two-core delivery PC measures 10.4 tokens/s with one thread, versus 0.8 with four. */
export function localModelThreadCountFor(available: number): number {
  return available <= 4 ? 1 : Math.max(1, Math.min(4, Math.floor(available)));
}
interface LocalRuntimeState {
  child: ChildProcess | null;
  slot: LocalModelSlot;
  idle: ReturnType<typeof setTimeout> | undefined;
  token: string;
  identity: string;
  exitHookSet: boolean;
}
// Next routes and hot reloads must share the authenticated process and its one inference slot.
const runtimeHost = globalThis as typeof globalThis & { mindcareAlexaLocalRuntime?: LocalRuntimeState };
const runtimeIdentity = [LOCAL_MODEL_PIN.sha256, LOCAL_MODEL_PIN.runtimeManifestSha256, process.cwd()].join(":");
const runtimeState = runtimeHost.mindcareAlexaLocalRuntime ??= {
  child: null, slot: new LocalModelSlot(), idle: undefined, token: randomBytes(32).toString("hex"), identity: runtimeIdentity, exitHookSet: false,
};
/** Qualification is operational evidence, never a privacy or SQL authorization. */
export async function localSemanticQualified(): Promise<boolean> {
  try {
    const receipt = z.object({ gate: z.literal("PASS"), modelSha256: z.literal(LOCAL_MODEL_PIN.sha256), runtime: z.literal(LOCAL_MODEL_PIN.runtime),
      promptSha256: z.literal(createHash("sha256").update(LOCAL_SEMANTIC_PROMPT).digest("hex")), cases: z.number().int().min(8), failures: z.literal(0) }).strict();
    const raw = await readFile(join(localAssetLayout().root, "qualification.json"), "utf8");
    return raw.length <= 2000 && receipt.safeParse(JSON.parse(raw)).success;
  } catch { return false; }
}
/** Fixed authenticated loopback; no DNS, redirects or configurable destination. */
function loopback(path: "/health" | "/v1/chat/completions" | "/apply-template" | "/tokenize", signal: AbortSignal, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const req = httpRequest({ hostname: "127.0.0.1", port: 18082, path, method: body === undefined ? "GET" : "POST", signal,
      headers: { Authorization: "Bearer " + runtimeState.token, "Content-Type": "application/json" } }, res => {
      const chunks: Buffer[] = []; let bytes = 0;
      res.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 96000) { res.destroy(new Error("LocalModelOutput")); return; } chunks.push(chunk); });
      res.on("end", () => resolve({ status: res.statusCode ?? 500, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject); req.end(body);
  });
}
async function hash(path: string, signal: AbortSignal) {
  const value = createHash("sha256");
  for await (const chunk of createReadStream(path,{highWaterMark:1024*1024})) { signal.throwIfAborted(); value.update(chunk as Buffer); }
  return value.digest("hex");
}
export async function releaseLocalModel(): Promise<void> {
  clearTimeout(runtimeState.idle); runtimeState.idle = undefined;
  const handle = runtimeState.child; runtimeState.child = null;
  if (handle && handle.exitCode === null && handle.signalCode === null) {
    const stopped = new Promise<void>(resolve => handle.once("exit", () => resolve()));
    handle.kill();
    await Promise.race([stopped, new Promise<void>(resolve => { const timer = setTimeout(resolve, 5000); timer.unref(); })]);
  }
}
if (!runtimeState.exitHookSet) { runtimeState.exitHookSet = true; process.once("exit", () => { runtimeState.child?.kill(); }); }
async function prepare(signal: AbortSignal): Promise<void> {
  if (runtimeState.child && runtimeState.child.exitCode === null && runtimeState.child.signalCode === null) return;
  const layout = localAssetLayout(), model = join(layout.root, LOCAL_MODEL_PIN.model);
  const directory = join(layout.root, "runtime-" + LOCAL_MODEL_PIN.runtime), runtime = join(directory, "llama-server.exe");
  await measureLocalModelPhase('integrity',async()=>{
  await verifyLocalAssetAccess(layout.root, layout.packaged, signal);
  signal.throwIfAborted();
  if (await hash(model, signal) !== LOCAL_MODEL_PIN.sha256
    || await hash(join(layout.root, "llama-" + LOCAL_MODEL_PIN.runtime + ".zip"), signal) !== LOCAL_MODEL_PIN.archiveSha256)
    throw new Error("LocalModelIntegrity");
  const files = (await readdir(directory)).filter(name => /\.(exe|dll)$/.test(name)).sort(), manifest: string[] = [];
  for (const name of files) manifest.push(name + ":" + await hash(join(directory, name), signal));
  if (files.length !== 50 || createHash("sha256").update(manifest.join("\n")).digest("hex") !== LOCAL_MODEL_PIN.runtimeManifestSha256)
    throw new Error("LocalModelIntegrity");
  });
  signal.throwIfAborted();
  const handle = spawn(runtime, ["-m", model, "--host", "127.0.0.1", "--port", "18082", "-c", "4096", "-t", String(localModelThreadCountFor(availableParallelism())), "--gpu-layers", "0", "--batch-size", "128", "--ubatch-size", "128", "--load-mode", "none", "--parallel", "1",
    "--jinja", "--reasoning", "off", "--no-context-shift", "--no-warmup", "--api-key", runtimeState.token, "--no-webui", "--log-disable"],
  { cwd: directory, windowsHide: true, stdio: "ignore",
    env: { NODE_ENV: "production", SystemRoot: process.env["SystemRoot"] ?? "C:\\Windows", WINDIR: process.env["WINDIR"] ?? "C:\\Windows", OMP_NUM_THREADS: String(localModelThreadCountFor(availableParallelism())) } });
  runtimeState.child = handle;
  let failed = false; handle.once("error", () => { failed = true; });
  // Integrity, startup and inference share the caller's bounded deadline.
  await measureLocalModelPhase('startup',async()=>{for (;;) {
    signal.throwIfAborted();
    if (failed || handle.exitCode !== null || handle.signalCode !== null) throw new Error("LocalModelUnavailable");
    try {
      if ((await loopback("/health", AbortSignal.any([signal, AbortSignal.timeout(500)]))).status === 200) {
        const authenticated = await loopback("/tokenize", signal, JSON.stringify({content:"MindCare",add_special:false}));
        if (authenticated.status !== 200) throw new Error("LocalModelUnavailable");
        return;
      }
    } catch (error) { if (error instanceof Error && error.message === "LocalModelUnavailable") throw error; /* bounded local startup */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }});
}
/** Local inference only. Callers retain their privacy admission and response validators. */
async function inferLocalRaw(messages: readonly LocalMessage[], options: LocalTextOptions = {}): Promise<string> {
  if (runtimeState.identity !== runtimeIdentity) throw new Error("LocalModelIntegrity");
  const body = JSON.stringify(buildLocalRequest(messages, options));
  const timeout = localModelTimeoutMs(options);
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(Math.ceil(timeout))]);
  const releaseSlot = await measureLocalModelPhase('slot',()=>runtimeState.slot.acquire(signal));
  clearTimeout(runtimeState.idle);
  try {
    await prepare(signal);
    await measureLocalModelPhase('context',async()=>{
    const template = await loopback("/apply-template", signal, body);
    if (template.status !== 200) throw new Error("LocalModelInput");
    const rendered = z.object({ prompt: z.string().max(64000) }).parse(JSON.parse(template.body));
    const tokenized = await loopback("/tokenize", signal, JSON.stringify({ content: rendered.prompt, add_special: true }));
    assertLocalContextFits(JSON.parse(tokenized.body), options.maxOutputTokens ?? 512);
    });
    const response = await measureLocalModelPhase('generation',()=>loopback("/v1/chat/completions", signal, body));
    signal.throwIfAborted();
    if (response.status !== 200) throw new Error("LocalModelUnavailable");
    return response.body;
  } catch(error) {
    // A preflight overflow does not damage the authenticated runtime; the caller can fit its sources.
    if (!(error instanceof Error && error.message === "LocalModelContext")) await releaseLocalModel();
    if(signal.aborted)throw signal.reason;
    if(error instanceof Error&&/^LocalModel(?:Input|Context|Integrity|AssetAccess|Timeout|Unavailable)$/.test(error.message))throw error;
    throw new Error("LocalModelUnavailable");
  }
  finally {
    if (runtimeState.child) { runtimeState.idle = setTimeout(() => { void releaseLocalModel(); }, 60000); runtimeState.idle.unref(); }
    releaseSlot();
  }
}
export async function inferLocalText(messages: readonly LocalMessage[], options: LocalTextOptions = {}): Promise<string> {
  return parseLocalAnswer(await inferLocalRaw(messages, options));
}
export async function inferLocalCompletion(messages: readonly LocalMessage[], options: LocalTextOptions): Promise<LocalCompletion> {
  return parseLocalCompletion(await inferLocalRaw(messages, options));
}
export async function inferLocalSemantic(text: string, previous: unknown, signal: AbortSignal): Promise<unknown> {
  if (text.length > 4000) throw new Error("LocalModelInput");
  const content = await inferLocalText([
    { role: "system", content: LOCAL_SEMANTIC_PROMPT }, { role: "user", content: JSON.stringify({ request: text, previous }) },
  ], { maxOutputTokens: 350, jsonSchema: z.toJSONSchema(semanticRequestSchema), timeoutMs: 85000, signal });
  return JSON.parse(content);
}

