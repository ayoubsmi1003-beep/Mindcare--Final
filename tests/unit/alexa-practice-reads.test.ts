import { describe, expect, it, vi } from "vitest";
import { restoreAgentTask, runAgentLoop, savedAgentTask } from "@/server/alexa/agent-loop";
import { agentExecutor } from "@/server/alexa/agent-tools";
import { caseSummaryStatusRead, medicationTimelineRead, medicationWorkloadRead, statisticsRead } from "@/server/alexa/practice-reads";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";

const flow = { seances: 12, patientes_vues: 9, retours: 4, nouveaux: 2, absences: 1, annulations: 3, notes_signees: 8, notes_manquantes: 4, echelles: 2, changements_traitement: 5 };
const overview = {
  periode: { du: "2026-11-01", au: "2026-11-07", jours: 7, precedente_du: "2026-10-25", precedente_au: "2026-10-31", granularite: "jour" },
  pulse: { ...flow, patients_total: 100, patients_suivis: 40, rdv_a_venir: 6, rdv_non_clotures: 2, traitements_actifs: 30 },
  comparaison: { ...flow, seances: 7 },
};
const today = "2026-11-07";
const patient = (index: number, over: Record<string, unknown> = {}) => ({ patient_id: `p${index}`, first_name: "Test", last_name: `Patient ${index}`, record_number: "R", active_count: 2, has_missing_posology: false, has_overdue_end_date: false, next_end_date: null, last_consultation_at: null, next_appointment_at: null, meds: [], ...over });
const resume = { patients: 3, actifs: 6, revue: 3, changements: 1 };
const event = (index: number, action = "dose_changed", occurred_at: unknown = "2026-10-01T09:00:00Z") => ({ event_id: `e${index}`, occurred_at, event_kind: "treatment", treatment_id: null, action, medication_name: "Lithium", previous_values: null, new_values: null, reason: "Tolérance", notes: "not shown", actor_name: null, consultation_id: null, document_number: null, line_count: null });

describe("statistics read", () => {
  it("reports the gate's figures and keeps period and current figures apart", () => {
    const { text } = statisticsRead(overview);
    expect(text).toContain("du 2026-11-01 au 2026-11-07");
    expect(text).toContain("Séances closes : 12");
    expect(text).toContain("Séances closes sans note signée : 4");
    expect(text).toContain("du 2026-10-25 au 2026-10-31 : 7 séance(s)");
    expect(text.indexOf("À cet instant")).toBeLessThan(text.indexOf("Traitements actifs : 30"));
    expect(text.indexOf("Séances closes")).toBeLessThan(text.indexOf("À cet instant"));
  });
  it("patients followed depends on the period, so it sits with the period", () => {
    const { text } = statisticsRead(overview);
    expect(text.indexOf("douze mois précédant la fin de la période : 40")).toBeLessThan(text.indexOf("À cet instant"));
  });
  it.each([null, "", "x", -1, 1.5])("a value of %j is refused, not shown as a figure", value => {
    expect(() => statisticsRead({ ...overview, pulse: { ...overview.pulse, seances: value } })).toThrow();
  });
});

