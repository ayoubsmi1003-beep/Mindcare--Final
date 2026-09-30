import { expect, it } from "vitest";
import { ouvrirGeminiLive } from "@/server/egress/external-call";
import { withCaller } from "@/server/db/withCaller";

/** Opt-in live transport check: no patient data, no fabricated voice qualification. */
it.runIf(process.env.MINDCARE_GEMINI_LIVE_CHECK === "1")("authenticates the actual requested Gemini Live model with the server key", async () => {
  try {
    const cloud = await withCaller(null, async (q) => (await q.query<{ cloud: boolean }>("SELECT app.is_cloud_dev() AS cloud"))[0]?.cloud);
    console.info(JSON.stringify({ event: "alexa.live.guard", cloudDevelopment: cloud === true }));
  } catch (error) {
    const code = error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code : "UNAVAILABLE";
    console.info(JSON.stringify({ event: "alexa.live.guard", code }));
  }
  const result = await ouvrirGeminiLive({ sessionToken: crypto.randomUUID(), currentPatientId: null,
    onEvent: () => {}, executeTool: async () => ({ status: "unavailable" }), signal: AbortSignal.timeout(20_000) });
  expect(result.ok, "Native session must be acknowledged by Google; no simulated socket.").toBe(true);
  if (!result.ok) return;
  try { await result.data.sendAudio(Buffer.alloc(8_000).toString("base64")); }
  finally { result.data.close(); }
}, 25_000);
