/**
 * `jarvis-response-guard.ts` — M06 · le GARDE-FOU DE RÉPONSE.
 *
 * ═══ CE QUE C'EST ═══
 * Une fonction PURE et DÉTERMINISTE : pas de base, pas de réseau, pas de LLM,
 * pas d'effet de bord. Son seul travail :
 *
 *   empêcher Jarvis d'annoncer un succès que l'exécution et la vérification
 *   n'ont pas établi.
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas une autorisation. La RLS + les portes INVOKER + la machine d'état
 *     `proposed → confirmed → executed` autorisent ; le garde ne fait que
 *     REFUSER un constat de succès. Il ne peut jamais rendre une action
 *     possible, seulement rendre un message impossible.
 *   · Pas un critique clinique. Aucune inférence, aucun LLM, aucune notion de
 *     « bon » médical — seulement : l'outil vérifié est-il celui de l'action,
 *     les arguments vérifiés sont-ils ceux de l'action, l'exécution a-t-elle
 *     abouti, la relecture a-t-elle confirmé.
 *   · Pas une source de vérité. L'action canonique vient de la ligne
 *     `app.jarvis_actions` (via le chemin d'exécution partagé
 *     `jarvis-execution.ts`) ; le garde compare, il ne tranche jamais seul.
 *
 * ═══ LE CONTRAT ═══
 * `canonique` = ce que la ligne persistée dit (outil + arguments tels que
 * persistés — côté tableau de bord, la valeur rendue par la porte
 * `dashboard_today` ; côté conversation, les arguments préparés qui viennent
 * d'être sérialisés dans `tool_args` par `proposerAction`). Ce n'est PAS une
 * source d'autorisation : l'exécution reste pilotée par `actionId` seul, et
 * une divergence entre la mémoire cliente et la ligne fait ÉCHOUER la garde
 * (fermée par construction), jamais autoriser.
 *
 * `verifieAvec` = l'outil et les arguments EFFECTIVEMENT passés au `verifier`.
 * Le chemin partagé y fait toujours passer `canonique` lui-même ; si un
 * appelant futur y faisait passer autre chose, la garde le verrait ici.
 *
 * Règle d'échec fermé : tout ce qui est incertain BLOQUE. Un seul chemin rend
 * `ALLOW_SUCCESS` : exécution prouvée + relecture prouvée + correspondance
 * totale. Tout le reste — y compris l'inconnu — bloque.
 */

export type RaisonBlocage =
  | "MISMATCH_ACTION"
  | "MISMATCH_PATIENT"
  | "MISMATCH_ARGS"
  | "NOT_EXECUTED"
  | "NOT_VERIFIED"
  | "DUPLICATE"
  | "MALFORMED";

export type IssueGarde =
  | { readonly verdict: "ALLOW_SUCCESS" }
  | { readonly verdict: "BLOCK"; readonly reason: RaisonBlocage };

export interface EntreeGarde {
  /** Identifiant de la ligne `app.jarvis_actions`. Vide = malformé. */
  readonly actionId: string;
  /** Ce que la ligne persistée dit : outil + arguments persistés. */
  readonly canonique: { readonly outil: string; readonly args: unknown };
  /** Ce qui a EFFECTIVEMENT été passé au `verifier`. */
  readonly verifieAvec: { readonly outil: string; readonly args: unknown };
  /**
   * `ok` = la porte a rendu un identifiant affecté (seul chemin non-levé et
   * non-NULL de `execute_jarvis_action`, donc ligne passée en `executed`).
   * `dejaExecutee` = cette session a déjà mené cette action au succès : un
   * nouvel appel ne peut être qu'un doublon, jamais une seconde exécution
   * (la base l'aurait de toute façon refusé par machine d'état).
   */
  readonly execution: {
    readonly ok: boolean;
    readonly affecteId: string | null;
    readonly dejaExecutee?: boolean;
  };
  /** `ok` = le `verifier` de la capacité a relu l'effet demandé. */
  readonly verification: { readonly ok: boolean };
}

/**
 * Clés d'identifiants patient/contexte, dans les deux conventions du dépôt
 * (`camelCase` en TypeScript, `snake_case` en base). Une divergence limitée à
 * ces clés désigne un AUTRE dossier/contexte : c'est `MISMATCH_PATIENT`, pas
 * un simple désaccord d'arguments.
 */
const CLES_PATIENT_CONTEXTE: ReadonlySet<string> = new Set([
  "patientId",
  "patient_id",
  "consultationId",
  "consultation_id",
  "appointmentId",
  "appointment_id",
  "paymentId",
  "payment_id",
  "practitionerId",
  "practitioner_id",
  "conversationId",
  "conversation_id",
]);

