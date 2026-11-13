import { describe, expect, it, vi, afterEach } from "vitest";
import { isKnowledgeFollowup, knowledgeAppliedToPatient, knowledgeFollowupQuestion, namesTheOpenRecord, resolvePatientFollowup } from "@/server/alexa/conversation-frame";

const loop = vi.hoisted(() => ({ runAgentLoop: vi.fn() }));
vi.mock("@/server/alexa/agent-loop", () => loop);
import { runAlexa, type OrchestratorDependencies } from "@/server/alexa/orchestrator";
import { conversationState } from "@/server/alexa/conversation-state";

describe("knowledgeFollowupQuestion", () => {
  it.each([
    ["Quelle est la posologie de la sertraline ?", "Et la clozapine ?", "Quelle est la posologie de la clozapine ?"],
    ["Quelle est la posologie de la fluoxétine ?", "Et la clozapine ?", "Quelle est la posologie de la clozapine ?"],
    ["Quelle est la posologie de la sertraline ?", "Et ses effets ?", "Quels sont les effets indésirables de sertraline ?"],
    ["Quelle est la posologie de la sertraline ?", "Et les interactions de la clozapine ?", "Quelles sont les interactions de clozapine ?"],
    ["Quelles précautions pour la sertraline ?", "Et pour la grossesse ?", "Quelles précautions pour la sertraline pendant la grossesse ?"],
    ["Quelle est la posologie de la sertraline ?", "Et en cas d'insuffisance rénale ?", "Quelle est la posologie de la sertraline en cas d'insuffisance rénale ?"],
    // Conditions replace each other: they used to stack.
    ["Quelle est la posologie de la sertraline pendant la grossesse ?", "Et en cas d'insuffisance rénale ?", "Quelle est la posologie de la sertraline en cas d'insuffisance rénale ?"],
    ["Quelle est la posologie de la sertraline en cas d'insuffisance rénale ?", "Et chez l'enfant ?", "Quelle est la posologie de la sertraline chez l'enfant ?"],
  ])("%s + %s", (previous, text, expected) => expect(knowledgeFollowupQuestion(previous, text)).toBe(expected));
});

describe("isKnowledgeFollowup", () => {
  it("follows a drug question", () => expect(isKnowledgeFollowup("Quelle est la posologie de la sertraline ?", "Et la clozapine ?")).toBe(true));
  it("follows a book question without a drug only when the last turn was about books", () => {
    expect(isKnowledgeFollowup("Quels sont les critères du trouble bipolaire ?", "Et le type II ?", true)).toBe(true);
    expect(isKnowledgeFollowup("Quels sont les critères du trouble bipolaire ?", "Et le type II ?", false)).toBe(false);
  });
  it.each(["Et son dossier ?", "Et chez cette patiente ?", "Et ses consultations ?", "Et le rendez-vous ?"])("leaves %s to the patient domain", text => {
    expect(isKnowledgeFollowup("Quelle est la posologie de la sertraline ?", text)).toBe(false);
  });
});

describe("knowledgeAppliedToPatient", () => {
  it("keeps the drug and targets the working patient", () => {
    const rewritten = knowledgeAppliedToPatient("Quels sont les effets indésirables de la sertraline ?", "Et chez cette patiente ?");
    expect(rewritten).toContain("sertraline");expect(rewritten).toContain("patient sélectionné");
  });
  it("maps criteria to the patient's diagnoses", () => {
    expect(knowledgeAppliedToPatient("Quels sont les critères du trouble bipolaire ?", "Et chez elle ?")).toContain("diagnostics du patient");
  });
  it("ignores anything else", () => expect(knowledgeAppliedToPatient("Quelle dose ?", "Et le lithium ?")).toBeNull());
});

describe("resolvePatientFollowup", () => {
  it.each([
    ["Et le traitement ?", "traitements"], ["Et son traitement actuel ?", "traitements"], ["Ses diagnostics ?", "diagnostics"],
    ["Et les rendez-vous ?", "rendez-vous"], ["Au fait, et ses paiements ?", null], ["Résume-moi tout ça.", "Résume le dossier"],
    ["Combien a-t-elle payé jusqu'à maintenant ?", null],
  ])("%s", (text, fragment) => {
    const verdict = resolvePatientFollowup(text);
    if (fragment) { expect(verdict.kind).toBe("rewrite"); if (verdict.kind === "rewrite") expect(verdict.text).toContain(fragment); }
  });
  it.each(["Elle a combien de rendez-vous cette semaine ?", "Et elle prend quoi ?"])("reuses the patient for %s", text => expect(resolvePatientFollowup(text).kind).toBe("reuse"));
  it.each(["Il faut quelle dose de lithium ?", "Il y a combien de patients au cabinet ?", "Quels traitements pour la dépression ?", "Bonjour", "Combien de patients au total dans tout le cabinet ?"])("does not touch %s", text => {
    expect(resolvePatientFollowup(text).kind).toBe("none");
  });
  it("never applies when someone is named", () => expect(resolvePatientFollowup("Et le traitement de Rania Autre ?").kind).toBe("none"));
  it("tells the record on screen from the patient discussed last", () => {
    for (const yes of ["Revenons à mon patient : sa note la plus récente ?", "Retour au dossier, son traitement ?", "Et ma patiente, elle a quel âge ?", "Pour le patient ouvert, les rendez-vous ?", "La patiente de la consultation, son diagnostic ?"]) expect(namesTheOpenRecord(yes)).toBe(true);
    for (const no of ["Et ce patient, son traitement ?", "Le patient suivant ?", "Sa dernière note ?", "Combien de patients aujourd'hui ?", "Le dossier de Lina Test ?"]) expect(namesTheOpenRecord(no)).toBe(false);
  });
});

