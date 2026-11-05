import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "@/server/alexa/agent-loop";

const patient = "22222222-2222-4222-8222-222222222222";
const asOf = "2026-11-05T12:00:00+01:00";
const medication = { id: "t1", medication: "Sertraline", status: "active" };
const diagnosis = { id: "d1", label: "Trouble dépressif", code: "F32", primary: true, onsetDate: null, resolvedAt: null };

const input = (text: string) => ({
  text,
  conversationId: `mixed-${randomUUID()}`,
  clientTurnId: randomUUID(),
  appContext: { patientId: patient, page: `/patients/${patient}` },
});

const patientData = (section: "treatments" | "diagnoses" | "summary") => {
  const treatments = { current: [medication], history: [], historyComplete: true };
  if (section === "treatments") return { patientId: patient, treatments };
  if (section === "diagnoses") return { patientId: patient, diagnoses: [diagnosis] };
  return { patientId: patient, summary: { treatments, diagnoses: [diagnosis], scales: [], consultations: [], coverage: { requested: 1, returned: 1, complete: true, hasMore: false } } };
};

async function runMixed(text: string, section: "treatments" | "diagnoses" | "summary") {
  const execute = vi.fn(async (call: { id: string; name: string; args: Record<string, unknown> }, _asOf?: string, _prior?: unknown, _signal?: AbortSignal, original?: string) => {
    if (call.name === "get_patient_context") {
      return { callId: call.id, status: "ok" as const, complete: true, text: "Fait du dossier.", data: patientData(section), evidence: [{ id: patient, type: "patient" as const, label: "Dossier patient" }], conditionKeys: [] };
    }
    if (call.name === "search_knowledge") {
      return { callId: call.id, status: "partial" as const, complete: false, text: "Passage cité : source approuvée.", data: {}, evidence: [{ id: "k1", type: "knowledge" as const, label: "Source approuvée", excerpt: "source" }], conditionKeys: [], presentation: "knowledge" as const };
    }
    throw new Error(call.name);
  });
  const infer = vi.fn(() => { throw new Error("model must not be called"); });
  const result = await runAgentLoop(input(text), { actor: `mixed-${randomUUID()}`, asOf, infer: infer as never, execute: execute as never }, new AbortController().signal);
  return { result, calls: execute.mock.calls.map(call => call[0]), originals: execute.mock.calls.map(call => String(call[4])), infer };
}

describe("integrated mixed composition", () => {
  it.each([
    ["MIX-01", "Compare le traitement du patient sélectionné avec les recommandations approuvées sur le lithium.", "treatments", "lithium"],
    ["MIX-02", "Le patient prend-il un traitement dont les précautions figurent dans les sources approuvées ?", "treatments", "précautions"],
    ["MIX-03", "Quels diagnostics du patient sont documentés dans le DSM-5 ?", "diagnoses", "DSM-5"],
    ["MIX-04", "Le traitement actuel comporte-t-il une interaction décrite dans les sources approuvées ?", "treatments", "interactions"],
    ["MIX-05", "Quelles surveillances biologiques sont recommandées pour ce traitement ?", "treatments", "surveillance biologique"],
    ["MIX-06", "Résume le dossier et indique les points qui nécessitent une vérification dans les sources.", "summary", "recommandations"],
    ["MIX-07", "Quels effets indésirables des traitements du patient sont documentés ?", "treatments", "effets indésirables"],
    ["MIX-08", "Le patient a-t-il un traitement contre-indiqué au regard de ses diagnostics ?", "summary", "contre-indications"],
    ["MIX-09", "Quelles précautions du traitement actuel sont absentes du dossier ?", "treatments", "précautions"],
    ["MIX-10", "Prépare une synthèse du dossier avec les références approuvées correspondantes.", "summary", "recommandations"],
  ] as const)("%s reads the patient section then asks the approved source", async (_id, text, section, expected) => {
    const { calls, originals, infer, result } = await runMixed(text, section);
    expect(infer).not.toHaveBeenCalled();
    expect(calls.map(call => call.name)).toEqual(["get_patient_context", "search_knowledge"]);
    expect(calls[0]!.args).toMatchObject({ section, patientId: patient });
    expect(String(calls[1]!.args["query"])).toContain(expected);
    expect(originals[1]).toContain(expected);
    expect(result.sources.some(source => source.type === "patient")).toBe(true);
    expect(result.sources.some(source => source.type === "knowledge")).toBe(true);
  });
});
