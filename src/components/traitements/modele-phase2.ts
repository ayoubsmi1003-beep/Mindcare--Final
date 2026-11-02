/**
 * Modèle pur de la Phase 2 — ce qui se déduit de faits datés, jamais d'une
 * interprétation. Une allergie « courante » est le dernier événement connu
 * pour une substance ; une observance « dernière » est le rapport de période
 * la plus récente. Aucun score n'est calculé.
 */

import type {
  AdherenceReport,
  AllergyEvent,
  AllergySeverity,
  Measurement,
} from "@/services/medication-phase2";

export interface AllergieCourante {
  readonly substanceKey: string;
  readonly substance: string;
  readonly reaction: string | null;
  readonly severity: AllergySeverity | null;
  readonly since: string;
}

/**
 * Le dernier événement par substance décide. `resolved` et `refuted` ferment
 * l'allergie ; un événement `noted` la rouvre. L'ordre est total (date puis id)
 * pour que deux événements du même instant ne dépendent pas du hasard.
 */
export function allergiesCourantes(events: readonly AllergyEvent[]): readonly AllergieCourante[] {
  const tries = [...events].sort(
    (a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id),
  );
  const derniers = new Map<string, AllergyEvent>();
  for (const event of tries) derniers.set(event.substanceKey, event);

  return [...derniers.values()]
    .filter((event) => event.eventKind === "noted")
    .map((event) => ({
      substanceKey: event.substanceKey,
      substance: event.substance,
      reaction: event.reaction,
      severity: event.severity,
      since: event.recordedAt,
    }))
    .sort((a, b) => a.substance.localeCompare(b.substance, "fr"));
}

export function derniereAdherence(
  reports: readonly AdherenceReport[],
  treatmentId: string,
): AdherenceReport | null {
  const propres = reports.filter((r) => r.treatmentId === treatmentId);
  if (propres.length === 0) return null;
  return [...propres].sort(
    (a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.recordedAt.localeCompare(a.recordedAt),
  )[0] ?? null;
}

export function mesuresParKind(
  measurements: readonly Measurement[],
  kind: string,
): readonly Measurement[] {
  return measurements
    .filter((m) => m.kind === kind)
    .slice()
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
}

export function formaterMesure(value: number, unit: string): string {
  const nombre = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
  return `${nombre} ${unit}`;
}

/** Une mesure n'est hors référence que si les DEUX bornes existent. */
export function estHorsReference(
  measurement: Pick<Measurement, "value" | "referenceLow" | "referenceHigh">,
): boolean {
  if (measurement.referenceLow === null && measurement.referenceHigh === null) return false;
  if (measurement.referenceLow !== null && measurement.value < measurement.referenceLow) return true;
  if (measurement.referenceHigh !== null && measurement.value > measurement.referenceHigh) return true;
  return false;
}
