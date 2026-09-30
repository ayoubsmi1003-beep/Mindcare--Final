import { describe, expect, it, vi } from "vitest";
import { lireOutilLive } from "@/server/voice/live-tools";
import type { ClientSql } from "@/server/jarvis/client-sql";

const patientId = "00000000-0000-4000-8000-000000000009";
function fixture(synthetic = true) {
  const calls: string[] = [];
  const resume = { id: "existing-summary", contenu: { schema: 2, en_bref: "Exact existing synthetic summary" } };
  const rpc = vi.fn(async (name: string) => {
    calls.push(name);
    return { error: null, data: name === "get_patient" ? [{ id: patientId, first_name: "Nadia fictive", is_synthetic: synthetic }]
      : name === "get_patient_workspace" ? { clinique: {}, resume }
      : name === "search_patients" ? [{ id: patientId, total_count: 1 }] : null };
  });
  return { client: { rpc } as ClientSql, calls, resume };
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
});
