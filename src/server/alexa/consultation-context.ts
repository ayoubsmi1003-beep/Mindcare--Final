import type { DbPort } from "@/services/db/port";
import type { TurnInput } from "@/shared/alexa/turn";
import { resolvePatient } from "./patient-resolver";

/**
 * The consultation screen knows which patient its consultation belongs to, but the client only reports
 * the consultation id, and a client claim is never an identity. This asks the audited gates, under the
 * caller's own rights: `get_consultation`, then `get_patient`. The patient it returns is the one the
 * doctor is looking at, so "ce patient" and "son traitement" need no name.
 *
 * `unavailable` means the consultation could not be verified (absent, outside the caller's scope, gate
 * down). It never falls back on a guessed patient: the caller keeps whatever it had and the scope gate asks.
 */
export type ConsultationContext =
  | { readonly status: "none" }
  | { readonly status: "verified"; readonly patientId: string; readonly consultationId: string }
  | { readonly status: "unavailable" };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The gate may answer the row itself or wrapped under its function name, as `search_patients` does. */
function consultationRow(data: readonly unknown[]): { id?: unknown; patient_id?: unknown } | null {
  if (data.length !== 1) return null;
  const first = data[0];
  if (typeof first !== "object" || first === null) return null;
  const wrapped = "get_consultation" in first ? (first as { get_consultation?: unknown }).get_consultation : first;
  return typeof wrapped === "object" && wrapped !== null ? wrapped : null;
}

export async function verifyConsultationContext(
  db: Pick<DbPort, "rpc">,
  appContext: TurnInput["appContext"],
  signal?: AbortSignal,
): Promise<ConsultationContext> {
  const consultationId = appContext.consultationId;
  if (!consultationId) return { status: "none" };
  if (!uuid.test(consultationId) || signal?.aborted) return { status: "unavailable" };
  try {
    const found = await db.rpc<unknown>("get_consultation", { p_id: consultationId });
    if (signal?.aborted || !found.ok) return { status: "unavailable" };
    const row = consultationRow(found.data);
    if (!row || row.id !== consultationId || typeof row.patient_id !== "string" || !uuid.test(row.patient_id)) return { status: "unavailable" };
    // The patient gate re-checks access: a consultation row alone does not grant the dossier.
    const patient = await resolvePatient(db, { patientId: row.patient_id }, signal);
    return patient.status === "resolved" && patient.patientId === row.patient_id
      ? { status: "verified", patientId: row.patient_id, consultationId }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * The turn as the rest of the pipeline should see it. A verified consultation sets the working patient,
 * and wins over a different patient reported by the client: the screen cannot show one patient while
 * the question is read against another. An unverifiable consultation changes nothing.
 */
/**
 * `get_consultation` returns the whole row (raw notes included) and leaves an audit line each time it is read: asking it on every turn of a
 * conversation over-reads and adds noise. The patient of a consultation never changes, so a verified answer is kept for this actor, this
 * conversation and this consultation for a few minutes. It only decides which patient the question is about: every read that follows still
 * goes through `get_patient` and the other gates under the caller's own rights. A failure is never kept.
 */
const VERIFIED_FOR_MS = 10 * 60_000;
const MAX_VERIFIED = 500;
const verified = new Map<string, { readonly patientId: string; readonly until: number }>();

export function forgetVerifiedConsultations(): void { verified.clear(); }

export async function withConsultationPatient(
  input: TurnInput,
  db: Pick<DbPort, "rpc">,
  signal?: AbortSignal,
  actor?: string,
  now: number = Date.now(),
): Promise<{ readonly input: TurnInput; readonly context: ConsultationContext }> {
  const consultationId = input.appContext.consultationId;
  const key = actor && consultationId ? `${actor}|${input.conversationId}|${consultationId}` : null;
  const kept = key ? verified.get(key) : undefined;
  let context: ConsultationContext;
  if (key && kept && kept.until > now && consultationId) context = { status: "verified", patientId: kept.patientId, consultationId };
  else {
    context = await verifyConsultationContext(db, input.appContext, signal);
    if (key) {
      verified.delete(key);
      if (context.status === "verified") {
        if (verified.size >= MAX_VERIFIED) verified.delete(verified.keys().next().value as string);
        verified.set(key, { patientId: context.patientId, until: now + VERIFIED_FOR_MS });
      }
    }
  }
  if (context.status !== "verified" || input.appContext.patientId === context.patientId) return { input, context };
  return { input: { ...input, appContext: { ...input.appContext, patientId: context.patientId } }, context };
}
