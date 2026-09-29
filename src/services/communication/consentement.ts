/**
 * Consentement — lecture/écriture via les portes 112/113.
 * Aucune décision d'autorisation ici : `false` par défaut côté base
 * (fail-closed), ce fichier ne fait que transporter.
 */

import { db } from "../db";
import { logFieldsFor } from "../errors";
import { log } from "../log";
import { err, ok, type Result } from "../result";

import type { Canal } from "./types";

export async function lireConsentement(
  patientId: string,
  canal: Canal,
): Promise<Result<boolean>> {
  const result = await db().rpc<boolean>("comm_get_consent", {
    p_patient_id: patientId,
    p_canal: canal,
  });
  if (!result.ok) {
    log.error("communication.consentement.lecture", logFieldsFor(result.error));
    return err(result.error);
  }
  return ok(result.data[0] ?? false);
}

export async function poserConsentement(
  patientId: string,
  canal: Canal,
  consentement: boolean,
): Promise<Result<boolean>> {
  const result = await db().rpc<boolean>("comm_set_consent", {
    p_patient_id: patientId,
    p_canal: canal,
    p_consentement: consentement,
  });
  if (!result.ok) {
    log.error("communication.consentement.ecriture", logFieldsFor(result.error));
    return err(result.error);
  }
  return ok(result.data[0] ?? false);
}
