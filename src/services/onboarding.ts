/**
 * Le premier lancement — RIEN D'AUTRE, même esprit que `auth.ts`.
 *
 * Deux opérations : savoir s'il faut montrer l'écran de configuration, et
 * créer le compte réel. Aucune décision d'autorisation ici — la porte SQL
 * (084/085) est ce qui décide, ce fichier ne fait que l'appeler.
 */

import { db } from "./db";
import type { EtatInstallation, ProvisionnementOwner } from "./db/port";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

export async function getInstallationStatus(): Promise<Result<EtatInstallation>> {
  const result = await db().getInstallationStatus();
  if (!result.ok) {
    log.error("onboarding.getInstallationStatus", logFieldsFor(result.error));
    return err(result.error);
  }
  return ok(result.data);
}

/**
 * Ne journalise AUCUN champ de `entree` : nom, adresse, courriel et mot de
 * passe de la praticienne sont des données identifiantes (règle 1 de
 * CLAUDE.md), même à l'installation.
 */
export async function provisionOwnerAccount(
  entree: ProvisionnementOwner,
): Promise<Result<{ readonly userId: string }>> {
  const result = await db().provisionOwnerAccount(entree);
  if (!result.ok) {
    log.error("onboarding.provisionOwnerAccount", logFieldsFor(result.error));
    return err(result.error);
  }
  log.info("onboarding.provisionOwnerAccount", { code: "ok" });
  return ok(result.data);
}
