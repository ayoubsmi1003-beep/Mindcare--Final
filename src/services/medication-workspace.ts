/**
 * Espace traitements — lectures ciblées de la Phase 1.
 *
 * ⚠️ Ce service ne lit AUCUNE table en direct. Les quatre portes de 211 sont
 * les seules sources : elles portent la cloison clinique, la trace de lecture
 * et le périmètre. Le service ne fait que valider leur contrat et le nommer.
 */

import { z } from "zod";

import { fr } from "@/i18n/fr";

import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

const TIMELINE_ROW = z
  .object({
    event_id: z.string(),
    occurred_at: z.string(),
    event_kind: z.enum(["treatment", "prescription", "document"]),
    treatment_id: z.string().nullable(),
    action: z.string(),
    medication_name: z.string().nullable(),
    previous_values: z.unknown().nullable(),
    new_values: z.unknown().nullable(),
    reason: z.string().nullable(),
    notes: z.string().nullable(),
    actor_name: z.string().nullable(),
    consultation_id: z.string().nullable(),
    document_number: z.string().nullable(),
    line_count: z.number().nullable(),
  })
  .strict();

const MEASURE_ROW = z
  .object({
    consultation_id: z.string(),
    measured_at: z.string(),
    anxiete: z.number().int().min(1).max(10).nullable(),
    sommeil: z.number().int().min(1).max(10).nullable(),
    humeur: z.number().int().min(1).max(10).nullable(),
  })
  .strict();

const WORKLOAD_MED = z
  .object({
    treatment_id: z.string(),
    medication_name: z.string(),
    dose: z.string().nullable(),
    dose_unit: z.string().nullable(),
    frequency: z.string().nullable(),
    start_date: z.string(),
    end_date: z.string().nullable(),
    status: z.enum(["active", "paused", "stopped"]),
    updated_at: z.string(),
  })
  .strict();

const WORKLOAD_ROW = z
  .object({
    patient_id: z.string(),
    first_name: z.string(),
    last_name: z.string(),
    record_number: z.string(),
    active_count: z.coerce.number().int().nonnegative(),
    has_missing_posology: z.boolean(),
    has_overdue_end_date: z.boolean(),
    next_end_date: z.string().nullable(),
    last_consultation_at: z.string().nullable(),
    next_appointment_at: z.string().nullable(),
    meds: z.array(WORKLOAD_MED),
  })
  .strict();

const WORKLOAD_RESUME = z
  .object({
    patients: z.coerce.number().int().nonnegative(),
    actifs: z.coerce.number().int().nonnegative(),
    revue: z.coerce.number().int().nonnegative(),
    changements: z.coerce.number().int().nonnegative(),
  })
  .strict();

const WORKLOAD = z
  .object({
    total: z.coerce.number().int().nonnegative(),
    rows: z.array(WORKLOAD_ROW),
    resume: WORKLOAD_RESUME,
  })
  .strict();

export type MedicationTimelineKind = "treatment" | "prescription" | "document";

export interface MedicationTimelineEvent {
  readonly id: string;
  readonly occurredAt: string;
  readonly kind: MedicationTimelineKind;
  readonly treatmentId: string | null;
  readonly action: string;
  readonly medicationName: string | null;
  readonly previousValues: unknown | null;
  readonly newValues: unknown | null;
  readonly reason: string | null;
  readonly notes: string | null;
  readonly actorName: string | null;
  readonly consultationId: string | null;
  readonly documentNumber: string | null;
  readonly lineCount: number | null;
}

export interface MedicationTimelineCursor {
  readonly occurredAt: string;
  readonly id: string;
}

export interface MedicationTimelinePage {
  readonly events: readonly MedicationTimelineEvent[];
  readonly nextCursor: MedicationTimelineCursor | null;
}

export interface SessionMeasure {
  readonly consultationId: string;
  readonly measuredAt: string;
  readonly anxiete: number | null;
  readonly sommeil: number | null;
  readonly humeur: number | null;
}

export interface WorkloadMed {
  readonly treatmentId: string;
  readonly medicationName: string;
  readonly dose: string | null;
  readonly doseUnit: string | null;
  readonly frequency: string | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly status: "active" | "paused" | "stopped";
  readonly updatedAt: string;
}

export interface MedicationWorkloadRow {
  readonly patientId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly recordNumber: string;
  readonly activeCount: number;
  readonly hasMissingPosology: boolean;
  readonly hasOverdueEndDate: boolean;
  readonly nextEndDate: string | null;
  readonly lastConsultationAt: string | null;
  readonly nextAppointmentAt: string | null;
  readonly meds: readonly WorkloadMed[];
}

export interface MedicationWorkloadSummary {
  readonly patients: number;
  readonly actifs: number;
  readonly revue: number;
  readonly changements: number;
}

export interface MedicationWorkload {
  readonly rows: readonly MedicationWorkloadRow[];
  readonly total: number;
  readonly resume: MedicationWorkloadSummary;
  readonly restreint: boolean;
}

