import { afterEach, describe, expect, it, vi } from "vitest";
import { AftercareEnvelopeSchema, AftercarePublicationSchema, AftercareSubmissionSchema } from "@/services/aftercare-contracts";
import { listAftercareObjects, publishAftercareObject, verifyAftercareBinding } from "@/services/aftercare";
import { db, setDbPort } from "@/services/db";
import { ok } from "@/services/result";

const id = "b1000000-0000-4000-8000-000000000001";
afterEach(() => setDbPort(undefined));

describe("Aftercare authority contracts", () => {
  it.each([
    { kind: "mission", body: { title: "Reflection", purpose: "Observe", instructions: "Write", status: "published" } },
    { kind: "carePlan", body: { title: "Plan", text: "Human instruction", status: "published" } },
    { kind: "doctorNote", body: { text: "Human note", status: "published" } },
    { kind: "review", body: { sourceId: id, sourceVersion: 1, status: "reviewed", text: "Human reply" } },
  ])("accepts typed $kind publication", publication => {
    expect(AftercarePublicationSchema.safeParse(publication).success).toBe(true);
  });
  it("rejects caller-assigned authority and clinical mutations", () => {
    expect(AftercarePublicationSchema.safeParse({ kind: "doctorNote", body: { text: "Note", status: "published", approvedBy: id } }).success).toBe(false);
    expect(AftercarePublicationSchema.safeParse({ kind: "prescription", body: { medication: "Unrequested change" } }).success).toBe(false);
    expect(AftercarePublicationSchema.safeParse({ kind: "mission", body: { title: "Mission", purpose: "Observe", instructions: "Write", status: "published", durationMinutes: 181 } }).success).toBe(false);
  });
  it("keeps submissions separate from official records", () => {
    expect(AftercareSubmissionSchema.safeParse({ kind: "journal", body: { format: "free", text: "Patient words", status: "saved" } }).success).toBe(true);
    expect(AftercareSubmissionSchema.safeParse({ kind: "doctorNote", body: { text: "Forged authority", status: "published" } }).success).toBe(false);
    expect(AftercareSubmissionSchema.safeParse({ kind: "missionResponse", body: { missionId: id, missionVersion: 1, status: "completed", reflection: "Patient reflection", reviewedBy: id } }).success).toBe(false);
  });
  it("validates wire identity/version and excludes local mapping", () => {
    const wire = { schemaVersion: 2, eventId: id, patientId: id, bindingId: id, objectId: id, version: 1, effectiveAt: "2026-11-16T10:00:00+01:00", emittedAt: "2026-11-16T10:00:00+01:00", source: "sanad", correlationId: id, shareState: "shared", object: { kind: "journal", body: { text: "Patient words" } } };
    expect(AftercareEnvelopeSchema.safeParse(wire).success).toBe(true);
    expect(AftercareEnvelopeSchema.safeParse({ ...wire, version: 0 }).success).toBe(false);
    expect(AftercareEnvelopeSchema.safeParse({ ...wire, localPatientId: id }).success).toBe(false);
  });
});

describe("Aftercare service trust boundaries", () => {
  it("refuses unconfirmed identity and oversized pages before reaching DbPort", async () => {
    setDbPort({ ...db(), rpc: vi.fn(() => { throw new Error("Must not reach database"); }) });
    const result: unknown = await Reflect.apply(verifyAftercareBinding, undefined, [{ bindingId: id, patientId: id, portalPatientId: id, relationship: "guardian", evidence: "Doctor verified authority", consentVersion: 1, confirmed: false }]);
    expect(result).toMatchObject({ ok: false });
    expect(await listAftercareObjects(id, 51)).toMatchObject({ ok: false, error: { technical: "schema" } });
  });
  it("does not surface untrusted database error text", async () => {
    setDbPort({ ...db(), rpc: vi.fn(async () => { throw new Error("PRIVATE PATIENT CONTENT"); }) });
    const result = await listAftercareObjects(id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).not.toContain("PRIVATE PATIENT CONTENT");
  });
  it("fails closed on malformed database responses", async () => {
    setDbPort({ ...db(), rpc: vi.fn().mockResolvedValue(ok([{ body: "Unvalidated shape" }])) });
    expect(await listAftercareObjects(id)).toMatchObject({ ok: false, error: { technical: "schema" } });
  });
  it("serializes structured publication at the scalar DbPort boundary", async () => {
    let received: unknown;
    setDbPort({ ...db(), rpc: vi.fn(async (name: string, args: unknown) => { received = { name, args }; return ok([]); }) });
    const publication = { kind: "doctorNote" as const, body: { text: "Human note", status: "published" as const } };
    // An empty mutation response is also refused; SQL must return its one committed event.
    expect((await publishAftercareObject({ bindingId: id, objectId: id, expectedVersion: 0, requestId: id, confirmed: true, publication })).ok).toBe(false);
    expect(received).toMatchObject({ name: "publish_aftercare_object", args: { p_body: JSON.stringify(publication.body), p_expected_version: 0, p_confirmed: true } });
  });
});
