#!/usr/bin/env node
/** Real public synthetic qualification, through the product gateway. No injected answers or external fetch here. */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { loadEnvConfig } = createRequire(require.resolve("next/package.json"))("@next/env");
loadEnvConfig(root, false, { info() {}, error() {} });
const viteRequire = createRequire(require.resolve("vite/package.json", { paths: [dirname(require.resolve("vitest/package.json"))] }));
const { build } = viteRequire("esbuild");
const output = join(root, ".eval-out", "alexa-free-routing", "gateway.mjs");
await mkdir(dirname(output), { recursive: true });
await build({ stdin: { contents: 'export * from "@/server/alexa/model-gateway"; export {llm} from "@/server/egress/external-call"; export {ALEXA_GENERAL_PROMPT} from "@/i18n/alexa-general"; export {classerCharge} from "@/server/egress/classification";', resolveDir: root, loader: "ts" }, outfile: output,
  bundle: true, platform: "node", format: "esm", target: "node22", packages: "external", alias: { "@": join(root, "src") }, logLevel: "silent" });
const { qualifyAlexaModels, inferGeneralAlexa, getAlexaModelPolicy, llm, ALEXA_GENERAL_PROMPT, classerCharge } = await import(pathToFileURL(output).href);
const reportDir = join(root, "artifacts", "alexa-free-routing-2026-10-04");
await mkdir(reportDir, { recursive: true });
const report = { at: new Date().toISOString(), policy: getAlexaModelPolicy(), qualification: {}, samples: [] };
const reportFile = process.argv.includes("--qualify-only") ? "qualification.json" : process.argv.includes("--diagnostic") ? "diagnostic.json" : "providers.json";
const save = async () => writeFile(join(reportDir, reportFile), JSON.stringify(report, null, 2));
for (const provider of process.argv.includes("--probe-only") ? [] : ["groq-free", "gemini-free", "openrouter"]) {
  if ((provider === "groq-free" && !process.argv.includes("--groq-free-tier-confirmed"))
    || (provider === "gemini-free" && !process.argv.includes("--gemini-free-tier-confirmed"))) {
    report.qualification[provider] = { status: "NOT RUN", reason: "free-tier-confirmation-required" };
    console.log(JSON.stringify({ provider, ...report.qualification[provider] })); await save(); continue;
  }
  try {
    const data = await qualifyAlexaModels({ provider, freeTierConfirmed: provider !== "openrouter", timeoutMs: provider === "openrouter" ? 60000 : 10000, maxModels: 2 });
    const qualified = provider === "openrouter" ? data.modeles.some(m => m.qualification !== null) : data.qualified === true;
    if (!qualified) throw Object.assign(new Error("NO_QUALIFIED_MODEL"), { code: "NO_QUALIFIED_MODEL" });
    report.qualification[provider] = { ...data, status: "PASS" };
    console.log(JSON.stringify({ provider, status: "PASS", ...(provider === "openrouter" ? { quota: data.quota,
      models: data.modeles.filter(m => m.qualification).map(m => m.modelId), probes: data.probes } : data) }));
  } catch (cause) {
    report.qualification[provider] = { status: "FAIL", code: cause?.code ?? "UNAVAILABLE" };
    console.log(JSON.stringify({ provider, ...report.qualification[provider] }));
    process.exitCode = 2;
  }
  await save();
}
if (!process.argv.includes("--qualify-only")) {
  for (const question of ["Pourquoi le ciel est-il bleu ?", "ما هي ألوان قوس قزح؟", "Explain how a rainbow forms.", "علاش السماء زرقاء؟"]) {
    const started = performance.now();
    let result;
    if (process.argv.includes("--diagnostic")) {
      const raw = await llm({ purpose: "jarvis", messages: [{ role: "system", content: ALEXA_GENERAL_PROMPT }, { role: "user", content: question }],
        sessionToken: crypto.randomUUID(), promptVersion: "alexa-general-c4-v1", promptHash: "synthetic-public-diagnostic", timeoutMs: 15000,
        besoin: { json: false, streaming: false, outils: false, tache: "conversation" }, maxOutputTokens: 256, preferSmallFreeModel: true });
      result = raw.ok ? { ok: true, inference: raw.inference, outputClassification: classerCharge(raw.data, null), chars: raw.data.length } : raw;
    } else result = await inferGeneralAlexa(question);
    const sample = { question, ...result, totalMs: Math.round(performance.now() - started) };
    report.samples.push(sample); console.log(JSON.stringify(sample)); await save();
    if (result.ok === false) process.exitCode = 2;
  }
}
// Existing pool releases its pg sockets naturally. No browser or environment secrets are exported.
