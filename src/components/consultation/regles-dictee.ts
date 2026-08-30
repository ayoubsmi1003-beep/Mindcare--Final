/**
 * `regles-dictee.ts` — QUI ÉCOUTE, QUI REÇOIT, ET QUI RESTE INERTE.
 *
 * Ces trois questions décident où atterrit une parole. Elles vivent ici, en
 * fonctions pures, PARCE QU'ELLES SONT VÉRIFIABLES : une erreur de routage ne
 * se voit pas à l'écran — le texte apparaît quelque part, l'interface a l'air
 * de fonctionner, et c'est la note clinique qui est fausse. C'est exactement le
 * genre de défaut qu'une relecture ne rattrape pas et qu'un test attrape.
 *
 * ⚠️ UN SEUL ENREGISTREMENT À LA FOIS, PAR CONSTRUCTION. `jarvis-voix.ts` tient
 * un `dictee` unique et le micro vient d'un courtier à compteur de références :
 * deux dictées simultanées n'existent pas. Ces règles rendent ce fait VISIBLE
 * (les autres micros sont inertes) au lieu de le laisser se découvrir par un
 * échec au milieu d'une consultation.
 */

/** `repos` → `ecoute` → `transcription` → `repos`. Aucun autre chemin. */
export type PhaseDictee = "repos" | "ecoute" | "transcription";

export interface EtatDictee<C extends string> {
  /** Le champ en cours de dictée, ou `null` au repos. */
  readonly cible: C | null;
  readonly phase: PhaseDictee;
}

export const DICTEE_AU_REPOS = { cible: null, phase: "repos" } as const;

/**
 * Ce que produit une pression sur le micro du champ `demande`.
 *
 * `ignorer` n'est pas un trou : c'est le refus explicite de deux gestes qui
 * seraient ambigus — presser pendant qu'une transcription revient, et presser
 * le micro d'un AUTRE champ pendant qu'un premier écoute. Dans ce second cas,
 * « basculer » aurait deux lectures possibles (arrêter l'un ? démarrer
 * l'autre ?) et le texte serait rendu à l'un ou à l'autre selon une règle
 * qu'aucune praticienne ne peut deviner. On ne devine pas : le bouton est
 * inerte, et il le montre.
 */
export function actionMicro<C extends string>(
  etat: EtatDictee<C>,
  demande: C,
): "demarrer" | "arreter" | "ignorer" {
  if (etat.phase === "transcription") return "ignorer";
  if (etat.phase === "ecoute") return etat.cible === demande ? "arreter" : "ignorer";
  return "demarrer";
}

/** Le micro de `champ` doit-il être hors service ? */
export function microInerte<C extends string>(etat: EtatDictee<C>, champ: C): boolean {
  return actionMicro(etat, champ) === "ignorer";
}

/**
 * La cible qui recevra le texte d'une transcription démarrée sur `demarree`.
 *
 * ⚠️ C'EST LA CIBLE DU DÉPART, TOUJOURS. La transcription revient plusieurs
 * secondes après le geste, souvent après que le focus a bougé — relire l'état
 * courant à l'arrivée écrirait le Subjectif dans la Conduite à tenir sans que
 * rien ne le signale. Cette fonction existe pour que la règle soit nommée et
 * testée plutôt qu'implicite dans une fermeture.
 */
export function cibleDeRestitution<C extends string>(demarree: C, _courante: C | null): C {
  void _courante;
  return demarree;
}
