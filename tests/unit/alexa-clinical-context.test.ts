import { describe, expect, it } from "vitest";
import { buildClinicalContext, ClinicalContextError } from "@/server/alexa/clinical-context";
import { resolvePatient } from "@/server/alexa/patient-resolver";
import type { DbPort, RpcArgs } from "@/services/db/port";
import type { Result } from "@/services/result";

const patientId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const consultation = (index: number) => ({
  id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
  startedAt: `2026-09-${(30 - index).toString().padStart(2, "0")}T12:00:00Z`,
  endedAt: `2026-09-${(30 - index).toString().padStart(2, "0")}T13:00:00Z`,
  notes: [{ id: otherId, version: "2026-09-30T12:00:00Z", subjective: "Sommeil amélioré", objective: null, assessment: null, plan: null, amendments: [] }],
});
function payload(overrides: Record<string, unknown> = {}) {
  return { patientId, consultations: [consultation(1)], treatments: { current: [], history: [], historyComplete: true }, sourceRevision: "a".repeat(64),
    coverage: { requested: 1, returned: 1, complete: true, hasMore: false }, diagnoses: [], scales: [], ...overrides };
}
function port(responses: Record<string, unknown> | ((name: string, args: RpcArgs) => unknown)) {
  const calls: { name: string; args: RpcArgs }[] = [];
  const db: Pick<DbPort, "rpc"> = { rpc: async <T>(name: string, args: RpcArgs): Promise<Result<readonly T[]>> => {
    calls.push({ name, args });
    const value = typeof responses === "function" ? responses(name, args) : responses[name];
    return { ok: true, data: value as readonly T[] };
  } };
  return { db, calls };
}

