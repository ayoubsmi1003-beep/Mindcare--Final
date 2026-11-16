import { z } from "zod";
import { fr } from "@/i18n/fr";
import { db } from "./db";
import { toAppError } from "./errors";
import { err, ok, type Result } from "./result";
import {
  AftercareBindingSchema, AftercareEventSchema, AftercareObjectSchema, AftercarePublicationSchema,
  type AftercareBinding, type AftercareEvent, type AftercareObject, type AftercarePublication,
} from "./aftercare-contracts";

function invalid<T>(): Result<T> {
  return err({ code: "regle-metier", message: fr.patients.reponseIncoherente, technical: "schema", context: "aftercare" });
}
async function checked<T>(run: () => Promise<Result<readonly unknown[]>>, schema: z.ZodType<T>, one = false): Promise<Result<T[]>> {
  try {
    const result = await run();
    if (!result.ok) return result;
    const parsed = z.array(schema).safeParse(result.data);
    return parsed.success && (!one || parsed.data.length === 1) ? ok(parsed.data) : invalid();
  } catch (cause) { return err(toAppError(cause, "aftercare")); }
}
const uuid = z.string().uuid();
const BindingInput = z.object({ bindingId: uuid, patientId: uuid, portalPatientId: uuid, relationship: z.enum(["self", "guardian"]), evidence: z.string().trim().min(1).max(2000), consentVersion: z.number().int().positive().max(2147483647), confirmed: z.literal(true) }).strict();
export type VerifyAftercareBindingInput = z.infer<typeof BindingInput>;

export async function verifyAftercareBinding(input: VerifyAftercareBindingInput): Promise<Result<AftercareBinding[]>> {
  const p = BindingInput.safeParse(input);
  if (!p.success) return invalid();
  return checked(() => db().rpc("verify_aftercare_binding", { p_binding: p.data.bindingId, p_patient: p.data.patientId, p_portal_patient: p.data.portalPatientId, p_relationship: p.data.relationship, p_evidence: p.data.evidence, p_consent_version: p.data.consentVersion, p_confirmed: p.data.confirmed }), AftercareBindingSchema, true);
}
export async function listAftercareBindings(patientId: string): Promise<Result<AftercareBinding[]>> {
  if (!uuid.safeParse(patientId).success) return invalid();
  return checked(() => db().rpc("list_aftercare_bindings", { p_patient: patientId }), AftercareBindingSchema);
}
export async function listAftercareObjects(patientId: string, limit = 25, offset = 0): Promise<Result<AftercareObject[]>> {
  if (!uuid.safeParse(patientId).success || !z.number().int().min(1).max(50).safeParse(limit).success || !z.number().int().nonnegative().safeParse(offset).success) return invalid();
  return checked(() => db().rpc("list_aftercare_objects", { p_patient: patientId, p_limit: limit, p_offset: offset }), AftercareObjectSchema);
}
export async function publishAftercareObject(input: { bindingId: string; objectId: string; expectedVersion: number; requestId: string; confirmed: true; publication: AftercarePublication }): Promise<Result<AftercareEvent[]>> {
  const p = z.object({ bindingId: uuid, objectId: uuid, expectedVersion: z.number().int().nonnegative().max(2147483646), requestId: uuid, confirmed: z.literal(true), publication: AftercarePublicationSchema }).strict().safeParse(input);
  if (!p.success) return invalid();
  return checked(() => db().rpc("publish_aftercare_object", { p_binding: p.data.bindingId, p_object: p.data.objectId, p_expected_version: p.data.expectedVersion, p_kind: p.data.publication.kind, p_body: JSON.stringify(p.data.publication.body), p_request: p.data.requestId, p_confirmed: p.data.confirmed }), AftercareEventSchema, true);
}
export async function readAftercareObject(bindingId: string, objectId: string, version: number): Promise<Result<AftercareObject[]>> {
  if (!uuid.safeParse(bindingId).success || !uuid.safeParse(objectId).success || !z.number().int().positive().safeParse(version).success) return invalid();
  return checked(() => db().rpc("read_aftercare_object", { p_binding: bindingId, p_object: objectId, p_version: version }), AftercareObjectSchema, true);
}
export async function revokeAftercareBinding(bindingId: string, confirmed: true): Promise<Result<void>> {
  if (!uuid.safeParse(bindingId).success || confirmed !== true) return invalid();
  try {
    const result = await db().rpc("revoke_aftercare_binding", { p_binding: bindingId, p_confirmed: confirmed });
    return result.ok ? ok(undefined) : result;
  } catch (cause) { return err(toAppError(cause, "aftercare")); }
}
