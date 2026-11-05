import { describe, expect, it, vi } from "vitest";
import { scriptedAlexaRpc } from "../helpers/alexa-rpc";
import { agentExecutor } from "@/server/alexa/agent-tools";

const patient = "22222222-2222-4222-8222-222222222222";
const firstVisit = "33333333-3333-4333-8333-333333333331";
const lastVisit = "33333333-3333-4333-8333-333333333332";
const asOf = "2026-11-05T12:00:00+01:00";
const input = { text: "", conversationId: "record-reads", clientTurnId: "11111111-1111-4111-8111-111111111111", appContext: { patientId: patient, page: `/patients/${patient}` } };

describe("governed patient-record reads", () => {
  it("uses a future window for scheduled appointments instead of asking an unnecessary date", async () => {
    const rpc = scriptedAlexaRpc(async name => {
      if (name === "get_patient") return { ok: true as const, data: [{ id: patient }] };
      if (name === "query_alexa_records") return { ok: true as const, data: [{ total: 0, rows: [], totals: {}, complete: true, offset: 0 }] };
      throw Error(name);
    });
    const result = await agentExecutor({ ...input, text: "Quels rendez-vous sont prévus pour ce patient ?" }, { rpc }, { rpc: vi.fn() })(
      { id: "upcoming", name: "query_agenda", args: { partIds: ["upcoming"], patientId: patient } }, asOf, [], new AbortController().signal,
    );
    const call = rpc.mock.calls.find(([name]) => name === "query_alexa_records");
    expect(call).toBeTruthy();
    const spec = JSON.parse(String(call![1]["p_spec"]));
    expect(spec).toMatchObject({ patientId: patient, from: asOf });
    expect(Date.parse(spec.to) - Date.parse(spec.from)).toBe(364 * 86400000);
    expect(result.status).toBe("empty");
  });

  it("answers the patient's financial situation from the existing patient-finance gate", async () => {
    const consult = "44444444-4444-4444-8444-444444444444";
    const rpc = scriptedAlexaRpc(async name => {
      if (name === "get_patient") return { ok: true as const, data: [{ id: patient, first_name: "Patient", last_name: "Fictif" }] };
      if (name === "get_patient_workspace") return { ok: true as const, data: [{ identite: { id: patient }, clinique: {} }] };
      if (name === "list_patient_timeline") return { ok: true as const, data: [{ event_id: consult, occurred_at: asOf, label_key: "consultation_close" }] };
      if (name === "get_consultation_payment") return { ok: true as const, data: [{ payment_id: "55555555-5555-4555-8555-555555555555", amount_dzd: 4500, collected_at: null }] };
      throw Error(name);
    });
    const result = await agentExecutor({ ...input, text: "Quelle est la situation financière de ce patient ?" }, { rpc }, { rpc: vi.fn() })(
      { id: "finance", name: "query_finance", args: { partIds: ["finance"], patientId: patient, mode: "totals", state: "all" } }, asOf, [], new AbortController().signal,
    );
    expect(result).toMatchObject({ status: "ok", complete: true });
    expect(result.text).toContain("4500 DZD en attente");
  });

  it("answers first and last consultation dates without a model or a period clarification", async () => {
    const context = {
      patientId: patient,
      consultations: [
        { id: lastVisit, startedAt: "2026-10-01T09:00:00+01:00", endedAt: "2026-10-01T09:30:00+01:00", notes: [] },
        { id: firstVisit, startedAt: "2024-01-10T09:00:00+01:00", endedAt: "2024-01-10T09:30:00+01:00", notes: [] },
      ],
      treatments: { current: [], history: [], historyComplete: true },
      diagnoses: [],
      scales: [],
      sourceRevision: "a".repeat(64),
      coverage: { requested: 100, returned: 2, complete: true, hasMore: false },
    };
    const rpc = scriptedAlexaRpc(async name => ({ ok: true as const, data: [name === "get_patient" ? { id: patient } : context] }));
    const result = await agentExecutor({ ...input, text: "Quelles sont les dates de la première et de la dernière consultation ?" }, { rpc }, { rpc: vi.fn() })(
      { id: "bounds", name: "get_patient_context", args: { partIds: ["bounds"], section: "summary" } }, asOf, [], new AbortController().signal,
    );
    expect(result).toMatchObject({ status: "ok", complete: true });
    expect(result.text).toContain("10 janvier 2024");
    expect(result.text).toContain("1 octobre 2026");
    expect(result.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ id: firstVisit }), expect.objectContaining({ id: lastVisit })]));
  });
});
