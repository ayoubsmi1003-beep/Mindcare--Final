import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AlexaEvent } from "@/shared/alexa/turn";
import { ouvrirSession } from "@/server/auth/session";
import { alexaDb } from "@/server/alexa/db";
import { clientSql } from "@/server/jarvis/client-sql";
import { runAlexa } from "@/server/alexa/orchestrator";

/** Application aggregates with a governed `query_alexa_records` oracle. */
const enabled = process.env["MINDCARE_ALEXA_PATIENT"] === "1" && Boolean(process.env["MINDCARE_DATABASE_URL"]);

const algeriaDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers" }).format(date);
const today = algeriaDate(new Date());
const [year, month] = today.split("-").map(Number);
const pad = (value: number) => String(value).padStart(2, "0");
const monthStart = `${year}-${pad(month!)}-01T00:00:00+01:00`;
const nextMonthStart = month === 12 ? `${year! + 1}-01-01` : `${year}-${pad(month! + 1)}-01`;
const monthEnd = `${nextMonthStart}T00:00:00+01:00`;
const yearStart = `${year}-01-01T00:00:00+01:00`;
const yearEnd = `${year! + 1}-01-01T00:00:00+01:00`;
const tomorrow = new Date(`${today}T12:00:00+01:00`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
const dayStart = `${today}T00:00:00+01:00`;
const dayEnd = `${algeriaDate(tomorrow)}T00:00:00+01:00`;

const cases = [
  { question: "Combien de rendez-vous sont prévus aujourd'hui ?", domain: "agenda", spec: { from: dayStart, to: dayEnd } },
  { question: "Combien de rendez-vous confirmés aujourd'hui ?", domain: "agenda", spec: { from: dayStart, to: dayEnd, statuses: ["confirmed"] } },
  { question: "Combien de consultations terminées cette année ?", domain: "consultations", spec: { mode: "count", status: "closed", from: yearStart, to: yearEnd } },
  { question: "Combien de paiements sont en attente ?", domain: "finance", spec: { mode: "list", state: "pending", from: monthStart, to: monthEnd } },
  { question: "Combien de documents ont été émis ce mois ?", domain: "documents", spec: { from: monthStart, to: monthEnd, status: "issued" } },
  { question: "Combien de nouveaux patients ce mois ?", domain: "patients", spec: { mode: "count", population: "active", createdPeriod: { from: monthStart, to: monthEnd } } },
] as const;

async function ask(actor: string, question: string): Promise<{ text: string; status: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Deadline", "TimeoutError")), 180_000);
  const events: AlexaEvent[] = [];
  try {
    await runAlexa(
      { text: question, conversationId: `app-${randomUUID()}`, clientTurnId: randomUUID(), appContext: { patientId: null, page: "/jarvis" } },
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

describe.skipIf(!enabled)("Alexa application aggregates", () => {
  it("answers each application aggregate with the governed total", async () => {
    const session = await ouvrirSession(
      process.env["DOCTOR_ACCOUNT_USERNAME"] ?? "",
      process.env["DOCTOR_ACCOUNT_PASSWORD"] ?? "",
    );
    expect(session).not.toBeNull();
    const actor = session!.userId;
    const failures: string[] = [];
    for (const testCase of cases) {
      const oracle = testCase.domain === "patients"
        ? await alexaDb(actor).rpc<{ total: number }>("search_patients", { p_spec: JSON.stringify(testCase.spec), p_as_of: new Date().toISOString() })
        : await alexaDb(actor).rpc<{ total: number }>("query_alexa_records", {
            p_domain: testCase.domain, p_spec: JSON.stringify(testCase.spec), p_as_of: new Date().toISOString(),
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
