import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalMedicationName, runAgentLoop } from "@/server/alexa/agent-loop";
import { planKnowledgeQuery } from "@/server/alexa/knowledge-query";

describe("planKnowledgeQuery", () => {
  it.each([
    "Quelle est la posologie du lithium selon les recommandations ?",
    "Comment adapter la sertraline selon l'âge ?",
    "Quelle dose de lithium selon le poids ?",
  ])("does not read an ordinary word as an unknown book: %s", question => {
    expect(planKnowledgeQuery(question)).not.toBeNull();
  });
  it.each(["Que dit le livre de Kaplan sur le lithium ?", "Selon Kaplan, quels sont les critères ?"])("still refuses a real unknown book: %s", question => {
    expect(planKnowledgeQuery(question)).toBeNull();
  });
  it("lets a treatment question about depression reach every book", () => {
    expect(planKnowledgeQuery("Quel traitement pour un trouble dépressif caractérisé ?")?.sectionFocus).toBeUndefined();
  });
  it("keeps the section focus for its criteria", () => {
    expect(planKnowledgeQuery("Quels sont les critères du trouble dépressif caractérisé ?")?.sectionFocus).toBe("trouble depressif caracterise");
  });
  it("prepares bounded recovery ranked against the whole question", () => {
    const plan = planKnowledgeQuery("Quels sont les risques rénaux du lithium ?");
    expect(plan?.recoveryQueries?.length).toBeGreaterThan(0);
    expect(plan?.recoveryQueries?.length).toBeLessThanOrEqual(3);
    for (const entry of plan?.recoveryQueries ?? []) {
      expect(entry.query).toContain("lithium");
      expect(entry.reference.split(" ").length).toBeGreaterThanOrEqual(entry.query.split(" ").length);
    }
  });
  it("adds no recovery when a book is named", () => {
    expect(planKnowledgeQuery("Quels sont les risques du lithium selon Maudsley ?")?.recoveryQueries).toBeUndefined();
  });
});

describe("canonicalMedicationName", () => {
  it.each([
    ["Sertraline 50 mg cp", "sertraline"],
    ["ZOLOFT 50mg", "zoloft"],
    ["Depakine Chrono 500 mg", "Depakine Chrono"],
    ["Tercian 25 mg comprimé", "Tercian"],
    ["Lithium", "lithium"],
  ])("%s -> %s", (recorded, expected) => expect(canonicalMedicationName(recorded)).toBe(expected));
});

describe("mixed patient and knowledge reads", () => {
  const patient = "22222222-2222-4222-8222-222222222222";
  async function run(medications: string[], text: string) {
    const execute = vi.fn(async (call: { id: string; name: string; args: Record<string, unknown> }) => call.name === "get_patient_context"
      ? { callId: call.id, status: "ok" as const, complete: true, text: "Fait du dossier.", data: { patientId: patient, treatments: { current: medications.map((medication, index) => ({ id: `t${index}`, medication, status: "active" })), history: [], historyComplete: true } }, evidence: [{ id: patient, type: "patient" as const, label: "Dossier" }], conditionKeys: [], patientId: patient }
      : { callId: call.id, status: "partial" as const, complete: false, text: `Passage ${String(call.args["query"])}`, data: {}, evidence: [{ id: String(call.args["query"]), type: "knowledge" as const, label: "Source" }], conditionKeys: [] });
    const result = await runAgentLoop({ text, conversationId: `m-${randomUUID()}`, clientTurnId: randomUUID(), appContext: { patientId: patient, page: `/patients/${patient}` } },
      { actor: `m-${randomUUID()}`, asOf: "2026-11-05T12:00:00+01:00", infer: (() => { throw new Error("no model"); }), execute: execute }, new AbortController().signal);
    return { result, queries: execute.mock.calls.map(call => call[0]).filter(call => call.name === "search_knowledge").map(call => String(call.args["query"])) };
  }
  const question = "Quels effets indésirables des traitements du patient sont documentés ?";
  it("searches one drug at a time, without dose or form", async () => {
    const { queries } = await run(["Sertraline 50 mg cp", "Lithium 400 mg cp"], question);
    expect(queries).toEqual(["sertraline effets indésirables ?", "lithium effets indésirables ?"]);
  });
  it("caps the number of reads", async () => {
    const { queries } = await run(["Sertraline", "Lithium", "Clozapine", "Quetiapine", "Olanzapine"], question);
    expect(queries).toHaveLength(3);
  });
  it("leaves no failed part for the reads it did not need", async () => {
    const { result, queries } = await run(["Sertraline 50 mg cp"], question);
    expect(queries).toHaveLength(1);
    expect(result.parts.some(part => part.status === "failed")).toBe(false);
    expect(result.parts).toHaveLength(2);
  });
  it("uses a named drug rather than the whole treatment list", async () => {
    const { queries } = await run(["Sertraline 50 mg cp", "Clozapine 100 mg cp"], "Compare le traitement du patient sélectionné avec les recommandations approuvées sur le lithium.");
    expect(queries).toEqual(["lithium recommandations ?"]);
  });
});
