import { describe, expect, it } from "vitest";
import { forgetVerifiedConsultations, verifyConsultationContext, withConsultationPatient } from "@/server/alexa/consultation-context";
import type { TurnInput } from "@/shared/alexa/turn";

const CONSULTATION = "11111111-1111-4111-8111-111111111111";
const PATIENT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

type Rows = readonly unknown[];
/** Stands in for the audited gates: each name maps to the rows it would return for the caller. */
function fakeDb(table: Record<string, Rows | "fail">) {
  const calls: string[] = [];
  return {
    calls,
    db: {
      rpc: async (name: string) => {
        calls.push(name);
        const rows = table[name];
        if (rows === "fail" || rows === undefined) return { ok: false as const, error: { code: "x", message: "x" } } as never;
        return { ok: true as const, data: rows } as never;
      },
    },
  };
}
const input = (appContext: Partial<TurnInput["appContext"]>): TurnInput => ({
  text: "Quel est son traitement actuel ?", conversationId: "c", clientTurnId: "t",
  appContext: { patientId: null, page: `/consultation/${CONSULTATION}`, ...appContext },
} as TurnInput);
const patientRow = (id: string) => [{ id, first_name: "Prénom", last_name: "Nom" }];

describe("consultation context", () => {
  it("does nothing off the consultation screen", async () => {
    const { db, calls } = fakeDb({});
    expect(await verifyConsultationContext(db, { patientId: null, page: "/jarvis" })).toEqual({ status: "none" });
    expect(calls).toEqual([]);
  });

  it("derives the patient from the audited gates, never from the client", async () => {
    const { db, calls } = fakeDb({ get_consultation: [{ id: CONSULTATION, patient_id: PATIENT }], get_patient: patientRow(PATIENT) });
    const result = await withConsultationPatient(input({ consultationId: CONSULTATION }), db);
    expect(result.context).toEqual({ status: "verified", patientId: PATIENT, consultationId: CONSULTATION });
    expect(result.input.appContext.patientId).toBe(PATIENT);
    expect(calls).toEqual(["get_consultation", "get_patient"]);
  });

  it("accepts the gate answering under its function name", async () => {
    const { db } = fakeDb({ get_consultation: [{ get_consultation: { id: CONSULTATION, patient_id: PATIENT } }], get_patient: patientRow(PATIENT) });
    expect((await verifyConsultationContext(db, input({ consultationId: CONSULTATION }).appContext)).status).toBe("verified");
  });

  it("lets the consultation override a different patient reported by the client", async () => {
    const { db } = fakeDb({ get_consultation: [{ id: CONSULTATION, patient_id: PATIENT }], get_patient: patientRow(PATIENT) });
    const result = await withConsultationPatient(input({ consultationId: CONSULTATION, patientId: OTHER }), db);
    expect(result.input.appContext.patientId).toBe(PATIENT);
  });

  it("leaves the turn unchanged when the consultation is outside the caller's scope", async () => {
    const { db } = fakeDb({ get_consultation: [], get_patient: patientRow(PATIENT) });
    const original = input({ consultationId: CONSULTATION });
    const result = await withConsultationPatient(original, db);
    expect(result.context).toEqual({ status: "unavailable" });
    expect(result.input).toBe(original);
  });

  it("refuses a consultation whose patient the patient gate will not return", async () => {
    const { db } = fakeDb({ get_consultation: [{ id: CONSULTATION, patient_id: PATIENT }], get_patient: [] });
    expect((await verifyConsultationContext(db, input({ consultationId: CONSULTATION }).appContext)).status).toBe("unavailable");
  });

  it("refuses a row that is not the consultation asked for", async () => {
    const { db } = fakeDb({ get_consultation: [{ id: OTHER, patient_id: PATIENT }], get_patient: patientRow(PATIENT) });
    expect((await verifyConsultationContext(db, input({ consultationId: CONSULTATION }).appContext)).status).toBe("unavailable");
  });

  it("reports a failing gate as unavailable, never as a guess", async () => {
    const { db } = fakeDb({ get_consultation: "fail" });
    expect((await verifyConsultationContext(db, input({ consultationId: CONSULTATION }).appContext)).status).toBe("unavailable");
  });

  it("does not call the gates once the turn is cancelled", async () => {
    const { db, calls } = fakeDb({ get_consultation: [{ id: CONSULTATION, patient_id: PATIENT }] });
    const controller = new AbortController();
    controller.abort();
    expect((await verifyConsultationContext(db, input({ consultationId: CONSULTATION }).appContext, controller.signal)).status).toBe("unavailable");
    expect(calls).toEqual([]);
  });
});

describe("the consultation is read once per conversation, not once per turn", () => {
  const gates = () => fakeDb({ get_consultation: [{ id: CONSULTATION, patient_id: PATIENT }], get_patient: patientRow(PATIENT), search_patients: patientRow(PATIENT) });
  it("reads the consultation gate on the first turn only", async () => {
    forgetVerifiedConsultations();
    const { db, calls } = gates();
    const first = await withConsultationPatient(input({ consultationId: CONSULTATION }), db as never, undefined, "doctor-a", 1_000);
    const second = await withConsultationPatient(input({ consultationId: CONSULTATION }), db as never, undefined, "doctor-a", 60_000);
    expect(first.input.appContext.patientId).toBe(PATIENT);
    expect(second.input.appContext.patientId).toBe(PATIENT);
    expect(calls.filter((name) => name === "get_consultation")).toHaveLength(1);
  });
  it("asks again after ten minutes, for another conversation, another doctor or another consultation", async () => {
    forgetVerifiedConsultations();
    const { db, calls } = gates();
    await withConsultationPatient(input({ consultationId: CONSULTATION }), db as never, undefined, "doctor-a", 0);
    await withConsultationPatient(input({ consultationId: CONSULTATION }), db as never, undefined, "doctor-a", 11 * 60_000);
    await withConsultationPatient({ ...input({ consultationId: CONSULTATION }), conversationId: "other" }, db as never, undefined, "doctor-a", 11 * 60_000);
    await withConsultationPatient(input({ consultationId: CONSULTATION }), db as never, undefined, "doctor-b", 11 * 60_000);
    expect(calls.filter((name) => name === "get_consultation")).toHaveLength(4);
  });
  it("never keeps a failure: the next turn tries again", async () => {
    forgetVerifiedConsultations();
    const { db, calls } = fakeDb({ get_consultation: "fail" });
    await withConsultationPatient(input({ consultationId: CONSULTATION }), db as never, undefined, "doctor-a", 0);
    await withConsultationPatient(input({ consultationId: CONSULTATION }), db as never, undefined, "doctor-a", 1_000);
    expect(calls.filter((name) => name === "get_consultation")).toHaveLength(2);
  });
  it("keeps nothing without an actor", async () => {
    forgetVerifiedConsultations();
    const { db, calls } = gates();
    await withConsultationPatient(input({ consultationId: CONSULTATION }), db as never);
    await withConsultationPatient(input({ consultationId: CONSULTATION }), db as never);
    expect(calls.filter((name) => name === "get_consultation")).toHaveLength(2);
  });
});