function erreurSchema(porte: string) {
  return {
    code: "regle-metier" as const,
    message: fr.patients.reponseIncoherente,
    technical: "schema",
    context: `rpc:${porte}`,
  };
}

export async function listMedicationTimeline(
  patientId: string,
  cursor: MedicationTimelineCursor | null = null,
  limit = 20,
): Promise<Result<MedicationTimelinePage>> {
  const taille = Math.min(Math.max(limit, 1), 50);
  const result = await db().rpc<unknown>("list_patient_medication_timeline", {
    p_id: patientId,
    p_before_at: cursor?.occurredAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: taille,
  });
  if (!result.ok) {
    log.error("traitements.chronologie", logFieldsFor(result.error));
    return err(result.error);
  }
  const parsed = z.array(TIMELINE_ROW).safeParse(result.data);
  if (!parsed.success) {
    log.error("traitements.chronologie", {
      code: "regle-metier",
      context: `zod:${parsed.error.issues.map((i) => i.path.join(".")).join(",")}`,
    });
    return err(erreurSchema("list_patient_medication_timeline"));
  }
  const events = parsed.data.map((e) => ({
    id: e.event_id,
    occurredAt: e.occurred_at,
    kind: e.event_kind,
    treatmentId: e.treatment_id,
    action: e.action,
    medicationName: e.medication_name,
    previousValues: e.previous_values,
    newValues: e.new_values,
    reason: e.reason,
    notes: e.notes,
    actorName: e.actor_name,
    consultationId: e.consultation_id,
    documentNumber: e.document_number,
    lineCount: e.line_count,
  }));
  const dernier = events[events.length - 1];
  return ok({
    events,
    nextCursor:
      events.length < taille || dernier === undefined
        ? null
        : { occurredAt: dernier.occurredAt, id: dernier.id },
  });
}

export async function getPatientSessionMeasures(
  patientId: string,
  limit = 120,
): Promise<Result<readonly SessionMeasure[]>> {
  const taille = Math.min(Math.max(limit, 1), 200);
  const result = await db().rpc<unknown>("get_patient_session_measures", {
    p_id: patientId,
    p_limit: taille,
  });
  if (!result.ok) {
    log.error("traitements.mesures", logFieldsFor(result.error));
    return err(result.error);
  }
  const parsed = z.array(MEASURE_ROW).safeParse(result.data);
  if (!parsed.success) {
    log.error("traitements.mesures", {
      code: "regle-metier",
      context: `zod:${parsed.error.issues.map((i) => i.path.join(".")).join(",")}`,
    });
    return err(erreurSchema("get_patient_session_measures"));
  }
  return ok(
    parsed.data.map((m) => ({
      consultationId: m.consultation_id,
      measuredAt: m.measured_at,
      anxiete: m.anxiete,
      sommeil: m.sommeil,
      humeur: m.humeur,
    })),
  );
}

export type MedicationWorkloadFilter = "tout" | "revue" | "fin";

export async function getMedicationWorkload(
  query: string,
  limit = 30,
  offset = 0,
  attention: MedicationWorkloadFilter = "tout",
): Promise<Result<MedicationWorkload>> {
  const taille = Math.min(Math.max(limit, 1), 100);
  const depart = Math.max(offset, 0);
  const result = await db().rpc<unknown>("list_medication_workload", {
    p_query: query.trim(),
    p_limit: taille,
    p_offset: depart,
    p_attention: attention === "tout" ? null : attention,
  });
  if (!result.ok) {
    log.error("traitements.charge", logFieldsFor(result.error));
    return err(result.error);
  }
  const donnee: unknown = result.data;
  const brut = Array.isArray(donnee) ? ((donnee as readonly unknown[])[0] ?? null) : donnee;
  if (brut === null || brut === undefined) {
    return ok({
      rows: [],
      total: 0,
      resume: { patients: 0, actifs: 0, revue: 0, changements: 0 },
      restreint: true,
    });
  }
  const parsed = WORKLOAD.safeParse(brut);
  if (!parsed.success) {
    log.error("traitements.charge", {
      code: "regle-metier",
      context: `zod:${parsed.error.issues.map((i) => i.path.join(".")).join(",")}`,
    });
    return err(erreurSchema("list_medication_workload"));
  }
  return ok({
    total: parsed.data.total,
    resume: parsed.data.resume,
    restreint: false,
    rows: parsed.data.rows.map((r) => ({
      patientId: r.patient_id,
      firstName: r.first_name,
      lastName: r.last_name,
      recordNumber: r.record_number,
      activeCount: r.active_count,
      hasMissingPosology: r.has_missing_posology,
      hasOverdueEndDate: r.has_overdue_end_date,
      nextEndDate: r.next_end_date,
      lastConsultationAt: r.last_consultation_at,
      nextAppointmentAt: r.next_appointment_at,
      meds: r.meds.map((m) => ({
        treatmentId: m.treatment_id,
        medicationName: m.medication_name,
        dose: m.dose,
        doseUnit: m.dose_unit,
        frequency: m.frequency,
        startDate: m.start_date,
        endDate: m.end_date,
        status: m.status,
        updatedAt: m.updated_at,
      })),
    })),
  });
}
