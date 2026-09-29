/**
 * Appariement — candidats dossiers pour un numéro entrant, liaison humaine.
 * Le matching propose (0..10 candidats), l'humaine dispose (`comm_lier_patient`).
 */

import { db } from "../db";
import { logFieldsFor } from "../errors";
import { log } from "../log";
import { err, ok, type Result } from "../result";

export interface CandidatPatient {
  readonly patientId: string;
  readonly libelle: string;
}

export async function proposerCandidats(telephone: string): Promise<Result<readonly CandidatPatient[]>> {
  const result = await db().rpc<CandidatPatient>("comm_matcher_patient", {
    p_telephone: telephone,
  });
  if (!result.ok) {
    log.error("communication.appariement", logFieldsFor(result.error));
    return err(result.error);
  }
  return ok(result.data);
}

export async function lierPatient(
  conversationId: string,
  patientId: string,
): Promise<Result<boolean>> {
  const result = await db().rpc<boolean>("comm_lier_patient", {
    p_conversation_id: conversationId,
    p_patient_id: patientId,
  });
  if (!result.ok) {
    log.error("communication.liaison", logFieldsFor(result.error));
    return err(result.error);
  }
  log.info("communication.liaison", { count: 1 });
  return ok(result.data[0] ?? false);
}

export async function marquerRemise(
  messageId: string,
  statut: "delivered" | "read",
): Promise<Result<boolean>> {
  const result = await db().rpc<boolean>("comm_suivi_statut", {
    p_message_id: messageId,
    p_statut: statut,
  });
  if (!result.ok) {
    log.error("communication.remise", logFieldsFor(result.error));
    return err(result.error);
  }
  return ok(result.data[0] ?? false);
}
