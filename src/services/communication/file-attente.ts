/**
 * File d'attente hors-ligne — les envois impossibles deviennent `queued`.
 *
 * JAMAIS de faux `sent` : la reprise est explicite (`reprendreFile`), message
 * par message, avec re-vérification du consentement et de la connexion avant
 * chaque tentative. Ce module ne touche pas au réseau.
 */

import { db } from "../db";
import { logFieldsFor } from "../errors";
import { log } from "../log";
import { err, ok, type Result } from "../result";

export async function mettreEnFile(messageId: string): Promise<Result<boolean>> {
  const result = await db().rpc<boolean>("comm_transition_message", {
    p_message_id: messageId,
    p_vers: "queued",
  });
  if (!result.ok) {
    log.error("communication.file.attente", logFieldsFor(result.error));
    return err(result.error);
  }
  log.info("communication.file.attente", { count: 1 });
  return ok(result.data[0] ?? false);
}

export async function marquerEnvoi(messageId: string): Promise<Result<boolean>> {
  const result = await db().rpc<boolean>("comm_transition_message", {
    p_message_id: messageId,
    p_vers: "sending",
  });
  if (!result.ok) {
    log.error("communication.file.envoi", logFieldsFor(result.error));
    return err(result.error);
  }
  return ok(result.data[0] ?? false);
}
