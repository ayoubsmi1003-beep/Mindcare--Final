import { dateCivile, jourLong } from "@/components/patients/format";
import type { PointCourbe } from "@/components/ui/Courbe";
import type { MedicationTimelineEvent, SessionMeasure } from "@/services/medication-workspace";
import type { AdministrationEchelle } from "@/services/scales";

import type { EvenementPosologie } from "./modele-traitements";

function objet(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function texte(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function evenementsPosologie(
  events: readonly MedicationTimelineEvent[],
): readonly EvenementPosologie[] {
  return events
    .filter((e) => e.kind === "treatment" && e.treatmentId !== null)
    .filter((e) => e.action === "started" || e.action === "dose_changed")
    .map((e) => {
      const values = objet(e.newValues);
      // Le début clinique est `start_date`, pas l'instant où la ligne a été
      // saisie. Un traitement commencé le 1er septembre mais enregistré le
      // 2 novembre doit apparaître au 1er septembre sur l'axe.
      const dateEvenement =
        e.action === "started" && values !== null ? (texte(values["start_date"]) ?? e.occurredAt) : e.occurredAt;
      return {
        id: e.id,
        treatmentId: e.treatmentId ?? "",
        occurredAt: dateEvenement,
        action: e.action === "started" ? "started" : "dose_changed",
        dose: values === null ? null : texte(values["dose"]),
        doseUnit: values === null ? null : texte(values["dose_unit"]),
      } satisfies EvenementPosologie;
    });
}

export function pointsEchelle(
  echelles: readonly AdministrationEchelle[],
  code: string,
): readonly PointCourbe[] {
  return echelles
    .filter((e) => e.scaleCode === code)
    .slice()
    .sort((a, b) => a.administeredAt.localeCompare(b.administeredAt))
    .map((e) => ({
      cle: e.id,
      libelle: dateCivile(e.administeredAt.slice(0, 10)) ?? e.administeredAt.slice(0, 10),
      titre: jourLong(e.administeredAt) ?? e.administeredAt,
      valeur: e.total,
      couvert: e.total !== null,
    }));
}

export function pointsMesure(
  mesures: readonly SessionMeasure[],
  cle: "anxiete" | "sommeil" | "humeur",
): readonly PointCourbe[] {
  return mesures
    .slice()
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
    .map((m) => ({
      cle: m.consultationId,
      libelle: dateCivile(m.measuredAt.slice(0, 10)) ?? m.measuredAt.slice(0, 10),
      titre: jourLong(m.measuredAt) ?? m.measuredAt,
      valeur: m[cle],
      couvert: m[cle] !== null,
    }));
}
