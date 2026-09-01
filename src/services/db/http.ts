/**
 * `httpDbPort` — l'implémentation NAVIGATEUR de `DbPort` (ADR-020).
 *
 * C'est la moitié visible de la bascule : les 14 fichiers de `src/services/*`
 * n'ont pas changé d'une ligne, mais ce qu'ils appellent parle désormais à
 * `/api/db/*` au lieu de PostgREST.
 *
 * ═══ CE QUI DISPARAÎT DU NAVIGATEUR, ET C'EST TOUT L'OBJET ═════════════════
 *
 * Plus de client Supabase, donc plus de clé `anon` dans le paquet, plus de JWT
 * en `localStorage`, plus d'URL de projet. Le navigateur ne détient plus AUCUN
 * identifiant de base : il détient un cookie `httpOnly` qu'il ne peut même pas
 * lire. Un XSS qui vidait auparavant `localStorage` de son jeton n'a plus rien
 * à voler — il peut faire des requêtes AU NOM de l'utilisatrice, mais il ne peut
 * pas exfiltrer une session pour la rejouer ailleurs.
 *
 * ═══ `credentials: "same-origin"` — ÉCRIT, PAS SUPPOSÉ ═════════════════════
 *
 * C'est le défaut de `fetch` dans les navigateurs modernes, mais l'écrire est
 * ce qui garantit que le cookie part. L'omettre et se tromper produit le
 * symptôme le plus coûteux à diagnostiquer du dispositif : chaque requête rend
 * 401, l'écran renvoie vers la connexion, la connexion réussit, et l'écran
 * suivant renvoie encore vers la connexion. On l'écrit.
 */

import { fr } from "@/i18n/fr";

import type { AppError, AppErrorCode } from "../errors";
import { erreurDepuisEnveloppeEdge, toAppError } from "../errors";
import type { Result } from "../result";
import { err, ok } from "../result";
import type {
  DbPort,
  EtatInstallation,
  ProvisionnementOwner,
  RpcArgs,
  SelectSpec,
  SessionInfo,
  SignInCredentials,
} from "./port";

/**
 * L'enveloppe que rendent toutes les routes : `{ ok, data }` ou `{ ok, code }`.
 * C'est la même convention que `Result<T>`, délibérément — la frontière HTTP ne
 * réinvente pas un protocole d'erreur, elle transporte celui du dépôt.
 */
