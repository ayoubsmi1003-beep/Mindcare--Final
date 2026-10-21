import * as provider from "@/server/egress/external-call";
import { classerCharge } from "@/server/egress/classification";
import { expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { inferGeneralAlexa } from "@/server/alexa/model-gateway";
import { runAlexa } from "@/server/alexa/orchestrator";
import { alexaDb } from "@/server/alexa/db";
import { clientSql } from "@/server/jarvis/client-sql";
import type { AlexaEvent } from "@/shared/alexa/turn";

it.skipIf(process.env.MINDCARE_DELIVERY_LIVE !== "1")("real Gemini answers through application routing with existing local role scope", async () => {
  process.loadEnvFile(".env");
  const transport = vi.spyOn(provider, "appelGeminiDirect");
  const result = spawnSync("docker", ["exec", "mc-p3", "psql", "-U", "postgres", "-d", "mindcare", "-Atc", "SELECT id FROM app.profiles WHERE role='owner' AND is_active ORDER BY id LIMIT 1"], { encoding: "utf8" });
  expect(result.status).toBe(0);
  const actor = result.stdout.trim();
  expect(actor).toMatch(/^[0-9a-f-]{36}$/);
  const knowledge = clientSql(actor);
  const conversation = await knowledge.rpc("start_jarvis_conversation", {});
  expect(conversation.error).toBeNull();
  const conversationId = String(conversation.data);
  for (const text of ["Pourquoi le ciel est-il bleu ?", "Quelle est la capitale du Japon ?", "Pourquoi le ciel est-il bleu ?"]) {
    const outcomes: unknown[] = [];
    const events: AlexaEvent[] = [];
    await runAlexa({ text, conversationId, clientTurnId: randomUUID(), appContext: { patientId: null, page: "/jarvis" } },
      { actor, db: alexaDb(actor), knowledge, general: async (question, options) => { const result = await inferGeneralAlexa(question, options); outcomes.push(result); return result; } }, event => events.push(event), AbortSignal.timeout(60000));
    const answer = events.filter(event => event.type === "sentence").map(event => event.type === "sentence" ? event.text : "").join(" ");
    expect(events.some(event => event.type === "error")).toBe(false);
    expect(events.some(event => event.type === "done" && !event.limited), JSON.stringify({ text, events, outcomes, providerOutputs: await Promise.all(transport.mock.results.slice(-1).filter(r => r.type === "return").map(async r => { const result = await Promise.resolve(r.value).catch((cause: unknown) => ({ blocked: true, parts: [], error: typeof cause === "object" && cause !== null && "code" in cause ? cause.code : "unknown" })); const answer = result.parts.filter((p: provider.PartieGeminiDirecte) => !p.thought).map((p: provider.PartieGeminiDirecte) => p.text ?? "").join(""); return { answer, verdict: classerCharge(answer, null), finishReason: "finishReason" in result ? result.finishReason : null, providerError: "error" in result ? result.error : null }; })) })).toBe(true);
    expect(answer).not.toMatch(/indisponible|local.*pas disponible/iu);
    if (text.includes("Japon")) expect(answer).toMatch(/Tokyo/iu);
    else expect(answer).toMatch(/lumière|diffusion|bleu/iu);
  }
}, 180000);
