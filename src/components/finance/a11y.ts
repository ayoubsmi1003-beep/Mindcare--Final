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
 *
 * ⚠️ À POSER SUR UN `<div>` ENVELOPPE, JAMAIS DIRECTEMENT SUR UN `<table>`.
 * MESURÉ : sur un élément `display: table`, `height` est traité par CSS comme
 * un MINIMUM, pas comme un maximum — `h-px` ne réduit donc rien, et
 * `overflow: hidden` ne s'applique pas davantage. Le tableau équivalent du
 * calendrier (31 lignes) mesurait ainsi 856 px de haut et rallongeait `<html>`
 * de 761 px : la page défilait alors que `<main>` ne débordait pas, et la
 * cause était invisible dans le rendu — le tableau est visuellement caché.
 * Enveloppé dans un `<div>`, tout rentre dans le pixel prévu.
 */
export const CACHE_VISUELLEMENT = "cache-visuellement";
