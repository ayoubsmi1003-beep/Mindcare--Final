/**
 * Mise en forme des valeurs du dossier patient — présentation seule.
 *
 * ═══ DEUX SORTES DE DATES, ET LES CONFONDRE DÉCALE D'UN JOUR ══════════════
 *
 * ⚠️ `birth_date`, `onset_date` et `resolved_at` sont des `date` Postgres :
 * elles arrivent en `"1992-03-12"`, SANS heure et SANS fuseau. Les passer dans
 * `new Date(...)` les interprète à MINUIT UTC, et un formatage en heure locale
 * les ramène alors au 11 mars à Alger — une date de naissance fausse d'un jour
 * sur un certificat. `dateCivile` les découpe donc à la main, sans jamais
 * construire de `Date`.
 *
 * `started_at`, `issued_at`, `starts_at`, `genere_a` sont des `timestamptz` :
 * des INSTANTS. Eux se formatent dans le fuseau du poste, comme dans
 * `AgendaPieces.tsx` et pour la raison qui y est écrite — figer
 * « Africa/Algiers » dans une fonction d'affichage inscrirait une donnée de
 * déploiement dans le code et donnerait une heure fausse à la première session
 * ouverte ailleurs.
 *
 * ⚠️ L'ÂGE NE SE RECALCULE PAS ICI. Il arrive déjà calculé par la porte 047,
 * qui l'établit en base à partir de `birth_date`. Le recalculer en JavaScript
 * le ferait dépendre de l'horloge du poste — même défaut que celui documenté
 * dans `PanneauAttention.tsx` pour l'âge d'un impayé.
 */

import { fr } from "@/i18n/fr";
import type { Sexe } from "@/services/patients";

const FORMAT_HEURE = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
});

const FORMAT_JOUR = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const FORMAT_JOUR_ANNEE = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const FORMAT_MOIS = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
});

/** Une date illisible rend `null`, jamais « Invalid Date » — motif AgendaPieces. */
function instant(iso: string | null): Date | null {
  if (iso === null || iso === "") return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * `"1992-03-12"` → `"12/03/1992"`. Découpage textuel, AUCUN objet `Date` :
 * voir l'avertissement en tête de fichier.
 */
export function dateCivile(valeur: string | null): string | null {
  if (valeur === null || valeur === "") return null;
  const parties = valeur.slice(0, 10).split("-");
  const [annee, mois, jour] = parties;
  if (annee === undefined || mois === undefined || jour === undefined) return null;
  if (annee.length !== 4 || mois.length !== 2 || jour.length !== 2) return null;
  return `${jour}/${mois}/${annee}`;
}

/** Un instant, en date longue : « 26 août 2026 ». */
export function jourLong(iso: string | null): string | null {
  const d = instant(iso);
  return d === null ? null : FORMAT_JOUR_ANNEE.format(d);
}

/** Un instant, en jour et heure : « mardi 26 août, 14:30 ». */
export function jourEtHeure(iso: string | null): string | null {
  const d = instant(iso);
  return d === null ? null : `${FORMAT_JOUR.format(d)}, ${FORMAT_HEURE.format(d)}`;
}

/** L'heure seule : « 14:30 ». Sert la mention de fraîcheur. */
export function heure(iso: string | null): string | null {
  const d = instant(iso);
  return d === null ? null : FORMAT_HEURE.format(d);
}

/** Le mois, pour les intertitres de la chronologie : « août 2026 ». */
export function moisLong(iso: string | null): string | null {
  const d = instant(iso);
  return d === null ? null : FORMAT_MOIS.format(d);
}

/**
 * Le sexe en toutes lettres. `M`/`F` est un code de base, pas un libellé :
 * l'afficher brut demanderait à la praticienne de traduire une colonne.
 */
export function sexeLisible(sexe: Sexe | null): string | null {
  if (sexe === null) return null;
  return sexe === "M" ? fr.patients.sexeM : fr.patients.sexeF;
}

/**
 * La ligne d'état civil de l'en-tête : « 34 ans · Femme · née le 12/03/1992 ».
 * Les segments absents DISPARAISSENT au lieu de laisser « — · — » : une suite
 * de tirets se lit comme un défaut d'affichage, pas comme une donnée manquante.
 */
export function etatCivil(
  age: number | null,
  sexe: Sexe | null,
  naissance: string | null,
): string | null {
  const segments: string[] = [];

  if (age !== null) segments.push(`${String(age)} ${fr.patients.ageAnnees}`);

  const s = sexeLisible(sexe);
  if (s !== null) segments.push(s);

  const n = dateCivile(naissance);
  if (n !== null) {
    // L'accord suit le sexe quand on le connaît, et reste neutre sinon — mieux
    // vaut « né(e) le » qu'un accord inventé.
    const ne = sexe === "F" ? "née le" : sexe === "M" ? "né le" : "né(e) le";
    segments.push(`${ne} ${n}`);
  }

  return segments.length === 0 ? null : segments.join(" · ");
}

/**
 * L'écart entre deux scores d'échelle, signé.
 *
 * ⚠️ AUCUNE MENTION D'« AMÉLIORATION » NI D'« AGGRAVATION ». Le sens d'une
 * variation dépend de l'échelle : sur un PHQ-9 la baisse est favorable, sur un
 * MMSE c'est la hausse. `scales.scoring` porte des seuils d'interprétation,
 * pas une direction exploitable. On affiche le nombre ; la clinicienne
 * interprète.
 */
export function ecartLisible(delta: number | null): string | null {
  if (delta === null) return null;
  if (delta === 0) return "±0";
  return delta > 0 ? `+${String(delta)}` : String(delta);
}
