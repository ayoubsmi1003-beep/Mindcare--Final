/**
 * `jarvis-execution.ts` — M06 · le SEUL chemin service d'exécution vérifiée.
 *
 * ═══ POURQUOI CE FICHIER EXISTE ═══
 * Deux surfaces consomment une écriture confirmée — la conversation
 * (`conversation.ts`, carte flottante) et le tableau de bord
 * (`ColonneContexte.tsx`, liste des propositions) — et seule la première
 * relisait l'effet après coup. Deux chemins de vérification, c'est deux
 * sémantiques de succès qui divergeront. Ce fichier est l'unique endroit où :
 *
 *   exécuter(actionId) → verifier(args canoniques, affecté) → garderReponse
 *
 * Les deux surfaces appellent `executerEcritureConfirmee` et reçoivent la même
 * `IssueExecution`. Aucune logique métier de vérification ne vit dans un
 * composant : les écrans affichent, ils ne prouvent pas.
 *
 * ═══ CE QUI AUTORISE, ET CE QUI CONSTATE ═══
 *   · Autorise : la RLS (acteur + cabinet) + les portes INVOKER + la machine
 *     d'état (`FOR UPDATE`, `confirmed` exigé). Rien ici ne les remplace et
 *     l'exécution reste pilotée par `actionId` SEUL — aucun argument client
 *     n'est envoyé à la porte.
 *   · Constate : le `verifier` de la capacité (relecture de l'état réel) + la
 *     garde (`jarvis-response-guard.ts`, correspondance + succès prouvé).
 *   · Les arguments canoniques (`argsCanoniques`) ne sont PAS une source
 *     d'autorisation : ils servent à SAVOIR QUOI RELIRE. Côté tableau de bord,
 *     c'est la valeur rendue par la porte `dashboard_today` (dérivée serveur
 *     de la ligne persistée) ; côté conversation, les arguments préparés qui
 *     viennent d'être sérialisés dans `tool_args`. Une divergence avec la
 *     ligne ferait ÉCHOUER la relecture — jamais autoriser.
 *
 * ═══ MONITEUR D'EXÉCUTION — la plus petite configuration explicite ═══
 *   · `tentatives` vaut TOUJOURS 0 pour les écritures en M06 : aucune écriture
 *     n'est rejouée automatiquement. Table par opération (réconciliation après
 *     `inconnue` = relecture conservatrice, jamais rejeu) :
 *       - create_appointment      : pas de rejeu (double création possible) ;
 *         réconciliation par (patient, début) — un sosie concurrent impose
 *         l'incertitude, jamais un succès.
 *       - reschedule_appointment  : pas de rejeu (déplacer deux fois ≠
 *         déplacer une fois) ; relecture de l'heure affectée.
 *       - cancel_appointment      : pas de rejeu. Le refus de la double
 *         annulation (E6) est un REFUS, pas une idempotence d'affaires :
 *         seules les suppressions de doublons par machine d'état (`rejet`
 *         du second `execute` sur le même `actionId`) sont admises.
 *       - mark_patient_arrived    : idem — suppression de doublon par état,
 *         aucun rejeu d'affaires.
 *       - set_consultation_price  : pas de rejeu (écrasement ; une valeur
 *         égale relue après délai ne prouve PAS la causalité — §8 M06, un
 *         concurrent a pu l'écrire) ; relecture du montant = indice, pas
 *         preuve sans correspondance causale.
 *       - record_payment_collected : JAMAIS rejoué en M06 (mouvement
 *         d'argent) ; relecture de `collectedAt`, inconnu sinon.
 *       - create_document_draft   : la porte est SELECT-only (063), mais le
 *         chemin reste identique — aucune normalisation terminologique ne
 *         change le comportement, et aucun rejeu post-exécution.
 *   · Délai : `DELAI_EXECUTION_MS` borne l'ATTENTE cliente, pas l'opération.
 *     Au-delà, l'issue est `inconnue` — l'écriture a PU être validée côté
 *     serveur sans que la réponse ne revienne. `inconnue` n'est ni un succès
 *     ni un échec, n'autorise aucun rejeu, et ne dit jamais « C'est fait ».
 *     20 s > `statement_timeout` (15 s) de `withCaller` : une mise à mort
 *     serveur arrive en `echec` (porte en `failed`), pas en `inconnue`.
 *
 * ═══ JOURNALISATION ═══
 * Champs `LogFields` existants uniquement — jamais d'identifiants, jamais
 * d'arguments, jamais de montants : `code` (raison non identifiante),
 * `durationMs`, `count`, `context` (`outil:<nom>:tentatives:0`).
 */

