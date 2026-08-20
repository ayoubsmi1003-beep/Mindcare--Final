/**
 * Le texte réservé au lecteur d'écran — visible pour lui, invisible à l'œil.
 *
 * ⚠️ PAS `hidden`, PAS `display:none`, PAS `visibility:hidden`. Les trois
 * retirent l'élément de l'ARBRE D'ACCESSIBILITÉ : un lecteur d'écran ne les
 * annonce pas. C'est l'écart exact que `AppShell` documente déjà pour les
 * libellés du rail replié — « le texte sort du flux visuel et reste annoncé ».
 * On reprend ici le même motif, nommé une fois, au lieu de le recopier dans
 * chaque graphique.
 *
 * ⚠️ PAS `sr-only` NON PLUS, et c'est délibéré : `tailwind.config.ts` REMPLACE
 * les échelles de Tailwind au lieu de les étendre. S'appuyer sur un utilitaire
 * du cœur dont on n'a pas vérifié la survie, c'est reproduire l'affaire de
 * `min-h-0` — une classe qui n'existe pas ne produit aucune règle, en silence,
 * sans avertissement de build. Ici, chaque déclaration est écrite.
 *
 * `clip-path` plutôt que `overflow:hidden` seul : un texte de plusieurs lignes
 * réduit à 1px déborderait sinon d'un pixel visible en haut de page.
 */
export const CACHE_VISUELLEMENT =
  "absolute h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)]";
