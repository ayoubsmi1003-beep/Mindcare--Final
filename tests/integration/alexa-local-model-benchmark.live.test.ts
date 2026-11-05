import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { inferLocalCompletion, releaseLocalModel } from "@/server/alexa/local-model";

/**
 * Measures the pinned local model on the real development machine.
 *
 *   $env:ALEXA_LOCAL_BENCH = "1"
 *   pnpm vitest run tests/integration/alexa-local-model-benchmark.live.test.ts
 *
 * No patient data: the prompt is synthetic and non-identifying.
 */
const enabled = process.env["ALEXA_LOCAL_BENCH"] === "1";

const messages = [
  { role: "system" as const, content: "Tu es un assistant clinique. Réponds en français, en une phrase concise." },
  { role: "user" as const, content: "Pourquoi le lithium nécessite-t-il une surveillance de la fonction rénale ?" },
];

function llamaMemoryMb(): number | null {
  try {
    const raw = execFileSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "$p=Get-Process llama-server -ErrorAction SilentlyContinue; if($p){[math]::Round(($p | Measure-Object WorkingSet64 -Sum).Sum/1MB)}",
    ], { encoding: "utf8", windowsHide: true, timeout: 15_000 }).trim();
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

describe.skipIf(!enabled)("local model benchmark (pinned MiniCPM)", () => {
  it("measures cold start, warm generation and resident memory", async () => {
    const before = process.memoryUsage();
    const coldStart = performance.now();
    const cold = await inferLocalCompletion(messages, { maxOutputTokens: 120, timeoutMs: 180_000 });
    const coldMs = Math.round(performance.now() - coldStart);
    const llamaMb = llamaMemoryMb();

    const warmStart = performance.now();
    const warm = await inferLocalCompletion(messages, { maxOutputTokens: 120, timeoutMs: 180_000 });
    const warmMs = Math.round(performance.now() - warmStart);
    const after = process.memoryUsage();
    const text = (value: typeof cold) => value.kind === "answer" ? value.text : "";

    console.log(JSON.stringify({
      cold: { ms: coldMs, characters: text(cold).length, tokensOut: cold.tokensOut, tokensPerSecond: cold.tokensOut > 0 ? Number((cold.tokensOut / (coldMs / 1000)).toFixed(2)) : null },
      warm: { ms: warmMs, characters: text(warm).length, tokensOut: warm.tokensOut, tokensPerSecond: warm.tokensOut > 0 ? Number((warm.tokensOut / (warmMs / 1000)).toFixed(2)) : null },
      llamaServerMb: llamaMb,
      nodeRssMb: Math.round(after.rss / 1024 / 1024),
      nodeRssDeltaMb: Math.round((after.rss - before.rss) / 1024 / 1024),
      ttft: "not measured: non-streaming client",
    }, null, 2));

    expect(text(cold).length).toBeGreaterThan(0);
    expect(text(warm).length).toBeGreaterThan(0);
    await releaseLocalModel();
  }, 420_000);
});
