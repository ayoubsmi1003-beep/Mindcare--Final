import { z } from "zod";

const uuid = z.string().uuid();
const version = z.number().int().positive().max(2147483647);
const text = z.string().max(6000);
const nonempty = text.trim().min(1);
const title = nonempty.max(200);
const date = z.string().date();
const tags = z.array(z.string().trim().min(1).max(80)).max(8);
const media = z.array(uuid).max(5);
const category = z.enum(["work", "study", "family", "relationship", "routine", "challenge", "achievement", "other"]);
const sourceRef = z.object({ recordId: uuid, version }).strict();
const eventBody = z.object({ type: z.enum(["life-event", "moment", "victory", "milestone"]), title, detail: text, happenedOn: date, category, tags, emotion: z.enum(["happy", "calm", "excited", "tired", "sad", "anxious"]).optional(), sourceId: uuid.optional() }).strict();

export const AftercarePublicationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mission"), body: z.object({ title, purpose: nonempty, instructions: nonempty, durationMinutes: z.number().int().min(1).max(180).optional(), status: z.enum(["published", "withdrawn"]), dueOn: date.optional(), reviewAt: date.optional() }).strict() }).strict(),
  z.object({ kind: z.literal("carePlan"), body: z.object({ title, text: nonempty, status: z.enum(["published", "withdrawn"]) }).strict() }).strict(),
  z.object({ kind: z.literal("doctorNote"), body: z.object({ text: nonempty, status: z.enum(["published", "withdrawn"]) }).strict() }).strict(),
  z.object({ kind: z.literal("review"), body: z.object({ sourceId: uuid, sourceVersion: version, status: z.literal("reviewed"), text: text.optional() }).strict() }).strict(),
  z.object({ kind: z.literal("personalEvent"), body: eventBody.omit({ emotion: true, sourceId: true }).extend({ type: z.literal("milestone") }) }).strict(),
]);
export type AftercarePublication = z.infer<typeof AftercarePublicationSchema>;

// Patient submissions stay separate from official clinical records.
export const AftercareSubmissionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("journal"), body: z.object({ format: z.enum(["free", "guided"]).optional(), text: text.optional(), situation: text.optional(), emotion: text.optional(), need: text.optional(), helped: text.optional(), status: z.literal("saved").optional(), tags: tags.optional(), mediaIds: media.optional() }).strict() }),
  z.object({ kind: z.literal("preparation"), body: z.object({ questions: nonempty, summary: text.optional(), appointmentId: uuid.optional(), appointmentVersion: version.optional(), selectedSources: z.array(sourceRef).max(20).optional() }).strict() }),
  z.object({ kind: z.literal("message"), body: z.object({ category: z.enum(["renewal", "appointment", "effect", "administrative"]), text: text.optional(), status: z.literal("sent"), simulation: z.literal(true), mediaIds: z.array(uuid).max(1).optional() }).strict() }),
  z.object({ kind: z.literal("blueprint"), body: z.object({ goals: text.max(3000), helps: text.max(3000), difficult: text.max(3000), communication: text.max(3000), doctorShouldKnow: text.max(3000), supportPreferences: text.max(3000) }).strict() }),
  z.object({ kind: z.literal("missionResponse"), body: z.object({ missionId: uuid, missionVersion: version, status: z.enum(["planned", "completed", "deferred"]), reflection: text }).strict() }),
  z.object({ kind: z.literal("personalEvent"), body: eventBody }),
  z.object({ kind: z.literal("letter"), body: z.object({ recipient: z.enum(["person", "past-self", "future-self", "emotion", "experience", "missed-person"]), title: z.string().max(200), text: z.string().max(12000), status: z.literal("saved"), mediaIds: media.optional() }).strict() }),
  z.object({ kind: z.literal("atlas"), body: z.object({ title, nodes: z.array(z.object({ id: uuid, type: z.enum(["situation", "thought", "emotion", "sensation", "response", "strategy", "helped"]), text: z.string().trim().min(1).max(1000) }).strict()).max(32), edges: z.array(z.object({ from: uuid, to: uuid }).strict()).max(64) }).strict() }),
  z.object({ kind: z.literal("roomSession"), body: z.object({ roomType: z.enum(["sleep", "conversation", "appointment", "stress", "thoughts", "routine"]), completedSteps: z.array(z.enum(["arrive", "notice", "choose", "practice", "reflect"])).max(12), reflection: text, status: z.literal("completed") }).strict() }),
  z.object({ kind: z.literal("report"), body: z.object({ title, from: date, to: date, audience: z.enum(["personal", "clinician"]), selectedSources: z.array(sourceRef).max(30), status: z.literal("ready"), generatedAt: z.string().datetime({ offset: true }).optional(), sourceSnapshot: z.array(sourceRef.extend({ kind: z.string().trim().min(1).max(40), createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }) }).strict()).max(30).optional() }).strict() }),
]);
export type AftercareSubmission = z.infer<typeof AftercareSubmissionSchema>;

export const AftercareBindingSchema = z.object({
  id: uuid, cabinet_id: uuid, practitioner_id: uuid, patient_id: uuid, portal_patient_id: uuid,
  relationship: z.enum(["self", "guardian"]), verification_evidence: z.string(), consent_version: version,
  verified_by: uuid, verified_at: z.string(), revoked_at: z.string().nullable(),
});
export type AftercareBinding = z.infer<typeof AftercareBindingSchema>;

export const AftercareObjectSchema = z.object({
  id: uuid, binding_id: uuid, patient_id: uuid, cabinet_id: uuid, practitioner_id: uuid,
  object_id: uuid, source: z.enum(["mindcare", "sanad"]), kind: z.string(), version,
  body: z.record(z.string(), z.unknown()), share_state: z.enum(["shared", "revoked"]), effective_at: z.string(),
  approved_by: uuid.nullable(), approved_at: z.string().nullable(), read_by: uuid.nullable(), read_at: z.string().nullable(),
  created_at: z.string(), updated_at: z.string(),
});
export type AftercareObject = z.infer<typeof AftercareObjectSchema>;

export const AftercareEnvelopeSchema = z.object({
  schemaVersion: z.literal(2), eventId: uuid, patientId: uuid, bindingId: uuid, objectId: uuid,
  version, effectiveAt: z.string().datetime({ offset: true }), emittedAt: z.string().datetime({ offset: true }),
  source: z.enum(["mindcare", "sanad"]), correlationId: uuid, shareState: z.enum(["shared", "revoked"]),
  object: z.object({ kind: z.string(), body: z.record(z.string(), z.unknown()) }).strict(),
}).strict();
export type AftercareEnvelope = z.infer<typeof AftercareEnvelopeSchema>;
export const AftercareEventSchema = z.object({
  id: uuid, binding_id: uuid, patient_id: uuid, cabinet_id: uuid, practitioner_id: uuid, object_id: uuid,
  direction: z.enum(["incoming", "outgoing"]), request_id: uuid, digest: z.string(), envelope: AftercareEnvelopeSchema,
  status: z.enum(["pending", "applied", "duplicate", "stale"]), delivered_at: z.string().nullable(), created_at: z.string(),
});
export type AftercareEvent = z.infer<typeof AftercareEventSchema>;
