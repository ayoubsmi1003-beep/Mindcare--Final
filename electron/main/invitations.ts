/**
 * L'invitation d'appairage — côté HÔTE (processus principal).
 *
 * ═══ CE QUE CE FICHIER GARANTIT ═════════════════════════════════════════════
 *
 *   1. USAGE UNIQUE STRICT — dès qu'une demande a été déchiffrée et validée,
 *      le fichier est supprimé. Un code rejoué dans les cinq minutes ne trouve
 *      plus rien. (L'ancienne version le laissait en place : la fenêtre de
 *      rejeu était réelle.)
 *   2. VERROU APRÈS CINQ ÉCHECS — un paquet qui ressemble à une invitation mais
 *      ne se déchiffre pas incrémente un compteur ; au cinquième, le code est
 *      détruit. Un attaquant qui martèle le port détruit l'invitation, ce qui
 *      est un déni de service assumé — pas une compromission.
 *   3. ATOMICITÉ — `.tmp` puis `rename` : le proxy ne lit jamais un JSON
 *      tronqué, et deux écrivains ne se marchent pas dessus.
 *
 * Le format est partagé avec `src/server/cabinet/invitation.ts` (création) et
 * lu aussi par `scripts/configurer-cabinet.ps1` (qui accepte un fichier
 * `{secret, expiresAt}`). Les champs ajoutés sont facultatifs à la lecture :
 * une invitation écrite par le script d'administration reste valable.
 */

import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

export interface InvitationLue {
  readonly secret: string;
  readonly expiresAt: number;
  readonly attempts: number;
}

const SECRET = /^[A-Za-z0-9_-]{24}$/;
const TAILLE_MAX = 2 * 1024;
const DUREE_MS = 5 * 60_000;
const ECHECS_MAX = 5;

function lireBrut(fichier: string): Record<string, unknown> | undefined {
  try {
    if (!existsSync(fichier)) return undefined;
    if (statSync(fichier).size > TAILLE_MAX) return undefined;
    const brut: unknown = JSON.parse(readFileSync(fichier, "utf8"));
    if (typeof brut !== "object" || brut === null) return undefined;
    return brut as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function ecrire(fichier: string, valeur: Record<string, unknown>): void {
  const temporaire = `${fichier}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporaire, JSON.stringify(valeur), { encoding: "utf8", mode: 0o600 });
  renameSync(temporaire, fichier);
}

/**
 * Rend l'invitation utilisable, ou `undefined`. Une invitation consommée,
 * expirée, mal formée ou dépassant sa fenêtre est refusée SANS erreur : le
 * responder de découverte ne doit rien révéler de son état interne.
 */
export function lireInvitation(fichier: string, maintenant = Date.now()): InvitationLue | undefined {
  const brut = lireBrut(fichier);
  if (brut === undefined) return undefined;

  const secret = brut["secret"];
  const expiresAt = brut["expiresAt"];
  const consumedAt = brut["consumedAt"];
  const attempts = typeof brut["attempts"] === "number" ? brut["attempts"] : 0;

  if (typeof secret !== "string" || !SECRET.test(secret)) return undefined;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return undefined;
  if (consumedAt !== undefined && consumedAt !== null) return undefined;
  if (attempts >= ECHECS_MAX) return undefined;
  // La borne haute (5 min + 10 s) est celle du script d'administration : une
  // invitation qui prétendrait durer une heure serait refusée.
  if (expiresAt <= maintenant || expiresAt > maintenant + DUREE_MS + 10_000) return undefined;

  return { secret, expiresAt, attempts };
}

/**
 * Consomme l'invitation — appelée AVANT l'envoi de la réponse scellée.
 *
 * L'ordre est délibéré : si le paquet de réponse se perd, le code est brûlé et
 * le médecin en génère un autre. L'inverse — répondre puis consommer — laissait
 * une fenêtre où deux postes pouvaient utiliser le même code.
 */
export function consommerInvitation(fichier: string): void {
  try {
    rmSync(fichier, { force: true });
  } catch {
    /* un fichier déjà absent est le résultat voulu */
  }
}

/** Un paquet d'appairage invalide. Au cinquième, le code est détruit. */
export function enregistrerEchec(fichier: string): void {
  const brut = lireBrut(fichier);
  if (brut === undefined) return;
  const attempts = (typeof brut["attempts"] === "number" ? brut["attempts"] : 0) + 1;
  if (attempts >= ECHECS_MAX) {
    consommerInvitation(fichier);
    return;
  }
  try {
    ecrire(fichier, { ...brut, attempts });
  } catch {
    // Un compteur qui ne s'écrit pas ne doit pas ouvrir l'accès : l'invitation
    // reste utilisable pour le bon poste, et le prochain échec retentera.
  }
}

/** Nom de fichier canonique dans le dossier privé. */
export function cheminInvitation(dossierPrive: string): string {
  return path.join(dossierPrive, "clinic-invitation.json");
}
