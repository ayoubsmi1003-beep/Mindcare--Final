import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {RpcArgs} from '@/services/db/port';
import {AgentReadError,type AgentResult} from '@/shared/alexa/agent';
import {consultationReadCopy as copy} from '@/i18n/alexa-consultation';
type Rpc=(name:string,args:RpcArgs,signal:AbortSignal,allowEmpty?:boolean)=>Promise<unknown>;
const date=z.union([z.iso.datetime({offset:true}),z.date()]).transform(value=>new Date(value).toISOString());
const rowSchema=z.object({id:z.uuid(),patient_id:z.uuid().nullable(),status:z.enum(['open','closed']),started_at:date,ended_at:date.nullable(),appointment_id:z.uuid().nullable(),appointment_kind:z.string().nullable(),record_number:z.string().nullable(),first_name:z.string().nullable(),last_name:z.string().nullable(),practitioner_id:z.uuid(),practitioner_name:z.string().nullable(),note_id:z.uuid().nullable(),note_status:z.enum(['draft','signed']).nullable(),signed_at:date.nullable(),signer_name:z.string().nullable(),lock_after:date.nullable()});
const analysisSchema=z.object({id:z.uuid(),patient_id:z.uuid(),consultation_id:z.uuid(),version:z.number().int().positive(),content:z.json(),source_state:z.json(),model:z.string(),generated_at:date});
const display=(value:string|null)=>value??copy.missing;
const when=(value:string|null)=>value?new Date(value).toLocaleString('fr-DZ',{timeZone:'Africa/Algiers'}):copy.missing;
/** Exact consultation reads reuse the audited application door, then expose only the requested section. */
export async function readConsultation(callId:string,id:string,view:'details'|'analysis',patientId:string|undefined,textOffset:number,revision:string|undefined,rpc:Rpc,signal:AbortSignal):Promise<AgentResult>{
 const rawConsultation=await rpc('get_consultation',{p_id:id},signal,true);
 if(rawConsultation===null)throw new AgentReadError('permission');
 const row=rowSchema.parse(rawConsultation);
 if(row.id!==id||!row.patient_id||(patientId&&patientId!==row.patient_id))throw new AgentReadError('permission');
 const durationMinutes=row.ended_at?(Date.parse(row.ended_at)-Date.parse(row.started_at))/60000:null;
 if(durationMinutes!==null&&(!Number.isFinite(durationMinutes)||durationMinutes<0))throw new AgentReadError('malformed');
 const note={exists:row.note_id!==null,id:row.note_id,status:row.note_status,signedAt:row.signed_at,signer:row.signer_name,lockAfter:row.lock_after};
 const patientLabel=[row.first_name,row.last_name].filter(Boolean).join(' ');
 const evidence:AgentResult['evidence']=[{id,type:'consultation',label:copy.title+' — '+when(row.started_at),provenance:{gate:'get_consultation'}},{id:row.patient_id,type:'patient',label:patientLabel}];
 if(view==='details')return {callId,status:'ok',complete:true,patientId:row.patient_id,conditionKeys:[],evidence,data:{id:row.id,patientId:row.patient_id,status:row.status,startedAt:row.started_at,endedAt:row.ended_at,durationMinutes,appointmentId:row.appointment_id,appointmentKind:row.appointment_kind,practitionerId:row.practitioner_id,practitionerName:row.practitioner_name,note},text:[`${copy.patient} : ${patientLabel} — ${display(row.record_number)}`,`${copy.practitioner} : ${display(row.practitioner_name)}`,`${copy.status} : ${row.status==='closed'?copy.closed:copy.working}`,`${copy.started} : ${when(row.started_at)}`,`${copy.ended} : ${when(row.ended_at)}`,`${copy.duration} : ${durationMinutes===null?copy.missing:durationMinutes+' minutes'}`,`${copy.kind} : ${display(row.appointment_kind)}`,`${copy.appointment} : ${row.appointment_id??copy.none}`,`${copy.note} : ${!note.exists?copy.none:note.status==='signed'?copy.signedStatus:copy.draft}`,`${copy.signed} : ${when(note.signedAt)}`,`${copy.signer} : ${display(note.signer)}`,`${copy.lock} : ${when(note.lockAfter)}`].join('\n')};
 const raw=await rpc('get_consultation_analysis',{p_consultation_id:id},signal,true);
 if(raw===null)return {callId,status:'empty',complete:true,patientId:row.patient_id,conditionKeys:[],evidence,text:copy.noAnalysis,data:{consultationId:id,analysis:null}};
 const analysis=analysisSchema.parse(raw);
 if(analysis.consultation_id!==id||analysis.patient_id!==row.patient_id)throw new AgentReadError('permission');
 const text=JSON.stringify(analysis.content,null,2),hash=createHash('sha256').update(JSON.stringify([analysis.id,analysis.version,analysis.generated_at,text,analysis.source_state])).digest('hex');
 if(revision&&revision!==hash)throw new AgentReadError('changed');
 if(textOffset>text.length)throw new AgentReadError('malformed');
 if(textOffset>0&&/[\uDC00-\uDFFF]/u.test(text[textOffset]??'')&&/[\uD800-\uDBFF]/u.test(text[textOffset-1]??''))throw new AgentReadError('malformed');
 let end=Math.min(text.length,textOffset+1200);if(end<text.length&&/[\uD800-\uDBFF]/u.test(text[end-1]??'')&&/[\uDC00-\uDFFF]/u.test(text[end]??''))end--;
 const excerpt=text.slice(textOffset,end),complete=end>=text.length;
 evidence[0]={...evidence[0]!,version:String(analysis.version),provenance:{gate:'get_consultation_analysis',analysisId:analysis.id,model:analysis.model,generatedAt:analysis.generated_at}};
 return {callId,status:complete?'ok':'partial',complete,patientId:row.patient_id,conditionKeys:[],evidence,data:{consultationQuery:{consultationId:id,view:'analysis',textOffset,revision:hash},revision:hash,...(!complete?{nextTextOffset:textOffset+excerpt.length}:{}),analysis:{id:analysis.id,version:analysis.version,model:analysis.model,generatedAt:analysis.generated_at,text:excerpt,textLength:text.length,textOffset}},text:[copy.analysis,`${copy.version} : ${analysis.version} ; ${copy.generated} : ${when(analysis.generated_at)}`,`${copy.model} : ${analysis.model}`,`« ${excerpt} »`,...(!complete?[`${copy.partial} ${textOffset+excerpt.length} / ${text.length}`]:[])].join('\n')};
}