import { fr } from "@/i18n/fr";

import { capaciteEcriture, type CapaciteEcritureEnregistree } from "./jarvis-ecritures";
import { executerAction } from "./jarvis-tools";
import { garderReponse, type RaisonBlocage } from "./jarvis-response-guard";
import { log } from "./log";
import type { Result } from "./result";

/** Borne d'ATTENTE cliente sur l'exécution. Voir l'en-tête : dépassée = `inconnue`. */
export const DELAI_EXECUTION_MS = 20_000;

/** Ce que l'appelant a confirmé et dont il demande l'exécution vérifiée. */
export interface EntreeExecution {
  readonly actionId: string;
  /** Nom d'outil tel que persisté (jamais un type d'affichage). */
  readonly outil: string;
  /**
   * Arguments tels que persistés dans `tool_args` — dérivés serveur quand ils
   * existent (porte `dashboard_today`), sinon la valeur exacte sérialisée par
   * `proposerAction`. Servent à relire, jamais à autoriser. `null` (carte
   * historique sans arguments mémorisés) = invérifiable = bloqué honnête.
   */
  readonly argsCanoniques: unknown;
}

export type IssueConnue = "ok" | "echec" | "inconnue" | "bloquee" | "duplicata";

/**
 * Raisons techniques non-PII ; les `RaisonBlocage` viennent de la garde.
 * `RUPTURE_TRANSPORT` = le transport a levé pendant l'exécution : la réponse
 * est perdue, l'écriture a pu être validée — issue `inconnue`, jamais `echec`.
 */
export type RaisonExecution = RaisonBlocage | "ECHEC_PORTE" | "DELAI_DEPASSE" | "RUPTURE_TRANSPORT";

export interface ExecutionAboutie {
  readonly ok: true;
  readonly issue: "ok";
  readonly affecteId: string;
  readonly dureeMs: number;
  /** M06 : toujours 0 — aucune écriture n'est rejouée. */
  readonly tentatives: 0;
}

export interface ExecutionEchouee {
  readonly ok: false;
  readonly issue: Exclude<IssueConnue, "ok">;
  readonly raison: RaisonExecution;
  /** Message français affichable, réutilisé de `fr` — jamais composé ici. */
  readonly message: string;
  readonly dureeMs: number;
  /** M06 : toujours 0 — `inconnue` n'autorise aucun rejeu. */
  readonly tentatives: 0;
}

export type IssueExecution = ExecutionAboutie | ExecutionEchouee;

/**
 * Dépendances injectables — même patron que `DEPENDANCES_REELLES` de
 * `jarvis-boucle.ts` : le réel en production, des doublures en test, sans
 * toucher aux portes.
 */
export interface DependancesExecution {
  readonly executer: (actionId: string) => Promise<Result<string>>;
  readonly verifierPour: (outil: string) => CapaciteEcritureEnregistree | null;
  readonly delaiMs: number;
  readonly maintenant: () => number;
}

const DEPENDANCES_REELLES: DependancesExecution = {
  executer: (actionId) => executerAction(actionId),
  verifierPour: (outil) => capaciteEcriture(outil),
  delaiMs: DELAI_EXECUTION_MS,
  maintenant: () => Date.now(),
};

/**
 * Actions déjà menées au succès dans cette session. Signal de MONITEUR
 * uniquement : la base reste l'autorité (un second `execute` sur le même
 * `actionId` lève par machine d'état de toute façon). Sert à nommer le
 * doublon `duplicata` au lieu d'un `echec` générique, et à rendre à la garde
 * l'information `dejaExecutee` qui fait BLOQUER en `DUPLICATE`.
 */
const terminees = new Set<string>();

/** Réservé aux tests : purger le signal de doublon de session. */
export function reinitialiserTermineesPourTest(): void {
  terminees.clear();
}

type SortExecution =
  | { readonly expire: true }
  | { readonly expire: false; readonly resultat: Result<string>; readonly rupture: boolean };

