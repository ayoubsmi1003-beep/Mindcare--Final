/**
 * Phase 2 du domaine médicament — faits cliniques append-only.
 *
 * ⚠️ CE SERVICE N'INTERPRÈTE RIEN.
 * Il enregistre et relit des faits saisis par la praticienne : allergie,
 * effet indésirable, mesure, observance rapportée, revue d'interaction
 * attestée, lien de renouvellement entre deux ordonnances. Aucun score,
 * aucune interaction calculée, aucune posologie déduite.
 */

import { z } from "zod";

import { fr } from "@/i18n/fr";

import { db } from "./db";
import { logFieldsFor, type AppError } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

export type AllergyEventKind = "noted" | "resolved" | "refuted";
export type AllergySeverity = "legere" | "moderee" | "severe" | "anaphylaxie";
export type AdverseSeverity = "leger" | "modere" | "severe" | "grave";
export type AdherenceStatus = "observant" | "partiel" | "non_observant" | "inconnu";
export type AdherenceSource = "patient" | "entourage" | "pharmacie" | "observation_clinique";
export type MeasurementSource = "consultation" | "laboratoire" | "auto_declare";
export type InteractionConclusion =
  | "aucune_interaction_retenue"
  | "interaction_possible"
  | "interaction_majeure"
  | "non_conclu";

const NOMBRE_NULLABLE = z
  .union([z.string(), z.number(), z.null()])
  .transform((v) => (v === null ? null : Number(v)));

const ALLERGY_ROW = z
  .object({
    id: z.string(),
    patient_id: z.string(),
    consultation_id: z.string().nullable(),
    substance: z.string(),
    substance_key: z.string(),
    reaction: z.string().nullable(),
    severity: z.enum(["legere", "moderee", "severe", "anaphylaxie"]).nullable(),
    event_kind: z.enum(["noted", "resolved", "refuted"]),
    notes: z.string().nullable(),
    recorded_at: z.string(),
  });

const ADVERSE_ROW = z
  .object({
    id: z.string(),
    patient_id: z.string(),
    consultation_id: z.string().nullable(),
    treatment_id: z.string().nullable(),
    medication_id: z.string().nullable(),
    symptom: z.string(),
    severity: z.enum(["leger", "modere", "severe", "grave"]),
    onset_date: z.string().nullable(),
    resolved_date: z.string().nullable(),
    action_taken: z.string().nullable(),
    description: z.string().nullable(),
    recorded_at: z.string(),
  });

const MEASUREMENT_ROW = z
  .object({
    id: z.string(),
    patient_id: z.string(),
    consultation_id: z.string().nullable(),
    kind: z.string(),
    value: z.coerce.number(),
    unit: z.string(),
    measured_at: z.string(),
    source: z.enum(["consultation", "laboratoire", "auto_declare"]),
    reference_low: NOMBRE_NULLABLE,
    reference_high: NOMBRE_NULLABLE,
    notes: z.string().nullable(),
    recorded_at: z.string(),
  });

const ADHERENCE_ROW = z
  .object({
    id: z.string(),
    patient_id: z.string(),
    consultation_id: z.string().nullable(),
    treatment_id: z.string(),
    period_start: z.string(),
    period_end: z.string(),
    status: z.enum(["observant", "partiel", "non_observant", "inconnu"]),
    source: z.enum(["patient", "entourage", "pharmacie", "observation_clinique"]),
    notes: z.string().nullable(),
    recorded_at: z.string(),
  });

const INTERACTION_REVIEW_ROW = z
  .object({
    id: z.string(),
    source: z.string(),
    conclusion: z.enum([
      "aucune_interaction_retenue",
      "interaction_possible",
      "interaction_majeure",
      "non_conclu",
    ]),
    notes: z.string().nullable(),
    recorded_at: z.string(),
    practitioner_name: z.string().nullable(),
    treatments: z.array(
      z
        .object({
          treatment_id: z.string(),
          medication_name: z.string(),
          dose: z.string().nullable(),
          dose_unit: z.string().nullable(),
          status: z.enum(["active", "paused", "stopped"]),
        }),
    ),
  });

const INTERACTION_REVIEW_WRITE = z.object({
  id: z.string(),
  source: z.string(),
  conclusion: z.enum([
    "aucune_interaction_retenue",
    "interaction_possible",
    "interaction_majeure",
    "non_conclu",
  ]),
  notes: z.string().nullable(),
  recorded_at: z.string(),
});

const RENEWAL_LINK_WRITE = z.object({
  id: z.string(),
  new_document_id: z.string(),
  previous_document_id: z.string(),
  notes: z.string().nullable(),
  linked_at: z.string(),
});

