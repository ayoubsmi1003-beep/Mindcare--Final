/**
 * Statistiques — les fonctions PURES de l'écran.
 *
 * ⚠️ AUCUNE ARITHMÉTIQUE MÉTIER. Ces fonctions ne comptent rien : elles
 * formattent, nomment et calculent des GÉOMÉTRIES (hauteur d'une barre,
 * position d'une infobulle). Les totaux, les parts et les fenêtres viennent de
 * Postgres. La frontière est la même que celle de `Graphes.tsx` : un nombre
 * affiché ne doit pas pouvoir naître ici.
 *
 * Pourquoi un fichier séparé : ces règles sont testables sans DOM, et deux
 * écrans qui formatent la même période de deux façons finissent par se
 * contredire.
 */

const NOMBRE = new Intl.NumberFormat("fr-FR");
const DATE_COURTE = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" });
const DATE_LONGUE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const MOIS_COURT = new Intl.DateTimeFormat("fr-FR", { month: "short" });
const MOIS_LONG = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const HEURE = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

export type Granularite = "jour" | "semaine" | "mois";

/** « 1 558 », jamais « 1558 ». Le groupement est celui de la locale. */
export function formaterNombre(valeur: number): string {
  return NOMBRE.format(valeur);
}

/** « 29 oct. 2026 » — pour les bornes de période. */
export function formaterDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : DATE_LONGUE.format(d);
}

/** « 29/10 » — pour l'infobulle d'un seau journalier. */
export function formaterDateCourte(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : DATE_COURTE.format(d);
}

/** « 14:30 » — pour un événement horodaté. */
export function formaterHeure(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : HEURE.format(d);
}

/**
 * Le libellé d'un seau temporel.
 *
 * ⚠️ UN SEUIL, PAS UNE MOYENNE. Un seau hebdomadaire affiche « S44 » et le
 * mois « oct. 26 » : deux seaux de granularités différentes ne doivent jamais
 * porter le même libellé, sinon une infobulle ment sur ce qu'elle décrit.
 */
export function libelleSeau(iso: string, granularite: Granularite): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  if (granularite === "jour") return DATE_COURTE.format(d);
  if (granularite === "semaine") return `S${numeroSemaineIso(d)}`;
  return `${MOIS_COURT.format(d).replace(".", "")} ${String(d.getUTCFullYear()).slice(2)}`;
}

/** Numéro de semaine ISO 8601 (lundi premier jour, semaine 1 = 4 janvier). */
export function numeroSemaineIso(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const jour = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - jour);
  const debutAnnee = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - debutAnnee.getTime()) / 86_400_000 + 1) / 7);
}

/** Le titre long d'un seau, pour l'infobulle. Jamais un libellé d'axe. */
export function titreSeau(iso: string, granularite: Granularite): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  if (granularite === "jour") return DATE_LONGUE.format(d);
  if (granularite === "semaine") return `Semaine du ${DATE_COURTE.format(d)}`;
  return MOIS_LONG.format(d);
}

/**
 * L'écart à la période précédente.
 *
 * ⚠️ `pct: null` QUAND LE DÉNOMINATEUR EST NUL. Un « +100 % » calculé sur zéro
 * séance n'est pas une croissance, c'est une division par zéro déguisée. Et
 * `pct: null` quand le précédent est absent, pas quand il vaut zéro mesuré :
 * les deux se distinguent par `precedent === null`.
 */
export function ecart(
  courant: number,
  precedent: number | null,
): { readonly absolu: number; readonly pct: number | null } {
  if (precedent === null) return { absolu: 0, pct: null };
  const absolu = courant - precedent;
  if (precedent === 0) return { absolu, pct: null };
  return { absolu, pct: Math.round((absolu * 1000) / precedent) / 10 };
}

/** « +12,4 % » / « −3 % » / « — ». Le signe typographique, pas le trait d'union. */
export function formaterEcart(pct: number | null): string {
  if (pct === null) return "—";
  const signe = pct > 0 ? "+" : pct < 0 ? "−" : "";
  const valeur = Math.abs(pct);
  return `${signe}${valeur.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

/**
 * Position d'une valeur sur une échelle [0, max] — GÉOMÉTRIE seulement.
 * `null` (valeur absente) rend `null`, jamais 0 : un trou n'est pas un plancher.
 */
export function positionRelative(valeur: number | null, max: number): number | null {
  if (valeur === null) return null;
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (valeur * 100) / max));
}

/** Le plafond « lisible » d'un axe : arrondi au pas supérieur, jamais 0. */
export function plafondLisible(max: number): number {
  if (max <= 0) return 1;
  if (max <= 5) return max;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const pas = magnitude / 2;
  return Math.ceil(max / pas) * pas;
}

/** Les indices à étiqueter sur un axe, sans jamais dépasser `maximum`. */
export function indicesEtiquettes(total: number, maximum: number): number[] {
  if (total <= 0) return [];
  const combien = Math.min(maximum, total);
  if (combien === 1) return [0];
  const pas = (total - 1) / (combien - 1);
  return Array.from({ length: combien }, (_, i) => Math.round(i * pas));
}

/**
 * Le point actif le plus proche d'une position horizontale.
 * Sert au survol ET au clavier : une seule règle, donc un seul comportement.
 */
export function indexLePlusProche(x: number, largeur: number, total: number): number {
  if (total <= 0 || largeur <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, x / largeur));
  return Math.min(total - 1, Math.round(ratio * (total - 1)));
}
