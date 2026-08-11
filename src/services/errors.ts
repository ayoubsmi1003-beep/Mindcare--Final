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
  | "identifiants-refuses"
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
  /**
   * Où l'appel a échoué (ex. `"rpc:day_revenue"`, `"select"`, `"signIn"`). Un
   * repère de code, jamais une donnée de ligne — V1.1.
   */
  readonly context?: string;
  /**
   * La cause d'origine, jamais affichée : réservée à `log.ts`, qui n'en
   * retiendra que `.name` (V1.1 — `LogFields` reste fermée, jamais `message`).
   * Peut être une `Error` avec sa propre chaîne `.cause`, ou l'objet brut
   * rendu par Supabase.
   */
  readonly cause?: unknown;
}

/**
 * Forme minimale d'une erreur PostgREST ou Supabase Auth, sans importer le type
 * de Supabase. `name` et `status` s'y ajoutent pour le seul cas décrit dans
 * `isNetworkFailure` ; ce sont des champs techniques, ils ne portent jamais de
 * donnée de ligne — contrairement à `message`, qu'on ne lit toujours pas.
 */
interface RawDbError {
  readonly code?: string;
  readonly message?: string;
  readonly name?: string;
  readonly status?: number;
}

function isRawDbError(value: unknown): value is RawDbError {
  return typeof value === "object" && value !== null;
}

/**
 * PANNE RÉSEAU PENDANT UN APPEL D'AUTHENTIFICATION.
 *
 * `@supabase/auth-js` ne LÈVE pas quand le réseau tombe : il RETOURNE une
 * `AuthRetryableFetchError`, dont le champ `code` est explicitement `undefined`
 * (« errors that occur before a response is received will not have one »). Le
 * `try/catch` de l'adaptateur ne la voit donc jamais, et `classify(undefined)`
 * la rangeait en « inattendu ».
 *
 * La conséquence n'est pas cosmétique : à la coupure du Wi-Fi du cabinet,
 * l'écran de connexion affichait « Une erreur inattendue s'est produite »
 * — qui laisse croire à une panne du système — au lieu de « la connexion est
 * interrompue, réessayez lorsque le réseau est rétabli ». I20 demande que tout
 * se dégrade en DISANT ce qui se passe.
 *
 * ⚠️ `status` VAUT ZÉRO, PAS `undefined` — vérifié dans la bibliothèque
 * installée, pas supposé : `auth-js@2.110.9`, `dist/main/lib/fetch.js:38` et
 * `:126` construisent l'erreur avec `new AuthRetryableFetchError(msg, 0)`.
 * Une première version de cette fonction sortait sur `raw.status !== undefined`
 * et ne se déclenchait donc JAMAIS sur le chemin d'authentification — le seul
 * cas pour lequel elle avait été écrite. Zéro n'est pas « pas de statut » pour
 * un `!== undefined`, et c'est exactement le genre d'écart qu'un commentaire
 * rassurant fait passer en relecture. Si tu modifies ce test, relis le fichier
 * de la bibliothèque avant, pas sa documentation.
 *
 * On reconnaît donc le cas sans importer le type : aucune réponse HTTP
 * exploitable (`status` absent OU nul) et un nom d'erreur de transport.
 *
 * ⚠️ SECOND ÉCART, MÊME FAMILLE, MESURÉ À L'ÉCRAN LE 2026-08-04 — cette fois sur
 * le chemin POSTGREST, qui porte tous les écrans métier.
 *
 * `postgrest-js@2.110.9`, `src/PostgrestBuilder.ts:443-455` : quand `fetch`
 * échoue, il ne lève pas non plus, il retourne
 *   `{ message: "TypeError: Failed to fetch", details, hint: "", code: "" }`
 * avec `status: 0`. Deux pièges d'un coup :
 *   · `code` vaut la CHAÎNE VIDE, pas `undefined` — la sortie `raw.code !==
 *     undefined` renvoyait donc `false` immédiatement, et la branche hors-ligne
 *     était INATTEIGNABLE pour tout appel de données ;
 *   · l'objet n'a AUCUN champ `name` — le nom du transport est préfixé dans
 *     `message`.
 * Résultat constaté : coupure du Wi-Fi en pleine semaine d'agenda → « Une
 * erreur inattendue s'est produite », c'est-à-dire le message qui fait croire
 * à une panne du système au moment précis où il faut dire « le réseau est
 * coupé, rien n'est perdu » (I20).
 *
 * Le test ne peut donc pas se fier au seul `name`. Il reste néanmoins étroit :
 * une VRAIE erreur PostgREST porte toujours un code non vide (`PGRST116`,
 * `42501`, `23505`…), donc « pas de code exploitable ET pas de statut HTTP »
 * ne peut désigner qu'un échec de transport.
 *
 * Comme les deux fois précédentes : relire la bibliothèque installée, jamais sa
 * documentation.
 */
const NOMS_TRANSPORT = [
  "AuthRetryableFetchError",
  "TypeError",
  "NetworkError",
  "AbortError",
  "FetchError",
] as const;