const RENEWAL_LINK_ROW = z
  .object({
    id: z.string(),
    new_document_id: z.string(),
    new_document_number: z.string(),
    new_issued_at: z.string(),
    previous_document_id: z.string(),
    previous_document_number: z.string(),
    previous_issued_at: z.string(),
    linked_at: z.string(),
    notes: z.string().nullable(),
  });

export interface AllergyEvent {
  readonly id: string;
  readonly patientId: string;
  readonly consultationId: string | null;
  readonly substance: string;
  readonly substanceKey: string;
  readonly reaction: string | null;
  readonly severity: AllergySeverity | null;
  readonly eventKind: AllergyEventKind;
  readonly notes: string | null;
  readonly recordedAt: string;
}

export interface AdverseEvent {
  readonly id: string;
  readonly patientId: string;
  readonly consultationId: string | null;
  readonly treatmentId: string | null;
  readonly medicationId: string | null;
  readonly symptom: string;
  readonly severity: AdverseSeverity;
  readonly onsetDate: string | null;
  readonly resolvedDate: string | null;
  readonly actionTaken: string | null;
  readonly description: string | null;
  readonly recordedAt: string;
}

export interface Measurement {
  readonly id: string;
  readonly patientId: string;
  readonly consultationId: string | null;
  readonly kind: string;
  readonly value: number;
  readonly unit: string;
  readonly measuredAt: string;
  readonly source: MeasurementSource;
  readonly referenceLow: number | null;
  readonly referenceHigh: number | null;
  readonly notes: string | null;
  readonly recordedAt: string;
}

export interface AdherenceReport {
  readonly id: string;
  readonly patientId: string;
  readonly consultationId: string | null;
  readonly treatmentId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: AdherenceStatus;
  readonly source: AdherenceSource;
  readonly notes: string | null;
  readonly recordedAt: string;
}

export interface InteractionReviewTreatment {
  readonly treatmentId: string;
  readonly medicationName: string;
  readonly dose: string | null;
  readonly doseUnit: string | null;
  readonly status: "active" | "paused" | "stopped";
}

export interface InteractionReview {
  readonly id: string;
  readonly source: string;
  readonly conclusion: InteractionConclusion;
  readonly notes: string | null;
  readonly recordedAt: string;
  readonly practitionerName: string | null;
  readonly treatments: readonly InteractionReviewTreatment[];
}

export interface RenewalLink {
  readonly id: string;
  readonly newDocumentId: string;
  readonly newDocumentNumber: string;
  readonly newIssuedAt: string;
  readonly previousDocumentId: string;
  readonly previousDocumentNumber: string;
  readonly previousIssuedAt: string;
  readonly linkedAt: string;
  readonly notes: string | null;
}

function erreurSchema(porte: string) {
  return {
    code: "regle-metier" as const,
    message: fr.patients.reponseIncoherente,
    technical: "schema",
    context: `rpc:${porte}`,
  };
}

function erreurLecture<T>(porte: string, parcours: string, result: { readonly error: AppError }): Result<T> {
  log.error(parcours, logFieldsFor(result.error));
  return err<T>(result.error);
}

function journaliserSchema<T>(
  parcours: string,
  porte: string,
  issues: readonly z.ZodIssue[],
): Result<T> {
  log.error(parcours, {
    code: "regle-metier",
    context: `zod:${issues.map((i) => i.path.join(".")).join(",")}`,
  });
  return err<T>(erreurSchema(porte));
}

// ---------------------------------------------------------------------------
// Allergies
// ---------------------------------------------------------------------------

export async function listPatientAllergies(patientId: string): Promise<Result<readonly AllergyEvent[]>> {
  const result = await db().rpc<unknown>("list_patient_allergies", { p_id: patientId });
  if (!result.ok) return erreurLecture("list_patient_allergies", "traitements.allergies", result);

  const parsed = z.array(ALLERGY_ROW).safeParse(result.data);
  if (!parsed.success) return journaliserSchema("traitements.allergies", "list_patient_allergies", parsed.error.issues);

  return ok(
    parsed.data.map((r) => ({
      id: r.id,
      patientId: r.patient_id,
      consultationId: r.consultation_id,
      substance: r.substance,
      substanceKey: r.substance_key,
      reaction: r.reaction,
      severity: r.severity,
      eventKind: r.event_kind,
      notes: r.notes,
      recordedAt: r.recorded_at,
    })),
  );
}

