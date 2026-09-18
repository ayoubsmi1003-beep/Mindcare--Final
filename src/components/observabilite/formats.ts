/**
 * `formats.ts` — M09 écran d'observabilité · formats purs (sans DOM, sans React).
 *
 * Séparés du panneau pour rester testables en `vitest run` (node) : les
 * modules tsx ne s'y importent pas (transform JSX sans React en portée).
 * Les agrégats eux-mêmes sont calculés en base ; ici, seul l'affichage.
 */

/** Durée affichable en français (virgule décimale, jamais de flottant brut). */
export function formaterDuree(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${String(ms)} ms`;
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

/** Date affichable (fuseau cabinet, même idiome que l'agenda). */
export function formaterDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-DZ");
}

/** Identifiant technique tronqué (complet en infobulle, jamais en log). */
export function court(id: string): string {
  return id.slice(0, 8);
}
