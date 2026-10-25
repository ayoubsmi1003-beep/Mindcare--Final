/**
 * Logique pure du cockpit — aucune écriture, aucun appel, aucun DOM.
 *
 * Ce module ne connaît ni les portes ni les composants : il calcule le sens
 * d'un delta d'échelle, applique un marqueur de focus et insère une piste de
 * texte. L'écriture passe ensuite par `saveNote`, jamais par ici.
 */

import type { EchelleResume } from "@/services/patients";

/**
 * Sens FACTUEL d'un delta, sans jugement clinique : la polarité d'une
 * échelle (haut = mieux ou pire) n'est pas connue ici, donc `hausse` ne
 * veut jamais dire « amélioration ».
 */
export type SensDelta = "hausse" | "baisse" | "stable" | "aucune";

export function sensDelta(echelle: EchelleResume): SensDelta {
  if (echelle.precedent === null || echelle.delta === null) return "aucune";
  if (echelle.delta > 0) return "hausse";
  if (echelle.delta < 0) return "baisse";
  return "stable";
}

/** Valeur signée (`+2`, `−3`, `0`), `null` quand rien n'est comparable. */
export function texteDelta(delta: number | null): string | null {
  if (delta === null) return null;
  if (delta > 0) return `+${String(delta)}`;
  // Moins typographique U+2212, pas le trait d'union : un score négatif se
  // lit, il ne se devine pas.
  if (delta < 0) return `−${String(Math.abs(delta))}`;
  return "0";
}

/**
 * Phrase recopiée dans Objectif quand la praticienne choisit « Inscrire ».
 *
 * ⚠️ LA DATE EST OBLIGATOIRE. Un score d'août recopié sans date dans la note
 * du jour se lit comme une mesure d'aujourd'hui : c'est une falsification
 * involontaire du dossier. Le score et l'interprétation sont ceux du dossier,
 * jamais recalculés ici.
 */
export function phraseEchelleDatee(echelle: EchelleResume, date: string): string {
  const score = echelle.dernier.score === null ? "" : ` ${String(echelle.dernier.score)}`;
  const lecture =
    echelle.dernier.interpretation === null ? "" : ` (${echelle.dernier.interpretation})`;
  return `${echelle.scaleName} (${date}) :${score}${lecture}`;
}

/** Nombre de rubriques SOAP réellement remplies, pour la barre de séance. */
export function progressionNote(soap: Readonly<Record<string, string>>): number {
  return ["subjective", "objective", "assessment", "plan"].filter(
    (champ) => (soap[champ] ?? "").trim() !== "",
  ).length;
}

/**
 * Préfixe `Focus : a, b — ` au subjectif. Idempotent : un marqueur existant
 * est remplacé, jamais empilé. Sélection vide = texte inchangé (on ne
 * retire jamais une formulation du médecin par effet de bord).
 */
export function appliquerFocus(texte: string, selection: readonly string[]): string {
  if (selection.length === 0) return texte;
  const marqueur = `Focus : ${selection.join(", ")} — `;
  if (/^Focus\s*:/.test(texte)) return texte.replace(/^Focus\s*:[^\n]*—\s?/, marqueur);
  return marqueur + texte;
}

/**
 * Ajoute une piste à la ligne sous le texte existant. Second clic sans
 * effet : pas de doublon au double-clic.
 */
export function ajouterPiste(texte: string, piste: string): string {
  if (texte.trim() === "") return piste;
  if (texte.includes(piste)) return texte;
  return `${texte.trimEnd()}\n• ${piste}`;
}
