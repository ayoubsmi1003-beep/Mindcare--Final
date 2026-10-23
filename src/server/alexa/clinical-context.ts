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
  const bounded=request.from!==undefined||request.to!==undefined;
  const from=request.from===undefined?undefined:Date.parse(request.from),to=request.to===undefined?undefined:Date.parse(request.to);
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > 100 ||
      !clinicalContextSchema.shape.patientId.safeParse(scope.patientId).success ||
      (request.before !== undefined && !consultationCursorSchema.safeParse(request.before).success) ||
      (bounded && (request.from===undefined||request.to===undefined||!Number.isFinite(from)||!Number.isFinite(to)||from!>=to!||request.before!==undefined))) throw new ClinicalContextError("invalid-request");
  try {
    const patient = await db.rpc<{ readonly id: string }>("get_patient", { p_id: scope.patientId });
    active(signal);
    if (!patient.ok || patient.data.length !== 1 || patient.data[0]?.id !== scope.patientId) throw new ClinicalContextError("unavailable");
    const consultations: ClinicalConsultation[] = [];
    let first: ClinicalContext | undefined;
    let before = request.before;
    let last: ClinicalContext | undefined;
    let complete = true;
    let crossedLowerBoundary=false,rowsSeen=0;
    while (bounded ? rowsSeen<100&&!crossedLowerBoundary&&(last===undefined||last.coverage.hasMore) : request.all || consultations.length < request.count) {
      active(signal);
      const limit = Math.min(20, bounded?100-rowsSeen:request.all?20:request.count-consultations.length);
      const result = await db.rpc<unknown>("get_alexa_clinical_context", { p_patient_id: scope.patientId, p_limit: limit,
        p_before_at: before?.startedAt ?? null, p_before_id: before?.id ?? null });
      active(signal);
      if (!result.ok) throw new ClinicalContextError("unavailable");
      const parsed = clinicalContextSchema.safeParse(result.data[0]);
      if (!parsed.success || parsed.data.patientId !== scope.patientId || parsed.data.coverage.returned !== parsed.data.consultations.length || parsed.data.consultations.length > limit) throw new ClinicalContextError("invalid-context");
      const page = parsed.data;
      if (first !== undefined && first.sourceRevision !== page.sourceRevision) throw new ClinicalContextError("stale-context");
      first ??= page;
      let previous=before;
      for (const consultation of page.consultations) {
        if (consultation.endedAt === null || consultations.some((existing) => existing.id === consultation.id)) throw new ClinicalContextError("invalid-context");
        const at=Date.parse(consultation.startedAt);
        if(previous&&(at>Date.parse(previous.startedAt)||(at===Date.parse(previous.startedAt)&&consultation.id>=previous.id)))throw new ClinicalContextError("invalid-context");
        previous={startedAt:consultation.startedAt,id:consultation.id};rowsSeen++;
        if(!bounded)consultations.push(consultation);
        else{
          if(at<from!)crossedLowerBoundary=true;
          if(at>=from!&&at<to!){
            consultations.push(consultation);
            if(!consultation.notes.length&&!(consultation.rawNotes??"").trim())complete=false;
          }
        }
      }
      if(!bounded)complete&&=page.coverage.complete;
      else if(page.coverage.returned<page.coverage.requested&&page.coverage.hasMore)complete=false;
      last = page;
      if (!page.coverage.hasMore||bounded&&crossedLowerBoundary) break;
      const next = page.coverage.next;
      if (page.consultations.length === 0 || next === undefined || (before?.id === next.id && before.startedAt === next.startedAt)) throw new ClinicalContextError("invalid-context");
      before = next;
    }
    if (first === undefined || last === undefined) throw new ClinicalContextError("invalid-context");
    const rangeHasMore=bounded&& !crossedLowerBoundary&&last.coverage.hasMore;
    const rangeComplete=bounded&&(crossedLowerBoundary||!last.coverage.hasMore);
    return { ...first, consultations, coverage: { requested: bounded?100:request.all?Math.max(1,consultations.length):request.count, returned: consultations.length,
      complete: bounded ? complete&&rangeComplete : complete&&first.treatments.historyComplete&&(consultations.length===request.count||!last.coverage.hasMore),
      hasMore: bounded?rangeHasMore:last.coverage.hasMore, ...((bounded?rangeHasMore:last.coverage.hasMore)&&last.coverage.next!==undefined?{next:last.coverage.next}:{}) } };
  } catch (error) {
    if (error instanceof ClinicalContextError) throw error;
    throw new ClinicalContextError(signal?.aborted ? "cancelled" : "unavailable");
  }
}

/** Rechecks the whole-record revision; the gate revision is independent of the requested page. */
export async function readClinicalSourceRevision(db: Pick<DbPort, "rpc">, scope: { readonly patientId: string }, signal?: AbortSignal): Promise<string> {
  return (await buildClinicalContext(db, scope, { count: 1 }, signal)).sourceRevision;
}
