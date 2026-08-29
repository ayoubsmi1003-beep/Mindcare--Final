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
import { fr } from "@/i18n/fr";

import type { AppError, AppErrorCode } from "../errors";
import { classerCodeEdge, toAppError } from "../errors";
import { err, ok, type Result } from "../result";
import type { DbPort, RpcArgs, SelectSpec, SessionInfo, SignInCredentials } from "./port";

/**
 * V1.2 — plafond CLIENT sur l'appel d'une Edge Function.
 *
 * 15 s, délibérément AU-DESSUS des 10 s de `_shared/external-call.ts` : ce
 * plafond est un filet contre une fonction qui ne répond pas du tout, pas un
 * concurrent de la passerelle. Si les deux étaient au même chiffre, le client
 * abandonnerait parfois avant la passerelle et remplacerait un message qui
 * explique la panne par un message qui dit seulement « délai ».
 *
 * ⚠️ Les 10 s de la passerelle viennent de `03-JARVIS-TOOLS.md` §10 (rang 4).
 * `SPRINT-V1.md` §V1.2 écrit 30 s (rang 5) : par `DOC-AUTHORITY.md` §1 le rang
 * 4 gagne, et l'arbitrage utilisateur du 2026-08-11 l'a confirmé. Aucun
 * document d'autorité n'a été modifié, aucune valeur de passerelle non plus.
 */
const PLAFOND_INVOKE_MS = 15_000;

/**
 * V-JARVIS-CORE — course au PREMIER octet d'un flux, pas à sa fin.
 *
 * Un flux Jarvis vit aussi longtemps que le modèle réfléchit (mesuré : plus de
 * 40 s sur les variantes à raisonnement). Un plafond global tuerait des
 * réponses parfaitement vivantes. Ce qui doit rester borné, c'est le silence
 * INITIAL : passerelle injoignable, fonction morte avant ses en-têtes. Une fois
 * le corps ouvert, la vivacité du flux est surveillée PAR LE SERVICE (watchdog
 * inter-frames), qui seul connaît son protocole et ses battements.
 */
