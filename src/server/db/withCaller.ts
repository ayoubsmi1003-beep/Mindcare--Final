/**
 * `withCaller` — l'identité de l'appelant, posée en base, et qui n'en sort pas.
 *
 * ⚠️ C'EST LE FICHIER LE PLUS DANGEREUX DU DÉPÔT. Jusqu'ici, l'identité venait
 * d'un JWT que PostgREST posait lui-même, une connexion par requête. En passant
 * à un pool, NOUS devenons responsables de cette pose — et `pg` ne réinitialise
 * RIEN entre deux emprunts. Une identité posée avec `SET` au lieu de
 * `SET LOCAL` survit à la requête et sert la suivante : la praticienne B lirait
 * les dossiers de la praticienne A, sans erreur, sans trace, sans symptôme.
 *
 * C'est le seul endroit de cette migration où l'on peut créer une faille qui
 * n'existait pas. Tout ce qui suit n'a qu'un objet : la rendre impossible.
 *
 * ═══ LES QUATRE VERROUS, ET POURQUOI IL EN FAUT QUATRE ══════════════════════
 *
 * 1. `SET LOCAL` (et `set_config(..., true)`) — la valeur meurt à la fin de la
 *    transaction. PostgreSQL la révoque au COMMIT **comme au ROLLBACK** : les
 *    chemins d'erreur, les `return` anticipés et les exceptions sont donc
 *    couverts PAR LE MOTEUR, pas par notre discipline. C'est le seul verrou
 *    qu'on ne peut pas oublier d'appliquer.
 *
 * 2. `mindcare_app` est `NOINHERIT` (bootstrap 010) — hors `SET LOCAL ROLE`, il
 *    n'a aucun droit. Si l'enveloppe était contournée, la requête échouerait au
 *    lieu de lire. Le verrou 1 protège l'identité ; celui-ci protège contre
 *    l'absence d'identité.
 *
 * 3. `DISCARD ALL` avant de rendre la connexion. S'il échoue, la connexion est
 *    DÉTRUITE et non rendue au pool.
 *
 *    ⚠️ NE PAS LE DÉCRIRE COMME REDONDANT — MESURÉ, PAS SUPPOSÉ. La première
 *    rédaction de ce commentaire le disait « inutile en théorie, puisque 1
 *    garantit déjà la propreté ». C'est faux en pratique, et la mesure l'a
 *    montré : en remplaçant `SET LOCAL` par `SET` et `set_config(…, true)` par
 *    `false`, les 7 tests de `tests/integration/identite-pool.test.ts` sont
 *    restés VERTS. `DISCARD ALL` efface aussi les réglages de portée SESSION,
 *    donc il rattrapait seul la faille — et rendait les verrous 1 et 3
 *    INDISTINGUABLES de l'extérieur.
 *
 *    Conséquence, et c'est elle qui compte : aucun test de bout en bout ne peut
 *    prouver que le verrou 1 est en place. Si `SET LOCAL` disparaissait un jour,
 *    la sécurité reposerait entièrement sur ce `finally`, sans que personne ne
 *    l'ait décidé. C'est pourquoi le contrôle 11 de `scripts/preflight.sh` lit
 *    le TEXTE de ce fichier : c'est le seul endroit où la différence existe.
 *    Ne pas retirer ce contrôle en le croyant couvert par les tests.
 *
 * 4. Le pool n'est joignable que d'ici (`no-restricted-imports`).
 *
 * ═══ CE QUE CETTE ENVELOPPE NE FAIT PAS ═════════════════════════════════════
 *
 * Elle ne décide d'aucun accès. Elle ne lit pas de rôle, ne compare pas de
 * `practitioner_id`, ne filtre rien. Elle POSE une identité et laisse la RLS
 * décider — exactement comme les portes de 020. Un `if` d'autorisation ici
 * serait un bug de conception (règle 4 de CLAUDE.md).
 *
 * Elle ne sert pas non plus au streaming. Voir `withCallerStream` plus bas.
 */

import type { PoolClient, QueryResultRow } from "pg";

import { obtenirPool } from "./pool";

/**
 * La seule chose qu'un appelant reçoit : de quoi exécuter une requête, et rien
 * qui permette de manipuler la transaction ou la connexion. Pas de `release`,
 * pas de `BEGIN`, pas d'accès au `PoolClient`. On ne peut donc pas, depuis un
 * service, valider la transaction à mi-chemin ni garder la connexion.
 */
