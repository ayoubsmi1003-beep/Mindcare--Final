/**
 * Le temps, tel qu'il se lit AU CABINET.
 *
 * ⚠️ AUCUN `toLocaleTimeString()` NU DANS LES COMPOSANTS. Sans `timeZone`, le
 * navigateur formate dans le fuseau du POSTE : une praticienne en déplacement,
 * ou un poste mal réglé, lirait « 14:00 » pour un rendez-vous de 15 h. Le
 * cabinet est à Alger (ADR-001), et c'est la seule heure qui vaille sur cet
 * écran — même raisonnement que les bornes de journée de la porte 059.
 *
 * Les formateurs sont créés UNE fois au chargement du module : `Intl` est cher,
 * et le fil de la journée en appelle un par créneau, trente fois par
 * rafraîchissement.
 */

const FUSEAU_CABINET = "Africa/Algiers";

const FORMAT_HEURE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU_CABINET,
  hour: "2-digit",
  minute: "2-digit",
});

const FORMAT_DATE_LONGUE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU_CABINET,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** `14:00` — l'heure d'un créneau, telle qu'elle est affichée en salle. */
export function heureCabinet(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : FORMAT_HEURE.format(d);
}

/** `lundi 13 juillet 2026` — la date en tête d'écran. */
export function dateLongueCabinet(quand: Date): string {
  return FORMAT_DATE_LONGUE.format(quand);
}

/**
 * Une durée écoulée, en mots courts : `4 min`, `1 h 12`.
 *
 * Utilisée par la carte « séance en cours », qui est la seule à compter un
 * temps qui court. Elle s'arrête à l'heure — au-delà, la précision à la minute
 * ne dit plus rien d'utile, et une séance de plus de 24 h serait de toute façon
 * une séance qu'on a oublié de clore (ce que `close_stale_consultations` (032)
 * ferme de son côté).
 */
export function dureeDepuis(iso: string, maintenant: Date): string {
  const debut = new Date(iso).getTime();
  if (Number.isNaN(debut)) return "—";

  const minutes = Math.max(0, Math.floor((maintenant.getTime() - debut) / 60_000));
  if (minutes < 60) return `${minutes} min`;

  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste === 0 ? `${heures} h` : `${heures} h ${String(reste).padStart(2, "0")}`;
}

/**
 * Position d'un instant dans la journée, en minutes depuis minuit AU CABINET.
 *
 * Sert au curseur « maintenant » du fil. On passe par le formateur plutôt que
 * par `getHours()` pour la raison donnée en tête de fichier : `getHours()` rend
 * l'heure du poste.
 */
export function minutesDansLaJournee(quand: Date): number {
  const parties = FORMAT_HEURE.formatToParts(quand);
  const heure = parties.find((p) => p.type === "hour")?.value ?? "0";
  const minute = parties.find((p) => p.type === "minute")?.value ?? "0";
  return Number(heure) * 60 + Number(minute);
}
