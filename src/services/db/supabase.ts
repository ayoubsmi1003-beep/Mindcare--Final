/**
 * Adaptateur Supabase — LE SEUL FICHIER DU DÉPÔT qui importe
 * `@supabase/supabase-js` (I3, ADR-020).
 *
 * Ce n'est pas une convention : `eslint.config.js` nomme ce fichier, et lui
 * seul, dans l'exception à `local/no-supabase-resolution`. Un import ailleurs
 * est une erreur de compilation, pas une remarque en revue.
 *
 * Un second adaptateur (Postgres local pour ADR-001, hors-ligne, Electron)
 * s'écrira À CÔTÉ, implémentera le même `DbPort`, et devra être ajouté
 * nommément à cette exception — donc relu.
 *
 * ⚠️ CLÉ PUBLIQUE (`anon`) UNIQUEMENT (I1). La clé de service contourne la RLS par
 * conception : dans un fichier atteignable par le navigateur, ce serait la
 * totalité des dossiers en une variable. Elle n'a rien à faire ici, et le
 * contrôle 2 du préflight le vérifie.
 *
 * `db: { schema: "app" }` — toutes les tables vivent dans `app`, jamais dans
 * `public`. Le schéma doit être exposé côté projet (Dashboard → Data API →
 * Exposed schemas), sans quoi PostgREST rend `PGRST106`. `audit` n'est
 * délibérément PAS exposé : c'est ce qui rend le journal d'audit illisible par
 * l'API, et toute la conception de la migration 017 repose là-dessus.
 */

import { createClient } from "@supabase/supabase-js";

import { getClientEnv } from "@/lib/env";

import { toAppError } from "../errors";
import { err, ok, type Result } from "../result";
import type { DbPort, RpcArgs, SelectSpec, SessionInfo, SignInCredentials } from "./port";

function createAppClient() {
  const env = getClientEnv();
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    db: { schema: "app" },
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

// Le type du client dépend du schéma passé à `createClient` : l'annoter
// `SupabaseClient` tout court le ramènerait à `public` et ne compilerait pas.
// On le déduit de la fabrique — le compilateur suit, et le jour où le schéma
// change, il n'y a rien à corriger ici.
type AppClient = ReturnType<typeof createAppClient>;

let client: AppClient | undefined;

function getClient(): AppClient {
  client ??= createAppClient();
  return client;
}

/**
 * Point d'assertion UNIQUE de tout le dépôt.
 *
 * PostgREST rend des lignes dont la forme n'est connue qu'à l'exécution : le
 * compilateur ne peut pas relier une chaîne de colonnes à `T`. Plutôt que de
 * disperser des assertions dans chaque méthode, on en garde une, ici, prise à
 * travers `unknown` — donc sans double assertion, qu'ESLint interdit (I9).
 *
 * C'est la contrepartie honnête du port : le typage des services est une
 * PROMESSE vérifiée par les types générés depuis le schéma, pas une garantie
 * arrachée au client.
 */
function asRows<T>(data: unknown): readonly T[] {
  if (data === null || data === undefined) return [];
  return (Array.isArray(data) ? data : [data]) as readonly T[];
}

export const supabaseDbPort: DbPort = {
  async select<T>(spec: SelectSpec): Promise<Result<readonly T[]>> {
    try {
      let query = getClient().from(spec.relation).select(spec.columns.join(", "));

      // `switch` et non `query[filter.op]` : l'indexation dynamique rend une
      // UNION de signatures que TypeScript refuse d'appeler, et la contourner
      // demanderait l'assertion qu'on s'interdit. Six branches explicites
      // coûtent six lignes et gardent la vérification de types intacte.
      for (const filter of spec.filters ?? []) {
        switch (filter.op) {
          case "eq":  query = query.eq(filter.column, filter.value); break;
          case "neq": query = query.neq(filter.column, filter.value); break;
          case "gt":  query = query.gt(filter.column, filter.value); break;
          case "gte": query = query.gte(filter.column, filter.value); break;
          case "lt":  query = query.lt(filter.column, filter.value); break;
          case "lte": query = query.lte(filter.column, filter.value); break;
        }
      }
      for (const order of spec.order ?? []) {
        query = query.order(order.column, { ascending: order.ascending });
      }
      if (spec.limit !== undefined) {
        const offset = spec.offset ?? 0;
        query = query.range(offset, offset + spec.limit - 1);
      }

      const { data, error } = await query;
      if (error !== null) return err(toAppError(error));
      return ok(asRows<T>(data));
    } catch (cause) {
      // Une panne réseau lève au lieu de rendre `error`. Sans ce filet, elle
      // remonterait jusqu'à un composant — donc jusqu'à l'écran (I20).
      return err(toAppError(cause));
    }
  },

  async rpc<T>(name: string, args: RpcArgs): Promise<Result<readonly T[]>> {
    try {
      // `rpc()` rend `any` faute de types générés. On le CAPTURE en `unknown`
      // et on le décompose par vérification, sans assertion : laisser un `any`
      // se propager viderait I9 de son sens précisément là où les données
      // patient transitent. Annoter la déstructuration ne suffit pas — la
      // source reste `any` et la règle mord quand même ; il faut passer par une
      // variable typée et interroger ses membres.
      const response: unknown = await getClient().rpc(name, args);
      if (typeof response !== "object" || response === null) {
        return err(toAppError(response));
      }
      const error = "error" in response ? response.error : null;
      if (error !== null && error !== undefined) return err(toAppError(error));
      return ok(asRows<T>("data" in response ? response.data : null));
    } catch (cause) {
      return err(toAppError(cause));
    }
  },

  // `signInWithPassword` / `getSession` sont typés par le SDK — contrairement à
  // `rpc()`, qui n'a pas de types générés. Pas besoin ici du détour par
  // `unknown` : le compilateur connaît déjà la forme de `data.user.id`.
  async signIn(credentials: SignInCredentials): Promise<Result<SessionInfo>> {
    try {
      const { data, error } = await getClient().auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password,
      });
      if (error !== null) return err(toAppError(error));
      // Cas sans erreur ET sans utilisateur : le SDK ne le documente pas, mais
      // rendre une session vide comme un succès ferait croire à l'écran qu'il
      // est connecté. On le traite en échec explicite plutôt que de repasser
      // `error` — qui vaut `null` ici, et donnerait un diagnostic trompeur.
      if (data.user === null) return err(toAppError(undefined));
      return ok({ userId: data.user.id });
    } catch (cause) {
      return err(toAppError(cause));
    }
  },

  async signOut(): Promise<Result<void>> {
    try {
      const { error } = await getClient().auth.signOut();
      if (error !== null) return err(toAppError(error));
      return ok(undefined);
    } catch (cause) {
      return err(toAppError(cause));
    }
  },

  async getSession(): Promise<Result<SessionInfo | null>> {
    try {
      const { data, error } = await getClient().auth.getSession();
      if (error !== null) return err(toAppError(error));
      if (data.session === null) return ok(null);
      return ok({ userId: data.session.user.id });
    } catch (cause) {
      return err(toAppError(cause));
    }
  },
};
