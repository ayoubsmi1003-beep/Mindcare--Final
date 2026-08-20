/**
 * Le calendrier du cabinet — arithmétique de dates civiles, en Africa/Algiers.
 *
 * ⚠️ CE MODULE N'IMPORTE RIEN. Ni `DbPort`, ni i18n, ni React. C'est délibéré :
 * ce sont les seules fonctions de la finance qu'on peut éprouver SANS base et
 * SANS navigateur, donc les seules qu'un test unitaire peut couvrir dans un
 * dépôt qui n'a aucun lanceur de tests installé (`package.json` : ni vitest, ni
 * jest — et en ajouter un est une décision de dépôt, pas un effet de bord d'un
 * lot finance).
 *
 * `scripts/test-finance-calendrier.mjs` les compile avec le `tsc` déjà présent
 * et les exécute. Séparer ce fichier de `finance-periode.ts` est ce qui rend
 * cette compilation possible : l'autre module tire `supabase-js` par `db()`.
 *
 * ⚠️ POURQUOI PAS `toISOString()`, NULLE PART.
 * Il bascule en UTC. À Alger (UTC+1), un soir après 23 h, la date UTC est déjà
 * celle du lendemain : « aujourd'hui » désignerait la mauvaise journée une
 * heure par nuit, sur l'écran qui sert à compter l'argent. C'est le défaut que
 * `jourLocal()` évitait déjà dans l'écran des finances, remonté ici pour que
 * toute la page parle du même calendrier que les portes SQL.
 */

/**
 * Le fuseau est écrit en dur ICI comme il l'est dans les portes 029 et 036, et
 * pour la même raison : le cabinet est à Alger et ADR-001 ne prévoit pas de
 * second site. Le jour où il y en aurait un, il se lirait sur `app.cabinets` —
 * aux trois endroits, en même temps.
 */
const FUSEAU_CABINET = "Africa/Algiers";

/** Une date civile `AAAA-MM-JJ`, telle qu'elle se lit AU CABINET. */
export function aujourdHuiCabinet(maintenant: Date = new Date()): string {
  // `en-CA` rend nativement `AAAA-MM-JJ` : on ne recompose pas la chaîne à la
  // main, donc aucun `padStart` ne peut se tromper.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSEAU_CABINET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(maintenant);
}

/**
 * Arithmétique de calendrier, en UTC DÉLIBÉRÉMENT.
 *
 * Une date civile n'a pas d'heure ; la manipuler avec un `Date` local ferait
 * intervenir l'heure d'été du poste et pourrait décaler d'un jour. On projette
 * donc le triplet (année, mois, jour) sur minuit UTC — où aucun changement
 * d'heure n'existe — et on ne s'en sert QUE pour compter des jours.
 */
function versUtc(date: string): number {
  const [a, m, j] = date.split("-").map(Number);
  return Date.UTC(a ?? 1970, (m ?? 1) - 1, j ?? 1);
}

function depuisUtc(ms: number): string {
  const d = new Date(ms);
  const a = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const j = String(d.getUTCDate()).padStart(2, "0");
  return `${a}-${m}-${j}`;
}

const JOUR_MS = 86_400_000;

export function ajouterJours(date: string, n: number): string {
  return depuisUtc(versUtc(date) + n * JOUR_MS);
}

/** Nombre de jours INCLUSIFS entre deux dates civiles. `du === au` rend 1. */
export function nombreDeJours(du: string, au: string): number {
  return Math.round((versUtc(au) - versUtc(du)) / JOUR_MS) + 1;
}

/** `true` si `a` est antérieure ou égale à `b`. */
export function estAvantOuEgal(a: string, b: string): boolean {
  return versUtc(a) <= versUtc(b);
}

export type NomPeriode = "jour" | "semaine" | "mois" | "annee" | "personnalise";

export interface Periode {
  readonly nom: NomPeriode;
  readonly du: string;
  readonly au: string;
}

/**
 * Les bornes d'une période nommée, en calendrier du cabinet.
 *
 * ⚠️ LES PÉRIODES SONT RENDUES ENTIÈRES, PAS TRONQUÉES À AUJOURD'HUI, et c'est
 * ce qui rend la comparaison juste. « Ce mois », consulté le 10, rend le
 * 1er→31 : la porte 036 compare alors les 10 jours ÉCOULÉS aux 10 PREMIERS
 * jours du mois précédent. Si on tronquait ici au 10, la porte comparerait aux
 * 10 DERNIERS jours du mois précédent — une fenêtre qui ne correspond à rien
 * et qui ferait dire « en baisse » à un mois parfaitement normal.
 *
 * La semaine commence LUNDI (ISO), comme `date_trunc('week')` en Postgres. Les
 * deux doivent s'accorder, sinon le premier seau de la série déborde de la
 * période demandée.
 */
export function bornesDePeriode(
  nom: Exclude<NomPeriode, "personnalise">,
  aujourdHui: string,
): Periode {
  switch (nom) {
    case "jour":
      return { nom, du: aujourdHui, au: aujourdHui };

    case "semaine": {
      // `getUTCDay()` : 0 = dimanche. On ramène à un index ISO où lundi = 0.
      const jourIso = (new Date(versUtc(aujourdHui)).getUTCDay() + 6) % 7;
      const lundi = ajouterJours(aujourdHui, -jourIso);
      return { nom, du: lundi, au: ajouterJours(lundi, 6) };
    }

    case "mois": {
      const [a, m] = aujourdHui.split("-").map(Number);
      const annee = a ?? 1970;
      const mois = m ?? 1;
      // Jour 0 du mois SUIVANT = dernier jour du mois courant. Aucun tableau de
      // longueurs de mois à maintenir, et février bissextile se règle tout seul.
      const dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
      const mm = String(mois).padStart(2, "0");
      return {
        nom,
        du: `${annee}-${mm}-01`,
        au: `${annee}-${mm}-${String(dernier).padStart(2, "0")}`,
      };
    }

    case "annee": {
      const annee = Number(aujourdHui.split("-")[0] ?? 1970);
      return { nom, du: `${annee}-01-01`, au: `${annee}-12-31` };
    }
  }
}

/**
 * La plage maximale acceptée. La porte 036 refuse au-delà de 366 jours d'écart
 * (soit 367 jours inclusifs) — c'est ELLE qui décide ; cette constante n'existe
 * que pour refuser AVANT l'aller-retour, par politesse d'interface.
 */
export const PLAGE_MAX_JOURS = 367;

export function periodeEstValide(du: string, au: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(du) || !/^\d{4}-\d{2}-\d{2}$/.test(au)) return false;
  const n = nombreDeJours(du, au);
  return Number.isFinite(n) && n >= 1 && n <= PLAGE_MAX_JOURS;
}
