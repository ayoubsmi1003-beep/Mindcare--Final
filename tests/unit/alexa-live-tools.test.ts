import { describe, expect, it, vi } from "vitest";
import { lireOutilLive, type ContexteLive } from "@/server/voice/live-tools";
import type { ClientSql, ReponseRpc, ArgsJarvis } from "@/server/jarvis/client-sql";

const patientId = "00000000-0000-4000-8000-000000000009";
function fixture(synthetic = true, overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const resume = { id: "existing-summary", contenu: { schema: 2, en_bref: "Exact existing synthetic summary" } };
  const rpc = vi.fn(async (name: string, _args?: ArgsJarvis): Promise<ReponseRpc> => {
    calls.push(name);
    return { error: null, data: Object.hasOwn(overrides, name) ? overrides[name] : name === "get_patient" ? [{ id: patientId, first_name: "Nadia fictive", is_synthetic: synthetic }]
      : name === "get_patient_workspace" ? { clinique: {}, resume }
      : name === "search_patients" ? [{ id: patientId, total_count: 1 }] : null };
  });
  const client: ClientSql = { rpc: async <T>(name: string, args?: ArgsJarvis) => {
    const result = await rpc(name, args); return { data: result.data as T | null, error: result.error };
  } };
  return { client, calls, resume };
}
describe("Live uses only existing authorized synthetic records", () => {
  it("retrieves the exact existing summary through audited patient and workspace gates", async () => {
    const f = fixture();
    const r = await lireOutilLive(f.client, "get_patient_summary", { patient_id: patientId }, { currentPatientId: null, referencedPatientId: null });
    expect(r).toMatchObject({ status: "ok", resume: f.resume });
    expect(f.calls).toEqual(["get_patient", "get_patient_workspace"]);
  });
  it("refuses real or unclassified patients before reading their clinical content", async () => {
    const f = fixture(false);
    expect(await lireOutilLive(f.client, "get_patient_summary", { patient_id: patientId }, { currentPatientId: null, referencedPatientId: null })).toMatchObject({ status: "unavailable" });
    expect(f.calls).toEqual(["get_patient"]);
  });
  it("keeps the resolved patient for elliptical follow-up tools", async () => {
    const f = fixture(), context = { currentPatientId: null, referencedPatientId: null as string | null };
    await lireOutilLive(f.client, "get_patient", { query: "Nadia" }, context);
    expect(context.referencedPatientId).toBe(patientId);
    expect(await lireOutilLive(f.client, "get_patient_summary", {}, context)).toMatchObject({ resume: f.resume });
  });
  it("refuses writes and invalid arguments without executing a database call", async () => {
    const f = fixture(), context = { currentPatientId: null, referencedPatientId: null };
    for (const [name, args] of [["save_note", {}], ["get_patient", { patient_id: "invalid" }], ["search_patient", { query: "N" }]] as const)
      expect(await lireOutilLive(f.client, name, args, context)).toMatchObject({ status: "unavailable" });
    expect(f.calls).toEqual([]);
  });
  it("keeps a searched patient as the target without silently falling back to the open record", async () => {
    const f = fixture(), context: ContexteLive = { currentPatientId: "00000000-0000-4000-8000-000000000002", referencedPatientId: null };
    await lireOutilLive(f.client, "search_patient", { query: "Nadia" }, context);
    expect(context.referencedPatientId).toBe(patientId);
    expect(await lireOutilLive(f.client, "get_patient_summary", {}, context)).toMatchObject({ resume: f.resume });
  });
  it("does not read the open record after a truncated ambiguous name search", async () => {
    const f = fixture(true, { search_patients: [{ id: patientId, total_count: 2 }] });
    const context: ContexteLive = { currentPatientId: patientId, referencedPatientId: patientId };
    expect(await lireOutilLive(f.client, "search_patient", { query: "Nadia" }, context)).toMatchObject({ status: "ambiguous" });
    f.calls.length = 0;
    expect(await lireOutilLive(f.client, "get_patient_summary", {}, context)).toMatchObject({ status: "unavailable" });
    expect(f.calls).toEqual([]);
  });
  it("unwraps the SQL agenda row and keeps its unique next patient for follow-ups", async () => {
    const f = fixture(true, { dashboard_today: [{ suivant: { patient_id: patientId, starts_at: "2026-09-30T15:00:00Z", status: "booked" }, journee: [] }] });
    const context: ContexteLive = { currentPatientId: null, referencedPatientId: null };
    expect(await lireOutilLive(f.client, "get_next_patient", {}, context)).toMatchObject({ status: "ok", appointments: [{ patient: { patient_id: patientId } }] });
    expect(context.referencedPatientId).toBe(patientId);
    expect(await lireOutilLive(f.client, "get_patient_summary", {}, context)).toMatchObject({ resume: f.resume });
  });
  it("excludes unsigned notes and duplicate timeline events from the consultation history", async () => {
    const f = fixture(true, {
      list_patient_timeline: [{ event_id: "visit", label_key: "consultation_ouverte" }, { event_id: "visit", label_key: "consultation_close" }],
      get_consultation: [{ patient_id: patientId, signed_at: null, raw_notes: "private draft", subjective: "unsigned draft" }],
    });
    const result = await lireOutilLive(f.client, "get_patient_consultations", {}, { currentPatientId: patientId, referencedPatientId: null });
    expect(result).toMatchObject({ consultations: [{ note: null, note_signed: false }] });
    expect(JSON.stringify(result)).not.toContain("draft");
    expect((result.consultations as unknown[]).length).toBe(1);
  });
});
