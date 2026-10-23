import { createHash } from "node:crypto";
import { z } from "zod";
import type { DbPort } from "@/services/db/port";
import type { ClinicalConsultation, ClinicalContext } from "@/shared/alexa/clinical";
import { consultationNotesDigest, consultationNotesSnapshot, consultationNarrativeSources, NARRATIVE_HASH, NARRATIVE_VERSION, synthesizeClinicalNarrative } from "./clinical-narrative";
import { ALEXA_CONVERSATION_MODEL } from "./model-policy";
import { sessionDetailsSchema,measureChanges } from '@/shared/alexa/session-details';
import { narrativeCopy } from '@/i18n/alexa-narrative';
import {dialogue} from '@/i18n/alexa-dialogue';
import {alexaRecordCopy} from '@/i18n/alexa-records';
import { buildClinicalContext } from './clinical-context';
import type { NarrativeSource } from './clinical-narrative';

const date = z.union([z.string(), z.date()]).transform(v => new Date(v).toISOString());
const rowSchema = z.object({ id: z.uuid(), patient_id: z.uuid(), started_at: date, ended_at: date.nullable(), raw_notes: z.string().nullable(), note_id: z.uuid().nullable(), note_status: z.enum(["signed", "draft"]).nullable(), subjective: z.string().nullable(), objective: z.string().nullable(), assessment: z.string().nullable(), plan: z.string().nullable() });
const amendmentSchema = z.object({ id: z.uuid(), body: z.string(), reason: z.string(), created_at: date });
export class SessionSummaryError extends Error { constructor(readonly code: "empty" | "changed" | "unavailable") { super(code); } }
function diagnostic(stage:string,details:Record<string,unknown>={}):void {
  if(process.env.ALEXA_DEBUG_NARRATIVE==='1')console.warn('[session-summary]',JSON.stringify({stage,...details}));
}
function treatmentState(state:{dose:string|null;doseUnit:string|null;frequency:string|null;status:string|null;timing?:string[];instructions?:string|null}|null):string {
  if(!state)return 'état non renseigné';
  const status=state.status==='active'||state.status==='paused'||state.status==='stopped'?dialogue('fr').states[state.status]:state.status??'non renseigné';
  return `${state.dose===null?'dose non renseignée':[state.dose,state.doseUnit].filter(Boolean).join(' ')}, ${state.frequency??'fréquence non renseignée'}, état ${status}${state.timing?.length?`, ${state.timing.join(', ')}`:''}${state.instructions?`, consignes « ${state.instructions} »`:''}`;
}
type TreatmentSnapshot=ClinicalContext['treatments']['history'][number]['previous'];
const treatmentFields=['dose','doseUnit','status','frequency','timing','instructions','startDate','endDate'] as const;
function changedTreatmentState(state:TreatmentSnapshot,fields:readonly (typeof treatmentFields[number])[]):string {
  if(!state)return 'état non renseigné';
  const labels={...alexaRecordCopy.fr.treatmentFields,...narrativeCopy.treatmentFields};
  return fields.map(field=>{
    const value=state[field];
    const text=field==='status'&&(value==='active'||value==='paused'||value==='stopped')?dialogue('fr').states[value]
      :Array.isArray(value)?value.join(', ')||'non renseigné':field==='instructions'&&value?`« ${value} »`:value??'non renseigné';
    return `${labels[field]} : ${text}`;
  }).join(' ; ');
}

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
  const details=await db.rpc('get_session_details',{p_id:consultationId});
  if(!details.ok)throw new SessionSummaryError('unavailable');
  const parsedDetails=sessionDetailsSchema.nullable().safeParse(details.data[0]??null);
  if(!parsedDetails.success)throw new SessionSummaryError('unavailable');
  signal.throwIfAborted();
  return { id: row.id, startedAt: row.started_at, endedAt: row.ended_at, rawNotes: row.raw_notes,sessionDetails:parsedDetails.data,
    notes: row.note_id && row.note_status ? [{ id: row.note_id, version: "saved", status: row.note_status, subjective: row.subjective, objective: row.objective, assessment: row.assessment, plan: row.plan, amendments }] : [] };
}

