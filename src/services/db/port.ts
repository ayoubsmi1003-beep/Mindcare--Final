/**
 * `DbPort` — ADR-020. La seule chose que `src/services/*` connaît de la base.
 *
 * POURQUOI UNE INTERFACE ET PAS UN CLIENT PARTAGÉ. ADR-016 promet que le retour
 * à l'auto-hébergé sera « un changement de configuration, pas une
 * reconstruction ». Cette promesse est vide si chaque service importe
 * `supabase-js` et parle PostgREST : le jour du basculement, il faudrait
 * réécrire toute la couche. Ici, on écrit un second adaptateur et on le branche.
 *
 * POURQUOI UNE REQUÊTE DÉCLARATIVE ET PAS UNE API FLUIDE. Un `.from().select().
 * eq()` chaîné serait PostgREST déguisé : on aurait changé le nom de la
 * dépendance sans changer la dépendance. `SelectSpec` est une structure de
 * données inerte, qu'un adaptateur `pg` traduit en SQL sans deviner
 * l'intention.
 *
 * CE QUI N'EST PAS ICI, ET POURQUOI :
 *   - Pas d'assistant de transaction. PostgREST n'expose pas de transaction
 *     multi-requêtes ; un tel assistant donnerait une garantie d'atomicité
 *     FAUSSE, ce qui est pire que son absence. Quand l'atomicité est requise,
 *     elle s'écrit en fonction Postgres — la bascule d'environnement de 016 et
 *     `app.get_patient()` le font déjà.
 *   - Pas de cache, pas d'abonnement temps réel. Mais rien ne les interdit :
 *     une implémentation peut mémoïser `select`, une autre exposer un flux.
 *     Le contrat ne leur ferme pas la porte, il ne les invente pas d'avance.
 */

import type { Result } from "../result";

export type ScalarValue = string | number | boolean | null;

export type FilterOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";

export interface Filter {
  readonly column: string;
  readonly op: FilterOperator;
  readonly value: ScalarValue;
}

export interface Order {
  readonly column: string;
  readonly ascending: boolean;
}

/**
 * Description d'une lecture. `columns` est OBLIGATOIRE et n'accepte pas `"*"` :
 * une relation lue en entier ramène les colonnes ajoutées demain sans que
 * personne l'ait décidé — c'est ainsi qu'une donnée clinique arrive un jour
 * dans un écran administratif (I12).
 */
export interface SelectSpec {
  readonly relation: string;
  readonly columns: readonly [string, ...string[]];
  readonly filters?: readonly Filter[];
  readonly order?: readonly Order[];
  readonly limit?: number;
  readonly offset?: number;
}

export type RpcArgs = Readonly<Record<string, ScalarValue>>;

export interface DbPort {
  /** Lecture d'une relation exposée (table ou vue). */
  readonly select: <T>(spec: SelectSpec) => Promise<Result<readonly T[]>>;
  /** Appel d'une fonction Postgres. Seule voie vers l'identité patient (ADR-019). */
  readonly rpc: <T>(name: string, args: RpcArgs) => Promise<Result<readonly T[]>>;
}