export interface Querier {
  readonly query: <T extends QueryResultRow>(
    texte: string,
    valeurs?: readonly unknown[],
  ) => Promise<readonly T[]>;
}

function faireQuerier(client: PoolClient): Querier {
  return {
    query: async <T extends QueryResultRow>(texte: string, valeurs?: readonly unknown[]) => {
      const r = await client.query<T>(texte, valeurs === undefined ? undefined : [...valeurs]);
      return r.rows;
    },
  };
}

/**
 * `SET LOCAL ROLE` n'accepte pas de paramètre lié — c'est un identifiant, pas
 * une valeur. On ne concatène donc JAMAIS une chaîne venue de l'appelant : les
 * deux seuls noms possibles sont écrits ici, en toutes lettres, et le choix se
 * fait sur un booléen. Aucune donnée externe n'atteint cette instruction.
 *
 * L'identité, elle, est une VALEUR : elle passe par `set_config($1)`, liée.
 */
const ROLE_CONNECTE = "SET LOCAL ROLE authenticated";
const ROLE_VISITEUR = "SET LOCAL ROLE anon";

/**
 * Borne de sécurité, pas de performance. Une requête qui dépasse ce délai
 * retient une connexion du pool ; quelques-unes suffisent à figer l'application
 * entière. Posée en `SET LOCAL` pour ne pas survivre à l'emprunt.
 */
const DELAI_REQUETE = "15s";

/**
 * Exécute `fn` dans UNE transaction, sous l'identité de `userId`.
 *
 * `userId === null` signifie « personne » : la transaction s'exécute sous `anon`
 * et `auth.uid()` rend NULL. C'est le cas avant connexion, et il doit rester
 * exprimable — un port qui ne saurait pas dire « pas d'identité » finirait par
 * en inventer une.
 *
 * ⚠️ `fn` NE DOIT PAS capturer le `Querier` au-delà de son propre retour. La
 * connexion est rendue au pool aussitôt après, et l'utiliser ensuite écrirait
 * dans la transaction de quelqu'un d'autre. Pour un flux, voir
 * `withCallerStream`.
 */
export async function withCaller<T>(
  userId: string | null,
  fn: (q: Querier) => Promise<T>,
): Promise<T> {
  const client = await obtenirPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(userId === null ? ROLE_VISITEUR : ROLE_CONNECTE);
    // `true` = SET LOCAL : la valeur disparaît avec la transaction.
    // La chaîne vide est le « personne » de `auth.uid()`, qui la ramène à NULL.
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    await client.query(`SET LOCAL statement_timeout = '${DELAI_REQUETE}'`);

    const resultat = await fn(faireQuerier(client));

    await client.query("COMMIT");
    return resultat;
  } catch (erreur) {
    // La connexion peut déjà être morte (coupure, délai dépassé) : un ROLLBACK
    // qui échoue ne doit pas masquer l'erreur d'origine, qui est celle qui
    // explique la panne.
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connexion perdue — l'erreur d'origine est plus informative */
    }
    throw erreur;
  } finally {
    /**
     * `DISCARD ALL` ne peut pas s'exécuter dans une transaction ouverte. À ce
     * point elle est close (COMMIT ou ROLLBACK), sauf si la connexion est morte
     * — auquel cas l'appel lève, et c'est exactement le cas où il ne faut PAS
     * rendre la connexion au pool. `release(true)` la détruit.
     */
    try {
      await client.query("DISCARD ALL");
      client.release();
    } catch {
      client.release(true);
    }
  }
}

/**
 * `withAuthGate` — la transaction qui n'endosse AUCUNE identité.
 *
 * Elle existe pour un problème d'ordre : les portes de `070_local_auth.sql`
 * s'exécutent AVANT qu'une identité existe. Vérifier un mot de passe, ouvrir une
 * session, résoudre un jeton — aucune de ces trois opérations ne peut se faire
 * sous `authenticated`, puisque c'est précisément ce qu'elles servent à établir.
 *
 * Elle laisse donc la transaction sous le rôle de CONNEXION (`mindcare_app`), à
 * qui 070 §5 accorde `EXECUTE` sur les quatre portes — et à personne d'autre.
 *
 * ⚠️ POURQUOI CE N'EST PAS UN TROU. `mindcare_app` est `NOINHERIT` : hors d'un
 * `SET LOCAL ROLE`, il ne possède AUCUN privilège de table, ni dans `app`, ni
 * dans `audit`, ni dans `auth`. Ce que cette enveloppe ouvre n'est donc pas « un
 * accès sans identité » : c'est le droit d'appeler quatre fonctions nommées, qui
 * ne rendent qu'un `uuid` ou un horodatage, jamais une ligne. Une requête de
 * données passée par erreur ici échouerait sur `permission denied`.
 *
 * La symétrie est ce qui rend le dispositif lisible :
 *   · `withCaller(uid, …)`  → `SET LOCAL ROLE authenticated` + identité posée ;
 *   · `withCaller(null, …)` → `SET LOCAL ROLE anon`, l'absence d'identité ASSUMÉE ;
 *   · `withAuthGate(…)`     → aucun rôle endossé, l'identité en cours d'ÉTABLISSEMENT.
 *
 * Le troisième cas ne doit jamais servir à autre chose. Le contrôle 12 de
 * `scripts/preflight.sh` le vérifie : seul `src/server/auth/**` l'appelle.
 */