/**
 * Course entre l'exécution et le délai, SANS rejet non observé : les deux
 * branches rendent une valeur, donc une exécution qui aboutit (ou lève)
 * après l'expiration ne devient jamais un `unhandled rejection`.
 */
async function executerAvecDelai(
  executer: (actionId: string) => Promise<Result<string>>,
  actionId: string,
  delaiMs: number,
): Promise<SortExecution> {
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  try {
    const expiration = new Promise<SortExecution>((resoudre) => {
      minuteur = setTimeout(() => resoudre({ expire: true }), delaiMs);
    });
    // ⚠️ UNE RUPTURE N'EST PAS UN ÉCHEC PROUVÉ. Si le transport lève (réseau
    // coupé, réponse perdue), l'écriture a PU être validée côté serveur sans
    // que la réponse ne revienne : `rupture: true` force l'issue `inconnue`
    // en aval, jamais `echec` (qui prétendrait savoir qu'elle n'a pas eu
    // lieu) et jamais un rejeu. Le message joint ne sert qu'au repli.
    const achevee: Promise<SortExecution> = executer(actionId).then(
      (resultat) => ({ expire: false as const, resultat, rupture: false }),
      (erreur: unknown) => ({
        expire: false as const,
        resultat: {
          ok: false as const,
          error: {
            code: "indisponible" as const,
            message: fr.erreurs.indisponible,
            cause: erreur,
          },
        },
        rupture: true,
      }),
    );
    return await Promise.race([achevee, expiration]);
  } finally {
    if (minuteur !== undefined) clearTimeout(minuteur);
  }
}

function contexteOutil(outil: string): string {
  return `outil:${outil}:tentatives:0`;
}

function bloquer(
  issue: ExecutionEchouee["issue"],
  raison: RaisonExecution,
  message: string,
  outil: string,
  dureeMs: number,
): ExecutionEchouee {
  log.error("jarvis.execution.surveillee", {
    code: raison,
    durationMs: dureeMs,
    context: contexteOutil(outil),
  });
  return { ok: false, issue, raison, message, dureeMs, tentatives: 0 };
}

/**
 * CONFIRMÉ → EXÉCUTER → VÉRIFIER → GARDER. La confirmation a déjà eu lieu en
 * amont (`confirmerAction`, appel séparé — l'ordre reste démontrable) ; ici
 * on exécute par `actionId`, on relit avec les arguments canoniques, et on ne
 * rend `ok` que si la garde constate le succès prouvé.
 */
