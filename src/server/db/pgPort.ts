/**
 * L'adaptateur PostgreSQL de `DbPort` — le second adaptateur promis par ADR-020.
 *
 * Il traduit `SelectSpec` et `rpc()` en SQL, contre un `Querier` déjà placé sous
 * l'identité de l'appelant par `withCaller`. Il ne connaît ni pool, ni
 * connexion, ni transaction : on ne peut donc pas s'en servir pour lire hors
 * d'une enveloppe, ce qui est la propriété qui compte.
 *
 * ⚠️ IL N'EST PAS BRANCHÉ SUR `db()`. `src/services/db/index.ts` continue de
 * résoudre vers un port navigateur, et c'est délibéré : un service importé par
 * mégarde dans un gestionnaire de route court-circuiterait la frontière HTTP et
 * s'exécuterait avec le rôle que le pool porte à cet instant. Ici, l'adaptateur
 * se construit EXPLICITEMENT, avec un `Querier` qu'on a dû obtenir de
 * `withCaller` — il n'existe aucun chemin ambiant vers la base.
 *
 * CE QU'IL N'IMPLÉMENTE PAS, ET POURQUOI CE N'EST PAS UN OUBLI.
 * `signIn`/`signOut`/`getSession` et `invokeFunction*` appartiennent à `DbPort`
 * mais n'ont aucun sens ici : une session est un cookie HTTP, pas un état de
 * connexion PostgreSQL, et une fonction distante est une route. Ils sont
 * implémentés par le port HTTP (phase 4) et par les routes d'authentification
 * (phase 3). Ce fichier expose donc `PgDataPort` — la PARTIE données du
 * contrat — plutôt que de mentir sur l'interface complète avec des méthodes qui
 * lèveraient. Un adaptateur qui prétend implémenter ce qu'il ne sait pas faire
 * est exactement ce qu'ADR-020 cherchait à éviter.
 */

import type { QueryResultRow } from "pg";

import type { RpcArgs, ScalarValue, SelectSpec } from "@/services/db/port";
import type { Result } from "@/services/result";
import { err, ok } from "@/services/result";
import { toAppError } from "@/services/errors";

import type { Querier } from "./withCaller";

export interface PgDataPort {
  readonly select: <T>(spec: SelectSpec) => Promise<Result<readonly T[]>>;
  readonly rpc: <T>(name: string, args: RpcArgs) => Promise<Result<readonly T[]>>;
}

/**
 * Échappement d'identifiant, à la manière de `pg`.
 *
 * ⚠️ CE N'EST PAS LA PROTECTION PRINCIPALE, et le croire serait dangereux. Les
 * noms de relations, de colonnes et de fonctions viendront de l'allowlist
 * générée (phase 4), jamais de la requête HTTP. Cette fonction est le second
 * filet : elle garantit qu'un identifiant contenant un guillemet ne peut pas
 * refermer la chaîne, même si un jour un nom arrivait d'ailleurs.
 *
 * Le doublement du guillemet est la règle SQL standard. Le rejet du NUL est
 * nécessaire parce qu'un octet nul tronque la chaîne côté C, donc échapperait à
 * tout ce qui suit dans l'instruction.
 */
function ident(nom: string): string {
  if (nom.includes("\0")) {
    throw new Error("Identifiant SQL contenant un octet nul.");
  }
  return `"${nom.replace(/"/g, '""')}"`;
}

/**
 * Les six opérateurs de `FilterOperator`, traduits par une TABLE FERMÉE.
 *
 * L'union TypeScript ne survit pas à l'exécution : une valeur venue du réseau
 * peut porter n'importe quelle chaîne. Un `op` inconnu doit donc lever, jamais
 * se retrouver concaténé dans l'instruction — c'est le seul endroit où un
 * opérateur SQL est décidé.
 */
const OPERATEURS: Readonly<Record<string, string>> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
};

function operateur(op: string): string {
  const sql = OPERATEURS[op];
  if (sql === undefined) {
    throw new Error(`Opérateur de filtre inconnu : ${op}.`);
  }
  return sql;
}

/**
 * `SelectSpec` → SQL. Toutes les VALEURS sont liées ; seuls les IDENTIFIANTS
 * sont interpolés, après échappement.
 *
 * `eq` avec `null` devient `IS NULL` : en SQL, `colonne = NULL` ne rend jamais
 * vrai, et une lecture qui rend silencieusement zéro ligne au lieu des lignes
 * attendues est un défaut qu'on met longtemps à voir. `neq` avec `null` suit la
 * même logique.
 */
