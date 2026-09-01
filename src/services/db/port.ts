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

export interface SignInCredentials {
  readonly email: string;
  readonly password: string;
}

/**
 * Session PAUVRE, délibérément. `userId` et rien d'autre : ni e-mail, ni
 * jeton, ni métadonnées. Un port qui rendrait le jeton d'accès inviterait un
 * appelant à s'en servir ailleurs que dans l'adaptateur — exactement ce que
 * `DbPort` interdit déjà pour les requêtes (voir l'en-tête du fichier).
 */
export interface SessionInfo {
  readonly userId: string;
}

/** État du premier lancement — voir `085_etat_provisionnement.sql`. */
export interface EtatInstallation {
  readonly environment: string | null;
  readonly provisionne: boolean;
}

/** Les neuf champs du premier lancement — voir `084_provision_owner_account.sql`. */
export interface ProvisionnementOwner {
  readonly cabinetNom: string;
  readonly cabinetAdresse: string;
  readonly cabinetTelephone: string;
  readonly praticienNomComplet: string;
  readonly praticienTitre: string;
  readonly praticienNumeroOrdre: string;
  readonly praticienTelephone: string;
  readonly email: string;
  readonly motDePasse: string;
}

export interface DbPort {
  /** Lecture d'une relation exposée (table ou vue). */
  readonly select: <T>(spec: SelectSpec) => Promise<Result<readonly T[]>>;
  /** Appel d'une fonction Postgres. Seule voie vers l'identité patient (ADR-019). */
  readonly rpc: <T>(name: string, args: RpcArgs) => Promise<Result<readonly T[]>>;

  /**
   * `auth` APPARTIENT AU PORT, PAS À UN MODULE SÉPARÉ. Le jour d'ADR-001
   * (Postgres local), l'authentification change d'implémentation EN MÊME
   * TEMPS que la base — un cabinet hors-ligne ne peut pas dépendre d'un
   * service d'identité cloud pendant que ses données vivent sur la machine
   * locale. Si `auth` vivait à côté du port, le second adaptateur pourrait
   * compiler sans la fournir, et l'application démarrerait sans authentification
   * sans que rien ne le signale. En la mettant dans `DbPort`, un adaptateur
   * incomplet échoue à la compilation, pas en cabinet.
   *
   * Trois opérations, aussi pauvres que `SessionInfo` : ouvrir une session,
   * la fermer, lire celle en cours. Rien qui décide d'un accès — la RLS
   * Postgres s'en charge, comme partout ailleurs dans ce dépôt.
   */
  readonly signIn: (credentials: SignInCredentials) => Promise<Result<SessionInfo>>;
  readonly signOut: () => Promise<Result<void>>;
  readonly getSession: () => Promise<Result<SessionInfo | null>>;

  /**
   * Le premier lancement (§D, phase Bureau Windows) — même famille que
   * `signIn`/`signOut`/`getSession` : deux opérations pauvres, pré-session,
   * qui vivent dans le port pour la même raison que l'authentification (voir
   * plus haut). `getInstallationStatus` dit s'il faut montrer l'écran de
   * configuration ; `provisionOwnerAccount` ne s'exécute qu'une fois.
   */
  readonly getInstallationStatus: () => Promise<Result<EtatInstallation>>;
  readonly provisionOwnerAccount: (
    entree: ProvisionnementOwner,
  ) => Promise<Result<{ readonly userId: string }>>;

  /**
   * Appel d'une Edge Function — S6. Seule voie vers la passerelle Jarvis
   * (`supabase/functions/`) : ADR-019 et ADR-020 valent pour ce chemin comme
   * pour `rpc()`, un seul point d'entrée qu'on peut auditer et faire évoluer.
   * `body` voyage tel quel en JSON ; la fonction cible répond `{ ok, data |
   * error }` (même convention que `Result<T>`), et l'adaptateur la traduit ici
   * — l'appelant ne voit jamais la forme brute de la réponse HTTP.
   */
  readonly invokeFunction: <T>(name: string, body: unknown) => Promise<Result<T>>;

  /**
   * Appel STREAMING d'une Edge Function — V-JARVIS-CORE.
   *
   * Même frontière que `invokeFunction`, en flux : le corps de réponse est
   * rendu TEL QUEL (SSE du chat, octets audio de la voix), sans aucune
   * interprétation ici — le protocole applicatif reste dans les services.
   *
   * ⚠️ LE JETON NE SORT PAS DU PORT. L'adaptateur lit l'access token en
   * interne pour construire l'en-tête Authorization ; `SessionInfo` reste
   * volontairement pauvre, exactement pour cette raison.
   *
   * `signal` porte l'interruption bout-en-bout (bouton Stop, navigation) :
   * l'abandon remonte jusqu'au `req.signal` Deno, donc jusqu'au fetch
   * fournisseur — la génération s'arrête vraiment.
   */
  readonly invokeFunctionStream: (
    name: string,
    body: unknown,
    signal?: AbortSignal,
  ) => Promise<Result<ReadableStream<Uint8Array>>>;
}
