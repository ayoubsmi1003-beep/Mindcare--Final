import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AlexaEvent } from "@/shared/alexa/turn";
import { ouvrirSession } from "@/server/auth/session";
import { alexaDb } from "@/server/alexa/db";
import { clientSql } from "@/server/jarvis/client-sql";
import { runAlexa } from "@/server/alexa/orchestrator";

/**
 * Patient/application correctness with a real practitioner session.
 * Read-only governed `search_patients` oracle; the answer text is never stored.
 */
const enabled = process.env["MINDCARE_ALEXA_PATIENT"] === "1" && Boolean(process.env["MINDCARE_DATABASE_URL"]);

interface Case { question: string; spec: Record<string, unknown> }

const cases: Case[] = [
  { question: "Combien de patients actifs compte le cabinet ?", spec: { mode: "count", population: "active", filters: [] } },
  { question: "Combien de patients actifs n'ont pas de téléphone ?", spec: { mode: "count", population: "active", filters: [{ field: "phone", op: "missing", value: null }] } },
  { question: "Combien de patients n'ont pas de carte d'identité ?", spec: { mode: "count", population: "active", filters: [{ field: "identity_card", op: "missing", value: null }] } },
  { question: "Combien de patients sont mineurs ?", spec: { mode: "count", population: "active", filters: [{ field: "age", op: "lt", value: 18 }] } },
  { question: "Combien de patients n'ont pas de date de naissance ?", spec: { mode: "count", population: "active", filters: [{ field: "birth_date", op: "missing", value: null }] } },
  { question: "Combien de patients n'ont jamais eu de consultation terminée ?", spec: { mode: "count", population: "active", filters: [{ field: "completed_consultations", op: "eq", value: 0 }] } },
  { question: "Combien de patients n'ont pas été vus depuis six mois ?", spec: { mode: "count", population: "active", filters: [{ field: "no_completed_months", op: "eq", value: 6 }] } },
  { question: "Combien de patients ont un solde impayé ?", spec: { mode: "count", population: "active", filters: [{ field: "outstanding_balance", op: "gt", value: 0 }] } },
];

async function ask(actor: string, question: string): Promise<{ text: string; status: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Deadline", "TimeoutError")), 180_000);
  const events: AlexaEvent[] = [];
  try {
    await runAlexa(
      { text: question, conversationId: `patient-${randomUUID()}`, clientTurnId: randomUUID(), appContext: { patientId: null, page: "/jarvis" } },
      { actor, db: alexaDb(actor), knowledge: clientSql(actor), native: true, contextKey: JSON.stringify({ patientId: null, page: "/jarvis" }) },
      event => { events.push(event); },
      controller.signal,
    );
  } finally {
    clearTimeout(timer);
  }
  const sentences = events.filter((event): event is Extract<AlexaEvent, { type: "sentence" }> => event.type === "sentence");
  const done = events.find((event): event is Extract<AlexaEvent, { type: "done" }> => event.type === "done");
  return { text: sentences.map(sentence => sentence.text).join("\n"), status: done?.status ?? null };
}

const compact = (value: string) => value.replace(/[\s\u00a0\u202f]/gu, "");

describe.skipIf(!enabled)("Alexa patient aggregates", () => {
  it("answers every count with the authorized total", async () => {
    const session = await ouvrirSession(
      process.env["DOCTOR_ACCOUNT_USERNAME"] ?? "",
      process.env["DOCTOR_ACCOUNT_PASSWORD"] ?? "",
    );
    expect(session).not.toBeNull();
    const actor = session!.userId;
    const failures: string[] = [];
    for (const testCase of cases) {
      const oracle = await alexaDb(actor).rpc<{ total: number }>("search_patients", {
        p_spec: JSON.stringify(testCase.spec), p_as_of: new Date().toISOString(),
      });
      if (!oracle.ok) { failures.push(`${testCase.question}:oracle-error`); continue; }
      const total = Number(oracle.data[0]?.total);
      const answer = await ask(actor, testCase.question);
      const contains = compact(answer.text).includes(String(total));
      const zeroExpressed = total === 0 && /aucun|aucune|tous|toutes|\b0\b/iu.test(answer.text);
      console.log(JSON.stringify({ question: testCase.question, total, status: answer.status, contains: contains || zeroExpressed, characters: answer.text.length }));
      if (answer.status === "failed" || (!contains && !zeroExpressed)) failures.push(`${testCase.question}:${answer.status}:${contains}`);
    }
    expect(failures).toEqual([]);
  }, 900_000);
});
