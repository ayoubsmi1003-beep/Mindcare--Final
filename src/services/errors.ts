/**
 * Normalisation des erreurs de la couche données.
 *
 * RÈGLE CENTRALE, ET C'EST UNE RÈGLE DE SÉCURITÉ, PAS D'ERGONOMIE :
 * **le message brut de Postgres n'atteint jamais l'écran, ni un log, ni une
 * notification.** Il porte régulièrement la valeur qui a déclenché l'erreur —
 * `duplicate key value violates unique constraint … Key (phone)=(0554…)`. C'est
 * une donnée identifiante dans un message d'erreur : I5, et la règle 1 de
 * CLAUDE.md.
 *
 * Ce qui sort d'ici : un `code` stable, non identifiant, que la praticienne
 * peut lire au téléphone au support ; et un message français en trois temps —
 * ce qui s'est passé · ce qui a été préservé · quoi faire (§4.8 du design
 * system). « Une erreur est survenue » ne dit aucun des trois.
 */

import { fr } from "@/i18n/fr";

export type AppErrorCode =
  | "hors-ligne"
  | "non-authentifie"
  | "interdit"
  | "introuvable"
  | "conflit"
  | "regle-metier"
  | "indisponible"
  | "inattendu";

export interface AppError {
  readonly code: AppErrorCode;
  /** Message affichable, en français, en trois temps. Jamais de valeur de ligne. */
  readonly message: string;
  /**
   * Code technique d'origine (SQLSTATE ou code PostgREST), conservé pour le
   * diagnostic. Un code n'identifie personne — un message, si.
   */
  readonly technical?: string;
}

/** Forme minimale d'une erreur PostgREST, sans importer le type de Supabase. */
interface RawDbError {
  readonly code?: string;
  readonly message?: string;
}

function isRawDbError(value: unknown): value is RawDbError {
  return typeof value === "object" && value !== null;
}

/**
 * Table de correspondance SQLSTATE / PostgREST → erreur applicative.
 *
 * `42501` mérite un mot : depuis ADR-019, un refus de permission sur
 * `app.patients` n'est PAS un incident, c'est le garde-fou qui fonctionne — il
 * signifie qu'un appel a tenté le chemin direct au lieu de `app.get_patient`.
 * Le message le dit, pour que le diagnostic prenne dix secondes et pas une
 * demi-heure.
 */
function classify(code: string | undefined): AppErrorCode {
  switch (code) {
    case "PGRST301":
    case "42501":
      return "interdit";
    case "PGRST116":
      return "introuvable";
    case "23505":
    case "23503":
      return "conflit";
    case "23514":
    case "P0001":
      return "regle-metier";
    case "PGRST106":
    case "PGRST002":
    case "57P03":
      return "indisponible";
    default:
      return "inattendu";
  }
}

export function toAppError(raw: unknown): AppError {
  if (!isRawDbError(raw)) {
    return { code: "inattendu", message: fr.erreurs.inattendu };
  }

  const technical = raw.code;
  const code = classify(technical);
  const message = fr.erreurs[code];

  return technical === undefined
    ? { code, message }
    : { code, message, technical };
}

/**
 * Perte de réseau. Distinguée d'une panne serveur parce que la conduite à tenir
 * n'est pas la même : hors ligne, le travail en cours n'est PAS perdu et la
 * consultation continue (I20). Le message doit le dire, sinon la praticienne
 * croit avoir perdu sa note et recommence.
 */
export function offlineError(): AppError {
  return { code: "hors-ligne", message: fr.erreurs["hors-ligne"] };
}