describe("medication workload read", () => {
  const rows = [patient(1, { has_missing_posology: true }), patient(2, { has_overdue_end_date: true }), patient(3, { next_end_date: "2026-11-20" }), patient(4, { next_end_date: "2027-03-01" }), patient(5)];
  const raw = { total: 5, rows, resume };
  it("lists everyone for the plain workload", () => {
    const read = medicationWorkloadRead(raw, { attention: null, today });
    expect(read.complete).toBe(true);
    expect(read.text).toContain("6 traitement(s) actif(s), chez 3 patient(s)");
    expect(read.text).toContain("Test Patient 1 : 2 traitement(s) actif(s), posologie incomplète");
    expect(read.text).toContain("Test Patient 5");
  });
  it("a missing dose question lists only those patients", () => {
    const { text } = medicationWorkloadRead(raw, { attention: "missing_dose", today });
    expect(text).toContain("Patients avec une posologie incomplète : 1");
    expect(text).toContain("Test Patient 1");
    expect(text).not.toContain("Test Patient 2");
  });
  it("review uses the gate's rule, end date within 14 days included", () => {
    const { text } = medicationWorkloadRead(raw, { attention: "review", today });
    expect(text).toContain("Patients à revoir : 3");
    expect(text).toContain("prochaine fin le 2026-11-20");
    expect(text).not.toContain("Test Patient 4");
    expect(text).not.toContain("Test Patient 5");
  });
  it("a patient sorted late isn't lost among 20 unconcerned ones", () => {
    const many = [...Array.from({ length: 30 }, (_, index) => patient(index + 100)), patient(999, { has_missing_posology: true })];
    const { text } = medicationWorkloadRead({ total: 31, rows: many, resume }, { attention: "missing_dose", today });
    expect(text).toContain("Test Patient 999");
    expect(text).not.toContain("Test Patient 100");
  });
  it("says when it couldn't look at every patient", () => {
    const read = medicationWorkloadRead({ total: 150, rows: Array.from({ length: 100 }, (_, index) => patient(index)), resume }, { attention: "missing_dose", today });
    expect(read.complete).toBe(false);
    expect(read.text).toContain("Je n’ai examiné que 100 patients sur 150");
    expect(read.text).toContain("parmi ceux examinés : 0");
  });
  it("says both limits when it read 100 of 150 and shows 20", () => {
    const { text } = medicationWorkloadRead({ total: 150, rows: Array.from({ length: 100 }, (_, index) => patient(index)), resume }, { attention: null, today });
    expect(text).toContain("20 patient(s) affiché(s) sur 100");
    expect(text).toContain("Je n’ai examiné que 100 patients sur 150");
  });
  it("says when patients aren't shown", () => {
    const read = medicationWorkloadRead({ total: 40, rows: Array.from({ length: 40 }, (_, index) => patient(index + 10)), resume }, { attention: null, today });
    expect(read.complete).toBe(false);
    expect(read.text).toContain("20 patient(s) affiché(s) sur 40");
    expect(read.text).not.toContain("Test Patient 30");
  });
  it("is honest about nothing visible", () => {
    const read = medicationWorkloadRead({ total: 0, rows: [], resume: { patients: 0, actifs: 0, revue: 0, changements: 0 } }, { attention: null, today });
    expect(read.empty).toBe(true);
    expect(read.text).toContain("visible avec votre accès");
  });
  it("refuses a null count", () => {
    expect(() => medicationWorkloadRead({ ...raw, resume: { ...resume, actifs: null } }, { attention: null, today })).toThrow();
  });
});

describe("medication timeline read", () => {
  it("labels events and leaves notes out", () => {
    const { text } = medicationTimelineRead([event(1), event(2, "something_new")]);
    expect(text).toContain("2026-10-01 : changement de dose, Lithium, motif : Tolérance");
    expect(text).toContain("autre événement");
    expect(text).not.toContain("not shown");
    expect(text).not.toContain("something_new");
  });
  it.each([[new Date("2026-09-14T23:30:00Z")], ["2026-09-14T23:30:00+00:00"]])("uses the cabinet's day: %s", value => {
    expect(medicationTimelineRead([event(1, "stopped", value)]).text).toContain("2026-09-15 : arrêt");
  });
  it("says when older events exist", () => {
    const read = medicationTimelineRead(Array.from({ length: 21 }, (_, index) => event(index)));
    expect(read.complete).toBe(false);
    expect(read.text).toContain("D’autres événements plus anciens");
  });
  it("doesn't say the patient had no change when nothing is visible", () => {
    const read = medicationTimelineRead([]);
    expect(read.empty).toBe(true);
    expect(read.text).toContain("consigné ou visible");
  });
});

describe("case summary status read", () => {
  it("gives the state and never the generated text", () => {
    const { text } = caseSummaryStatusRead({ id: "s", version: 3, genere_le: "2026-10-02T08:00:00Z", genere_par: null, content: { synthese: "GENERATED" }, aJour: false });
    expect(text).toContain("version 3, générée le 2026-10-02");
    expect(text).toContain("Je ne peux pas la confirmer à jour");
    expect(text).toContain("généré par un modèle");
    expect(text).not.toContain("GENERATED");
  });
  it("uses the cabinet's day", () => {
    expect(caseSummaryStatusRead({ version: 1, genere_le: "2026-09-14T23:30:00+00:00", aJour: true }).text).toContain("générée le 2026-09-15");
  });
  it("says what the check doesn't cover", () => {
    const { text } = caseSummaryStatusRead({ version: 1, genere_le: "2026-10-02T08:00:00Z", aJour: true });
    expect(text).toContain("dont les allergies, effets indésirables, l’observance, les mesures et les documents, ne sont pas vérifiées");
    expect(text).not.toContain("à jour");
  });
  it("handles no summary", () => expect(caseSummaryStatusRead(null).empty).toBe(true));
});

