/**
 * Domaine traitements — ADR-028.
 * État courant (patient_treatments) + historique append-only (patient_treatment_history).
 * Toutes écritures via portes INVOKER (RLS décide, FOR UPDATE + versioning).
 * Aucun INSERT/UPDATE direct.
 */

import { z } from "zod";

import { fr } from "@/i18n/fr";

import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type TreatmentStatus = "active" | "paused" | "stopped";
export type TreatmentAction =
  | "started"
  | "dose_changed"
  | "schedule_changed"
  | "paused"
  | "resumed"
  | "stopped"
  | "renewed";
export type StoppedReason =
  | "inefficacite"
  | "effets_indesirables"
  | "amelioration"
  | "decision_clinique"
  | "autre";

export interface Treatment {
  readonly id: string;
  readonly patientId: string;
  readonly medicationId: string;
  readonly medicationRaw: string;
  readonly brandName: string | null;
  readonly form: string | null;
  readonly strength: string | null;
  readonly inn: string | null;
  readonly consultationId: string | null;
  readonly previousTreatmentId: string | null;
  readonly status: TreatmentStatus;
  readonly dose: string | null;
  readonly doseUnit: string | null;
  readonly frequency: string | null;
  readonly timing: readonly string[];
  readonly instructions: string | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly stoppedAt: string | null;
  readonly stoppedReason: StoppedReason | null;
  readonly currentVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TreatmentHistoryEntry {
  readonly id: string;
  readonly treatmentId: string;
  readonly version: number;
  readonly action: TreatmentAction;
  readonly previousValues: unknown | null;
  readonly newValues: unknown | null;
  readonly actorId: string;
  readonly actorName: string | null;
  readonly occurredAt: string;
  readonly consultationId: string | null;
  readonly reason: string | null;
  readonly notes: string | null;
}

export interface PatientTreatments {
  readonly actifs: readonly Treatment[];
  readonly enPause: readonly Treatment[];
  readonly arretesRecents: readonly Treatment[];
  readonly totalActifs: number;
  readonly total: number;
}

export interface TreatmentCursor {
  readonly occurredAt: string;
  readonly id: string;
}

// Zod de la table (colonnes snake)
const TREATMENT_ROW = z.object({
  id: z.string(),
  patient_id: z.string(),
  medication_id: z.string(),
  medication_raw: z.string().nullable(),
  brand_name: z.string().nullable(),
  form: z.string().nullable(),
  strength: z.string().nullable(),
  inn: z.string().nullable(),
  consultation_id: z.string().nullable(),
  previous_treatment_id: z.string().nullable(),
  status: z.enum(["active", "paused", "stopped"]),
  dose: z.string().nullable(),
  dose_unit: z.string().nullable(),
  frequency: z.string().nullable(),
  timing: z.unknown(),
  instructions: z.string().nullable(),
  start_date: z.string(),
  end_date: z.string().nullable(),
  stopped_at: z.string().nullable(),
  stopped_reason: z.string().nullable(),
  current_version: z.coerce.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

const HISTORY_ROW = z.object({
  id: z.string(),
  treatment_id: z.string(),
  version: z.coerce.number(),
  action: z.enum([
    "started",
    "dose_changed",
    "schedule_changed",
    "paused",
    "resumed",
    "stopped",
    "renewed",
  ]),
  previous_values: z.unknown().nullable(),
  new_values: z.unknown().nullable(),
  actor_id: z.string(),
  actor_name: z.string().nullable(),
  occurred_at: z.string(),
  consultation_id: z.string().nullable(),
  reason: z.string().nullable(),
  notes: z.string().nullable(),
});

function toTreatment(r: z.infer<typeof TREATMENT_ROW>): Treatment {
  let timing: readonly string[] = [];
  if (Array.isArray(r.timing)) timing = r.timing.filter((x) => typeof x === "string");
  else if (typeof r.timing === "string") {
    timing = [];
  }
  return {
    id: r.id,
    patientId: r.patient_id,
    medicationId: r.medication_id,
    medicationRaw: r.medication_raw ?? "",
    brandName: r.brand_name,
    form: r.form,
    strength: r.strength,
    inn: r.inn,
    consultationId: r.consultation_id,
    previousTreatmentId: r.previous_treatment_id,
    status: r.status,
    dose: r.dose,
    doseUnit: r.dose_unit,
    frequency: r.frequency,
    timing,
    instructions: r.instructions,
    startDate: r.start_date,
    endDate: r.end_date,
    stoppedAt: r.stopped_at,
    stoppedReason: r.stopped_reason as StoppedReason | null,
    currentVersion: r.current_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function erreurSchema(porte: string) {
  return {
    code: "regle-metier" as const,
    message: fr.patients.reponseIncoherente,
    technical: "schema",
    context: `rpc:${porte}`,
  };
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------
export async function getPatientTreatments(
  patientId: string,
): Promise<Result<PatientTreatments>> {
  const result = await db().rpc<unknown>("get_patient_treatments", {
    p_patient_id: patientId,
  });
  if (!result.ok) {
    log.error("traitements.liste", logFieldsFor(result.error));
    return err(result.error);
  }
  const raw = result.data[0] as Record<string, unknown> | undefined;
  if (!raw) {
    return ok({ actifs: [], enPause: [], arretesRecents: [], totalActifs: 0, total: 0 });
  }
  const schema = z.object({
    actifs: z.array(TREATMENT_ROW),
    en_pause: z.array(TREATMENT_ROW),
    arretes_recents: z.array(TREATMENT_ROW),
    total_actifs: z.coerce.number(),
    total: z.coerce.number(),
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    log.error("traitements.liste", {
      code: "regle-metier",
      context: `zod:${parsed.error.issues.map((i) => i.path.join(".")).join(",")}`,
    });
    return err(erreurSchema("get_patient_treatments"));
  }
  return ok({
    actifs: parsed.data.actifs.map(toTreatment),
    enPause: parsed.data.en_pause.map(toTreatment),
    arretesRecents: parsed.data.arretes_recents.map(toTreatment),
    totalActifs: parsed.data.total_actifs,
    total: parsed.data.total,
  });
}

export async function getTreatmentHistory(
  treatmentId: string,
  cursor: TreatmentCursor | null = null,
  limit = 20,
): Promise<Result<{ entries: readonly TreatmentHistoryEntry[]; nextCursor: TreatmentCursor | null }>> {
  const result = await db().rpc<unknown>("get_treatment_history", {
    p_treatment_id: treatmentId,
    p_before_at: cursor?.occurredAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: Math.min(Math.max(limit, 1), 50),
  });
  if (!result.ok) {
    log.error("traitements.historique", logFieldsFor(result.error));
    return err(result.error);
  }
  const parsed = z.array(HISTORY_ROW).safeParse(result.data);
  if (!parsed.success) {
    return err(erreurSchema("get_treatment_history"));
  }
  const entries = parsed.data.map((r) => ({
    id: r.id,
    treatmentId: r.treatment_id,
    version: r.version,
    action: r.action,
    previousValues: r.previous_values,
    newValues: r.new_values,
    actorId: r.actor_id,
    actorName: r.actor_name,
    occurredAt: r.occurred_at,
    consultationId: r.consultation_id,
    reason: r.reason,
    notes: r.notes,
  }));
  const last = entries[entries.length - 1];
  const nextCursor =
    entries.length < Math.min(Math.max(limit, 1), 50) || !last
      ? null
      : { occurredAt: last.occurredAt, id: last.id };
  return ok({ entries, nextCursor });
}

// ---------------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------------
export interface StartTreatmentParams {
  readonly patientId: string;
  readonly medicationId: string;
  readonly dose?: string | null;
  readonly doseUnit?: string | null;
  readonly frequency?: string | null;
  readonly timing?: readonly string[] | null;
  readonly instructions?: string | null;
  readonly startDate?: string | null; // YYYY-MM-DD
  readonly endDate?: string | null;
  readonly consultationId?: string | null;
}

export async function startTreatment(
  params: StartTreatmentParams,
): Promise<Result<Treatment>> {
  const timingJson =
    params.timing && params.timing.length > 0 ? JSON.stringify(params.timing) : null;
  const result = await db().rpc<unknown>("start_treatment", {
    p_patient_id: params.patientId,
    p_medication_id: params.medicationId,
    p_dose: params.dose ?? null,
    p_dose_unit: params.doseUnit ?? null,
    p_frequency: params.frequency ?? null,
    p_timing: timingJson,
    p_instructions: params.instructions ?? null,
    p_start_date: params.startDate ?? null,
    p_end_date: params.endDate ?? null,
    p_consultation_id: params.consultationId ?? null,
  });
  if (!result.ok) {
    log.error("traitements.demarrer", logFieldsFor(result.error));
    return err(result.error);
  }
  const row = (result.data as unknown[])[0];
  const parsed = TREATMENT_ROW.safeParse(row);
  if (!parsed.success) return err(erreurSchema("start_treatment"));
  log.info("traitements.demarrer", { count: 1 });
  return ok(toTreatment(parsed.data));
}

export async function updateTreatment(
  treatmentId: string,
  expectedVersion: number | null,
  changes: Record<string, unknown>,
  consultationId: string | null = null,
): Promise<Result<Treatment>> {
  const result = await db().rpc<unknown>("update_treatment", {
    p_treatment_id: treatmentId,
    p_expected_version: expectedVersion ?? null,
    p_changes: JSON.stringify(changes),
    p_consultation_id: consultationId,
  });
  if (!result.ok) {
    log.error("traitements.modifier", logFieldsFor(result.error));
    return err(result.error);
  }
  const row = (result.data as unknown[])[0];
  const parsed = TREATMENT_ROW.safeParse(row);
  if (!parsed.success) return err(erreurSchema("update_treatment"));
  log.info("traitements.modifier", { count: 1 });
  return ok(toTreatment(parsed.data));
}

export async function pauseTreatment(
  treatmentId: string,
  expectedVersion: number | null,
  consultationId: string | null = null,
): Promise<Result<Treatment>> {
  const result = await db().rpc<unknown>("pause_treatment", {
    p_treatment_id: treatmentId,
    p_expected_version: expectedVersion ?? null,
    p_consultation_id: consultationId,
  });
  if (!result.ok) return err(result.error);
  const parsed = TREATMENT_ROW.safeParse((result.data as unknown[])[0]);
  if (!parsed.success) return err(erreurSchema("pause_treatment"));
  return ok(toTreatment(parsed.data));
}

export async function resumeTreatment(
  treatmentId: string,
  expectedVersion: number | null,
  consultationId: string | null = null,
): Promise<Result<Treatment>> {
  const result = await db().rpc<unknown>("resume_treatment", {
    p_treatment_id: treatmentId,
    p_expected_version: expectedVersion ?? null,
    p_consultation_id: consultationId,
  });
  if (!result.ok) return err(result.error);
  const parsed = TREATMENT_ROW.safeParse((result.data as unknown[])[0]);
  if (!parsed.success) return err(erreurSchema("resume_treatment"));
  return ok(toTreatment(parsed.data));
}

export async function stopTreatment(
  treatmentId: string,
  expectedVersion: number | null,
  reason: StoppedReason | null,
  consultationId: string | null = null,
  notes: string | null = null,
): Promise<Result<Treatment>> {
  const result = await db().rpc<unknown>("stop_treatment", {
    p_treatment_id: treatmentId,
    p_expected_version: expectedVersion ?? null,
    p_reason: reason,
    p_consultation_id: consultationId,
    p_notes: notes,
  });
  if (!result.ok) return err(result.error);
  const parsed = TREATMENT_ROW.safeParse((result.data as unknown[])[0]);
  if (!parsed.success) return err(erreurSchema("stop_treatment"));
  return ok(toTreatment(parsed.data));
}

export async function restartTreatment(
  oldTreatmentId: string,
  overrides: {
    dose?: string | null;
    doseUnit?: string | null;
    frequency?: string | null;
    timing?: readonly string[] | null;
    instructions?: string | null;
    startDate?: string | null;
    consultationId?: string | null;
  } = {},
): Promise<Result<Treatment>> {
  const timingJson =
    overrides.timing && overrides.timing.length > 0
      ? JSON.stringify(overrides.timing)
      : null;
  const result = await db().rpc<unknown>("restart_treatment", {
    p_old_treatment_id: oldTreatmentId,
    p_dose: overrides.dose ?? null,
    p_dose_unit: overrides.doseUnit ?? null,
    p_frequency: overrides.frequency ?? null,
    p_timing: timingJson,
    p_instructions: overrides.instructions ?? null,
    p_start_date: overrides.startDate ?? null,
    p_consultation_id: overrides.consultationId ?? null,
  });
  if (!result.ok) return err(result.error);
  const parsed = TREATMENT_ROW.safeParse((result.data as unknown[])[0]);
  if (!parsed.success) return err(erreurSchema("restart_treatment"));
  return ok(toTreatment(parsed.data));
}

export async function renewTreatment(
  treatmentId: string,
  expectedVersion: number | null,
  endDate: string,
  consultationId: string | null = null,
): Promise<Result<Treatment>> {
  const result = await db().rpc<unknown>("renew_treatment", {
    p_treatment_id: treatmentId,
    p_expected_version: expectedVersion ?? null,
    p_end_date: endDate,
    p_consultation_id: consultationId,
  });
  if (!result.ok) return err(result.error);
  const parsed = TREATMENT_ROW.safeParse((result.data as unknown[])[0]);
  if (!parsed.success) return err(erreurSchema("renew_treatment"));
  return ok(toTreatment(parsed.data));
}