export async function recordPatientAllergy(params: {
  readonly patientId: string;
  readonly substance: string;
  readonly reaction: string | null;
  readonly severity: AllergySeverity | null;
  readonly eventKind: AllergyEventKind;
  readonly notes: string | null;
  readonly consultationId: string | null;
}): Promise<Result<AllergyEvent>> {
  const result = await db().rpc<unknown>("record_patient_allergy", {
    p_patient_id: params.patientId,
    p_substance: params.substance,
    p_reaction: params.reaction,
    p_severity: params.severity,
    p_event_kind: params.eventKind,
    p_notes: params.notes,
    p_consultation_id: params.consultationId,
  });
  if (!result.ok) {
    log.error("traitements.allergie.enregistrer", logFieldsFor(result.error));
    return err(result.error);
  }
  const row = result.data[0];
  const parsed = ALLERGY_ROW.safeParse(row);
  if (!parsed.success) return journaliserSchema("traitements.allergie", "record_patient_allergy", parsed.error.issues);
  const r = parsed.data;
  return ok({
    id: r.id,
    patientId: r.patient_id,
    consultationId: r.consultation_id,
    substance: r.substance,
    substanceKey: r.substance_key,
    reaction: r.reaction,
    severity: r.severity,
    eventKind: r.event_kind,
    notes: r.notes,
    recordedAt: r.recorded_at,
  });
}

// ---------------------------------------------------------------------------
// Effets indésirables
// ---------------------------------------------------------------------------

export async function listPatientAdverseEvents(patientId: string): Promise<Result<readonly AdverseEvent[]>> {
  const result = await db().rpc<unknown>("list_patient_adverse_events", { p_id: patientId, p_limit: 100 });
  if (!result.ok) return erreurLecture("list_patient_adverse_events", "traitements.effets", result);

  const parsed = z.array(ADVERSE_ROW).safeParse(result.data);
  if (!parsed.success) return journaliserSchema("traitements.effets", "list_patient_adverse_events", parsed.error.issues);

  return ok(
    parsed.data.map((r) => ({
      id: r.id,
      patientId: r.patient_id,
      consultationId: r.consultation_id,
      treatmentId: r.treatment_id,
      medicationId: r.medication_id,
      symptom: r.symptom,
      severity: r.severity,
      onsetDate: r.onset_date,
      resolvedDate: r.resolved_date,
      actionTaken: r.action_taken,
      description: r.description,
      recordedAt: r.recorded_at,
    })),
  );
}

export async function recordAdverseEvent(params: {
  readonly patientId: string;
  readonly symptom: string;
  readonly severity: AdverseSeverity;
  readonly treatmentId: string | null;
  readonly onsetDate: string | null;
  readonly resolvedDate: string | null;
  readonly actionTaken: string | null;
  readonly description: string | null;
  readonly consultationId: string | null;
}): Promise<Result<AdverseEvent>> {
  const result = await db().rpc<unknown>("record_adverse_event", {
    p_patient_id: params.patientId,
    p_symptom: params.symptom,
    p_severity: params.severity,
    p_treatment_id: params.treatmentId,
    p_onset_date: params.onsetDate,
    p_resolved_date: params.resolvedDate,
    p_action_taken: params.actionTaken,
    p_description: params.description,
    p_consultation_id: params.consultationId,
  });
  if (!result.ok) {
    log.error("traitements.effet.enregistrer", logFieldsFor(result.error));
    return err(result.error);
  }
  const row = result.data[0];
  const parsed = ADVERSE_ROW.safeParse(row);
  if (!parsed.success) return journaliserSchema("traitements.effet", "record_adverse_event", parsed.error.issues);
  const r = parsed.data;
  return ok({
    id: r.id,
    patientId: r.patient_id,
    consultationId: r.consultation_id,
    treatmentId: r.treatment_id,
    medicationId: r.medication_id,
    symptom: r.symptom,
    severity: r.severity,
    onsetDate: r.onset_date,
    resolvedDate: r.resolved_date,
    actionTaken: r.action_taken,
    description: r.description,
    recordedAt: r.recorded_at,
  });
}

// ---------------------------------------------------------------------------
// Mesures
// ---------------------------------------------------------------------------

