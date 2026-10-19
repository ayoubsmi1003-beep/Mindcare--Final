import {z} from 'zod';
import type {RpcArgs} from '@/services/db/port';
import {AgentReadError,type AgentResult} from '@/shared/alexa/agent';
import {messageDraftCopy as copy} from '@/i18n/alexa-message-draft';
type Rpc=(name:string,args:RpcArgs,signal:AbortSignal)=>Promise<unknown>;
/** Unsent administrative text only. No persistence, communication channel or business write. */
export async function readMessageDraft(callId:string,patientId:string,motif:string,asOf:string,rpc:Rpc,signal:AbortSignal):Promise<AgentResult>{
 const p=z.object({id:z.uuid(),first_name:z.string(),last_name:z.string()}).parse(await rpc('get_patient',{p_id:patientId},signal));
 if(p.id!==patientId)throw new AgentReadError('permission');
 const r:AgentResult={callId,patientId,status:'ok',complete:true,conditionKeys:[],text:'',evidence:[{id:patientId,type:'patient',label:p.first_name+' '+p.last_name}],data:{patientId,sent:false,persisted:false}};
 let body:string;
 if(motif==='rappel_rendez_vous'){
  const value=z.object({patientId:z.uuid(),appointment:z.object({id:z.uuid(),patientId:z.uuid(),startsAt:z.iso.datetime({offset:true}),status:z.enum(['requested','confirmed'])}).strict().nullable()}).strict().parse(await rpc('get_alexa_reminder_context',{p_patient_id:patientId,p_as_of:asOf},signal));
  if(value.patientId!==patientId||value.appointment&&value.appointment.patientId!==patientId)throw new AgentReadError('permission');
  if(!value.appointment)return {...r,status:'empty',text:copy.noAppointment};
  const appointment=value.appointment;
  if(Date.parse(appointment.startsAt)<Date.parse(z.iso.datetime({offset:true}).parse(asOf)))throw new AgentReadError('malformed');
  const date=new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Algiers',weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(appointment.startsAt));
  body=copy.reminder(p.first_name+' '+p.last_name,date,appointment.status==='requested');
  r.evidence.push({id:appointment.id,type:'appointment',label:date});
  r.data={patientId,sent:false,persisted:false,appointment};
 }else if(motif==='document_pret'){
  const value=z.object({total:z.number().int().nonnegative().safe(),complete:z.literal(true),rows:z.array(z.object({id:z.uuid(),patientId:z.uuid().nullable(),status:z.literal('issued')})).max(20)}).parse(await rpc('query_alexa_records',{p_domain:'documents',p_spec:JSON.stringify({patientId,status:'issued'}),p_as_of:asOf},signal));
  if(value.rows.length!==Math.min(value.total,20)||value.rows.some(d=>d.patientId!==patientId))throw new AgentReadError('malformed');
  if(!value.total)return {...r,status:'empty',text:copy.noDocument};
  const document=value.rows[0]!;
  body=copy.document(p.first_name+' '+p.last_name);r.evidence.push({id:document.id,type:'document',label:document.id});
  r.data={patientId,sent:false,persisted:false,documentId:document.id};
 }else throw new AgentReadError('malformed');
 r.text=copy.review(body);return r;
}
