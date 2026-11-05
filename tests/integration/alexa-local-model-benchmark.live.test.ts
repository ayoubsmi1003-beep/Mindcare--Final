import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { inferLocalText, releaseLocalModel } from "@/server/alexa/local-model";

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
    const cold = await inferLocalText(messages, { maxOutputTokens: 120, timeoutMs: 180_000 });
    const coldMs = Math.round(performance.now() - coldStart);
    const llamaMb = llamaMemoryMb();

    const warmStart = performance.now();
    const warm = await inferLocalText(messages, { maxOutputTokens: 120, timeoutMs: 180_000 });
    const warmMs = Math.round(performance.now() - warmStart);
    const after = process.memoryUsage();

    console.log(JSON.stringify({
      cold: { ms: coldMs, characters: cold.length, head: cold.slice(0, 80) },
      warm: { ms: warmMs, characters: warm.length, head: warm.slice(0, 80) },
      llamaServerMb: llamaMb,
      nodeRssMb: Math.round(after.rss / 1024 / 1024),
      nodeRssDeltaMb: Math.round((after.rss - before.rss) / 1024 / 1024),
    }, null, 2));

    expect(cold.length).toBeGreaterThan(0);
    expect(warm.length).toBeGreaterThan(0);
    await releaseLocalModel();
  }, 420_000);
});