function isNetworkFailure(raw: RawDbError): boolean {
  // Chaîne vide == absence de code. Voir l'encadré ci-dessus.
  if (raw.code !== undefined && raw.code !== "") return false;
  if (raw.status !== undefined && raw.status !== 0) return false;

  const name = raw.name;
  if (name !== undefined) {
    return (NOMS_TRANSPORT as readonly string[]).includes(name);
  }

  // Pas de `name` : postgrest-js préfixe le nom du transport dans `message`.
  const message = raw.message;
  if (message === undefined) return false;
  return (NOMS_TRANSPORT as readonly string[]).some((n) => message.startsWith(`${n}:`));
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
    // Supabase Auth ne rend pas un SQLSTATE : ces codes arrivent en HTTP 400
    // avec un `code`/`error_code` textuel. `invalid_credentials` couvre AUSSI
    // BIEN un e-mail inconnu qu'un mot de passe faux — les distinguer serait
    // un oracle d'énumération de comptes, qui révèle qui travaille dans un
    // cabinet de psychiatrie. Un seul code, un seul message pour les deux.
    case "invalid_credentials":
    case "invalid_grant":
    // `email_not_confirmed` et `user_banned` SONT ICI, ET PAS AVEC LES ERREURS
    // DE SESSION. Ils ne surviennent qu'après un mot de passe CORRECT : les
    // ranger ailleurs produisait un message différent, donc un oracle — « ce
    // compte existe, il est seulement non confirmé ». Les comptes …a2 et …a3
    // de la migration 015 sont exactement dans cet état, ce qui rendait
    // l'oracle atteignable en pratique. Un écran de connexion ne distingue
    // jamais POURQUOI il refuse.
    case "email_not_confirmed":
    case "user_banned":
      return "identifiants-refuses";
    // Celles-ci concernent une session DÉJÀ ouverte qui cesse d'être valable —
    // « votre session a expiré » y est vrai, et n'apprend rien sur l'existence
    // d'un compte puisqu'il a déjà fallu s'y connecter.
    case "session_not_found":
    case "refresh_token_not_found":
    case "refresh_token_already_used":
      return "non-authentifie";
    default:
      return "inattendu";
  }
}

/**
 * Suit la chaîne `Error.cause` jusqu'à trouver l'objet porteur de l'échec
 * réel (celui qui a un `.code` PostgREST/SQLSTATE exploitable), ou jusqu'à
 * épuiser la chaîne.
 *
 * N'INTERVIENT QU'EN AMONT de `isNetworkFailure` et `classify` — ni l'un ni
 * l'autre n'est modifié. Pour un `raw` qui n'est pas une `Error` (le cas
 * d'origine, un objet PostgREST brut), la boucle ne s'exécute jamais et cette
 * fonction rend `raw` inchangé : le comportement antérieur est préservé à
 * l'identique sur ce chemin.
 */
function unwrapCause(value: unknown): unknown {
  let courant = value;
  const vus = new Set<unknown>();
  while (courant instanceof Error && courant.cause !== undefined && !vus.has(courant)) {
    vus.add(courant);
    courant = courant.cause;
  }
  return courant;
}

/**
 * `context` situe l'appel dans le code (ex. `"rpc:day_revenue"`), jamais une
 * valeur de ligne. `cause` porte `raw` tel quel, réservé à `log.ts` — qui n'en
 * lira que `.name` (V1.1, jamais `.message`, jamais une donnée patient).
 */
export function toAppError(raw: unknown, context?: string): AppError {
  const source = unwrapCause(raw);

  if (!isRawDbError(source)) {
    return {
      code: "inattendu",
      message: fr.erreurs.inattendu,
      ...(context !== undefined && { context }),
      ...(raw !== undefined && { cause: raw }),
    };
  }

  if (isNetworkFailure(source)) {
    return {
      ...offlineError(),
      ...(context !== undefined && { context }),
      ...(raw !== undefined && { cause: raw }),
    };
  }

  const technical = source.code;
  const code = classify(technical);
  const message = fr.erreurs[code];

  return {
    code,
    message,
    ...(technical !== undefined && { technical }),
    ...(context !== undefined && { context }),
    ...(raw !== undefined && { cause: raw }),
  };
}

/**
 * Le `.name` de `AppError.cause`, pour `log.ts` — JAMAIS `.message`. Centralisé
 * ici plutôt que répété à chaque site d'appel de service, pour qu'aucun ne
 * soit tenté de lire autre chose que le nom (I5, règle 1).
 */
export function causeName(erreur: AppError): string | undefined {
  const cause = erreur.cause;
  return cause instanceof Error ? cause.name : undefined;
}

/**
 * Les champs `LogFields` (`log.ts`) qu'un site d'appel de service doit
 * transmettre pour un échec — V1.1. UNE SEULE fonction, appelée à chaque
 * `log.error`/`log.warn` de service, pour que le SQLSTATE (`technical`) et le
 * contexte n'atteignent plus jamais un journal par hasard à un site et pas à
 * l'autre. La forme correspond à `LogFields` sans l'importer : `log.ts`
 * n'importe rien d'`errors.ts`, et cette fonction ne porte que `code` (déjà
 * dans `LogFields`), `technical`, `context`, `causeName`.
 */
export function logFieldsFor(erreur: AppError): {
  readonly code: string;
  readonly technical?: string;
  readonly context?: string;
  readonly causeName?: string;
} {
  const nom = causeName(erreur);
  return {
    code: erreur.code,
    ...(erreur.technical !== undefined && { technical: erreur.technical }),
    ...(erreur.context !== undefined && { context: erreur.context }),
    ...(nom !== undefined && { causeName: nom }),
  };
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
