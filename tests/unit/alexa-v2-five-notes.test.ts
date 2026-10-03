import { describe, expect, it, vi } from "vitest";
import { clinicalConsultationSchema, type ClinicalContext } from "@/shared/alexa/clinical";
import { buildCaseSummary, buildStructuredSummaryNarrative } from "@/server/alexa/case-summary";
import { localResponse } from "@/server/alexa/local-response";
import { createSafeClinicalPayload } from "@/server/alexa/privacy-boundary";
import { planRequest } from "@/shared/alexa/request-plan";
import { runAlexa } from "@/server/alexa/orchestrator";
import type { AlexaEvent } from "@/shared/alexa/turn";
import type { DbPort } from "@/services/db/port";

const patientId = "11111111-1111-4111-8111-111111111111";
const visitId = "22222222-2222-4222-8222-222222222222";
const rawText = "Nadia décrit un contexte familial difficile, sans conflit actuel.";
const fields = [rawText, "Sommeil de 7 heures, sans réveil nocturne.", "Contact adapté.", "Anxiété décrite par la sœur, pas par le patient.", "Maintien du rendez-vous prévu."];
function record(): ClinicalContext {
  return { patientId, sourceRevision: "a".repeat(64), diagnoses: [], scales: [], treatments: { current: [], history: [], historyComplete: true },
    consultations: [{ id: visitId, startedAt: "2026-10-01T10:00:00Z", endedAt: "2026-10-01T11:00:00Z", rawNotes: rawText, rawNotesVersion: "raw-revision", notes: [{
      id: "33333333-3333-4333-8333-333333333333", version: "soap-revision", status: "draft" as const,
      subjective: fields[1]!, objective: fields[2]!, assessment: fields[3]!, plan: fields[4]!, amendments: [],
    }] }], coverage: { requested: 1, returned: 1, complete: true, hasMore: false } };
}
const textOf = (events: { text: string }[]) => events.map(event => event.text).join("\n");

