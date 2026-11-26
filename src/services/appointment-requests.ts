/**
 * Reception's two decisions on a web/WhatsApp appointment request (235).
 *
 * ZÉRO DÉCISION D'AUTORISATION ICI : les portes sont SECURITY INVOKER, la RLS décide.
 * Accept = link a real patient file + the agreed time + confirm under lock (117), in
 * ONE database transaction. Candidates for the link come from the existing phone
 * matcher (`proposerCandidats`, 116), never from a guess here.
 */

import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

export { proposerCandidats as candidatsPourDemande } from "./communication/appariement";

export async function accepterDemande(
  appointmentId: string,
  patientId: string,
  startsAt: string,
): Promise<Result<boolean>> {
  const result = await db().rpc<boolean>("accept_appointment_request", {
    p_appointment_id: appointmentId,
    p_patient_id: patientId,
    p_starts_at: startsAt,
  });
  if (!result.ok) {
    log.error("demandes.accepter", logFieldsFor(result.error));
    return err(result.error);
  }
  log.info("demandes.accepter", { count: 1 });
  return ok(result.data[0] ?? false);
}

export async function refuserDemande(appointmentId: string, motif: string): Promise<Result<boolean>> {
  const result = await db().rpc<boolean>("reject_appointment_request", {
    p_appointment_id: appointmentId,
    p_motif: motif,
  });
  if (!result.ok) {
    log.error("demandes.refuser", logFieldsFor(result.error));
    return err(result.error);
  }
  log.info("demandes.refuser", { count: 1 });
  return ok(result.data[0] ?? false);
}