export async function listPatientMeasurements(
  patientId: string,
  kind: string | null = null,
): Promise<Result<readonly Measurement[]>> {
  const result = await db().rpc<unknown>("list_patient_measurements", {
    p_id: patientId,
    p_kind: kind,
    p_limit: 1000,
  });
  if (!result.ok) return erreurLecture("list_patient_measurements", "traitements.mesures", result);

  const parsed = z.array(MEASUREMENT_ROW).safeParse(result.data);
  if (!parsed.success) return journaliserSchema("traitements.mesures", "list_patient_measurements", parsed.error.issues);

  return ok(
    parsed.data.map((r) => ({
      id: r.id,
      patientId: r.patient_id,
      consultationId: r.consultation_id,
      kind: r.kind,
      value: r.value,
      unit: r.unit,
      measuredAt: r.measured_at,
      source: r.source,
      referenceLow: r.reference_low,
      referenceHigh: r.reference_high,
      notes: r.notes,
      recordedAt: r.recorded_at,
    })),
  );
}

export async function recordMeasurement(params: {
  readonly patientId: string;
  readonly kind: string;
  readonly value: number;
  readonly unit: string;
  readonly measuredAt: string;
  readonly source: MeasurementSource;
  readonly referenceLow: number | null;
  readonly referenceHigh: number | null;
  readonly notes: string | null;
  readonly consultationId: string | null;
}): Promise<Result<Measurement>> {
  const result = await db().rpc<unknown>("record_measurement", {
    p_patient_id: params.patientId,
    p_kind: params.kind,
    p_value: params.value,
    p_unit: params.unit,
    p_measured_at: params.measuredAt,
    p_source: params.source,
    p_reference_low: params.referenceLow,
    p_reference_high: params.referenceHigh,
    p_notes: params.notes,
    p_consultation_id: params.consultationId,
  });
  if (!result.ok) {
    log.error("traitements.mesure.enregistrer", logFieldsFor(result.error));
    return err(result.error);
  }
  const row = result.data[0];
  const parsed = MEASUREMENT_ROW.safeParse(row);
  if (!parsed.success) return journaliserSchema("traitements.mesure", "record_measurement", parsed.error.issues);
  const r = parsed.data;
  return ok({
    id: r.id,
    patientId: r.patient_id,
    consultationId: r.consultation_id,
    kind: r.kind,
    value: r.value,
    unit: r.unit,
    measuredAt: r.measured_at,
    source: r.source,
    referenceLow: r.reference_low,
    referenceHigh: r.reference_high,
    notes: r.notes,
    recordedAt: r.recorded_at,
  });
}

// ---------------------------------------------------------------------------
// Observance rapportée
// ---------------------------------------------------------------------------

export async function listPatientAdherence(patientId: string): Promise<Result<readonly AdherenceReport[]>> {
  const result = await db().rpc<unknown>("list_patient_adherence", { p_id: patientId });
  if (!result.ok) return erreurLecture("list_patient_adherence", "traitements.observance", result);

  const parsed = z.array(ADHERENCE_ROW).safeParse(result.data);
  if (!parsed.success) return journaliserSchema("traitements.observance", "list_patient_adherence", parsed.error.issues);

  return ok(
    parsed.data.map((r) => ({
      id: r.id,
      patientId: r.patient_id,
      consultationId: r.consultation_id,
      treatmentId: r.treatment_id,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      status: r.status,
      source: r.source,
      notes: r.notes,
      recordedAt: r.recorded_at,
    })),
  );
}

export async function recordAdherence(params: {
  readonly patientId: string;
  readonly treatmentId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: AdherenceStatus;
  readonly source: AdherenceSource;
  readonly notes: string | null;
  readonly consultationId: string | null;
}): Promise<Result<AdherenceReport>> {
  const result = await db().rpc<unknown>("record_adherence", {
    p_patient_id: params.patientId,
    p_treatment_id: params.treatmentId,
    p_period_start: params.periodStart,
    p_period_end: params.periodEnd,
    p_status: params.status,
    p_source: params.source,
    p_notes: params.notes,
    p_consultation_id: params.consultationId,
  });
  if (!result.ok) {
    log.error("traitements.observance.enregistrer", logFieldsFor(result.error));
    return err(result.error);
  }
  const row = result.data[0];
  const parsed = ADHERENCE_ROW.safeParse(row);
  if (!parsed.success) return journaliserSchema("traitements.observance", "record_adherence", parsed.error.issues);
  const r = parsed.data;
  return ok({
    id: r.id,
    patientId: r.patient_id,
    consultationId: r.consultation_id,
    treatmentId: r.treatment_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    status: r.status,
    source: r.source,
    notes: r.notes,
    recordedAt: r.recorded_at,
  });
}

// ---------------------------------------------------------------------------
// Revue d'interaction attestée
// ---------------------------------------------------------------------------