function estObjetSimple(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === "object" && valeur !== null && !Array.isArray(valeur);
}

/**
 * Chemins-feuilles où `a` et `b` diffèrent (`"dates.0"`, `"montantDzd"`…).
 * Tableaux comparés indice par indice ; tout le reste par `===` strict —
 * aucune tolérance de fuseau ici : les deux côtés portent la même valeur
 * quand le chemin partagé est utilisé, et la comparaison d'instants
 * (fuseaux équivalents) vit déjà dans chaque `verifier`.
 */
function cheminsDifferents(a: unknown, b: unknown, prefixe: string): string[] {
  if (a === b) return [];
  if (estObjetSimple(a) && estObjetSimple(b)) {
    const cles = new Set([...Object.keys(a), ...Object.keys(b)]);
    const sorties: string[] = [];
    for (const cle of cles) {
      const chemin = prefixe === "" ? cle : `${prefixe}.${cle}`;
      sorties.push(...cheminsDifferents(a[cle], b[cle], chemin));
    }
    return sorties;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const sorties: string[] = [];
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      sorties.push(...cheminsDifferents(a[i], b[i], `${prefixe}.${i}`));
    }
    return sorties;
  }
  return [prefixe];
}

function feuille(chemin: string): string {
  const i = chemin.lastIndexOf(".");
  return i === -1 ? chemin : chemin.slice(i + 1);
}

export function garderReponse(entree: EntreeGarde): IssueGarde {
  // 0 · Forme de l'entrée. Une garde nourrie de vide ne peut rien établir.
  if (typeof entree.actionId !== "string" || entree.actionId === "") {
    return { verdict: "BLOCK", reason: "MALFORMED" };
  }
  if (
    typeof entree.canonique.outil !== "string" ||
    entree.canonique.outil === "" ||
    typeof entree.verifieAvec.outil !== "string" ||
    entree.verifieAvec.outil === ""
  ) {
    return { verdict: "BLOCK", reason: "MALFORMED" };
  }
  // Des arguments persistés qui ne sont pas un objet ne peuvent être ni
  // vérifiés ni comparés : la porte les a refusés en `failed`, et aucun
  // succès ne peut en sortir.
  if (!estObjetSimple(entree.canonique.args)) {
    return { verdict: "BLOCK", reason: "MALFORMED" };
  }

  // 1 · Doublon connu de cette session : la base a déjà tranché, ce second
  // constat ne peut pas être un succès — même si, par impossible, la porte
  // avait rendu quelque chose.
  if (entree.execution.dejaExecutee === true) {
    return { verdict: "BLOCK", reason: "DUPLICATE" };
  }

  // 2 · Pas d'exécution prouvée → pas de succès. Couvre : porte en `failed`,
  // refus RLS (NULL), rejet, absence de confirmation, erreur réseau.
  if (!entree.execution.ok) {
    return { verdict: "BLOCK", reason: "NOT_EXECUTED" };
  }

  // 3 · Exécution « ok » sans entité affectée : l'effet est introuvable.
  // C'est l'oracle que `executerAction` refuse déjà — la garde le refuse une
  // seconde fois, au cas où un futur appelant oublierait.
  if (
    typeof entree.execution.affecteId !== "string" ||
    entree.execution.affecteId === ""
  ) {
    return { verdict: "BLOCK", reason: "NOT_EXECUTED" };
  }

  // 4 · Pas de relecture prouvée → pas de succès. « La porte n'a pas levé »
  // prouve que quelque chose a été touché, pas que c'est CE QUI ÉTAIT DEMANDÉ.
  if (!entree.verification.ok) {
    return { verdict: "BLOCK", reason: "NOT_VERIFIED" };
  }

  // 5 · L'outil relu n'est pas celui de l'action : on a approuvé A, vérifié B.
  if (entree.verifieAvec.outil !== entree.canonique.outil) {
    return { verdict: "BLOCK", reason: "MISMATCH_ACTION" };
  }

  // 6 · Les arguments relus ne sont pas ceux de l'action. Divergences
  // limitées aux identifiants patient/contexte → MISMATCH_PATIENT (un
  // rendez-vous à la bonne heure POUR LE MAUVAIS PATIENT est pire qu'un
  // échec) ; tout le reste → MISMATCH_ARGS.
  const differents = cheminsDifferents(
    entree.canonique.args,
    entree.verifieAvec.args,
    "",
  );
  if (differents.length > 0) {
    const toutPatient = differents.every((c) =>
      CLES_PATIENT_CONTEXTE.has(feuille(c)),
    );
    return {
      verdict: "BLOCK",
      reason: toutPatient ? "MISMATCH_PATIENT" : "MISMATCH_ARGS",
    };
  }

  return { verdict: "ALLOW_SUCCESS" };
}
