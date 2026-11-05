import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AlexaEvent } from "@/shared/alexa/turn";
import { ouvrirSession } from "@/server/auth/session";
import { alexaDb } from "@/server/alexa/db";
import { clientSql } from "@/server/jarvis/client-sql";
import { runAlexa } from "@/server/alexa/orchestrator";

/**
 * Structural smoke execution for the semantic categories. This is NOT a
 * semantic PASS: it proves the pipeline completes, produces text and carries
 * provenance. The result status is SMOKE, never PASS.
 */
const enabled = process.env["MINDCARE_ALEXA_PATIENT"] === "1" && Boolean(process.env["MINDCARE_DATABASE_URL"]);
const require = createRequire(import.meta.url);
const allCases = require("../eval/alexa-reliability-100.cjs") as ReadonlyArray<{
  id: string; category: string; question: string; turns?: readonly string[];
}>;
const selected = process.env["SMOKE_CATEGORY"] ?? "";
const wantedIds = process.env["SMOKE_IDS"]?.split(",").map(value => value.trim()).filter(Boolean);
const cases = allCases.filter(testCase => ["summaries", "notes", "mixed", "multi_turn"].includes(testCase.category)
  && (!selected || testCase.category === selected)
  && (!wantedIds?.length || wantedIds.includes(testCase.id)));

interface Answer { status: string | null; sentences: number; sources: string[]; chars: number; hasDigit: boolean;
  calls: { name: string; keys: string[]; section?: string; query?: string }[];
  parts: { status: string; reasonClass: string }[];
  stages: string[];
  fallbackText: boolean }

const classifyReason = (text: string): string =>
  /aucune preuve/iu.test(text) ? "no-evidence"
    : /p[ée]riode|dates? de d[ée]but/iu.test(text) ? "period"
      : /quel patient|quelle information/iu.test(text) ? "clarification"
        : /synth[èe]se|r[ée]ponse fiable/iu.test(text) ? "generation"
          : /limite du tour/iu.test(text) ? "budget"
            : "other";

async function turn(actor: string, patientId: string, question: string, conversationId: string): Promise<Answer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Deadline", "TimeoutError")), 180_000);
  const events: AlexaEvent[] = [];
  const calls: Answer["calls"] = [];
  try {
    await runAlexa(
      { text: question, conversationId, clientTurnId: randomUUID(), appContext: { patientId, page: `/patients/${patientId}` } },
      { actor, db: alexaDb(actor), knowledge: clientSql(actor), native: true, contextKey: JSON.stringify({ patientId, page: `/patients/${patientId}` }),
        agentObserve: call => {
          const keys = Object.keys(call.args);
          calls.push({ name: call.name, keys, ...(typeof call.args["section"] === "string" ? { section: call.args["section"] } : {}), ...(typeof call.args["query"] === "string" ? { query: call.args["query"] } : {}) });
        } },
      event => { events.push(event); },
      controller.signal,
    );
  } finally {
    clearTimeout(timer);
  }
  const sentences = events.filter((event): event is Extract<AlexaEvent, { type: "sentence" }> => event.type === "sentence");
  const done = events.find((event): event is Extract<AlexaEvent, { type: "done" }> => event.type === "done");
  const text = sentences.map(sentence => sentence.text).join("\n");
  return {
    status: done?.status ?? null,
    sentences: sentences.length,
    sources: [...new Set(sentences.flatMap(sentence => sentence.sources.map(source => source.type)))],
    chars: text.length,
    hasDigit: /\d/u.test(text),
    calls,
    parts: done?.parts?.map(part => ({ status: part.status, reasonClass: classifyReason(part.reason ?? "") })) ?? [],
    stages: events.filter((event): event is Extract<AlexaEvent, { type: "stage" }> => event.type === "stage").map(event => event.stage),
    fallbackText: /synth[eè]se v[eé]rifi[eé]e est indisponible|aucune preuve suffisante|r[eé]ponse fiable est indisponible/iu.test(text),
  };
}

describe.skipIf(!enabled)("dossier smoke", () => {
  it("executes the selected semantic category", async () => {
    const session = await ouvrirSession(process.env["DOCTOR_ACCOUNT_USERNAME"] ?? "", process.env["DOCTOR_ACCOUNT_PASSWORD"] ?? "");
    expect(session).not.toBeNull();
    const actor = session!.userId;
    const listed = await alexaDb(actor).rpc<{ rows: { id: string }[] }>("search_patients", {
      p_spec: JSON.stringify({ mode: "list", population: "active", filters: [{ field: "completed_consultations", op: "gte", value: 1 }], limit: 1 }),
      p_as_of: new Date().toISOString(),
    });
    expect(listed.ok).toBe(true);
    const patientId = listed.ok ? listed.data[0]?.rows[0]?.id : undefined;
    expect(patientId).toBeTruthy();

    const outcomes = [];
    for (const testCase of cases) {
      const conversationId = `smoke-${randomUUID()}`;
      const first = await turn(actor, patientId!, testCase.turns?.[0] ?? testCase.question, conversationId);
      const second = testCase.turns?.[1] ? await turn(actor, patientId!, testCase.turns[1], conversationId) : null;
      const relevant = second ?? first;
      const needsKnowledge = /recommand|approuv|référence|interaction|contre-indication|surveillance|précaution/iu.test(testCase.question);
      const knowledgeOk = !needsKnowledge || relevant.sources.includes("knowledge");
      const acceptable = (answer: Answer) => answer.status === "completed" || answer.status === "empty"
        ? answer.sentences > 0 && answer.chars > 20
        : answer.status === "partial" ? answer.sentences > 0 && answer.sources.length > 0 : false;
      const structural = acceptable(first) && (!second || acceptable(second));
      const smoke = structural && knowledgeOk;
      const outcome = { id: testCase.id, category: testCase.category, status: smoke ? "SMOKE" : "FAIL",
        first, second, knowledgeOk };
      outcomes.push(outcome);
      console.log(JSON.stringify(outcome));
    }
    const directory = join(".eval-out", "alexa-dossier-smoke");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `report-${selected || "all"}-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`),
      JSON.stringify({ generatedAt: new Date().toISOString(), category: selected || "all", outcomes }, null, 2), "utf8");
    expect(outcomes.filter(outcome => outcome.status === "FAIL")).toEqual([]);
  }, 3_600_000);
});
