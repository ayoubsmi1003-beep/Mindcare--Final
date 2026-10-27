/**
 * Lecture automatique des réponses texte d'Alexa — spécification du
 * 2026-10-24 (`docs/superpowers/specs/2026-10-24-alexa-voice-design.md`
 * §2.4, §5, §5b).
 *
 * GLOBALE : chaque réponse texte se lit, mains-libres ON comme OFF.
 * Règles conservées :
 * · le corps de réponse seul est lisible (preuves, sources, cartes,
 *   statuts, erreurs et interruptions exclus — décidé par l'appelant via
 *   le texte qu'il passe, comme la lecture manuelle par bulle) ;
 * · la voix est locale: un texte à identité est lu comme les autres, sans
 *   franchir de fournisseur tiers ;
 * · jamais de lecture d'historique au chargement : seules les réponses
 *   arrivées APRÈS le montage sont candidates ;
 * · toute nouvelle demande coupe la lecture en cours (appelant : sur
 *   `envoi`, via `arreterLecture`) ;
 * · préférence muette persistée en `localStorage` (pas clinique, OK),
 *   défaut ON (réponse toujours à voix haute, demande du 2026-10-25).
 */

export interface CandidatLectureAuto {
  readonly id: string;
  readonly role: "humain" | "jarvis" | "systeme";
  readonly texte: string;
  readonly porteUneIdentite?: boolean;
  readonly interrompu?: boolean;
  /** Statut terminal du tour natif : seul `completed` est lisible. */
  readonly alexaStatus?: string;
  /** A voice loop already spoke this turn; the UI must not play it twice. */
  readonly dejaParlee?: boolean;
}

const CLE_PREFERENCE = "mindcare.alexa.lecture-auto";
const abonnesPreference = new Set<(active: boolean) => void>();

/** Préférence persistée. Défaut ON : Alexa répond toujours à voix haute. */
export function lirePreferenceLectureAuto(): boolean {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return true;
  try {
    return window.localStorage.getItem(CLE_PREFERENCE) !== "0";
  } catch {
    return true;
  }
}

export function definirPreferenceLectureAuto(active: boolean): void {
  if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
    try {
      window.localStorage.setItem(CLE_PREFERENCE, active ? "1" : "0");
    } catch {
      // Préférence seule : un stockage indisponible ne bloque pas la lecture.
    }
  }
  for (const abonne of abonnesPreference) abonne(active);
}

/**
 * Le lecteur global vit dans `BootVoix`, le bouton muet dans `FilJarvis` :
 * sans abonnement, couper le son dans le panneau laisserait le lecteur global
 * parler. Le fait est publié, pas supposé.
 */
export function abonnerPreferenceLectureAuto(abonne: (active: boolean) => void): () => void {
  abonnesPreference.add(abonne);
  abonne(lirePreferenceLectureAuto());
  return () => {
    abonnesPreference.delete(abonne);
  };
}

/**
 * La réponse est-elle candidate à la lecture automatique ?
 * Pur et synchrone — testé sans micro ni réseau.
 */
export function fautLireAuto(
  tour: CandidatLectureAuto,
  opts: { readonly lectureAuto: boolean; readonly dejaLu: boolean; readonly conversationChargee: boolean },
): boolean {
  if (!opts.lectureAuto) return false;
  if (opts.dejaLu) return false;
  // Jamais d'historique au chargement : seules les réponses arrivées après
  // le montage du fil sont lues.
  if (!opts.conversationChargee) return false;
  if (tour.role !== "jarvis") return false;
  if (tour.interrompu === true) return false;
  // Un tour partiel / en attente / échoué n'est pas une réponse complète.
  // `conversation.ts` porte le statut terminal ; on ne le devine pas.
  if (tour.alexaStatus !== undefined && tour.alexaStatus !== "completed") return false;
  if (tour.dejaParlee === true) return false;
  // La synthèse est locale: un nom de dossier ne franchit plus de frontière
  // fournisseur. Il n'y a donc plus de raison de rendre la réponse muette.
  // Une réponse longue n'est plus tue non plus : `lireTexteLong` la découpe.
  const texte = tour.texte.trim();
  if (texte === "") return false;
  return true;
}

/**
 * Le dernier tour Jarvis qui n'appartient PAS à l'historique chargé et qui n'a
 * pas encore été lu. L'historique est identifié par ses IDs — jamais par le
 * moment où le chargement se termine : une réponse tapée pendant la requête
 * d'historique reste donc lisible.
 */
export function choisirTourAuto(
  tours: readonly CandidatLectureAuto[],
  idsHistoriques: ReadonlySet<string>,
  idsLus: ReadonlySet<string>,
  opts: { readonly lectureAuto: boolean; readonly conversationChargee: boolean },
): CandidatLectureAuto | null {
  for (let index = tours.length - 1; index >= 0; index -= 1) {
    const tour = tours[index];
    if (tour === undefined) continue;
    if (idsHistoriques.has(tour.id) || idsLus.has(tour.id)) continue;
    if (!fautLireAuto(tour, {
      lectureAuto: opts.lectureAuto,
      dejaLu: false,
      conversationChargee: opts.conversationChargee,
    })) continue;
    return tour;
  }
  return null;
}
