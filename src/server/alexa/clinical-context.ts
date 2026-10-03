import type { DbPort } from "@/services/db/port";
import { clinicalContextSchema, consultationCursorSchema, type ClinicalContext, type ClinicalContextRequest, type ClinicalConsultation } from "@/shared/alexa/clinical";
export type { ClinicalContext, ClinicalContextRequest } from "@/shared/alexa/clinical";

export type ClinicalContextErrorCode = "unavailable" | "invalid-context" | "invalid-request" | "stale-context" | "cancelled";
/** Codes only: SQL errors can contain identifiers and must not reach UI/logs. */
export class ClinicalContextError extends Error {
  constructor(readonly code: ClinicalContextErrorCode) { super(code); this.name = "ClinicalContextError"; }
}
function active(signal?: AbortSignal): void { if (signal?.aborted) throw new ClinicalContextError("cancelled"); }

export async function buildClinicalContext(db: Pick<DbPort, "rpc">, scope: { readonly patientId: string }, request: ClinicalContextRequest, signal?: AbortSignal): Promise<ClinicalContext> {
  active(signal);
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > 100 ||
      !clinicalContextSchema.shape.patientId.safeParse(scope.patientId).success ||
      (request.before !== undefined && !consultationCursorSchema.safeParse(request.before).success)) throw new ClinicalContextError("invalid-request");
  try {
    const patient = await db.rpc<{ readonly id: string }>("get_patient", { p_id: scope.patientId });
    active(signal);
    if (!patient.ok || patient.data.length !== 1 || patient.data[0]?.id !== scope.patientId) throw new ClinicalContextError("unavailable");
    const consultations: ClinicalConsultation[] = [];
    let first: ClinicalContext | undefined;
    let before = request.before;
    let last: ClinicalContext | undefined;
    let complete = true;
    while (consultations.length < request.count) {
      active(signal);
      const limit = Math.min(20, request.count - consultations.length);
      const result = await db.rpc<unknown>("get_alexa_clinical_context", { p_patient_id: scope.patientId, p_limit: limit,
        p_before_at: before?.startedAt ?? null, p_before_id: before?.id ?? null });
      active(signal);
      if (!result.ok) throw new ClinicalContextError("unavailable");
      const parsed = clinicalContextSchema.safeParse(result.data[0]);
      if (!parsed.success || parsed.data.patientId !== scope.patientId || parsed.data.coverage.returned !== parsed.data.consultations.length || parsed.data.consultations.length > limit) throw new ClinicalContextError("invalid-context");
      const page = parsed.data;
      if (first !== undefined && first.sourceRevision !== page.sourceRevision) throw new ClinicalContextError("stale-context");
      first ??= page;
      for (const consultation of page.consultations) {
        if (consultation.endedAt === null || consultations.some((existing) => existing.id === consultation.id)) throw new ClinicalContextError("invalid-context");
        consultations.push(consultation);
      }
      complete &&= page.coverage.complete;
      last = page;
      if (!page.coverage.hasMore) break;
      const next = page.coverage.next;
      if (page.consultations.length === 0 || next === undefined || (before?.id === next.id && before.startedAt === next.startedAt)) throw new ClinicalContextError("invalid-context");
      before = next;
    }
    if (first === undefined || last === undefined) throw new ClinicalContextError("invalid-context");
    return { ...first, consultations, coverage: { requested: request.count, returned: consultations.length,
      complete: complete && first.treatments.historyComplete && consultations.length === request.count,
      hasMore: last.coverage.hasMore, ...(last.coverage.next === undefined ? {} : { next: last.coverage.next }) } };
  } catch (error) {
    if (error instanceof ClinicalContextError) throw error;
    throw new ClinicalContextError(signal?.aborted ? "cancelled" : "unavailable");
  }
}

/** Rechecks the whole-record revision; the gate revision is independent of the requested page. */
export async function readClinicalSourceRevision(db: Pick<DbPort, "rpc">, scope: { readonly patientId: string }, signal?: AbortSignal): Promise<string> {
  return (await buildClinicalContext(db, scope, { count: 1 }, signal)).sourceRevision;
}
