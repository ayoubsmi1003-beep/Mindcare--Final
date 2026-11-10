import { z } from "zod";
import { clinicalSafetyCopy as copy } from "@/i18n/alexa-clinical-safety";

/**
 * Deterministic reads of recorded clinical safety data. The gates decide who sees what
 * (`app.can_see_clinical`) and return nothing otherwise, which is why an empty result is
 * worded as "not recorded or not visible". No model reads or rewrites these facts.
 */
export const PATIENT_SAFETY_SECTIONS = ["allergies", "adverse_events", "adherence", "measurements"] as const;
export type PatientSafetySection = (typeof PATIENT_SAFETY_SECTIONS)[number];
export function isPatientSafetySection(value: unknown): value is PatientSafetySection {
  return (PATIENT_SAFETY_SECTIONS as readonly unknown[]).includes(value);
}
export const PATIENT_SAFETY_GATES = {
  allergies: "list_patient_allergies", adverse_events: "list_patient_adverse_events",
  adherence: "list_patient_adherence", measurements: "list_patient_measurements",
} as const satisfies Record<PatientSafetySection, string>;

const DISPLAY_LIMIT = 20;
const day = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
const date = z.preprocess(value => value instanceof Date ? value.toISOString() : value, z.string());
const optionalDate = z.preprocess(value => value instanceof Date ? value.toISOString() : value, z.string().nullable());

const allergy = z.object({ substance: z.string(), substance_key: z.string(), reaction: z.string().nullable(), severity: z.enum(["legere", "moderee", "severe", "anaphylaxie"]).nullable(), event_kind: z.enum(["noted", "resolved", "refuted"]), recorded_at: date }).passthrough();
const adverse = z.object({ symptom: z.string(), severity: z.enum(["leger", "modere", "severe", "grave"]), onset_date: optionalDate, resolved_date: optionalDate, recorded_at: date }).passthrough();
const adherence = z.object({ period_start: date, period_end: date, status: z.enum(["observant", "partiel", "non_observant", "inconnu"]), source: z.enum(["patient", "entourage", "pharmacie", "observation_clinique"]) }).passthrough();
const measurement = z.object({ kind: z.string(), value: z.coerce.number(), unit: z.string(), measured_at: date, source: z.enum(["consultation", "laboratoire", "auto_declare"]) }).passthrough();

export interface PatientSafetyRead { text: string; complete: boolean; rows: number; empty: boolean }
const list = (heading: string, lines: readonly string[], total: number): PatientSafetyRead => ({
  text: [heading, ...lines.slice(0, DISPLAY_LIMIT).map(line => `- ${line}`), ...(total > DISPLAY_LIMIT ? [copy.more] : [])].join("\n"),
  complete: total <= DISPLAY_LIMIT, rows: total, empty: false,
});
const nothing = (section: PatientSafetySection): PatientSafetyRead => ({ text: copy.empty[section], complete: true, rows: 0, empty: true });

export function patientSafetyRead(section: PatientSafetySection, rows: unknown): PatientSafetyRead {
  if (section === "allergies") {
    // The gate returns an event log, newest first: the newest event decides each substance.
    const events = z.array(allergy).parse(rows), latest = new Map<string, z.infer<typeof allergy>>();
    for (const event of events) if (!latest.has(event.substance_key)) latest.set(event.substance_key, event);
    const current = [...latest.values()], active = current.filter(event => event.event_kind === "noted"), closed = current.length - active.length;
    if (!current.length) return nothing(section);
    const lines = active.map(event => copy.allergy(event.substance, event.severity ? copy.severityAllergy[event.severity] : null, event.reaction, day(event.recorded_at)));
    if (!active.length) return { text: `${copy.empty.allergies} ${copy.allergiesClosed(closed)}`, complete: true, rows: current.length, empty: false };
    const read = list(copy.allergiesHeading(active.length), lines, active.length);
    return closed ? { ...read, text: `${read.text}\n${copy.allergiesClosed(closed)}` } : read;
  }
  if (section === "adverse_events") {
    const events = z.array(adverse).parse(rows);
    if (!events.length) return nothing(section);
    return list(copy.adverseHeading(events.length), events.map(event => copy.adverse(event.symptom, copy.severityAdverse[event.severity], event.onset_date ? day(event.onset_date) : null, event.resolved_date ? day(event.resolved_date) : null)), events.length);
  }
  if (section === "adherence") {
    const reports = z.array(adherence).parse(rows);
    if (!reports.length) return nothing(section);
    return list(copy.adherenceHeading(reports.length), reports.map(report => copy.adherenceRow(day(report.period_start), day(report.period_end), copy.adherence[report.status], copy.adherenceSource[report.source])), reports.length);
  }
  const measures = z.array(measurement).parse(rows);
  if (!measures.length) return nothing(section);
  return list(copy.measuresHeading(measures.length), measures.map(row => copy.measure(row.kind, new Intl.NumberFormat("fr-FR").format(row.value), row.unit, day(row.measured_at), copy.measureSource[row.source])), measures.length);
}
