/**
 * `lecture-journee.ts` — la journée LUE, pas jugée (L4).
 *
 * Dérivations d'AFFICHAGE depuis des créneaux déjà chargés : trous, retards
 * constatés, restants. Pur, sans I/O, sans porte. Les annulés/non-présentés
 * ne comptent pas dans l'occupation (même filtre que `composerBriefMatinal`).
 * Un retard est un CONSTAT chiffré (arrivé après l'heure), jamais un verdict.
 */
import type { CreneauDuJour } from "@/services/dashboard";
import { m11 } from "@/i18n/m11";

const STATUTS_INACTIFS: ReadonlySet<string> = new Set(["cancelled", "no_show"]);
const STATUTS_TERMINES: ReadonlySet<string> = new Set(["completed", "cancelled", "no_show"]);

export interface TrouJournee {
  readonly debut: string;
  readonly fin: string;
  readonly minutes: number;
}

export interface RetardJournee {
  readonly nom: string;
  readonly minutes: number;
}

export function creneauxActifs(journee: readonly CreneauDuJour[]): CreneauDuJour[] {
  return [...journee]
    .filter((c) => !STATUTS_INACTIFS.has(c.status))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export function trousJournee(journee: readonly CreneauDuJour[]): TrouJournee[] {
  const actifs = creneauxActifs(journee);
  const trous: TrouJournee[] = [];
  for (let i = 0; i + 1 < actifs.length; i++) {
    const courant = actifs[i];
    const suivant = actifs[i + 1];
    if (courant === undefined || suivant === undefined) continue;
    const fin = Date.parse(courant.endsAt);
    const debut = Date.parse(suivant.startsAt);
    if (Number.isNaN(fin) || Number.isNaN(debut) || debut <= fin) continue;
    trous.push({ debut: courant.endsAt, fin: suivant.startsAt, minutes: Math.floor((debut - fin) / 60_000) });
  }
  return trous;
}

export function retardsJournee(journee: readonly CreneauDuJour[]): RetardJournee[] {
  const retards: RetardJournee[] = [];
  for (const c of journee) {
    if (c.arrivedAt === null) continue;
    const prevu = Date.parse(c.startsAt);
    const arrive = Date.parse(c.arrivedAt);
    if (Number.isNaN(prevu) || Number.isNaN(arrive) || arrive <= prevu) continue;
    const nom = [c.firstName, c.lastName].filter((n): n is string => n !== null).join(" ");
    retards.push({ nom: nom === "" ? (c.recordNumber ?? m11.journee.sansDossier) : nom, minutes: Math.floor((arrive - prevu) / 60_000) });
  }
  return retards;
}

export function resteJournee(
  journee: readonly CreneauDuJour[],
  maintenant: Date,
): { readonly restants: number; readonly prochain: CreneauDuJour | null } {
  const aVenir = journee
    .filter(
      (c) =>
        !STATUTS_TERMINES.has(c.status) &&
        !Number.isNaN(Date.parse(c.endsAt)) &&
        Date.parse(c.endsAt) > maintenant.getTime(),
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const prochains = aVenir.filter((c) => Date.parse(c.startsAt) > maintenant.getTime());
  return { restants: aVenir.length, prochain: prochains[0] ?? null };
}

/** `45 min`, `1 h`, `1 h 12` — même style que `dureeDepuis` (heures.ts). */
export function dureeCourte(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste === 0 ? `${heures} h` : `${heures} h ${String(reste).padStart(2, "0")}`;
}
