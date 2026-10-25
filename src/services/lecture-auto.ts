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
 * · un texte à identité (`porteUneIdentite`) n'est JAMAIS envoyé au TTS
 *   tiers — refus silencieux ici, motif affiché par l'appelant existant ;
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
}

const CLE_PREFERENCE = "mindcare.alexa.lecture-auto";

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
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    window.localStorage.setItem(CLE_PREFERENCE, active ? "1" : "0");
  } catch {
    // Préférence seule : un stockage indisponible ne bloque pas la lecture.
  }
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
  // Identité : refus inchangé — aucun nom de dossier vers le TTS tiers.
  if (tour.porteUneIdentite === true) return false;
  const texte = tour.texte.trim();
  if (texte === "" || texte.length > 2000) return false;
  return true;
}