describe("all five recorded consultation note areas", () => {
  it("accepts the separate working note and explicit SOAP draft status in the strict local contract", () => {
    const parsed = clinicalConsultationSchema.safeParse(record().consultations[0]);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toMatchObject({ rawNotes: rawText, rawNotesVersion: "raw-revision", notes: [{ status: "draft" }] });
  });
  it("answers from the separate working note when no SOAP note exists", () => {
    const context = record(); context.consultations[0]!.notes = [];
    const answer = localResponse(context, planRequest("la dernière consultation", null), ["Nadia"]);
    expect(textOf(answer)).toContain("contexte familial difficile, sans conflit actuel.");
    expect(textOf(answer)).not.toMatch(/aucune note|aucun passage/iu);
    expect(answer.some(event => event.sources.some(source => source.id === visitId && source.version === "raw-revision"))).toBe(true);
  });
  it("includes raw and all four SOAP fields with unsigned provenance and preserved qualifiers", () => {
    const answer = localResponse(record(), planRequest("Que disent ses notes ?", null), ["Nadia"]);
    for (const field of fields) expect(textOf(answer)).toContain(field.replace("Nadia ", ""));
    expect(textOf(answer)).toMatch(/notes de travail/iu);
    expect(textOf(answer)).toMatch(/non sign[ée]|brouillon/iu);
    expect(textOf(answer)).not.toContain("Nadia");
  });
  it("stores each of the five sourced note areas in the summary detail section", () => {
    const summary = buildCaseSummary(record(), ["Nadia"]);
    const details = summary.etat_actuel;
    for (const field of fields) expect(details.map(item => item.texte).join("\n")).toContain(field.replace("Nadia ", ""));
    expect(details.filter(item => item.sources.some(source => source.id === visitId))).toHaveLength(5);
    expect(details.map(item => item.texte).join(" ")).toMatch(/notes de travail|Subjectif|Objectif|[ée]valuation|Plan/iu);
  });
  it.each(["fr", "ar"] as const)("preserves working-note unsigned provenance in the %s overview", language => {
    const context = record(); context.consultations[0]!.notes = [];
    const overview = buildStructuredSummaryNarrative(context, [], language)[2]!.texte;
    expect(overview).toMatch(language === "fr" ? /Notes de travail.*non signé/u : /ملاحظات العمل.*غير موقّعة/u);
  });
  it("does not describe saved draft SOAP notes as signed in chronology or overview fallback", () => {
    const context = record(); context.consultations[0]!.rawNotes = null;
    const note = context.consultations[0]!.notes[0]!;
    note.subjective = "Observation complète. ".repeat(60);
    note.objective = ""; note.assessment = ""; note.plan = "";
    const summary = buildCaseSummary(context, []);
    expect(summary.chronologie[0]!.entrees[0]!.texte).toContain("SOAP enregistrée");
    expect(summary.apercu.contexte[2]!.texte).toContain("SOAP enregistrée");
    expect(summary.chronologie[0]!.entrees[0]!.texte).not.toContain("signée");
    expect(summary.apercu.contexte[2]!.texte).not.toContain("signée");
  });
  it("keeps current working notes distinct from the last completed consultation", () => {
    const context = record();
    const current = { ...context.consultations[0]!, id: "44444444-4444-4444-8444-444444444444", startedAt: "2026-10-02T10:00:00Z", endedAt: null, rawNotes: "Information recueillie aujourd’hui uniquement.", notes: [] };
    const summary = buildCaseSummary({ ...context, currentConsultation: current }, []);
    expect(summary.etat_actuel.map(item => item.texte).join(" ")).toContain("Information recueillie aujourd’hui uniquement.");
    expect(summary.etat_actuel.map(item => item.texte).join(" ")).toMatch(/en cours/iu);
    expect(summary.apercu.contexte[2]?.texte).not.toContain("Information recueillie aujourd’hui uniquement.");
  });
  it("withholds a long raw note whole instead of losing a late negation", () => {
    const context = record(); context.consultations[0]!.rawNotes = "Sommeil perturbé. " + "Description détaillée. ".repeat(100) + "Cela concerne sa sœur et non le patient.";
    context.consultations[0]!.notes = [];
    const answer = localResponse(context, planRequest("la dernière consultation", null), []);
    expect(textOf(answer)).not.toContain("Sommeil perturbé.");
    expect(textOf(answer)).toMatch(/pas affich[ée]s/iu);
  });
  it("includes a complete longer working note in the page summary with its final qualifier", () => {
    const context = record();
    const text = "Contexte familial et antécédents recueillis. ".repeat(18) + "Ce symptôme concerne la sœur et non le patient.";
    context.consultations[0]!.rawNotes = text;
    const summary = buildCaseSummary(context, []);
    expect(summary.etat_actuel[0]!.texte).toContain(text);
    expect(summary.etat_actuel).toHaveLength(5);
  });
  it("discloses a summary field above its bound without quoting an unsafe prefix", () => {
    const context = record(); context.consultations[0]!.rawNotes = "Contexte familial. ".repeat(300) + "La sœur est concernée, pas le patient.";
    const detail = buildCaseSummary(context, []).etat_actuel.map(item => item.texte).join(" ");
    expect(detail).not.toContain("Contexte familial.");
    expect(detail).toContain("passages longs");
  });
  it("does not leak any raw note into the actual external projection and marks narrative omission", () => {
    const context = record(); context.consultations[0]!.notes = [];
    const safe = createSafeClinicalPayload(context, "Résume la dernière consultation", ["Nadia"]);
    expect(safe.ok).toBe(true);
    if (safe.ok) {
      expect(JSON.stringify(safe.payload)).not.toMatch(/Nadia|familial|rawNotes|raw-revision/u);
      expect(safe.payload.facts[0]).toMatchObject({ notePresent: true });
      expect(safe.payload.coverage.narrativeOmitted).toBe(true);
    }
  });
  it.each(["Résume le cas", "لخص الملف"])("the shared conversational summary contains all five local areas: %s", async text => {
    const context: ClinicalContext = record(), events: AlexaEvent[] = [];
    const db: Pick<DbPort, "rpc"> = { rpc: async <T>() => ({ ok: true, data: [{ id: patientId, first_name: "Nadia", last_name: "Test" }] as T[] }) };
    const infer = vi.fn();
    await runAlexa({ text, conversationId: `five-notes-${text}`, clientTurnId: patientId, appContext: { patientId, page: "/patients/test" } },
      { db, actor: "five-notes-actor", knowledge: { rpc: async <T>() => ({ data: null as T | null, error: null }) }, build: async () => context, infer }, event => events.push(event), new AbortController().signal);
    const answer = events.filter((event): event is Extract<AlexaEvent, { type: "sentence" }> => event.type === "sentence");
    for (const field of fields) expect(textOf(answer)).toContain(field.replace("Nadia ", ""));
    expect(infer).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "done", patientId });
  });
});