export function construireSelect(spec: SelectSpec): { texte: string; valeurs: ScalarValue[] } {
  const colonnes = spec.columns.map(ident).join(", ");
  const valeurs: ScalarValue[] = [];
  const morceaux: string[] = [`SELECT ${colonnes} FROM app.${ident(spec.relation)}`];

  const filtres = spec.filters ?? [];
  if (filtres.length > 0) {
    const conditions = filtres.map((f) => {
      const colonne = ident(f.column);
      if (f.value === null && (f.op === "eq" || f.op === "neq")) {
        return `${colonne} IS ${f.op === "eq" ? "" : "NOT "}NULL`;
      }
      valeurs.push(f.value);
      return `${colonne} ${operateur(f.op)} $${valeurs.length}`;
    });
    morceaux.push(`WHERE ${conditions.join(" AND ")}`);
  }

  const tris = spec.order ?? [];
  if (tris.length > 0) {
    const parts = tris.map((o) => `${ident(o.column)} ${o.ascending ? "ASC" : "DESC"}`);
    morceaux.push(`ORDER BY ${parts.join(", ")}`);
  }

  // `limit`/`offset` sont des valeurs liées : ce sont des nombres venus de
  // l'appelant, et rien n'oblige à les traiter autrement que les autres.
  if (spec.limit !== undefined) {
    valeurs.push(spec.limit);
    morceaux.push(`LIMIT $${valeurs.length}`);
  }
  if (spec.offset !== undefined) {
    valeurs.push(spec.offset);
    morceaux.push(`OFFSET $${valeurs.length}`);
  }

  return { texte: morceaux.join(" "), valeurs };
}

/**
 * `rpc(nom, args)` → `SELECT * FROM app.nom(cle := $n, …)`.
 *
 * APPEL PAR PARAMÈTRES NOMMÉS, jamais positionnels. Les portes ont des
 * arguments à valeur par défaut (`app.search_patients(p_query, p_limit,
 * p_offset)`), et l'ordre des clés d'un objet JSON n'est pas un contrat. Un
 * appel positionnel intervertirait `p_limit` et `p_offset` le jour où un
 * appelant sérialise ses clés autrement — silencieusement.
 *
 * `SELECT * FROM` et non `SELECT nom(...)` : les portes rendent `SETOF` ou
 * `TABLE`, et seule la forme `FROM` développe les colonnes en lignes. La forme
 * scalaire rendrait une unique colonne composite, que l'appelant ne saurait pas
 * lire.
 */
export function construireRpc(
  nom: string,
  args: RpcArgs,
): { texte: string; valeurs: ScalarValue[] } {
  const valeurs: ScalarValue[] = [];
  const parametres = Object.entries(args).map(([cle, valeur]) => {
    valeurs.push(valeur);
    return `${ident(cle)} := $${valeurs.length}`;
  });
  return {
    texte: `SELECT * FROM app.${ident(nom)}(${parametres.join(", ")})`,
    valeurs,
  };
}

/**
 * Construit l'adaptateur sur un `Querier` déjà sous identité.
 *
 * Les erreurs passent par `toAppError`, le même classificateur que l'adaptateur
 * Supabase : `42501` reste `interdit`, `23505` reste `conflit`, `P0001` reste
 * `regle-metier`. Les codes SQLSTATE sont ceux de PostgreSQL, pas ceux de
 * PostgREST — c'est justement pourquoi ils survivent au changement d'adaptateur
 * sans qu'une seule correspondance soit réécrite. Le message brut de PostgreSQL
 * ne remonte jamais : il peut citer une ligne, donc une donnée patient.
 */
export function faireePgPort(q: Querier, contexte = "pg"): PgDataPort {
  return {
    select: async <T>(spec: SelectSpec): Promise<Result<readonly T[]>> => {
      try {
        const { texte, valeurs } = construireSelect(spec);
        const lignes = await q.query<QueryResultRow>(texte, valeurs);
        return ok(lignes as readonly T[]);
      } catch (brut) {
        return err(toAppError(brut, `${contexte}.select:${spec.relation}`));
      }
    },

    rpc: async <T>(nom: string, args: RpcArgs): Promise<Result<readonly T[]>> => {
      try {
        const { texte, valeurs } = construireRpc(nom, args);
        const lignes = await q.query<QueryResultRow>(texte, valeurs);
        return ok(lignes as readonly T[]);
      } catch (brut) {
        return err(toAppError(brut, `${contexte}.rpc:${nom}`));
      }
    },
  };
}