describe("routing", () => {
  const view = (text: string) => frenchRequestAdmission(text, false, "2026-11-07T10:00:00+01:00");
  it.each(["Montre mes statistiques.", "Quelles sont les statistiques de ce mois ?", "Montre les statistiques de septembre 2026", "Statistiques de l'activité du cabinet cette semaine.", "Statistiques de cette année", "Statistiques"])("statistics: %s", text => {
    expect(view(text)).toMatchObject({ tools: ["query_app"], applicationView: "statistics" });
  });
  it.each([
    "Statistiques de Karim", "statistiques de karim benali", "Montre les statistiques pour Karim",
    "Quelles statistiques de prévalence pour la schizophrénie ?", "Que dit le manuel diagnostique et statistique sur la manie ?", "Quelles sont les statistiques de mortalite de la schizophrenie ?", "Statistiques de rechute sous lithium",
    "Montre mes statistiques puis mes messages internes", "Montre mes statistiques et mes rendez-vous de demain", "Statistiques puis ouvre l agenda",
    "Statistiques de mars de cette année", "Statistiques du dernier jour du mois", "Statistiques de mars 2026 à hier", "Statistiques du 15 mars 2026 au 20", "Statistiques du mois dernier",
    "Exporte les statistiques", "Imprime le bilan d activite", "Ouvre les statistiques", "Statistiques des recettes de ce mois", "Combien de consultations dans les statistiques ?",
  ])("not practice statistics: %s", text => {
    expect(view(text).applicationView).not.toBe("statistics");
  });
  it.each(["Quels traitements à revoir ?", "Montre la charge des traitements.", "Quels traitements sans posologie ?", "Posologies manquantes"])("workload: %s", text => {
    expect(view(text)).toMatchObject({ tools: ["query_app"], applicationView: "medication_workload" });
  });
  it.each([
    "Quels traitements à revoir pour ce patient ?", "Traitements a revoir de Karim", "Posologies manquantes de Karim", "Charge des traitements de Nadia",
    "Quels traitements sans posologie pour la schizophrenie ?", "Quels traitements a reviser en cas de grossesse ?", "Que faire en cas de posologie manquante de lithium ?", "Une posologie incomplete de lithium est-elle dangereuse ?",
    "renouvelle les traitements a revoir", "Complete les posologies incompletes", "Corrige la posologie manquante", "Traitements a revoir et statistiques", "Combien de patients ont une posologie manquante ?", "Revue des traitements de Sans", "Charge des traitements de la Revue",
  ])("not the workload: %s", text => {
    expect(view(text).applicationView).not.toBe("medication_workload");
  });
  it.each(["Montre la chronologie des traitements de ce patient.", "Montre la chronologie des traitements de cette patiente.", "Chronologie des traitements du patient sélectionné.", "Montre la chronologie des traitements de Karim Benali.", "Montre la chronologie des traitements de karim benali."])("timeline: %s", text => {
    expect(view(text)).toMatchObject({ tools: ["get_patient_context"], patientSection: "medication_timeline" });
  });
  it.each(["Enregistre un changement de dose de sertraline pour Karim Benali", "Quel est le risque d un changement de traitement chez Karim Benali ?", "Quels changements de dose de sertraline pour ce patient ?", "Montre les changements de traitement de ce patient depuis mars 2026", "Quels changements de dose recommander pour ce patient ?", "Chronologie des prescriptions de lithium de ce patient", "Chronologie des traitements de la Schizophrénie Aiguë", "Chronologie des traitements de sa mère", "Chronologie des traitements de son fils", "Montre la chronologie des traitements de cet ancien patient", "Chronologie des traitements de nos patients", "Chronologie des traitements de Trouble Bipolaire", "Chronologie des traitements de Sans Benali", "Chronologie des traitements de Nom Inconnu", "Chronologie des traitements de Dose Benali"])("not the timeline: %s", text => {
    expect(view(text).patientSection).not.toBe("medication_timeline");
  });
  it("the general chronology is unchanged", () => {
    expect(view("Montre la chronologie de ce patient.").patientSection).toBe("timeline");
  });
  it.each(["Le résumé du cas de ce patient est-il à jour ?", "Le résumé du cas de cette patiente est-il à jour ?", "Le résumé du cas de Karim Benali est-il périmé ?", "Le résumé du cas de karim benali est-il à jour ?"])("case summary status: %s", text => {
    expect(view(text)).toMatchObject({ tools: ["get_patient_context"], patientSection: "case_summary_status" });
  });
  it.each(["Resume du cas de Karim Benali en date du 3 mars 2026", "Mets a jour le resume du cas de Karim Benali", "Quelle est la version du résumé du cas de ce patient ?", "Le résumé du cas de son frère est-il à jour ?", "Le résumé du cas du patient précédent est-il à jour ?", "Le résumé du cas du dernier patient est-il à jour ?", "Le résumé du cas de cet autre patient est-il à jour ?", "Le résumé du cas de Alger Benali est-il à jour ?"])("not the status: %s", text => {
    expect(view(text).patientSection).not.toBe("case_summary_status");
  });
  it("asking for the clinical summary is unchanged", () => {
    expect(view("Résumé clinique de ce patient.").patientSection).toBe("summary");
  });
});

