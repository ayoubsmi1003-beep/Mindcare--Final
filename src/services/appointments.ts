/**
 * Agenda.
 *
 * ⚠️ CE FICHIER LIT `appointments_admin`, JAMAIS `appointments`. Le nom de la
 * table brute n'apparaît nulle part dans `src/`, et le contrôle 6 du préflight
 * le vérifie.
 *
 * Précision qui compte, parce que l'inverse a déjà été écrit dans ce projet et
 * corrigé par ADR-017 : **la vue n'est pas le garde-fou.** Depuis ADR-017,
 * `reason` ne vit plus dans `app.appointments` mais dans
 * `app.appointment_reasons`, qui n'a AUCUNE policy assistant — c'est ça qui
 * protège le motif de consultation, et ça tient même en SQL brut. La vue reste
 * un confort de lecture. Ne pas réintroduire l'idée que « requêter la vue EST
 * la sécurité » : c'était l'erreur du §5.1 de 01-SCHEMA.
 *
 * Le motif de consultation n'est PAS exposé par ce service. Il appartient à un
 * futur service clinique, dont la RLS décidera — pas ce fichier.
 */

import { db } from "./db";
import { log } from "./log";
import { err, ok, type Result } from "./result";

export type AppointmentStatus = string;

export interface Appointment {
  readonly id: string;
  readonly patientId: string | null;
  readonly pendingPatientId: string | null;
  readonly practitionerId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: AppointmentStatus;
  readonly notesAdmin: string | null;
  readonly arrivedAt: string | null;
}

interface AppointmentRow {
  readonly id: string;
  readonly patient_id: string | null;
  readonly pending_patient_id: string | null;
  readonly practitioner_id: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly status: string;
  readonly notes_admin: string | null;
  readonly arrived_at: string | null;
}

export interface AppointmentRangeFilters {
  /** Borne basse incluse, ISO 8601 avec fuseau (I8 : jamais de `timestamp` nu). */
  readonly from: string;
  /** Borne haute exclue. */
  readonly to: string;
  readonly practitionerId?: string;
}

export async function listAppointments(
  filters: AppointmentRangeFilters,
): Promise<Result<readonly Appointment[]>> {
  const result = await db().select<AppointmentRow>({
    relation: "appointments_admin",
    columns: [
      "id",
      "patient_id",
      "pending_patient_id",
      "practitioner_id",
      "starts_at",
      "ends_at",
      "status",
      "notes_admin",
      "arrived_at",
    ],
    filters: [
      { column: "starts_at", op: "gte", value: filters.from },
      { column: "starts_at", op: "lt", value: filters.to },
      ...(filters.practitionerId === undefined
        ? []
        : [{ column: "practitioner_id", op: "eq" as const, value: filters.practitionerId }]),
    ],
    order: [{ column: "starts_at", ascending: true }],
  });

  if (!result.ok) {
    log.error("agenda.liste", { code: result.error.code });
    return err(result.error);
  }

  log.info("agenda.liste", { count: result.data.length });
  return ok(
    result.data.map((row) => ({
      id: row.id,
      patientId: row.patient_id,
      pendingPatientId: row.pending_patient_id,
      practitionerId: row.practitioner_id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      notesAdmin: row.notes_admin,
      arrivedAt: row.arrived_at,
    })),
  );
}