describe("orchestrated follow-ups", () => {
  const patientId = "22222222-2222-4222-8222-222222222222";
  const noRead = async () => { throw new Error("Mocked loop owns this test"); };
  const cleanups: (() => void)[] = [];
  afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); loop.runAgentLoop.mockReset(); });
  const answer = (id: string | null, tool: string) => ({ status: "completed", parts: [{ id: "requested_1", goal: "g", tools: [tool], conditions: [], dependsOn: [], status: "answered", resultRefs: ["r"] }], results: [{ callId: "r", status: "ok", complete: true, ...(id ? { patientId: id } : {}), text: "Réponse.", evidence: [], conditionKeys: [] }], sentences: ["Réponse."], sources: [], patientId: id, tokensIn: 1, tokensOut: 1 });
  function session(screenPatientId: string | null = null) {
    const actor = `frame-${crypto.randomUUID()}`, conversationId = crypto.randomUUID();
    cleanups.push(() => conversationState.clear(actor, conversationId));
    const deps: OrchestratorDependencies = { actor, native: true, agentAsOf: "2026-10-27T09:00:00+01:00", db: { rpc: noRead }, knowledge: { rpc: noRead } };
    return (text: string) => runAlexa({ text, conversationId, clientTurnId: crypto.randomUUID(), appContext: { patientId: screenPatientId, page: screenPatientId ? "patient" : "/jarvis" } }, deps, () => undefined, new AbortController().signal);
  }
  const last = () => loop.runAgentLoop.mock.calls.at(-1)?.[0] as { text: string; appContext: { patientId: string | null } };

  it("replaces the drug in a knowledge follow-up", async () => {
    const run = session();loop.runAgentLoop.mockResolvedValue(answer(null, "search_knowledge"));
    await run("Quelle est la posologie de la sertraline ?");await run("Et la clozapine ?");
    expect(last().text).toBe("Quelle est la posologie de la clozapine ?");
  });
  it("reaches the working patient after a book question", async () => {
    const run = session();
    loop.runAgentLoop.mockResolvedValueOnce(answer(patientId, "get_patient_context"));await run("Résume la dernière consultation de Lina Test.");
    loop.runAgentLoop.mockResolvedValueOnce(answer(null, "search_knowledge"));await run("Quels sont les effets indésirables de la sertraline ?");
    loop.runAgentLoop.mockResolvedValueOnce(answer(patientId, "get_patient_context"));await run("Et chez cette patiente ?");
    expect(last().appContext.patientId).toBe(patientId);expect(last().text).toContain("sertraline");expect(last().text).toContain("patient sélectionné");
  });
  it("resolves a bare section against the working patient", async () => {
    const run = session();loop.runAgentLoop.mockResolvedValue(answer(patientId, "get_patient_context"));
    await run("Résume la dernière consultation de Lina Test.");await run("Et le traitement ?");
    expect(last().appContext.patientId).toBe(patientId);expect(last().text).toContain("traitements");
  });
  it("leaves a bare section alone when no patient is established", async () => {
    const run = session();loop.runAgentLoop.mockResolvedValue(answer(null, "query_app"));
    await run("Et le traitement ?");
    expect(last().appContext.patientId).toBeNull();expect(last().text).toBe("Et le traitement ?");
  });
  it("does not carry a patient to a named other patient", async () => {
    const run = session();loop.runAgentLoop.mockResolvedValue(answer(patientId, "get_patient_context"));
    await run("Résume la dernière consultation de Lina Test.");await run("Et le traitement de Rania Autre ?");
    expect(last().appContext.patientId).toBeNull();
  });
  it("goes back to the record on screen when the doctor says so, after another patient was read", async () => {
    const screen = "33333333-3333-4333-8333-333333333333", run = session(screen);
    loop.runAgentLoop.mockResolvedValue(answer(patientId, "get_patient_context"));
    await run("Résume la dernière consultation de Lina Test.");
    await run("Et le traitement ?");
    expect(last().appContext.patientId).toBe(patientId);
    for (const back of ["Revenons à ma patiente : son traitement ?", "Et pour le dossier ouvert, sa dernière note ?"]) {
      await run("Résume la dernière consultation de Lina Test.");
      await run(back);
      expect(last().appContext.patientId).toBe(screen);
    }
  });
  it("keeps the working patient when no record is open", async () => {
    const run = session();loop.runAgentLoop.mockResolvedValue(answer(patientId, "get_patient_context"));
    await run("Résume la dernière consultation de Lina Test.");await run("Revenons à mon patient : son traitement ?");
    expect(last().appContext.patientId).toBe(patientId);
  });
});
