import { createHash } from "node:crypto";
import { z } from "zod";
import type { DbPort } from "@/services/db/port";
import type { ClinicalConsultation } from "@/shared/alexa/clinical";
import { consultationNotesDigest, consultationNotesSnapshot, consultationNarrativeSources, NARRATIVE_HASH, NARRATIVE_VERSION, synthesizeClinicalNarrative } from "./clinical-narrative";
import { ALEXA_CONVERSATION_MODEL } from "./model-policy";

const date = z.union([z.string(), z.date()]).transform(v => new Date(v).toISOString());
const rowSchema = z.object({ id: z.uuid(), patient_id: z.uuid(), started_at: date, ended_at: date.nullable(), raw_notes: z.string().nullable(), note_id: z.uuid().nullable(), note_status: z.enum(["signed", "draft"]).nullable(), subjective: z.string().nullable(), objective: z.string().nullable(), assessment: z.string().nullable(), plan: z.string().nullable() });
const amendmentSchema = z.object({ id: z.uuid(), body: z.string(), reason: z.string(), created_at: date });
export class SessionSummaryError extends Error { constructor(readonly code: "empty" | "changed" | "unavailable") { super(code); } }

async function readSession(db: Pick<DbPort, "rpc">, consultationId: string, signal: AbortSignal): Promise<ClinicalConsultation> {
  signal.throwIfAborted();
  const r = await db.rpc("get_consultation", { p_id: consultationId });
  if (!r.ok) throw new SessionSummaryError("unavailable");
  const parsed = rowSchema.safeParse(r.data[0]);
  if (!parsed.success || parsed.data.id !== consultationId) throw new SessionSummaryError("unavailable");
  const row = parsed.data;
  const patient = await db.rpc<{ id: string }>("get_patient", { p_id: row.patient_id });
  if (!patient.ok || patient.data[0]?.id !== row.patient_id) throw new SessionSummaryError("unavailable");
  const corrections = row.note_id ? await db.rpc("list_amendments", { p_note_id: row.note_id }) : { ok: true as const, data: [] };
  if (!corrections.ok) throw new SessionSummaryError("unavailable");
  const amendments = z.array(amendmentSchema).parse(corrections.data).map(a => ({ id: a.id, body: a.body, reason: a.reason, createdAt: a.created_at }));
  signal.throwIfAborted();
  return { id: row.id, startedAt: row.started_at, endedAt: row.ended_at, rawNotes: row.raw_notes,
    notes: row.note_id && row.note_status ? [{ id: row.note_id, version: "saved", status: row.note_status, subjective: row.subjective, objective: row.objective, assessment: row.assessment, plan: row.plan, amendments }] : [] };
}

/** Explicit Analyse gesture writes only a versioned derived artifact, never SOAP. */
export async function generateSessionSummary(db: Pick<DbPort, "rpc">, consultationId: string, signal: AbortSignal) {
  const consultation = await readSession(db, consultationId, signal);
  const input = consultationNarrativeSources(consultation);
  if (!input.sources.length) throw new SessionSummaryError("empty");
  const narrative = await synthesizeClinicalNarrative(input.sources, signal);
  if (!narrative.generated) throw new SessionSummaryError("unavailable");
  const digest = consultationNotesDigest(consultation);
  if (consultationNotesDigest(await readSession(db, consultationId, signal)) !== digest) throw new SessionSummaryError("changed");
  const soap = consultation.notes[0];
  const content = { resume: narrative.text, notesDigest: digest, complete: input.complete && narrative.complete, generated: true,
    noteStructuree: { subjective: soap?.subjective ?? "", objective: soap?.objective ?? "", assessment: soap?.assessment ?? "", plan: soap?.plan ?? "" }, evolution: [], pointsNonExplores: [] };
  const saved = await db.rpc<{ id: string; version: number; content: unknown }>("save_session_analysis", {
    p_consultation_id: consultationId, p_content: JSON.stringify(content),
    p_source_state: JSON.stringify({ notes_hash: createHash("sha256").update(consultation.rawNotes ?? "").digest("hex"), notes_digest: digest, notes_snapshot: consultationNotesSnapshot(consultation), note_areas: 5, historique_notes: 0, complete: content.complete }),
    p_model: ALEXA_CONVERSATION_MODEL, p_prompt_version: NARRATIVE_VERSION, p_prompt_hash: NARRATIVE_HASH,
  });
  const row = saved.ok ? saved.data[0] : undefined;
  if (saved.ok && !row) throw new SessionSummaryError("changed");
  let persisted = false; let persistedResume = content.resume; let persistedComplete = content.complete;
  if (row) {
    const readback = await db.rpc<{ id: string; content: { notesDigest?: string; resume?: string; complete?: boolean } }>("get_consultation_analysis", { p_consultation_id: consultationId });
    const stored = readback.ok ? readback.data[0] : undefined;
    if (stored?.id === row.id && stored.content.notesDigest === digest && typeof stored.content.resume === "string") {
      persisted = true; persistedResume = stored.content.resume; persistedComplete = stored.content.complete === true;
    }
  }

  return { ...content, resume: persistedResume, complete: persistedComplete, analyseId: persisted ? row!.id : null, version: persisted ? row!.version : null, persistee: persisted, sources: { historiqueNotes: 0 } };
}
