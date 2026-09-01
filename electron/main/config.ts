/**
 * Constantes partagées du processus principal — étape 1 du plan Electron.
 *
 * Le port applicatif est FIXE (règle 12 de la mission : ne jamais dépendre
 * d'un glissement de port Next). `garde-origine.mjs` refuse déjà de démarrer
 * si ce port est occupé — Electron hérite de cette garantie en lançant
 * `next dev`/`next start` avec la même variable `PORT`.
 */
export const PORT_BACKEND = 43117;

/**
 * En développement, `scripts/dev-electron.mjs` pose cette variable une fois
 * le serveur Next confirmé prêt (voir garde-origine + verifier-base), et le
 * processus principal ne la lit qu'à ce moment — jamais de sonde par
 * `setTimeout` arbitraire ici (règle 13 de la mission).
 */
export function urlDepart(): string {
  return process.env["MINDCARE_START_URL"] ?? `http://127.0.0.1:${PORT_BACKEND}`;
}

export const EST_PACKAGE = process.env["MINDCARE_ELECTRON_ENV"] === "production";