describe("ClinicalContextEngine scoped audited reads", () => {
  it("authorizes through get_patient before a direct chronological clinical page", async () => {
    const f = port({ get_patient: [{ id: patientId }], get_alexa_clinical_context: [payload()] });
    const context = await buildClinicalContext(f.db, { patientId }, { count: 1 });
    expect(f.calls.map((call) => call.name)).toEqual(["get_patient", "get_alexa_clinical_context"]);
    expect(f.calls[1]?.args).toMatchObject({ p_patient_id: patientId, p_limit: 1 });
    expect(context.consultations[0]?.notes[0]?.subjective).toBe("Sommeil amélioré");
  });
  it("does not read clinical content for an inaccessible or missing patient", async () => {
    const f = port({ get_patient: [] });
    await expect(buildClinicalContext(f.db, { patientId }, { count: 5 })).rejects.toMatchObject({ code: "unavailable" });
    expect(f.calls.map((call) => call.name)).toEqual(["get_patient"]);
  });
  it("rejects patient scope mismatch even when a gate returns valid-shaped content", async () => {
    const f = port({ get_patient: [{ id: patientId }], get_alexa_clinical_context: [payload({ patientId: otherId })] });
    await expect(buildClinicalContext(f.db, { patientId }, { count: 1 })).rejects.toMatchObject({ code: "invalid-context" });
  });
  it("pages requested history without letting timeline noise reduce the count", async () => {
    const first = Array.from({ length: 20 }, (_, index) => consultation(index + 1));
    const f = port((name, args) => name === "get_patient" ? [{ id: patientId }] : [payload({
      consultations: args.p_before_id ? [consultation(21)] : first,
      coverage: { requested: args.p_limit, returned: args.p_before_id ? 1 : 20, complete: true, hasMore: !args.p_before_id,
        ...(args.p_before_id ? {} : { next: { startedAt: first[19]!.startedAt, id: first[19]!.id } }) },
    })]);
    const context = await buildClinicalContext(f.db, { patientId }, { count: 21 });
    expect(context.consultations).toHaveLength(21);
    expect(f.calls.at(-1)?.args).toMatchObject({ p_before_id: first[19]!.id, p_limit: 1 });
    expect(context.coverage).toMatchObject({ requested: 21, returned: 21, complete: true, hasMore: false });
  });
  it("refuses history assembled from different source revisions", async () => {
    const first = Array.from({ length: 20 }, (_, index) => consultation(index + 1));
    const f = port((name, args) => name === "get_patient" ? [{ id: patientId }] : [payload({ consultations: args.p_before_id ? [consultation(21)] : first,
      sourceRevision: (args.p_before_id ? "b" : "a").repeat(64), coverage: { requested: args.p_limit, returned: args.p_before_id ? 1 : 20, complete: true, hasMore: !args.p_before_id,
        ...(args.p_before_id ? {} : { next: { startedAt: first[19]!.startedAt, id: first[19]!.id } }) } })]);
    await expect(buildClinicalContext(f.db, { patientId }, { count: 21 })).rejects.toMatchObject({ code: "stale-context" });
  });
  it("reports absent signed notes as incomplete coverage without inventing narrative", async () => {
    const f = port({ get_patient: [{ id: patientId }], get_alexa_clinical_context: [payload({ consultations: [{ ...consultation(1), notes: [] }], coverage: { requested: 5, returned: 1, complete: false, hasMore: false } })] });
    const context = await buildClinicalContext(f.db, { patientId }, { count: 5 });
    expect(context.coverage).toEqual({ requested: 5, returned: 1, complete: false, hasMore: false });
    expect(context.consultations[0]?.notes).toEqual([]);
  });
  it("preserves paused/stopped treatment states, units and missing frequency", async () => {
    const current = ["active", "paused", "stopped"].map((status) => ({ id: otherId, medication: "Médicament test", status, dose: "2", doseUnit: "mg", frequency: null,
      timing: [], instructions: null, startDate: "2026-01-01", endDate: null, version: 2 }));
    const f = port({ get_patient: [{ id: patientId }], get_alexa_clinical_context: [payload({ treatments: { current, history: [], historyComplete: true } })] });
    expect((await buildClinicalContext(f.db, { patientId }, { count: 1 })).treatments.current).toEqual(current);
  });
  it("preserves genuinely missing historical fields rather than filling them from today's treatment", async () => {
    const snapshot = { status: null, dose: "10 mg", doseUnit: null, frequency: null, timing: [], instructions: null, startDate: null, endDate: null };
    const history = [{ id: otherId, treatmentId: otherId, version: 1, action: "started", occurredAt: "2026-01-01T12:00:00Z", previous: null, next: snapshot, reason: null, notes: null }];
    const f = port({ get_patient: [{ id: patientId }], get_alexa_clinical_context: [payload({ treatments: { current: [], history, historyComplete: true } })] });
    expect((await buildClinicalContext(f.db, { patientId }, { count: 1 })).treatments.history[0]?.next).toEqual(snapshot);
  });
  it("rejects already aborted work before reading and never exposes DB error text", async () => {
    const f = port({}); const controller = new AbortController(); controller.abort();
    await expect(buildClinicalContext(f.db, { patientId }, { count: 1 }, controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    expect(f.calls).toEqual([]);
    const failing: Pick<DbPort, "rpc"> = { rpc: async () => { throw new Error("patient private name"); } };
    await expect(buildClinicalContext(failing, { patientId }, { count: 1 })).rejects.toMatchObject({ message: "unavailable" });
    expect(new ClinicalContextError("unavailable").message).not.toContain("patient");
  });
  it("rejects cancelled results and invalid counts/cursors", async () => {
    const controller = new AbortController();
    const f = port(() => { controller.abort(); return [{ id: patientId }]; });
    await expect(buildClinicalContext(f.db, { patientId }, { count: 1 }, controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    const clean = port({});
    for (const count of [0, 101, 1.5]) await expect(buildClinicalContext(clean.db, { patientId }, { count })).rejects.toMatchObject({ code: "invalid-request" });
    await expect(buildClinicalContext(clean.db, { patientId }, { count: 1, before: { id: otherId, startedAt: "not a date" } })).rejects.toMatchObject({ code: "invalid-request" });
    expect(clean.calls).toEqual([]);
  });
});

describe("PatientResolver fail closed local names", () => {
  it("resolves a single full name by audited search then get_patient", async () => {
    const f = port({ search_patients: [{ id: patientId, total_count: 1, first_name: "Prénom fictif", last_name: "Nom fictif" }], get_patient: [{ id: patientId, first_name: "Prénom fictif", last_name: "Nom fictif" }] });
    expect(await resolvePatient(f.db, { name: "Prénom fictif Nom fictif" })).toMatchObject({ status: "resolved", patientId });
    expect(f.calls.map((call) => call.name)).toEqual(["search_patients", "get_patient"]);
  });
  it("keeps ambiguous and missing names unresolved, including truncated search pages", async () => {
    const ambiguous = port({ search_patients: [{ id: patientId, total_count: 2, first_name: "Prénom fictif", last_name: "Nom fictif" }] });
    expect(await resolvePatient(ambiguous.db, { name: "fictif" })).toMatchObject({ status: "ambiguous" });
    expect(ambiguous.calls).toHaveLength(1);
    expect(await resolvePatient(port({ search_patients: [] }).db, { name: "inconnu" })).toEqual({ status: "unavailable" });
    expect(await resolvePatient(port({}).db, {})).toEqual({ status: "unavailable" });
  });
  it("does not choose a sole fuzzy match automatically", async () => {
    const f = port({ search_patients: [{ id: patientId, total_count: 1, first_name: "Nadia", last_name: "Test" }] });
    expect(await resolvePatient(f.db, { name: "Nadi Test" })).toMatchObject({ status: "ambiguous" });
    expect(f.calls).toHaveLength(1);
  });
  it.each(["Karim Djilali", "DJILALI Karim"])("resolves an exact full name among similar spellings: %s", async (name) => {
    const f = port({ search_patients: [
      { id: otherId, total_count: "2", first_name: "Karim", last_name: "Djellali" },
      { id: patientId, total_count: "2", first_name: "Karim", last_name: "Djilali" },
    ], get_patient: [{ id: patientId, first_name: "Karim", last_name: "Djilali" }] });
    expect(await resolvePatient(f.db, { name, patientId: otherId })).toMatchObject({ status: "resolved", patientId });
    expect(f.calls).toEqual([
      { name: "search_patients", args: { p_query: name, p_limit: 10, p_offset: 0 } },
      { name: "get_patient", args: { p_id: patientId } },
    ]);
  });
  it.each([
    { name: "Karim Djilali", rows: [{ first_name: "Karim", last_name: "Djilali" }, { first_name: "Karim", last_name: "Djilali" }] },
    { name: "Emile Test", rows: [{ first_name: "Émile", last_name: "Test" }, { first_name: "Emile", last_name: "Test" }] },
    { name: "أحمد اختبار", rows: [{ first_name: "أحمد", last_name: "اختبار" }, { first_name: "احمد", last_name: "اختبار" }] },
  ])("requires selection for duplicate full names after normalization: $name", async ({ name, rows }) => {
    const f = port({ search_patients: rows.map((row, index) => ({ ...row, id: index === 0 ? patientId : otherId, total_count: 2 })) });
    expect(await resolvePatient(f.db, { name })).toMatchObject({ status: "ambiguous" });
    expect(f.calls).toHaveLength(1);
  });
  it("does not select an exact name when a truncated search could hide a duplicate", async () => {
    const f = port({ search_patients: [
      { id: patientId, total_count: 3, first_name: "Karim", last_name: "Djilali" },
      { id: otherId, total_count: 3, first_name: "Karim", last_name: "Djellali" },
    ] });
    expect(await resolvePatient(f.db, { name: "Karim Djilali" })).toMatchObject({ status: "ambiguous" });
    expect(f.calls).toHaveLength(1);
  });
  it.each([undefined, null, "", "1.0", true, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("does not trust malformed search coverage: %s", async (total_count) => {
    const f = port({ search_patients: [{ id: patientId, total_count, first_name: "Karim", last_name: "Djilali" }] });
    expect(await resolvePatient(f.db, { name: "Karim Djilali" })).not.toMatchObject({ status: "resolved" });
    expect(f.calls).toHaveLength(1);
  });
  it.each([
    { id: otherId, total_count: 3, first_name: "Karim", last_name: "Djellali" },
    { id: "invalid-id", total_count: 2, first_name: "Karim", last_name: "Djellali" },
    { id: otherId, total_count: 2, first_name: null, last_name: "Djellali" },
    { id: patientId, total_count: 2, first_name: "Karim", last_name: "Djellali" },
  ])("does not ignore inconsistent or invalid rows in a search result", async (second) => {
    const f = port({ search_patients: [{ id: patientId, total_count: 2, first_name: "Karim", last_name: "Djilali" }, second] });
    expect(await resolvePatient(f.db, { name: "Karim Djilali" })).not.toMatchObject({ status: "resolved" });
    expect(f.calls).toHaveLength(1);
  });
  it.each([
    { patient: [] },
    { patient: [{ id: otherId, first_name: "Karim", last_name: "Djilali" }] },
    { patient: [{ id: patientId, first_name: "Karim", last_name: "Changed" }] },
  ])("rechecks access and the requested identity after the search", async ({ patient }) => {
    const f = port({ search_patients: [{ id: patientId, total_count: 1, first_name: "Karim", last_name: "Djilali" }], get_patient: patient });
    expect(await resolvePatient(f.db, { name: "Karim Djilali" })).toEqual({ status: "unavailable" });
    expect(f.calls.map((call) => call.name)).toEqual(["search_patients", "get_patient"]);
  });
  it("discards name resolution cancelled while get_patient is in flight", async () => {
    const controller = new AbortController();
    const f = port((name) => {
      if (name === "get_patient") controller.abort();
      return [{ id: patientId, total_count: 1, first_name: "Karim", last_name: "Djilali" }];
    });
    expect(await resolvePatient(f.db, { name: "Karim Djilali" }, controller.signal)).toEqual({ status: "cancelled" });
  });
});
