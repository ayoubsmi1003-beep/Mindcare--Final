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
import { buildLocalRequest, localModelTimeoutMs, parseLocalAnswer, parseLocalCompletion, type LocalCompletion, type LocalMessage, type LocalTextOptions } from "./local-model-protocol";

export const LOCAL_MODEL_PIN = {
  model: ALEXA_CONVERSATION_MODEL,
  sha256: "588c6c94c82f756b86dba35c42ed9ba9ec187d65824eb52f039c347df563e63d",
  architecture: "qwen35", runtime: "b11429",
  archiveSha256: "1283323272b04cd07905816a597a0da810918102de958f4ff6f7bbaa70ed2efe",
  runtimeManifestSha256: "a57e54357f5ca5a5fa0d70de662a076fc2150232bccd183abaf5d83982694465",
} as const;
let child: ChildProcess | null = null, busy = false;
/** Scale CPU inference to available cores, capped at the measured four-thread point. */
export function localModelThreadCountFor(available: number): number {
  return Math.max(1, Math.min(4, Math.floor(available)));
}
let idle: ReturnType<typeof setTimeout> | undefined;
const token = randomBytes(32).toString("hex");
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
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" } }, res => {
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
  clearTimeout(idle); idle = undefined;
  const handle = child; child = null;
  if (handle && handle.exitCode === null && handle.signalCode === null) {
    const stopped = new Promise<void>(resolve => handle.once("exit", () => resolve()));
    handle.kill();
    await Promise.race([stopped, new Promise<void>(resolve => { const timer = setTimeout(resolve, 5000); timer.unref(); })]);
  }
}
process.once("exit", () => { child?.kill(); });
async function prepare(signal: AbortSignal): Promise<void> {
  if (child && child.exitCode === null && child.signalCode === null) return;
  const layout = localAssetLayout(), model = join(layout.root, LOCAL_MODEL_PIN.model);
  const directory = join(layout.root, "runtime-" + LOCAL_MODEL_PIN.runtime), runtime = join(directory, "llama-server.exe");
  await verifyLocalAssetAccess(layout.root, layout.packaged);
  signal.throwIfAborted();
  if (await hash(model, signal) !== LOCAL_MODEL_PIN.sha256
    || await hash(join(layout.root, "llama-" + LOCAL_MODEL_PIN.runtime + ".zip"), signal) !== LOCAL_MODEL_PIN.archiveSha256)
    throw new Error("LocalModelIntegrity");
  const files = (await readdir(directory)).filter(name => /\.(exe|dll)$/.test(name)).sort(), manifest: string[] = [];
  for (const name of files) manifest.push(name + ":" + await hash(join(directory, name), signal));
  if (files.length !== 50 || createHash("sha256").update(manifest.join("\n")).digest("hex") !== LOCAL_MODEL_PIN.runtimeManifestSha256)
    throw new Error("LocalModelIntegrity");
  signal.throwIfAborted();
  const handle = spawn(runtime, ["-m", model, "--host", "127.0.0.1", "--port", "18082", "-c", "4096", "-t", String(localModelThreadCountFor(availableParallelism())), "--parallel", "1",
    "--jinja", "--reasoning", "off", "--no-context-shift", "--no-warmup", "--api-key", token, "--no-webui", "--log-disable"],
  { cwd: directory, windowsHide: true, stdio: "ignore",
    env: { NODE_ENV: "production", SystemRoot: process.env["SystemRoot"] ?? "C:\\Windows", WINDIR: process.env["WINDIR"] ?? "C:\\Windows", OMP_NUM_THREADS: "2" } });
  child = handle;
  let failed = false; handle.once("error", () => { failed = true; });
  // Integrity, startup and inference share the caller's bounded deadline.
  for (;;) {
    signal.throwIfAborted();
    if (failed || handle.exitCode !== null || handle.signalCode !== null) throw new Error("LocalModelUnavailable");
    try { if ((await loopback("/health", AbortSignal.any([signal, AbortSignal.timeout(500)]))).status === 200) return; } catch { /* bounded local startup */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
/** Local inference only. Callers retain their privacy admission and response validators. */
async function inferLocalRaw(messages: readonly LocalMessage[], options: LocalTextOptions = {}): Promise<string> {
  const body = JSON.stringify(buildLocalRequest(messages, options));
  if (busy) throw new Error("LocalModelBusy");
  const timeout = localModelTimeoutMs(options);
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(Math.ceil(timeout))]);
  signal.throwIfAborted(); busy = true; clearTimeout(idle);
  try {
    await prepare(signal);
    const template = await loopback("/apply-template", signal, body);
    if (template.status !== 200) throw new Error("LocalModelInput");
    const rendered = z.object({ prompt: z.string().max(64000) }).parse(JSON.parse(template.body));
    const tokenized = await loopback("/tokenize", signal, JSON.stringify({ content: rendered.prompt, add_special: true }));
    const tokens = z.object({ tokens: z.array(z.number().int()).max(4096) }).parse(JSON.parse(tokenized.body));
    if (tokens.tokens.length + (options.maxOutputTokens ?? 512) + 128 > 4096) throw new Error("LocalModelContext");
    const response = await loopback("/v1/chat/completions", signal, body);
    signal.throwIfAborted();
    if (response.status !== 200) throw new Error("LocalModelUnavailable");
    return response.body;
  } catch(error) { await releaseLocalModel();
    if(signal.aborted)throw signal.reason;
    if(error instanceof Error&&/^LocalModel(?:Input|Context|Integrity|AssetAccess|Timeout|Unavailable)$/.test(error.message))throw error;
    throw new Error("LocalModelUnavailable");
  }
  finally {
    busy = false;
    if (child) { idle = setTimeout(() => { void releaseLocalModel(); }, 60000); idle.unref(); }
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