const PLAFOND_PREMIERE_REPONSE_MS = 15_000;

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
      if (error !== null) return err(toAppError(error, `select:${spec.relation}`));
      return ok(asRows<T>(data));
    } catch (cause) {
      // Une panne réseau lève au lieu de rendre `error`. Sans ce filet, elle
      // remonterait jusqu'à un composant — donc jusqu'à l'écran (I20).
      return err(toAppError(new Error("échec select", { cause }), `select:${spec.relation}`));
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
        return err(toAppError(new Error("réponse rpc absente"), `rpc:${name}`));
      }
      const error = "error" in response ? response.error : null;
      if (error !== null && error !== undefined) return err(toAppError(error, `rpc:${name}`));
      return ok(asRows<T>("data" in response ? response.data : null));
    } catch (cause) {
      return err(toAppError(new Error("échec rpc", { cause }), `rpc:${name}`));
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
      if (error !== null) return err(toAppError(error, "signIn"));
      // Cas sans erreur ET sans utilisateur : le SDK ne le documente pas, mais
      // rendre une session vide comme un succès ferait croire à l'écran qu'il
      // est connecté. On le traite en échec explicite plutôt que de repasser
      // `error` — qui vaut `null` ici, et donnerait un diagnostic trompeur.
      if (data.user === null) {
        return err(toAppError(new Error("auth:session-vide"), "signIn"));
      }
      return ok({ userId: data.user.id });
    } catch (cause) {
      return err(toAppError(new Error("échec signIn", { cause }), "signIn"));
    }
  },

  async signOut(): Promise<Result<void>> {
    try {
      const { error } = await getClient().auth.signOut();
      if (error !== null) return err(toAppError(error, "signOut"));
      return ok(undefined);
    } catch (cause) {
      return err(toAppError(new Error("échec signOut", { cause }), "signOut"));
    }
  },

  async getSession(): Promise<Result<SessionInfo | null>> {
    try {
      const { data, error } = await getClient().auth.getSession();
      if (error !== null) return err(toAppError(error, "getSession"));
      if (data.session === null) return ok(null);
      return ok({ userId: data.session.user.id });
    } catch (cause) {
      return err(toAppError(new Error("échec getSession", { cause }), "getSession"));
    }
  },

  async invokeFunction<T>(name: string, body: unknown): Promise<Result<T>> {
    // V1.2 — PLAFOND CLIENT. Une Edge Function muette (processus tué, relais
    // Supabase qui ne répond jamais) laissait « Analyse en cours… » tourner
    // indéfiniment : le défaut nommément interdit par 05-UX-CONTRACT.md §2.
    //
    // Le plafond est ici, PAS dans la passerelle : `_shared/external-call.ts`
    // garde ses 10 s (03-JARVIS-TOOLS.md §10, rang 4 de DOC-AUTHORITY §1 —
    // arbitrage utilisateur du 2026-08-11, `SPRINT-V1.md` §V1.2 qui écrit 30 s
    // n'a pas été appliqué et le document d'autorité n'a pas été modifié).
    // Ce plafond-ci lui est DÉLIBÉRÉMENT SUPÉRIEUR : il ne doit se déclencher
    // que si la fonction ne répond pas du tout, jamais à la place de la
    // passerelle, qui elle sait dire pourquoi elle a renoncé.
    const controleur = new AbortController();
    let expire = false;
    const minuteur = setTimeout(() => {
      expire = true;
      controleur.abort();
    }, PLAFOND_INVOKE_MS);

    try {
      // `functions.invoke` rend `any` — même traitement qu'en `rpc()` : capturé
      // en `unknown`, décomposé par vérification, sans assertion (I9).
      // `body` traverse tel quel : c'est un objet JSON-sérialisable construit
      // par l'appelant (voir `src/services/jarvis.ts`), jamais un flux binaire.
      //
      // `signal` est passé, pas `timeout` : les deux existent dans la version
      // installée (`@supabase/functions-js@2.110.9`, `types.d.ts:115-120`,
      // lu dans `node_modules` et non dans la documentation), mais avec
      // `timeout` l'abandon revient sous la forme d'un `FunctionsFetchError`
      // que `isNetworkFailure` ne reconnaît pas — il retomberait donc sur le
      // code d'aveu que V1.1 vient précisément de fermer. Avec notre
      // propre signal, c'est NOUS qui nommons l'expiration, ci-dessous.
      const response: unknown = await getClient().functions.invoke(name, {
        body: body as Record<string, unknown>,
        signal: controleur.signal,
      });
      if (typeof response !== "object" || response === null) {
        return err(toAppError(new Error("réponse edge absente"), `invokeFunction:${name}`));
      }

      const transportError = "error" in response ? response.error : null;
      if (transportError !== null && transportError !== undefined) {
        // L'abandon revient par ce chemin (la bibliothèque enveloppe l'échec
        // de `fetch` en `FunctionsFetchError`). C'est nous qui savons POURQUOI
        // il a été abandonné : on le dit, au lieu de laisser classer un
        // dépassement de délai comme une panne réseau — l'écran afficherait un
        // bandeau « hors ligne » sur une connexion parfaitement valide.
        if (expire) return err(erreurDelaiInvoke(name, transportError));
        // Panne de transport (réseau, fonction introuvable) — jamais le
        // contrat applicatif `{ ok, data | error }` de la fonction elle-même,
        // qui répond toujours en HTTP 200 (voir jarvis-analyze-session/index.ts).
        return err(toAppError(transportError, `invokeFunction:${name}`));
      }

      const envelope = ("data" in response ? response.data : null) as
        | { readonly ok: unknown; readonly data?: unknown; readonly error?: { readonly code?: unknown } }
        | null;
      if (envelope === null || typeof envelope !== "object") {
        return err(
          toAppError(new Error("edge:enveloppe-absente"), `invokeFunction:${name}`),
        );
      }

      if (envelope.ok === true) {
        return ok(envelope.data as T);
      }

      const edgeCode = typeof envelope.error?.code === "string" ? envelope.error.code : undefined;
      const code = classifyEdgeErrorCode(edgeCode);
      const message = fr.erreurs[code];
      return err(
        edgeCode === undefined
          ? { code, message, context: `invokeFunction:${name}` }
          : { code, message, technical: edgeCode, context: `invokeFunction:${name}` },
      );
    } catch (cause) {
      if (expire) return err(erreurDelaiInvoke(name, cause));
      return err(toAppError(new Error("échec invokeFunction", { cause }), `invokeFunction:${name}`));
    } finally {
      clearTimeout(minuteur);
    }
  },

  async invokeFunctionStream(
    name: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Result<ReadableStream<Uint8Array>>> {
    // ── Le jeton ne sort jamais d'ici (voir port.ts) ──
    let jeton: string | undefined;
    try {
      const { data, error } = await getClient().auth.getSession();
      if (error !== null) return err(toAppError(error, `invokeFunctionStream:${name}`));
      jeton = data.session?.access_token;
    } catch (cause) {
      return err(toAppError(new Error("échec session flux", { cause }), `invokeFunctionStream:${name}`));
    }
    if (jeton === undefined || jeton === "") {
      return err({
        code: "non-authentifie",
        message: fr.erreurs["non-authentifie"],
        context: `invokeFunctionStream:${name}`,
      });
    }

    const env = getClientEnv();

    // Course au premier octet : plafond interne + abandon externe, fusionnés
    // dans un seul contrôleur. AbortSignal.any exigerait un lib cible plus
    // récent ; deux écouteurs coûtent quatre lignes et restent explicites.
    const controleur = new AbortController();
    const abandonnerExterne = () => {
      console.info("[TRACE-adapter] externe recu");
      controleur.abort();
    };
    signal?.addEventListener("abort", abandonnerExterne, { once: true });
    const minuteur = setTimeout(() => controleur.abort(), PLAFOND_PREMIERE_REPONSE_MS);

    try {
      // fetch DIRECT — et non `functions.invoke`, qui consomme le corps pour
      // décoder le JSON et n'expose jamais le ReadableStream. C'est la seule
      // raison de ce bloc : l'URL est celle du projet, le jeton vient de la
      // session déjà gérée par le SDK, aucune clé nouvelle n'apparaît ici
      // (contrôle 1 du préflight porte l'exemption nommée de ce fichier).
      const reponse = await fetch(`${env.supabaseUrl}/functions/v1/${name}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.supabaseAnonKey,
          Authorization: `Bearer ${jeton}`,
        },
        body: JSON.stringify(body),
        signal: controleur.signal,
      });

      if (!reponse.ok) {
        // La passerelle répond toujours 200 avec `{ ok:false, error }` — mais
        // la plateforme devant elle (404 fonction absente, 502 relais) non.
        // On décode ce qu'on peut SANS jamais deviner : enveloppe lisible →
        // codes Edge ; sinon → indisponible technique.
        let edgeCode: string | undefined;
        try {
          const brut = (await reponse.text()).slice(0, 2000);
          const parse: unknown = JSON.parse(brut);
          if (
            typeof parse === "object" && parse !== null && "error" in parse &&
            typeof (parse as { error?: unknown }).error === "object" &&
            (parse as { error?: { code?: unknown } }).error !== null &&
            typeof ((parse as { error: { code?: unknown } }).error).code === "string"
          ) {
            edgeCode = ((parse as { error: { code: string } }).error).code;
          }
        } catch {
          // Corps non JSON : on reste sur le statut HTTP comme seule preuve.
        }
        const code = classifyEdgeErrorCode(edgeCode ?? (reponse.status >= 500 ? undefined : "non-authentifie"));
        return err({
          code,
          message: fr.erreurs[code],
          technical: edgeCode ?? `http:${reponse.status}`,
          context: `invokeFunctionStream:${name}`,
        });
      }

      if (reponse.body === null) {
        return err({
          code: "indisponible",
          message: fr.erreurs["indisponible"],
          technical: "client:flux-corps-vide",
          context: `invokeFunctionStream:${name}`,
        });
      }

      // Premier octet en route : le PLAFOND initial est levé — mais l'écouteur
      // d'abandon externe RESTE EN PLACE jusqu'au `finally`. L'avoir retiré ici
      // (défaut trouvé par l'instrument navigateur N4) coupait le bouton Stop
      // pour toute la durée du flux : l'utilisateur interrompait un contrôleur
      // qui n'écoutait plus rien.
      clearTimeout(minuteur);
      return ok(reponse.body);
    } catch (cause) {
      // Abandon EXTERNE (bouton Stop, navigation) : ce n'est ni une panne ni
      // un délai — l'écran doit rester sur ce qui a déjà été reçu. Code
      // `interrompu` technique via indisponible + marqueur dédié ; le service
      // reconnaît son propre signal AVANT de lire cette erreur et ne
      // consulte le message que pour les abandons qu'il n'a pas provoqués.
      if (signal?.aborted) {
        return err({
          code: "indisponible",
          message: fr.delaiDepasse,
          technical: "client:flux-abandonne",
          context: `invokeFunctionStream:${name}`,
          cause,
        });
      }
      // Abandon INTERNE = premier octet jamais arrivé : c'est notre plafond,
      // nommé ici plutôt que classé panne réseau par toAppError.
      if (controleur.signal.aborted) return err(erreurDelaiInvoke(name, cause));
      return err(toAppError(new Error("échec flux", { cause }), `invokeFunctionStream:${name}`));
    } finally {
      clearTimeout(minuteur);
      signal?.removeEventListener("abort", abandonnerExterne);
    }
  },
};

/**
 * L'erreur d'expiration du plafond client (V1.2).
 *
 * `indisponible` et non `hors-ligne` : la connexion fonctionne, c'est la
 * fonction qui n'a pas répondu. Les confondre ferait afficher le bandeau
 * « Connexion perdue » à quelqu'un dont le réseau va très bien, et l'enverrait
 * chercher la panne du mauvais côté.
 *
 * Le message porte le mot « délai » (05-UX-CONTRACT.md §2). `technical` reste
 * un repère de code : il n'identifie personne (règle 1, I5).
 */
function erreurDelaiInvoke(name: string, cause: unknown): AppError {
  return {
    code: "indisponible",
    message: fr.delaiDepasse,
    technical: "client:delai-depasse",
    context: `invokeFunction:${name}`,
    cause,
  };
}

/**
 * Traduit le `code` métier renvoyé par une Edge Function (voir
 * `jarvis-analyze-session/index.ts`) vers `AppErrorCode`. DÉLÉGUÉ à
 * `errors.classerCodeEdge` depuis V-JARVIS-CORE : le client flux classe les
 * mêmes codes — une seule table, jamais deux vérités.
 */
function classifyEdgeErrorCode(code: string | undefined): AppErrorCode {
  return classerCodeEdge(code);
}