interface Enveloppe {
  readonly ok?: unknown;
  readonly data?: unknown;
  /** Forme des routes `/api/db/*` : le code est à la racine. */
  readonly code?: unknown;
  /**
   * Forme des routes `/api/jarvis/*` : le code est imbriqué dans `error`.
   *
   * ⚠️ LES DEUX FORMES COEXISTENT, ET CE N'EST PAS UNE NÉGLIGENCE. Les routes
   * Jarvis reprennent mot pour mot l'enveloppe des anciennes Edge Functions,
   * parce que `src/services/jarvis*.ts` la lit — et la phase 5 s'interdit de
   * modifier les services. Uniformiser les deux formes imposerait de toucher
   * `jarvis.ts`, `jarvis-voix.ts` et `resume-cas.ts`, c'est-à-dire d'élargir la
   * phase là où elle doit rester mécanique.
   */
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

/**
 * Les codes que la frontière est autorisée à prononcer.
 *
 * ⚠️ NE PAS PASSER CES CODES À `classify()` DE `errors.ts`. Cette fonction
 * traduit des SQLSTATE (`42501`, `23505`) et des codes d'auth Supabase — pas
 * des `AppErrorCode`. Lui donner « interdit » rendrait « inattendu », et
 * l'écran afficherait « une erreur inattendue » là où l'utilisatrice devrait
 * lire « vous n'avez pas accès ». Mesuré en écrivant ce fichier.
 *
 * On construit donc l'`AppError` directement, avec le message d'`fr.erreurs`
 * — le même que celui qu'aurait produit le chemin PostgREST pour ce code.
 *
 * Cette table vit ICI et non dans `errors.ts` parce que la phase 4 s'interdit
 * de modifier `src/services/**` hors de `db/` : c'est son critère
 * d'acceptation, et le tenir vaut mieux qu'une factorisation.
 */
const CODES_FRONTIERE: ReadonlySet<string> = new Set<AppErrorCode>([
  "hors-ligne",
  "non-authentifie",
  "identifiants-refuses",
  "interdit",
  "introuvable",
  "conflit",
  "regle-metier",
  "indisponible",
  "transcription",
  "synthese",
  "analyse",
  // ⚠️ « inattendu » N'EST PAS DANS CETTE LISTE, et son absence est le point.
  // Le contrôle V1.1 de `preflight.sh` interdit d'écrire ce code hors
  // d'`errors.ts` : « chaque échec porte sa cause réelle, jamais un aveu
  // générique ». L'accepter ici reviendrait à relayer fidèlement l'aveu du
  // serveur au lieu de le qualifier.
  //
  // Un serveur qui répondrait `code: "inattendu"` tombe donc dans le repli
  // ci-dessous, qui appelle `toAppError` AVEC le contexte du transport. Le code
  // final est le même ; ce qui change est qu'il porte alors le `context` et le
  // statut HTTP, c'est-à-dire de quoi diagnostiquer.
]);

function erreurDepuisCodeFrontiere(code: string, contexte: string): AppError {
  const connu = code as AppErrorCode;
  return {
    code: connu,
    message: fr.erreurs[connu],
    technical: code,
    context: contexte,
  };
}

/**
 * Traduit une réponse en `Result`, SANS jamais laisser fuir un détail de
 * transport. Le code applicatif vient du serveur ; s'il est absent ou
 * inconnu, on retombe sur `toAppError`, qui est la référence du dépôt.
 */
async function lireEnveloppe<T>(reponse: Response, contexte: string): Promise<Result<T>> {
  let corps: Enveloppe | undefined;
  try {
    corps = (await reponse.json()) as Enveloppe;
  } catch {
    corps = undefined;
  }

  if (reponse.ok && corps?.ok === true) {
    return ok(corps.data as T);
  }

  // Forme Jarvis : `{ ok:false, error:{ code } }`. Le classement passe par
  // `erreurDepuisEnveloppeEdge`, LA source de vérité du dépôt pour ces codes —
  // c'est elle qui sait que `transcription-indisponible` doit devenir
  // `transcription` et non `indisponible`, distinction pour laquelle
  // `errors.ts` a trois codes séparés.
  const codeEdge = typeof corps?.error?.code === "string" ? corps.error.code : undefined;
  if (codeEdge !== undefined) {
    return err(erreurDepuisEnveloppeEdge(codeEdge, contexte));
  }

  // Forme `/api/db/*` : le code est à la racine.
  const code = typeof corps?.code === "string" ? corps.code : undefined;
  if (code !== undefined && CODES_FRONTIERE.has(code)) {
    return err(erreurDepuisCodeFrontiere(code, contexte));
  }

  // Pas de code exploitable — une 502 d'un mandataire, une page d'erreur HTML,
  // un corps tronqué. On laisse `toAppError` classer, ce qui donnera
  // `inattendu` plutôt qu'une affirmation fausse sur la cause.
  return err(toAppError({ status: reponse.status }, contexte));
}

/**
 * Un `fetch` qui ne lève jamais. Une coupure réseau doit devenir `hors-ligne`,
 * pas une exception qui traverse la couche de services — c'est la promesse de
 * `src/services/result.ts`, et elle vaut ici comme partout.
 */
async function poster<T>(chemin: string, corps: unknown, contexte: string): Promise<Result<T>> {
  let reponse: Response;
  try {
    reponse = await fetch(chemin, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corps),
      credentials: "same-origin",
    });
  } catch (brut) {
    return err(toAppError(brut, contexte));
  }
  return lireEnveloppe<T>(reponse, contexte);
}