export async function listPatientInteractionReviews(patientId: string): Promise<Result<readonly InteractionReview[]>> {
  const result = await db().rpc<unknown>("list_patient_interaction_reviews", { p_id: patientId });
  if (!result.ok) return erreurLecture("list_patient_interaction_reviews", "traitements.interactions", result);

  const parsed = z.array(INTERACTION_REVIEW_ROW).safeParse(result.data);
  if (!parsed.success) return journaliserSchema("traitements.interactions", "list_patient_interaction_reviews", parsed.error.issues);

  return ok(
    parsed.data.map((r) => ({
      id: r.id,
      source: r.source,
      conclusion: r.conclusion,
      notes: r.notes,
      recordedAt: r.recorded_at,
      practitionerName: r.practitioner_name,
      treatments: r.treatments.map((t) => ({
        treatmentId: t.treatment_id,
        medicationName: t.medication_name,
        dose: t.dose,
        doseUnit: t.dose_unit,
        status: t.status,
      })),
    })),
  );
}

export async function recordInteractionReview(params: {
  readonly patientId: string;
  readonly treatmentIds: readonly string[];
  readonly source: string;
  readonly conclusion: InteractionConclusion;
  readonly notes: string | null;
  readonly consultationId: string | null;
}): Promise<Result<InteractionReview>> {
  const result = await db().rpc<unknown>("record_interaction_review", {
    p_patient_id: params.patientId,
    p_treatment_ids: JSON.stringify(params.treatmentIds),
    p_source: params.source,
    p_conclusion: params.conclusion,
    p_notes: params.notes,
    p_consultation_id: params.consultationId,
  });
  if (!result.ok) {
    log.error("traitements.interaction.enregistrer", logFieldsFor(result.error));
    return err(result.error);
  }
  const row = result.data[0];
  const parsed = INTERACTION_REVIEW_WRITE.safeParse(row);
  if (!parsed.success) return journaliserSchema("traitements.interaction", "record_interaction_review", parsed.error.issues);
  const r = parsed.data;

  // L'écran relit la liste complète via `onChanged` ; la réponse d'écriture
  // n'a pas à porter les traitements joints.
  return ok({
    id: r.id,
    source: r.source,
    conclusion: r.conclusion,
    notes: r.notes,
    recordedAt: r.recorded_at,
    practitionerName: null,
    treatments: [],
  });
}

// ---------------------------------------------------------------------------
// Renouvellements documentés
// ---------------------------------------------------------------------------

export async function listPatientRenewalLinks(patientId: string): Promise<Result<readonly RenewalLink[]>> {
  const result = await db().rpc<unknown>("list_patient_renewal_links", { p_id: patientId });
  if (!result.ok) return erreurLecture("list_patient_renewal_links", "traitements.renouvellements", result);

  const parsed = z.array(RENEWAL_LINK_ROW).safeParse(result.data);
  if (!parsed.success) return journaliserSchema("traitements.renouvellements", "list_patient_renewal_links", parsed.error.issues);

  return ok(
    parsed.data.map((r) => ({
      id: r.id,
      newDocumentId: r.new_document_id,
      newDocumentNumber: r.new_document_number,
      newIssuedAt: r.new_issued_at,
      previousDocumentId: r.previous_document_id,
      previousDocumentNumber: r.previous_document_number,
      previousIssuedAt: r.previous_issued_at,
      linkedAt: r.linked_at,
      notes: r.notes,
    })),
  );
}

export async function linkPrescriptionRenewal(params: {
  readonly patientId: string;
  readonly newDocumentId: string;
  readonly previousDocumentId: string;
  readonly notes: string | null;
}): Promise<Result<RenewalLink>> {
  const result = await db().rpc<unknown>("link_prescription_renewal", {
    p_patient_id: params.patientId,
    p_new_document_id: params.newDocumentId,
    p_previous_document_id: params.previousDocumentId,
    p_notes: params.notes,
  });
  if (!result.ok) {
    log.error("traitements.renouvellement.lier", logFieldsFor(result.error));
    return err(result.error);
  }
  const row = result.data[0];
  const parsed = RENEWAL_LINK_WRITE.safeParse(row);
  if (!parsed.success) return journaliserSchema("traitements.renouvellement", "link_prescription_renewal", parsed.error.issues);
  const r = parsed.data;

  // Le panneau relit les liens complets via `onChanged`.
  return ok({
    id: r.id,
    newDocumentId: r.new_document_id,
    newDocumentNumber: "",
    newIssuedAt: "",
    previousDocumentId: r.previous_document_id,
    previousDocumentNumber: "",
    previousIssuedAt: "",
    linkedAt: r.linked_at,
    notes: r.notes,
  });
}
