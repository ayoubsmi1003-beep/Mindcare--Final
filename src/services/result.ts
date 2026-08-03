/**
 * Le contrat de retour de toute la couche `src/services/*`.
 *
 * AUCUN SERVICE NE LÈVE D'EXCEPTION. Une exception qui traverse la couche
 * d'accès arrive dans un composant React, y déclenche une frontière d'erreur,
 * et le message brut de Postgres — qui peut contenir la valeur d'une ligne —
 * finit affiché à l'écran pendant une consultation. Ce n'est pas théorique :
 * c'est le comportement par défaut du client Supabase si on le laisse faire.
 *
 * On rend donc toujours une valeur, jamais un jet. L'appelant est forcé de
 * regarder `ok` avant d'atteindre `data` — `tsc` s'en assure, ce qu'un
 * `try/catch` oublié ne fait pas.
 */

import type { AppError } from "./errors";

export type Result<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: AppError };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function err<T>(error: AppError): Result<T> {
  return { ok: false, error };
}

/**
 * Une page de résultats. Présente dans la signature DÈS MAINTENANT, alors
 * qu'aucun écran ne pagine encore : l'ajouter plus tard imposerait de reprendre
 * chaque appelant, et c'est exactement le genre de reprise qu'on ne fait jamais.
 *
 * `total` est le nombre de lignes VISIBLES PAR L'APPELANT, pas le nombre de
 * lignes de la table. La distinction n'est pas cosmétique : un total global
 * divulguerait la taille de la file de l'autre praticienne sans en montrer une
 * seule ligne (cloison ADR-003).
 */
export interface Page<T> {
  readonly rows: readonly T[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}
