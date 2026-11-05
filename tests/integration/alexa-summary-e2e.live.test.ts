import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AlexaEvent } from "@/shared/alexa/turn";
import { ouvrirSession } from "@/server/auth/session";
import { alexaDb } from "@/server/alexa/db";
import { clientSql } from "@/server/jarvis/client-sql";
import { runAlexa } from "@/server/alexa/orchestrator";

/**
 * One real patient dossier, read-only. The summary/notes text is never printed
 * or persisted; only the status, sentence count and source types are reported.
 */
const enabled = process.env["MINDCARE_ALEXA_PATIENT"] === "1" && Boolean(process.env["MINDCARE_DATABASE_URL"]);

async function ask(actor: string, patientId: string, question: string): Promise<{ status: string | null; sentences: number; sources: string[]; failed: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Deadline", "TimeoutError")), 240_000);
  const events: AlexaEvent[] = [];
  try {
    await runAlexa(
      { text: question, conversationId: `summary-${randomUUID()}`, clientTurnId: randomUUID(), appContext: { patientId, page: `/patients/${patientId}` } },
      { actor, db: alexaDb(actor), knowledge: clientSql(actor), native: true, contextKey: JSON.stringify({ patientId, page: `/patients/${patientId}` }) },
      event => { events.push(event); },
      controller.signal,
    );
  } finally {
    clearTimeout(timer);
  }
  const sentences = events.filter((event): event is Extract<AlexaEvent, { type: "sentence" }> => event.type === "sentence");
  const done = events.find((event): event is Extract<AlexaEvent, { type: "done" }> => event.type === "done");
  return {
    status: done?.status ?? null,
    sentences: sentences.length,
    sources: [...new Set(sentences.flatMap(sentence => sentence.sources.map(source => source.type)))],
    failed: done?.status === "failed" || sentences.length === 0,
  };
}

describe.skipIf(!enabled)("Alexa patient dossier", () => {
  it("summarises a real dossier and lists its active diagnoses without failure", async () => {
    const session = await ouvrirSession(
      process.env["DOCTOR_ACCOUNT_USERNAME"] ?? "",
      process.env["DOCTOR_ACCOUNT_PASSWORD"] ?? "",
    );
    expect(session).not.toBeNull();
    const actor = session!.userId;
    const listed = await alexaDb(actor).rpc<{ rows: { id: string }[] }>("search_patients", {
      p_spec: JSON.stringify({ mode: "list", population: "active", filters: [{ field: "completed_consultations", op: "gte", value: 1 }], limit: 1 }),
      p_as_of: new Date().toISOString(),
    });
    expect(listed.ok).toBe(true);
    const patientId = listed.ok ? listed.data[0]?.rows[0]?.id : undefined;
    expect(patientId).toBeTruthy();

    const summary = await ask(actor, patientId!, "Résume le dossier du patient sélectionné.");
    const diagnoses = await ask(actor, patientId!, "Quels diagnostics actifs figurent au dossier du patient sélectionné ?");
    const notes = await ask(actor, patientId!, "Montre les notes de la dernière consultation.");
    const treatments = await ask(actor, patientId!, "Quels traitements sont actifs pour ce patient ?");
    console.log(JSON.stringify({
      summary: { status: summary.status, sentences: summary.sentences, sources: summary.sources },
      diagnoses: { status: diagnoses.status, sentences: diagnoses.sentences, sources: diagnoses.sources },
      notes: { status: notes.status, sentences: notes.sentences, sources: notes.sources },
      treatments: { status: treatments.status, sentences: treatments.sentences, sources: treatments.sources },
    }));
    expect(summary.failed).toBe(false);
    expect(diagnoses.failed).toBe(false);
    expect(notes.failed).toBe(false);
    expect(treatments.failed).toBe(false);
    expect(summary.sources.length).toBeGreaterThan(0);
    expect(diagnoses.sources.length).toBeGreaterThan(0);
    expect(notes.sources.length).toBeGreaterThan(0);
    expect(treatments.sources.length).toBeGreaterThan(0);
  }, 600_000);
});