/** Explicit Analyse gesture writes only a versioned derived artifact, never SOAP. */
export async function generateSessionSummary(db: Pick<DbPort, "rpc">, consultationId: string, signal: AbortSignal) {
  diagnostic('read-session');
  const consultation = await readSession(db, consultationId, signal);
  const input = consultationNarrativeSources(consultation);
  if (!input.sources.length) throw new SessionSummaryError("empty");
  diagnostic('read-identity');
  const identity=await db.rpc<{patient_id:string}>('get_consultation',{p_id:consultationId});
  const patientId=identity.ok?identity.data[0]?.patient_id:undefined;
  if(!patientId)throw new SessionSummaryError('unavailable');
  diagnostic('read-comparison');
  const context=await buildClinicalContext(db,{patientId},{count:1,before:{startedAt:consultation.startedAt,id:consultation.id}},signal);
  const previous=context.consultations[0];
  const trends=measureChanges(previous?.sessionDetails,consultation.sessionDetails).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).map((m,i)=>({id:`${consultation.id}:trend-${i}`,consultationId:consultation.id,text:narrativeCopy.measureSentence(narrativeCopy.measureLabels[m.key],m.previous,m.current,m.delta)}));
  const previousSources=previous?consultationNarrativeSources(previous).sources:[];
  const comparison:NarrativeSource[]=previous?[{id:previous.id,text:`Consultation précédente du ${previous.startedAt.slice(0,10)} : ${previousSources.map(s=>s.text).join(' ')}`,originalText:previousSources.map(s=>s.originalText??s.text).join(' ')}]:[];
  const at=Date.parse(consultation.endedAt??new Date().toISOString());
  const medications:NarrativeSource[]=context.treatments.current.filter(t=>Date.parse(t.startDate)<=at).map(t=>{
    const later=context.treatments.history.filter(h=>h.treatmentId===t.id&&Date.parse(h.occurredAt)>at).sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt))[0];
    const state=later?.previous??t;
    return {id:t.id,text:`Traitement documenté pour cette séance : ${t.medication}, ${treatmentState(state)}.`};
  });
  const changes=context.treatments.history.filter(h=>Date.parse(h.occurredAt)<=at&&(!previous||Date.parse(h.occurredAt)>Date.parse(previous.startedAt))).map(h=>{
    const medication=context.treatments.current.find(t=>t.id===h.treatmentId)?.medication??'médicament non renseigné';
    const before=h.previous,after=h.next;
    const changed=treatmentFields.filter(field=>JSON.stringify(before?.[field])!==JSON.stringify(after?.[field]));
    const doseOnly=before?.dose!=null&&after?.dose!=null&&(before.dose!==after.dose||before.doseUnit!==after.doseUnit)
      &&(['status','frequency','timing','instructions','startDate','endDate'] as const).every(key=>JSON.stringify(before[key])===JSON.stringify(after[key]));
    const transition=doseOnly?narrativeCopy.doseChangeSentence(medication,[before.dose,before.doseUnit].filter(Boolean).join(' '),[after.dose,after.doseUnit].filter(Boolean).join(' '))
      :!before||!after?`Changement documenté de ${medication} : état précédent ${treatmentState(before)} ; nouvel état ${treatmentState(after)}.`
      :`Changement documenté de ${medication} : état précédent ${changedTreatmentState(before,changed.length?changed:treatmentFields)} ; nouvel état ${changedTreatmentState(after,changed.length?changed:treatmentFields)}.`;
    return {id:h.id,originalText:transition,text:`${transition}${h.reason?` Motif consigné : ${h.reason}`:''}${h.notes?` Notes : ${h.notes}`:''}`};
  });
  const contextDigest=createHash('sha256').update(JSON.stringify({previous:previous?consultationNotesSnapshot(previous):null,medications,changes,prompt:NARRATIVE_HASH})).digest('hex');
  // Put historical context before the current visit, with explicit temporal scope.
  input.sources=[...comparison.map(s=>({...s,scope:'previous' as const})),...input.sources.map(s=>({...s,scope:'current' as const})),...trends.map(s=>({...s,scope:'change' as const})),...medications.map(s=>({...s,scope:'current' as const})),...changes.map(s=>({...s,scope:'change' as const}))];
  input.complete&&=context.treatments.historyComplete;
  const narrative = await synthesizeClinicalNarrative(input.sources, signal);
  diagnostic('model-return',{generated:narrative.generated,complete:narrative.complete,method:narrative.method,words:narrative.text.trim().split(/\s+/u).length});
  if (!narrative.generated || narrative.method==='source_selection') throw new SessionSummaryError("unavailable");
  const digest = consultationNotesDigest(consultation);
  diagnostic('verify-notes');
  if (consultationNotesDigest(await readSession(db, consultationId, signal)) !== digest) throw new SessionSummaryError("changed");
  diagnostic('verify-context');
  if((await buildClinicalContext(db,{patientId},{count:1},signal)).sourceRevision!==context.sourceRevision)throw new SessionSummaryError('changed');
  const soap = consultation.notes[0];
  const content = { resume: narrative.text, method: narrative.method ?? "reformulated", notesDigest: digest, complete: input.complete && narrative.complete, generated: true,
    noteStructuree: { subjective: soap?.subjective ?? "", objective: soap?.objective ?? "", assessment: soap?.assessment ?? "", plan: soap?.plan ?? "" }, evolution: [], pointsNonExplores: [] };
  diagnostic('persist');
  const saved = await db.rpc<{ id: string; version: number; content: unknown }>("save_session_analysis", {
    p_consultation_id: consultationId, p_content: JSON.stringify(content),
    p_source_state: JSON.stringify({ notes_hash: createHash("sha256").update(consultation.rawNotes ?? "").digest("hex"), notes_digest: digest, notes_snapshot: consultationNotesSnapshot(consultation), context_digest:contextDigest,previous_consultation_id:previous?.id??null,previous_raw_notes_hash:previous?createHash('sha256').update(previous.rawNotes??'').digest('hex'):null, source_revision:context.sourceRevision, note_areas: 5, historique_notes: previous?1:0, complete: content.complete }),
    p_model: ALEXA_CONVERSATION_MODEL, p_prompt_version: NARRATIVE_VERSION, p_prompt_hash: NARRATIVE_HASH,
  });
  const row = saved.ok ? saved.data[0] : undefined;
  if (saved.ok && !row) throw new SessionSummaryError("changed");
  let persisted = false; let persistedResume = content.resume; let persistedComplete = content.complete; let persistedMethod: typeof content.method | undefined = content.method;
  if (row) {
    const readback = await db.rpc<{ id: string; content: { notesDigest?: string; resume?: string; complete?: boolean; method?: "reformulated" | "extractive" | "source_selection" } }>("get_consultation_analysis", { p_consultation_id: consultationId });
    const stored = readback.ok ? readback.data[0] : undefined;
    if (stored?.id === row.id && stored.content.notesDigest === digest && typeof stored.content.resume === "string" && (stored.content.method==='reformulated'||stored.content.method==='extractive')) {
      persisted = true; persistedResume = stored.content.resume; persistedComplete = stored.content.complete === true; persistedMethod = stored.content.method;
    }
  }

  return { ...content, method: persistedMethod, resume: persistedResume, complete: persistedComplete, analyseId: persisted ? row!.id : null, version: persisted ? row!.version : null, persistee: persisted, sources: { historiqueNotes: previous?1:0 } };
}