export async function executerEcritureConfirmee(
  entree: EntreeExecution,
  deps: DependancesExecution = DEPENDANCES_REELLES,
): Promise<IssueExecution> {
  const debut = deps.maintenant();
  const duree = (): number => deps.maintenant() - debut;

  // 0 · Forme de l'entrée — avant tout appel. Une carte historique sans
  // arguments mémorisés est invérifiable : on le dit au lieu d'annoncer
  // « enregistré » sur une relecture qu'on n'a pas faite.
  if (
    typeof entree.actionId !== "string" ||
    entree.actionId === "" ||
    typeof entree.outil !== "string" ||
    entree.outil === "" ||
    typeof entree.argsCanoniques !== "object" ||
    entree.argsCanoniques === null ||
    Array.isArray(entree.argsCanoniques)
  ) {
    return bloquer(
      "bloquee",
      "MALFORMED",
      fr.jarvis.argumentsInvalides,
      typeof entree.outil === "string" && entree.outil !== "" ? entree.outil : "inconnu",
      duree(),
    );
  }
  const args = entree.argsCanoniques;

  // 1 · Doublon connu de cette session : on rejoue quand même la porte ?
  // NON — mais on ne prétend pas non plus que la base a tranché sans elle :
  // on rend `duplicata` sans nouvel appel, et la base aurait refusé de toute
  // façon (machine d'état). Zéro exécution métier supplémentaire.
  if (terminees.has(entree.actionId)) {
    return bloquer(
      "duplicata",
      "DUPLICATE",
      fr.jarvis.propositionIntrouvable,
      entree.outil,
      duree(),
    );
  }

  // 2 · EXÉCUTER — par `actionId` seul. Aucun argument client ne voyage.
  const sort = await executerAvecDelai(deps.executer, entree.actionId, deps.delaiMs);

  // 3 · Délai dépassé = INCONNUE. L'écriture a PU être validée sans que la
  // réponse ne revienne : ni succès, ni échec, aucun rejeu (toutes les
  // écritures M06 sont non rejouables), et le message honnête existant.
  if (sort.expire) {
    return bloquer(
      "inconnue",
      "DELAI_DEPASSE",
      fr.jarvis.ecriture.nonVerifiee,
      entree.outil,
      duree(),
    );
  }

  // 4 · La porte a refusé (failed, rejet, sans confirmation, RLS) : on rend
  // SON message, jamais un succès. Si pendant ce temps un doublon concurrent
  // a abouti, on nomme `duplicata`. Une RUPTURE de transport, elle, ne prouve
  // pas l'absence d'écriture : `inconnue`, message honnête, aucun rejeu.
  if (!sort.resultat.ok) {
    if (sort.rupture) {
      return bloquer(
        "inconnue",
        "RUPTURE_TRANSPORT",
        fr.jarvis.ecriture.nonVerifiee,
        entree.outil,
        duree(),
      );
    }
    if (terminees.has(entree.actionId)) {
      return bloquer(
        "duplicata",
        "DUPLICATE",
        fr.jarvis.propositionIntrouvable,
        entree.outil,
        duree(),
      );
    }
    log.error("jarvis.execution.surveillee", {
      code: sort.resultat.error.code,
      durationMs: duree(),
      context: contexteOutil(entree.outil),
    });
    return {
      ok: false,
      issue: "echec",
      raison: "ECHEC_PORTE",
      message: sort.resultat.error.message,
      dureeMs: duree(),
      tentatives: 0,
    };
  }
  const affecteId = sort.resultat.data;

  // 5 · VÉRIFIER — relecture de l'état réel avec les arguments canoniques.
  // Sans capacité enregistrée (outil inconnu du registre), aucune relecture
  // n'est définie : invérifiable, donc bloqué — strictement plus honnête que
  // l'historique « enregistré » sans relecture.
  const capacite = deps.verifierPour(entree.outil);
  if (capacite === null) {
    return bloquer(
      "bloquee",
      "NOT_VERIFIED",
      fr.jarvis.ecriture.nonVerifiee,
      entree.outil,
      duree(),
    );
  }
  let verifieOk = false;
  let messageVerifieur: string = fr.jarvis.ecriture.nonVerifiee;
  try {
    const verifie = await capacite.verifier(args, affecteId);
    verifieOk = verifie.ok;
    if (!verifie.ok) messageVerifieur = verifie.error.message;
  } catch {
    verifieOk = false;
  }

  // 6 · GARDER — seul constat de succès autorisé. Le chemin partagé fait
  // toujours passer à la garde l'outil et les arguments canoniques des deux
  // côtés ; une divergence ne peut venir que d'une erreur d'appelant, et
  // elle bloque ici plutôt qu'à l'écran.
  const garde = garderReponse({
    actionId: entree.actionId,
    canonique: { outil: entree.outil, args },
    verifieAvec: { outil: entree.outil, args },
    execution: {
      ok: true,
      affecteId,
      dejaExecutee: terminees.has(entree.actionId),
    },
    verification: { ok: verifieOk },
  });

  if (garde.verdict === "ALLOW_SUCCESS") {
    terminees.add(entree.actionId);
    log.info("jarvis.execution.surveillee", {
      code: "verifiee",
      durationMs: duree(),
      context: contexteOutil(entree.outil),
    });
    return { ok: true, issue: "ok", affecteId, dureeMs: duree(), tentatives: 0 };
  }

  // Doublon constaté par la garde (un concurrent de cette session a abouti
  // entre-temps) : même issue `duplicata` qu'à l'entrée — zéro exécution
  // supplémentaire, et le message qui dit que rien n'a été modifié.
  if (garde.reason === "DUPLICATE") {
    return bloquer(
      "duplicata",
      "DUPLICATE",
      fr.jarvis.propositionIntrouvable,
      entree.outil,
      duree(),
    );
  }

  // Garde bloquante après relecture : si c'est la relecture elle-même qui a
  // échoué, son message (français, précis) prime sur le générique.
  if (!verifieOk) {
    return bloquer("bloquee", garde.reason, messageVerifieur, entree.outil, duree());
  }
  return bloquer(
    "bloquee",
    garde.reason,
    fr.jarvis.ecriture.nonVerifiee,
    entree.outil,
    duree(),
  );
}