describe("through the real loop, without a model", () => {
  const selected = "11111111-1111-4111-8111-111111111111";
  const run = async (text: string, patientId: string | null) => {
    const infer = vi.fn(), calls: { name: string; args: Record<string, unknown> }[] = [];
    const execute = vi.fn(async (call: { id: string; name: string; args: Record<string, unknown> }) => {
      calls.push(call);
      return { callId: call.id, status: "ok", complete: true, data: {}, text: "Résultat", conditionKeys: [], evidence: [{ id: call.id, type: "query", label: "gate", provenance: { gate: "gate" } }] };
    });
    await runAgentLoop({ text, conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID(), appContext: { patientId, page: "/jarvis" } }, { actor: crypto.randomUUID(), infer: infer as never, execute: execute as never }, new AbortController().signal);
    return { calls, infer };
  };
  it.each([["Montre la chronologie des traitements de ce patient.", "medication_timeline"], ["Le résumé du cas de ce patient est-il à jour ?", "case_summary_status"]])("%s reads the selected patient, and doesn't search for a name", async (text, section) => {
    const { calls, infer } = await run(text, selected);
    expect(infer).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: "get_patient_context", args: { section } });
    expect(calls[0]?.args["patientName"]).toBeUndefined();
    expect(calls[0]?.name).not.toBe("query_patients");
  });
  it.each([["Montre mes statistiques", "statistics"], ["Quels traitements à revoir ?", "medication_workload"]])("%s is one direct read", async (text, view) => {
    const { calls, infer } = await run(text, null);
    expect(infer).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: "query_app", args: { view } });
  });
});

describe("whose record", () => {
  const selected = "11111111-1111-4111-8111-111111111111";
  const run = async (text: string) => {
    const calls: { name: string; args: Record<string, unknown> }[] = [], infer = vi.fn();
    const execute = vi.fn(async (call: { id: string; name: string; args: Record<string, unknown> }) => {
      calls.push(call);
      return { callId: call.id, status: "ok", complete: true, data: {}, text: "Résultat", conditionKeys: [], evidence: [{ id: call.id, type: "query", label: "gate", provenance: { gate: "gate" } }] };
    });
    await runAgentLoop({ text, conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID(), appContext: { patientId: selected, page: "/jarvis" } }, { actor: crypto.randomUUID(), infer: infer as never, execute: execute as never }, new AbortController().signal).catch(() => undefined);
    return calls;
  };
  it.each([
    "Chronologie des traitements de aucun patient sélectionné", "Chronologie des traitements de non patient sélectionné", "Chronologie des traitements de Sans ce patient", "Chronologie des traitements de quel patient sélectionné",
    "Montre-moi la chronologie des prescriptions pour aucun patient sélectionné.", "Chronologie des traitements de lithium ce patient", "Chronologie des traitements de Alger patient sélectionné", "Chronologie des traitements de Trouble ce patient",
    "Le résumé du cas de aucun patient sélectionné est-il à jour ?", "Le résumé du cas de Sans ce patient est-il à jour ?", "Le résumé du cas de quel patient sélectionné est-il à jour ?",
  ])("%s never reaches the new reads", async text => {
    expect(frenchRequestAdmission(text, false).patientSection).not.toBe("medication_timeline");
    expect(frenchRequestAdmission(text, false).patientSection).not.toBe("case_summary_status");
    for (const call of await run(text)) expect(["medication_timeline", "case_summary_status"]).not.toContain(call.args["section"]);
  });
  it.each(["Montre la chronologie des traitements de Karim Benali", "Chronologie des traitements de karim benali"])("%s reads the timeline for that name", async text => {
    const calls = await run(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: "get_patient_context", args: { section: "medication_timeline" } });
  });
});

