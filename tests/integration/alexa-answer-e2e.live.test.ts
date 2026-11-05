import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AlexaEvent } from "@/shared/alexa/turn";
import { clientSql } from "@/server/jarvis/client-sql";
import { alexaDb } from "@/server/alexa/db";
import { runAlexa } from "@/server/alexa/orchestrator";

/**
 * End-to-end Gate D: one real knowledge turn, real model, real governed gates.
 *
 * The question is non-identifying and the answer is never written to disk.
 * The actor is a synthetic UUID: the knowledge gates do not depend on a
 * practitioner assignment, and no patient record is requested.
 *
 *   $env:MINDCARE_ALEXA_E2E = "1"
 *   $env:MINDCARE_DATABASE_URL = ...   (already in the shell)
 *   pnpm vitest run tests/integration/alexa-answer-e2e.live.test.ts
 */
const enabled = process.env["MINDCARE_ALEXA_E2E"] === "1" && Boolean(process.env["MINDCARE_DATABASE_URL"]);
const ACTOR = "00000000-0000-4000-8000-000000000001";

describe.skipIf(!enabled)("Alexa knowledge turn, end to end", () => {
  it("answers the sertraline precautions question from approved evidence", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("Deadline", "TimeoutError")), 240_000);
    const events: AlexaEvent[] = [];
    const toolCalls: string[] = [];
    const started = performance.now();
    try {
      await runAlexa(
        {
          text: "Quelles précautions pour la sertraline ?",
          conversationId: `trace-${randomUUID()}`,
          clientTurnId: randomUUID(),
          appContext: { patientId: null, page: "/jarvis" },
        },
        {
          actor: ACTOR,
          db: alexaDb(ACTOR),
          knowledge: clientSql(ACTOR),
          native: true,
          contextKey: JSON.stringify({ patientId: null, page: "/jarvis" }),
          agentObserve: call => {
            toolCalls.push(call.name === "search_knowledge"
              ? `search_knowledge:${String(call.args["query"] ?? "")}`
              : call.name);
          },
        },
        event => { events.push(event); },
        controller.signal,
      );
    } finally {
      clearTimeout(timer);
    }
    const elapsedMs = Math.round(performance.now() - started);

    const sentences = events.filter((event): event is Extract<AlexaEvent, { type: "sentence" }> => event.type === "sentence");
    const text = sentences.map(event => event.text).join("\n");
    const done = events.find((event): event is Extract<AlexaEvent, { type: "done" }> => event.type === "done");
    const knowledgeSources = sentences.flatMap(event => event.sources).filter(source => source.type === "knowledge");

    console.log(JSON.stringify({
      elapsedMs,
      sentences: sentences.length,
      characters: text.length,
      status: done?.status ?? null,
      limited: done?.limited ?? null,
      knowledgeSources: knowledgeSources.length,
      toolCalls,
      parts: done?.parts?.map(part => ({ status: part.status, goal: part.goal })) ?? null,
      mentionsDrug: /sertraline/iu.test(text),
      mentionsPrecaution: /pr[ée]caution|surveillance|r[ée]nal|rein/iu.test(text),
      abstained: /aucune preuve suffisante/iu.test(text),
    }, null, 2));

    expect(sentences.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/aucune preuve suffisante/iu);
    expect(text).toMatch(/sertraline/iu);
    expect(text).toMatch(/pr[ée]caution|surveillance|r[ée]nal|rein/iu);
    expect(knowledgeSources.length).toBeGreaterThan(0);
    expect(done?.status).not.toBe("failed");
  }, 300_000);
});
