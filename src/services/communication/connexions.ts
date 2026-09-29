/**
 * Gabarits et connexions — écritures via portes 113, lectures bornées.
 * Les contenus de gabarits sont des textes d'exploitation (approuvés Meta),
 * jamais des données patient.
 */

import { db } from "../db";
import { lireTestConnexion } from "../db/http";
import { logFieldsFor } from "../errors";
import { log } from "../log";
import { err, ok, type Result } from "../result";

import type { Canal } from "./types";

export type LangueGabarit = "fr" | "ar" | "darija" | "mixte";

export async function enregistrerGabarit(
  canal: Canal,
  nom: string,
  langue: LangueGabarit,
  corps: string,
): Promise<Result<string>> {
  const result = await db().rpc<string>("comm_upsert_template", {
    p_canal: canal,
    p_nom: nom,
    p_langue: langue,
    p_corps: corps,
  });
  if (!result.ok) {
    log.error("communication.gabarit", logFieldsFor(result.error));
    return err(result.error);
  }
  const id = result.data[0];
  if (id === undefined) return err({ code: "interdit", message: "Gabarit impossible." });
  log.info("communication.gabarit", { count: 1 });
  return ok(id);
}

export interface EtatConnexion {
  readonly canal: string;
  readonly statut: "connecte" | "non_connecte" | "erreur";
  readonly capacites: Record<string, unknown>;
}

export async function declarerConnexion(
  canal: Canal,
  statut: EtatConnexion["statut"],
  capacites: Record<string, unknown>,
): Promise<Result<boolean>> {
  const result = await db().rpc<boolean>("comm_set_connection", {
    p_canal: canal,
    p_statut: statut,
    // La porte reçoit du texte et caste elle-même (motif update_appointment).
    p_capacites: JSON.stringify(capacites),
  });
  if (!result.ok) {
    log.error("communication.connexion", logFieldsFor(result.error));
    return err(result.error);
  }
  log.info("communication.connexion", { count: 1 });
  return ok(result.data[0] ?? false);
}

export async function lireConnexions(
  canal: Canal | null,
): Promise<Result<readonly EtatConnexion[]>> {
  const result = await db().rpc<EtatConnexion>("comm_connection_status", {
    p_canal: canal,
  });
  if (!result.ok) {
    log.error("communication.connexions", logFieldsFor(result.error));
    return err(result.error);
  }
  return ok(result.data);
}

export interface BilanConnexionTest {
  readonly canal: string;
  readonly connecte: boolean;
  readonly capacites: readonly { readonly nom: string; readonly disponible: boolean }[];
}

/**
 * Vérification live (lecture seule) : quelles capacités le compte connecté
 * expose-t-il vraiment. Aucun envoi, aucune publication — le « juste
 * vérifier » de l'opérateur.
 */
export async function testerConnexionCanal(canal: Canal): Promise<Result<BilanConnexionTest>> {
  if (canal !== "whatsapp" && canal !== "facebook" && canal !== "instagram") {
    return err({ code: "regle-metier", message: "Canal inconnu." });
  }
  const result = await lireTestConnexion(canal);
  if (!result.ok) {
    log.error("communication.test", logFieldsFor(result.error));
    return err(result.error);
  }
  return ok(result.data);
}