describe("the executor applies the same sentences as the route", () => {
  const selected = "11111111-1111-4111-8111-111111111111";
  const run = async (text: string, name: string, args: Record<string, unknown>) => {
    const gates: string[] = [];
    const rpc = (gate: string) => { gates.push(gate); return Promise.resolve({ ok: true, data: [null] }); };
    const db = { rpc }, knowledge = {};
    const execute = agentExecutor({ text, conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID(), appContext: { patientId: selected, page: "/jarvis" } }, db as never, knowledge as never);
    const result = await execute({ id: "c", name, args: { partIds: ["requested_1"], ...args } }, "2026-11-07T10:00:00+01:00", [], new AbortController().signal);
    return { gates, result };
  };
  it.each([
    ["Statistiques de mars", "query_app", { view: "statistics" }],
    ["Statistiques du mois dernier", "query_app", { view: "statistics" }],
    ["Statistiques d'hier", "query_app", { view: "statistics" }],
    ["Traitements à revoir de Karim", "query_app", { view: "medication_workload" }],
    ["Chronologie des traitements de sa mère", "get_patient_context", { section: "medication_timeline" }],
    ["Le résumé du cas de son frère est-il à jour ?", "get_patient_context", { section: "case_summary_status" }],
  ])("%s is refused, and the read's gate isn't called", async (text, name, args) => {
    const { gates, result } = await run(text, name, args);
    expect(["unsupported", "needs_input"]).toContain(result.status);
    for (const gate of ["get_analysis_overview", "list_medication_workload", "list_patient_medication_timeline", "get_alexa_case_summary"]) expect(gates).not.toContain(gate);
  });
  it("the exact sentence does reach the gate", async () => {
    // The fake gate returns NULL, as it does for a role without access: refused, never shown as zeros.
    await expect(run("Montre mes statistiques", "query_app", { view: "statistics" })).rejects.toThrow("permission");
  });
});

describe("a question left pending earlier doesn't block an exact read", () => {
  it("a period not yet started is an answer and the next read still works", async () => {
    const gates: string[] = [];
    const rpc = (gate: string) => { gates.push(gate); return Promise.resolve({ ok: true, data: [{ total: 0, rows: [], resume: { patients: 0, actifs: 0, revue: 0, changements: 0 } }] }); };
    const db = { rpc }, knowledge = {};
    const future = agentExecutor({ text: "Statistiques de décembre 2026", conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID(), appContext: { patientId: null, page: "/jarvis" } }, db as never, knowledge as never);
    const first = await future({ id: "a", name: "query_app", args: { partIds: ["requested_1"], view: "statistics" } }, "2026-11-07T10:00:00+01:00", [], new AbortController().signal);
    expect(first.status).toBe("empty");
    expect(first.text).toContain("n’a pas encore commencé");
    expect(gates).toEqual([]);
    expect(first.evidence).toEqual([]);
    const next = agentExecutor({ text: "Quels traitements à revoir ?", conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID(), appContext: { patientId: null, page: "/jarvis" } }, db as never, knowledge as never);
    const second = await next({ id: "b", name: "query_app", args: { partIds: ["requested_1"], view: "medication_workload" } }, "2026-11-07T10:00:00+01:00", [], new AbortController().signal, "Statistiques de décembre 2026 Quels traitements à revoir ?");
    expect(gates).toEqual(["list_medication_workload"]);
    expect(second.status).toBe("empty");
  });
});

describe("a partial list survives a restart", () => {
  it("still says there is no continuation", async () => {
    const actor = crypto.randomUUID(), conversationId = crypto.randomUUID();
    const execute = vi.fn(async (call: { id: string }) => ({ callId: call.id, status: "partial", complete: false, data: { practiceList: true, total: 40 }, text: "Liste", conditionKeys: [], evidence: [{ id: call.id, type: "query", label: "gate", provenance: { gate: "gate" } }] }));
    const infer = vi.fn();
    await runAgentLoop({ text: "Quels traitements à revoir ?", conversationId, clientTurnId: crypto.randomUUID(), appContext: { patientId: null, page: "/jarvis" } }, { actor, infer: infer as never, execute: execute as never }, new AbortController().signal);
    const saved = JSON.parse(JSON.stringify(savedAgentTask(actor, conversationId))) as unknown;
    expect(saved).toBeTruthy();
    const restoredActor = crypto.randomUUID();
    restoreAgentTask(restoredActor, conversationId, saved);
    expect(savedAgentTask(restoredActor, conversationId)).toBeTruthy();
    const next = await runAgentLoop({ text: "la suite", conversationId, clientTurnId: crypto.randomUUID(), appContext: { patientId: null, page: "/jarvis" } }, { actor: restoredActor, infer: infer as never, execute: execute as never }, new AbortController().signal);
    expect(infer).not.toHaveBeenCalled();
    expect(next.status).toBe("needs_input");
    expect(next.sentences.join(" ")).toContain("Aucune suite de lecture");
  });
});
