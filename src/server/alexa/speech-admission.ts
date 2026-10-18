import {z} from 'zod';import {clientSql} from '@/server/jarvis/client-sql';import {classerCharge} from '@/server/egress/classification';import type {AlexaEvent,TurnInput} from '@/shared/alexa/turn';
const publicText=(text:string)=>{const verdict=classerCharge(text,null);return verdict.classe==='C4'&&verdict.decision==='AUTORISER';};
export function legacySpeechAllowed(input:TurnInput,answer:string,events:readonly AlexaEvent[],done:Extract<AlexaEvent,{type:'done'}>):boolean{
 const sentences=events.filter(e=>e.type==='sentence');
 return !input.appContext.patientId&&!done.patientId&&!done.limited&&!!sentences.length&&publicText(input.text)&&publicText(answer)&&!events.some(e=>e.type==='proposal')&&sentences.every(e=>e.type==='sentence'&&['knowledge','inference'].includes(e.kind)&&e.sources.every(s=>s.type==='knowledge'));
}
const history=z.object({messages:z.array(z.object({role:z.string(),contenu:z.string(),createdAt:z.string(),outil:z.unknown().nullable()})).max(50)});
export function admittedHistorySpeech(value:unknown,text:string,now=Date.now()):boolean{
 const raw:unknown=Array.isArray(value)&&value.length===1?(value as unknown[])[0]:value;
 const parsed=history.safeParse(raw);if(!parsed.success||!publicText(text))return false;
 return parsed.data.messages.some(message=>{
  const age=now-Date.parse(message.createdAt);if(message.role!=='jarvis'||!Number.isFinite(age)||age<0||age>=900000||!message.contenu.includes(text))return false;
  const metadata=z.object({version:z.literal(1),events:z.array(z.unknown()).max(100)}).safeParse(message.outil);
  return !!metadata.success&&metadata.data.events.some(event=>z.object({type:z.literal('done'),speechAllowed:z.literal(true),status:z.literal('completed')}).safeParse(event).success);
 });
}
export async function serverAdmittedSpeech(actor:string,text:string):Promise<boolean>{
 const db=clientSql(actor);
 if(process.env['ALEXA_NATIVE_AGENT_ENABLED']==='1'){const r=await db.rpc('get_alexa_speech_admission',{p_text:text});return !r.error&&r.data===true;}
 const r=await db.rpc('get_jarvis_history',{p_limit:50});return !r.error&&admittedHistorySpeech(r.data,text);
}
