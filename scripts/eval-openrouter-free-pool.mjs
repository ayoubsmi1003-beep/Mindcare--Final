#!/usr/bin/env node
/** Real safe provider qualification through the product gateway. No direct external fetch here. */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { loadEnvConfig } = createRequire(require.resolve("next/package.json"))("@next/env");
loadEnvConfig(root, false, { info() {}, error() {} }); // Server loader; never print .env or a secret.
const viteRequire = createRequire(require.resolve("vite/package.json", { paths: [dirname(require.resolve("vitest/package.json"))] }));
const { build } = viteRequire("esbuild");
const output = join(root, ".eval-out", "openrouter-free", "gateway.mjs");
await mkdir(dirname(output), { recursive: true });
await build({ entryPoints: [join(root, "src/server/egress/external-call.ts")], outfile: output,
  bundle: true, platform: "node", format: "esm", target: "node22", packages: "external",
  alias: { "@": join(root, "src") }, logLevel: "silent" });
const { preparerPoolModelesGratuits, llm, llmStream, lireQuotaOpenRouter } = await import(pathToFileURL(output).href);
const reportDir = join(root, "artifacts", "alexa-free-pool-2026-09-30");
await mkdir(reportDir, { recursive: true });
let prepared;
try {
  prepared = await preparerPoolModelesGratuits({ timeoutMs: 60_000, maxModels: 3 });
} catch (error) {
  const code = error?.code ?? "PROVIDER_UNAVAILABLE";
  await writeFile(join(reportDir, "openrouter-live.json"), JSON.stringify({ at: new Date().toISOString(), status: "BLOCKED", code }, null, 2));
  console.log(JSON.stringify({ status: "BLOCKED", code })); process.exitCode = 2;
}
if (prepared) {
  const qualified = prepared.modeles.filter((m) => m.qualification !== null);
  console.log(JSON.stringify({ phase: "qualification", qualified: qualified.map((m) => m.modelId), quota: prepared.quota, account: prepared.compte }));
  await writeFile(join(reportDir, "openrouter-live.json"), JSON.stringify({ at: new Date().toISOString(), qualification: prepared }, null, 2));
  const samples = [];
  const max = process.argv.includes("--benchmark") ? 30 : 3;
  for (let n = 0; n < max && qualified.length > 0; n++) {
    const quota = await lireQuotaOpenRouter().catch(() => ({ remaining: null }));
    if (quota.remaining !== null && quota.remaining <= 5) break;
    const started = performance.now();
    const request = { purpose: "jarvis", messages: [{ role: "system", content: "Réponds brièvement dans la langue de la question, sans information de dossier." },
      { role: "user", content: ["Bonjour, explique en une phrase le rôle d’un agenda.", "واش هو برنامج اليوم؟ جاوب باختصار بلا معلومات تاع أشخاص.", "Explique agenda باختصار، sans données personnelles."][n % 3] }],
      promptVersion: "free-pool-benchmark-v1", promptHash: "synthetic-general-only", sessionToken: crypto.randomUUID(),
      besoin: { tache: "conversation", json: false }, timeoutMs: 10_000 };
    const result = n % 2 === 0 ? await llmStream(request) : await llm(request);
    let first = null; let complete = result.ok; let code = result.ok ? "OK" : result.error.diagnostic ?? result.error.code;
    if (result.ok && n % 2 === 0) {
      const reader = result.data.deltas.getReader();
      try { for (;;) { const r = await reader.read(); if (r.done) break; first ??= performance.now() - started; } await result.data.usage; }
      catch (error) { complete = false; code = error?.code ?? "MODEL_ERROR"; }
      finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    const sample = { language: ["fr", "darija", "mixed"][n % 3], streaming: n % 2 === 0, ok: complete, code,
      model: result.ok ? result.inference?.model : null, ttftMs: first, totalMs: performance.now() - started,
      attempts: result.ok ? result.inference?.tentatives : result.error.tentatives };
    samples.push(sample); console.log(JSON.stringify({ phase: "sample", n: n + 1, ...sample }));
    await writeFile(join(reportDir, "openrouter-benchmark.json"), JSON.stringify({ at: new Date().toISOString(), samples }, null, 2));
    if (code === "MODEL_QUOTA_EXHAUSTED" || code === "AUTH_FAILURE") break;
    await new Promise((r) => setTimeout(r, 3500));
  }
  const quantile = (xs, p) => xs.length === 0 ? null : [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * p) - 1)];
  const xs = samples.map((s) => s.totalMs), ttft = samples.flatMap((s) => s.ttftMs === null ? [] : [s.ttftMs]);
  const metrics = { n: samples.length, p50: quantile(xs, .5), p95: quantile(xs, .95), max: quantile(xs, 1),
    ttftP50: quantile(ttft, .5), ttftP95: quantile(ttft, .95),
    errorRate: samples.length ? samples.filter((s) => !s.ok).length / samples.length : null,
    fallbackRate: samples.length ? samples.filter((s) => (s.attempts?.length ?? 0) > 1).length / samples.length : null };
  const status = qualified.length >= 3 && samples.length > 0 && samples.every((s) => s.ok) ? "PASS" : "BLOCKED";
  await writeFile(join(reportDir, "openrouter-benchmark.json"), JSON.stringify({ status, metrics, samples }, null, 2));
  console.log(JSON.stringify({ status, metrics })); if (status !== "PASS") process.exitCode = 2;
}