export async function withAuthGate<T>(fn: (q: Querier) => Promise<T>): Promise<T> {
  const client = await obtenirPool().connect();
  try {
    await client.query("BEGIN");
    // Pas de SET LOCAL ROLE : c'est tout l'objet de cette enveloppe.
    // L'identité n'est pas non plus posée — `auth.uid()` rend NULL ici, et les
    // portes de 070 ne la consultent pas : elles reçoivent leurs arguments.
    await client.query(`SET LOCAL statement_timeout = '${DELAI_REQUETE}'`);

    const resultat = await fn(faireQuerier(client));

    await client.query("COMMIT");
    return resultat;
  } catch (erreur) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connexion perdue — l'erreur d'origine est plus informative */
    }
    throw erreur;
  } finally {
    try {
      await client.query("DISCARD ALL");
      client.release();
    } catch {
      client.release(true);
    }
  }
}

/**
 * `withEgressGate` — la transaction qui écrit le journal de franchissement.
 *
 * Même forme que `withAuthGate` : aucun rôle endossé, donc la transaction reste
 * sous `mindcare_app`, à qui `071_egress_gatekeeper.sql` accorde `EXECUTE` sur
 * `audit.log_boundary_crossing` — et à personne d'autre.
 *
 * ⚠️ POURQUOI PAS `withCaller(userId)`. Le journal de franchissement ne doit pas
 * être FORGEABLE depuis une requête servie pour une utilisatrice : sous
 * `authenticated`, l'`EXECUTE` est refusé (071 §5 le vérifie). Écrire ce journal
 * est un geste du SERVEUR, pas un geste de l'utilisatrice — et la table ne porte
 * d'ailleurs aucun acteur, délibérément : elle consigne qu'un appel externe a eu
 * lieu, pas qui l'a déclenché, pour rester non reliable à un patient.
 *
 * Elle existe séparément de `withAuthGate` au lieu d'être la même fonction
 * réutilisée, pour que le contrôle 12 de `preflight.sh` puisse dire, pour
 * chacune, D'OÙ elle a le droit d'être appelée. Une enveloppe unique partagée
 * autoriserait mécaniquement les deux répertoires à faire le travail de l'autre.
 */
export const withEgressGate = withAuthGate;

/**
 * Variante pour les réponses en flux (SSE du chat, octets audio de la voix).
 *
 * ⚠️ POURQUOI ELLE EXISTE, ET POURQUOI ELLE NE REND PAS DE `Querier`.
 * Un `ReadableStream` vit APRÈS le retour du gestionnaire de route : la réponse
 * part, puis les fragments arrivent au fil des minutes. Une transaction ouverte
 * pendant tout ce temps immobiliserait une connexion du pool et tiendrait des
 * verrous pendant la génération du modèle. Pire, si l'utilisateur ferme
 * l'onglet, la transaction resterait ouverte jusqu'au délai d'inactivité.
 *
 * Le contrat est donc : on rassemble TOUT ce dont le flux aura besoin AVANT de
 * le construire, la transaction se referme, et le flux ne touche plus la base.
 * Les écritures d'après-flux (journal de franchissement, tour de conversation)
 * ouvrent leur propre `withCaller`, court, une fois le flux terminé.
 *
 * Cette fonction ne fait donc rien de plus que `withCaller` — elle NOMME
 * l'intention, pour qu'une relecture voie tout de suite si la règle est
 * respectée. Le contrôle mécanique correspondant vit dans `preflight.sh` :
 * aucun identifiant `Querier` ne doit apparaître dans un corps de
 * `new ReadableStream`.
 */
export const prechargerPourFlux = withCaller;
