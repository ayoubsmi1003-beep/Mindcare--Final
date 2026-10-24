import type { Patient, PatientWorkspace } from "@/services/patients";

/**
 * Adaptateur de l'éditeur vers les règles pures partagées.
 *
 * Les règles d'auto-remplissage vivent désormais dans
 * `src/shared/documents/autofill.ts`, afin que l'éditeur et Alexa appliquent
 * exactement la même précédence. Ce fichier ne garde que la lecture des types
 * de service et la date civile du cabinet.
 */

export {
  buildInitialContent,
  buildInitialVariables,
  explicitDailyFrequency,
  isoVersFr,
  missingInitialFields,
  parseExplicitDailyFrequency,
  treatmentCertificateLine,
  treatmentCount,
  treatmentValues,
  treatmentVariables,
  uniqueActiveTreatments,
  withMedicationRows,
  withTreatmentCount,
} from "@/shared/documents/autofill";

export type {
  AutoFillPrescription,
  AutoFillPrescriptionLine,
  AutoFillSource,
  AutoFillTreatment,
  InitialDocumentData,
} from "@/shared/documents/autofill";

import type { AutoFillSource } from "@/shared/documents/autofill";
import { aujourdHuiCabinet } from "@/services/finance-calendrier";

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function buildAutoFillSource(
  patient: Patient | null,
  workspace: PatientWorkspace | null,
  now: Date = new Date(),
): AutoFillSource {
  return {
    idDocumentNumber: clean(workspace?.identification.idDocumentNumber) || clean(patient?.idDocumentNumber),
    idDocumentIssuer: clean(workspace?.identification.idDocumentIssuer) || clean(patient?.idDocumentIssuer),
    birthDate: workspace?.identite.birthDate ?? patient?.birthDate ?? null,
    today: aujourdHuiCabinet(now),
    activeTreatments: workspace?.traitementsV2?.actifs ?? [],
    lastPrescription: workspace?.traitements?.dernierePrescription ?? null,
  };
}
