/**
 * `apres-seance.ts` — CE QUI SE PASSE APRÈS LA CLÔTURE, ET CE QUI NE DOIT
 * JAMAIS EN DÉPENDRE.
 *
 * ═══ LA CHAÎNE ═══
 *
 *   clôture réussie ──▶ l'écran est rendu à la praticienne IMMÉDIATEMENT
 *                        │  (en tâche de fond, dans cet ordre)
 *                        ├─ analyse de la séance      → persistée (067)
 *                        └─ résumé du cas             → nouvelle version (053)
 *
 * ═══ LA RÈGLE QUI GOUVERNE TOUT CE FICHIER ═══
 *
 * ⚠️ AUCUNE PANNE D'IA NE DOIT TOUCHER LA DOCUMENTATION CLINIQUE. La
 * consultation est close AVANT que quoi que ce soit d'autre ne commence, par
 * un appel qui a déjà rendu son verdict. Rien ici ne peut la défaire, la
 * retarder, ni faire croire qu'elle a échoué. Si le fournisseur est
 * injoignable, la séance reste close, les notes restent écrites, et les deux
 * étapes se relancent plus tard — c'est tout.
 *
 * C'est pourquoi ce module ne LÈVE JAMAIS et ne rend jamais d'erreur : il
 * rapporte un ÉTAT. Un appelant qui l'oublierait ne pourrait pas casser une
 * clôture avec un `await` mal placé.
 *
 * ═══ POURQUOI SÉQUENTIEL, ET PAS EN PARALLÈLE ═══
 *
 * Le résumé du cas CONSOMME l'analyse (elle lui arrive par
 * `get_recent_session_analyses`). Les lancer ensemble ferait générer le résumé
 * sur l'état d'AVANT la séance qu'on vient de clore : un résumé « à jour » qui
 * ignore la dernière consultation est pire qu'un résumé visiblement périmé.
 * L'ordre n'est donc pas une préférence, c'est une dépendance de données.
 *
 * ═══ POURQUOI AUCUNE RELANCE AUTOMATIQUE ═══
 *
 * La passerelle réessaie déjà UNE fois le transitoire (`external-call.ts`).
 * Boucler ici multiplierait des appels payants sur un fournisseur qui vient de
 * dire non, sans que personne ne l'ait demandé. La reprise est un GESTE :
 * l'écran dit ce qui manque, la praticienne relance si elle le veut.
 */

import { analyzeSession } from "./jarvis";
import { log } from "./log";
import { err, type Result } from "./result";
import { genererResumeCas } from "./resume-cas";

/**
 * Exécute une étape en garantissant qu'elle NE LÈVE PAS.
 *
 * ⚠️ SANS CE FILET, LA GARANTIE DE L'EN-TÊTE SERAIT FAUSSE. Les services
 * rendent un `Result` et n'ont pas vocation à rejeter — mais « n'a pas vocation
 * à » n'est pas « ne peut pas » : une coupure réseau au mauvais moment, une
 * exception dans une couche transport, et la promesse rejette. Un appelant qui
 * aurait écrit `await` verrait alors sa CLÔTURE échouer à cause d'un appel de
 * modèle. Un commentaire qui promet plus que le code est pire qu'un silence :
 * il empêche la relecture suivante de voir le trou.
 */
async function sansLever<T>(
  etape: () => Promise<Result<T>>,
  message: string,
): Promise<Result<T>> {
  try {
    return await etape();
  } catch (cause) {
    log.error("apresSeance.exception", { context: cause instanceof Error ? cause.name : "inconnu" });
    return err({ code: "indisponible", message });
  }
}

/**
 * L'état d'une étape. `ignoree` n'est pas `echouee` : le résumé n'est pas
 * tenté quand l'analyse a échoué, parce qu'il lui manquerait sa source — ce
 * n'est pas une panne du résumé, et le dire autrement enverrait chercher un
 * défaut là où il n'y en a pas.
 */
export type EtatEtape = "attente" | "en-cours" | "faite" | "echouee" | "ignoree";

export interface SuiviApresSeance {
  readonly analyse: EtatEtape;
  readonly resume: EtatEtape;
  /** Message français prêt à afficher, ou `null` si tout s'est bien passé. */
  readonly message: string | null;
}

const DEPART: SuiviApresSeance = { analyse: "attente", resume: "attente", message: null };

/**
 * Enchaîne analyse puis résumé après une clôture RÉUSSIE.
 *
 * `surAvancement` est appelé à chaque changement d'état pour que l'écran
 * montre ce qui se passe. Ne rend jamais d'erreur : l'état EST le résultat.
 *
 * @param consultationId la séance qui vient d'être close
 * @param patientId      son patient — `null` si inconnu, l'enchaînement est
 *                       alors sans objet et rendu tel quel
 */
export async function enchainerApresSeance(
  consultationId: string,
  patientId: string | null,
  surAvancement: (suivi: SuiviApresSeance) => void = () => undefined,
): Promise<SuiviApresSeance> {
  let suivi = DEPART;
  const avancer = (partiel: Partial<SuiviApresSeance>): void => {
    suivi = { ...suivi, ...partiel };
    surAvancement(suivi);
  };

  if (patientId === null) {
    avancer({ analyse: "ignoree", resume: "ignoree" });
    return suivi;
  }

  // ── 1 · L'analyse de la séance ──────────────────────────────────────────
  avancer({ analyse: "en-cours" });
  const analyse = await sansLever(
    () => analyzeSession(consultationId),
    "L'analyse n'a pas pu être générée.",
  );
  if (!analyse.ok) {
    // ⚠️ PAS DE RÉSUMÉ SANS ANALYSE. Le générer quand même produirait une
    // version qui ignore la séance qu'on vient de clore, tout en s'affichant
    // comme la plus récente : une fausse fraîcheur, plus trompeuse qu'un
    // manque assumé.
    log.warn("apresSeance.analyse", { code: analyse.error.code });
    avancer({ analyse: "echouee", resume: "ignoree", message: analyse.error.message });
    return suivi;
  }
  // Analyse produite mais NON RANGÉE : la séance suivante ne la retrouvera
  // pas, et le résumé ne peut pas s'appuyer dessus. On le dit.
  avancer({ analyse: analyse.data.persistee ? "faite" : "echouee" });

  // ── 2 · Le résumé du cas ────────────────────────────────────────────────
  avancer({ resume: "en-cours" });
  const resume = await sansLever(
    () => genererResumeCas(patientId),
    "Le résumé du cas n'a pas pu être mis à jour.",
  );
  if (!resume.ok) {
    // La version précédente reste affichée, et la base la marque « pas à
    // jour » d'elle-même : on ne fabrique pas cet état côté écran.
    log.warn("apresSeance.resume", { code: resume.error.code });
    avancer({ resume: "echouee", message: resume.error.message });
    return suivi;
  }

  avancer({ resume: "faite" });
  return suivi;
}
