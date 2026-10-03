import { z } from "zod";

const id = z.string().uuid();
const nullableText = z.string().nullable();
export const consultationCursorSchema = z.object({ startedAt: z.string().datetime({ offset: true }), id }).strict();
export const clinicalNoteSchema = z.object({
  id, version: z.string(), subjective: nullableText, objective: nullableText, assessment: nullableText, plan: nullableText,
  status: z.enum(["draft", "signed"]).optional(),
  amendments: z.array(z.object({ id, body: z.string(), reason: z.string(), createdAt: z.string() }).strict()),
}).strict();
export const clinicalConsultationSchema = z.object({
  id, startedAt: z.string().datetime({ offset: true }), endedAt: z.string().datetime({ offset: true }).nullable(),
  rawNotes: nullableText.optional(), rawNotesVersion: z.string().optional(),
  notes: z.array(clinicalNoteSchema),
  analysis: z.object({ id, version: z.number().int().positive(), content: z.unknown() }).strict().optional(),
}).strict();
const treatmentSnapshotSchema = z.object({
  status: z.enum(["active", "paused", "stopped"]).nullable(), dose: nullableText, doseUnit: nullableText,
  frequency: nullableText, timing: z.array(z.string()), instructions: nullableText,
  startDate: nullableText, endDate: nullableText,
}).strict();
export const clinicalTreatmentSchema = treatmentSnapshotSchema.extend({
  id, medication: z.string(), version: z.number().int().positive(),
  status: z.enum(["active", "paused", "stopped"]), startDate: z.string(),
}).strict();
export const clinicalContextSchema = z.object({
  /** Internal local reference: this DTO must never be sent directly to a provider. */
  patientId: id,
  consultations: z.array(clinicalConsultationSchema), currentConsultation: clinicalConsultationSchema.optional(),
  treatments: z.object({
    current: z.array(clinicalTreatmentSchema),
    history: z.array(z.object({ id, treatmentId: id, version: z.number().int().positive(), action: z.string(), occurredAt: z.string(),
      previous: treatmentSnapshotSchema.nullable(), next: treatmentSnapshotSchema.nullable(), reason: nullableText, notes: nullableText }).strict()),
    historyComplete: z.boolean(),
  }).strict(),
  diagnoses: z.array(z.object({ id, label: z.string(), code: nullableText, primary: z.boolean(), onsetDate: nullableText, resolvedAt: nullableText }).strict()),
  scales: z.array(z.object({ id, name: z.string(), administeredAt: z.string(), score: z.number().nullable(), interpretation: nullableText }).strict()),
  sourceRevision: z.string().regex(/^[a-f0-9]{64}$/),
  coverage: z.object({ requested: z.number().int().positive(), returned: z.number().int().nonnegative(), complete: z.boolean(), hasMore: z.boolean(),
    next: consultationCursorSchema.optional() }).strict(),
}).strict();
export type ClinicalContext = z.infer<typeof clinicalContextSchema>;
export type ClinicalConsultation = z.infer<typeof clinicalConsultationSchema>;
export type ClinicalTreatment = z.infer<typeof clinicalTreatmentSchema>;
export type ConsultationCursor = z.infer<typeof consultationCursorSchema>;
export interface ClinicalContextRequest {
  readonly count: number;
  readonly before?: ConsultationCursor;
  readonly purpose?: "summary" | "history" | "preparation" | "longitudinal";
}