export const httpDbPort: DbPort = {
  select: <T>(spec: SelectSpec) =>
    poster<readonly T[]>("/api/db/select", spec, `http.select:${spec.relation}`),

  rpc: <T>(name: string, args: RpcArgs) =>
    poster<readonly T[]>("/api/db/rpc", { name, args }, `http.rpc:${name}`),

  signIn: (credentials: SignInCredentials) =>
    poster<SessionInfo>(
      "/api/auth/sign-in",
      { email: credentials.email, password: credentials.password },
      "http.signIn",
    ),

  signOut: async () => {
    const r = await poster<null>("/api/auth/sign-out", {}, "http.signOut");
    return r.ok ? ok(undefined) : err(r.error);
  },

  getInstallationStatus: async () => {
    // Mêmes raisons que `getSession` : jamais mis en cache, l'état bascule
    // une fois pour toutes.
    let reponse: Response;
    try {
      reponse = await fetch("/api/auth/etat-installation", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch (brut) {
      return err(toAppError(brut, "http.getInstallationStatus"));
    }
    return lireEnveloppe<EtatInstallation>(reponse, "http.getInstallationStatus");
  },

  provisionOwnerAccount: (entree: ProvisionnementOwner) =>
    poster<{ userId: string }>("/api/auth/provisionner", entree, "http.provisionOwnerAccount"),

  getSession: async () => {
    // `GET`, et jamais mis en cache : la route fait glisser `last_seen_at`.
    // `cache: "no-store"` est explicite pour la même raison que
    // `force-dynamic` côté serveur — une session mise en cache serait
    // l'identité de quelqu'un d'autre servie à froid.
    let reponse: Response;
    try {
      reponse = await fetch("/api/auth/session", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch (brut) {
      return err(toAppError(brut, "http.getSession"));
    }
    return lireEnveloppe<SessionInfo | null>(reponse, "http.getSession");
  },

  /**
   * ⚠️ PHASE 5. Les cinq fonctions Jarvis vivent encore dans
   * `supabase/functions/` (Deno) et n'ont pas d'équivalent local : ces deux
   * méthodes visent `/api/jarvis/<nom>`, qui n'existe pas encore et rend donc
   * 404 → `introuvable`.
   *
   * C'est un choix explicite, pas un oubli. L'alternative — garder le client
   * Supabase pour ce seul chemin — laisserait la clé `anon` et l'URL du projet
   * dans le paquet navigateur, c'est-à-dire exactement ce que la phase 4 doit
   * faire disparaître. On préfère une fonctionnalité franchement inopérante
   * pendant une phase à une frontière à moitié franchie.
   *
   * Conséquence à connaître : Jarvis, la dictée et la voix sont HORS SERVICE
   * entre la phase 4 et la phase 5. Les écrans cliniques, eux, fonctionnent.
   */
  invokeFunction: <T>(name: string, body: unknown) =>
    poster<T>(`/api/jarvis/${encodeURIComponent(name)}`, body, `http.invoke:${name}`),

  invokeFunctionStream: async (name: string, body: unknown, signal?: AbortSignal) => {
    let reponse: Response;
    try {
      reponse = await fetch(`/api/jarvis/${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
        // `RequestInit.signal` accepte `AbortSignal | null`, jamais
        // `undefined`, et `exactOptionalPropertyTypes` refuse de confondre les
        // deux. On étale la clé plutôt que de poser `undefined`.
        ...(signal !== undefined && { signal }),
      });
    } catch (brut) {
      return err(toAppError(brut, `http.invokeStream:${name}`));
    }

    if (!reponse.ok || reponse.body === null) {
      return lireEnveloppe<ReadableStream<Uint8Array>>(
        reponse,
        `http.invokeStream:${name}`,
      );
    }
    // Le flux est rendu TEL QUEL : le protocole applicatif (SSE du chat, octets
    // audio de la voix) reste dans les services, comme du temps de l'adaptateur
    // Supabase. La frontière transporte, elle n'interprète pas.
    return ok(reponse.body);
  },
};
