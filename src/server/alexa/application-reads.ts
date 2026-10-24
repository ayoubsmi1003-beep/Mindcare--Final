import {createHash} from "node:crypto";
import {z} from 'zod';
import {applicationLabels as labels,applicationReadCopy as copy} from '@/i18n/alexa-application';
import type {RpcArgs} from '@/services/db/port';
import type {AgentResult} from '@/shared/alexa/agent';
import {AgentReadError} from '@/shared/alexa/agent';
import {aujourdHuiCabinet,ajouterJours} from '@/services/finance-calendrier';

type Rpc=(name:string,args:RpcArgs,signal:AbortSignal)=>Promise<unknown>;
const text=z.string().nullable(),money=z.number().int().safe(),amount=z.number().int().nonnegative().safe();

function result(callId:string,data:unknown,lines:string[],gate:string):AgentResult{return {callId,status:'ok',complete:true,data,text:lines.join('\n'),conditionKeys:[],evidence:[{id:callId,type:'query',label:gate,provenance:{gate}}]};}
export async function readApplication(callId:string,view:string,rpc:Rpc,signal:AbortSignal,options:{asOf?:string;offset?:number;revision?:string;query?:string;day?:string;queue?:string}={}):Promise<AgentResult>{
 if(view==='medication_catalog'){
  if(!options.query||options.query.trim().length<2)throw new AgentReadError('malformed');
  const rows=z.array(z.object({id:z.string().max(200),raw_name:z.string().max(500),inn:z.string().max(300),brand_name:text,form:text,strength:text,source:z.string().max(300)})).max(20).parse(await rpc('search_medications',{p_query:options.query,p_limit:20},signal));
  const r=result(callId,{rows,query:options.query},rows.length?rows.map(row=>copy.extended.medication(row.raw_name,row.inn,row.form,row.strength)): [copy.extended.empty],'search_medications');
  r.complete=rows.length<20;r.status=rows.length===20?'partial':rows.length?'ok':'empty';if(!r.complete)r.text+=' '+copy.extended.catalogueLimit;return r;
 }
 if(view==='reception'){
  const day=options.day??aujourdHuiCabinet(new Date(options.asOf!)),queue=options.queue??'all';
  const person={first_name:text.optional(),last_name:text.optional()};
  const appointment=z.object({id:z.uuid(),status:z.string(),...person,arrived_at:text,starts_at:text.optional()});
  const raw=z.object({journee:z.array(appointment),demandes:z.array(z.object({id:z.uuid(),...person,starts_at:text.optional()})),paiements:z.array(z.object({payment_id:z.uuid(),...person,amount_dzd:amount,collected_at:text}))}).parse(await rpc('reception_board',{p_day:day},signal));
  const waiting=raw.journee.filter(row=>row.status==='arrived');
  const members=queue==='waiting'?waiting:queue==='requests'?raw.demandes:queue==='payments'?raw.paiements:raw.journee;
  const revision=createHash('md5').update(JSON.stringify({day,queue,raw})).digest('hex'),offset=options.offset??0;
  if((offset>0&&!options.revision)||(options.revision&&options.revision!==revision))throw new AgentReadError('changed');
  const rows=members.slice(offset,offset+20),complete=offset+rows.length>=members.length;
  const r=result(callId,{day,queue,total:members.length,rows,revision,offset,waiting:waiting.length,requests:raw.demandes.length,payments:raw.paiements.length,applicationQuery:{view:'reception',day,queue},...(!complete?{nextOffset:offset+rows.length}:{})},[
   copy.receptionCount(members.length,day,queue),
   ...rows.map(row=>[row.first_name,row.last_name].filter(Boolean).join(' ')||copy.missing),
   ...(!complete?[copy.page(offset+1,offset+rows.length,members.length),copy.extended.nextPage]:[]),
  ],'reception_board');
  r.status=complete?(members.length?'ok':'empty'):'partial';r.complete=complete;return r;
 }
 if(view==='notifications'||view==='system'){
  const gate='get_alexa_office_status',raw=await rpc(gate,{p_view:view,p_offset:options.offset??0,p_revision:options.revision??null},signal);
  if(view==='system'){
   const value=z.object({view:z.literal('system'),environment:z.enum(['cloud-dev','self-hosted'])}).strict().parse(raw);
   const instant=z.iso.datetime({offset:true}).parse(options.asOf),date=new Date(instant),timezone='Africa/Algiers';
   const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
   const localTime=new Intl.DateTimeFormat('fr-FR',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
   return result(callId,{...value,asOf:instant,localDate,localTime,timezone},[copy.office.system(value.environment,localDate,localTime)],gate);
  }
  const value=z.object({view:z.literal('notifications'),total:amount,unread:amount,kinds:z.array(z.object({kind:z.string().min(1).max(120),total:amount,unread:amount}).strict()).max(20),totalKinds:amount,offset:amount,hasMore:z.boolean(),revision:z.string().regex(/^[a-f0-9]{32}$/)}).strict().parse(raw);
  if(value.offset!==(options.offset??0)||value.unread>value.total||value.kinds.some(k=>k.unread>k.total)||new Set(value.kinds.map(k=>k.kind)).size!==value.kinds.length||value.hasMore!==(value.offset+value.kinds.length<value.totalKinds)||value.kinds.reduce((n,k)=>n+k.total,0)>value.total||value.kinds.reduce((n,k)=>n+k.unread,0)>value.unread)throw new AgentReadError('malformed');
  if(options.revision&&options.revision!==value.revision)throw new AgentReadError('changed');
  const r=result(callId,{...value,...(value.hasMore?{nextOffset:value.offset+value.kinds.length}:{})},[copy.office.notifications(value.total,value.unread),...value.kinds.map(k=>copy.office.kind(copy.office.kinds[k.kind]??k.kind,k.total,k.unread)),...(value.hasMore?[copy.page(value.offset+1,value.offset+value.kinds.length,value.totalKinds)]:[])],gate);
  r.complete=!value.hasMore;r.status=value.hasMore?'partial':value.total?'ok':'empty';return r;
 }
 if(!['cabinet','practitioner'].includes(view))throw new AgentReadError('malformed');
 const gate=view==='cabinet'?'get_my_cabinet':'get_my_profile';
 const raw=await rpc(gate,{},signal);
 const row=view==='cabinet'?z.object({id:z.uuid(),name:z.string(),address:text,phone:text}).parse(raw):z.object({id:z.uuid(),full_name:z.string(),title:text,speciality_fr:text,speciality_ar:text,order_number:text,phone:text}).parse(raw);
 return result(callId,row,Object.entries(row).filter(([key])=>key!=='id').map(([key,value])=>`${labels[key]??key} : ${value??copy.missing}`),gate);
}
export async function readFinanceView(callId:string,mode:string,from:string,to:string,offset:number,rpc:Rpc,signal:AbortSignal,revision?:string):Promise<AgentResult>{
 const du=aujourdHuiCabinet(new Date(from)),au=aujourdHuiCabinet(new Date(Date.parse(to)-1));
 if(Date.parse(to)<=Date.parse(from)||Date.parse(to)-Date.parse(from)>367*86400000||new Date(from).toISOString()!==new Date(du+'T00:00:00+01:00').toISOString()||new Date(to).toISOString()!==new Date(ajouterJours(au,1)+'T00:00:00+01:00').toISOString())throw new AgentReadError('malformed');
 const gate=mode==='charges'?'get_charges_list':'get_finance_overview',raw=await rpc(gate,{p_period_start:du,p_period_end:au},signal);
 if(raw===null)throw new AgentReadError('permission');
 if(!['overview','charges'].includes(mode))return readFinancePanel(callId,mode,du,au,offset,raw,revision);
 if(mode==='overview'){
  const value=z.object({du:z.string(),au:z.string(),pulse:z.object({revenu_periode:amount,charges_periode:amount,resultat_net_periode:money,nb_seances_periode:amount,panier_moyen:amount.nullable(),impayes_total:amount,impayes_count:amount,revenu_aujourdhui:amount,revenu_semaine:amount,revenu_mois:amount,nb_charges_recurrentes:amount})}).parse(raw);
  if(value.du!==du||value.au!==au)throw new AgentReadError('malformed');
  return result(callId,value,[copy.period(du,au),copy.finance.currentClock,...Object.entries(value.pulse).map(([key,n])=>`${labels[key]} : ${n===null?copy.unknown:n}${/revenu|charges_periode|net|moyen|impayes_total/u.test(key)?copy.currency:''}`)],gate);
 }
 const value=z.object({lignes:z.array(z.object({id:z.uuid(),intitule:z.string(),categorie:z.string(),montant:amount,type:z.enum(["recurrente","ponctuelle"]),frequence:text,date_charge:z.iso.date(),date_prochaine_echeance:text})),total_recurrent_mensuel:amount,total_ponctuel_periode:amount}).parse(raw);
 const matching=value.lignes.filter(row=>row.type==="recurrente"||(row.date_charge>=du&&row.date_charge<=au));
 const rows=matching.slice(offset,offset+20),complete=offset+rows.length>=matching.length;
 const r=result(callId,{...value,lignes:rows,total:matching.length,offset,hasMore:!complete},[
  copy.period(du,au),copy.chargePopulation,`${labels.total_recurrent_mensuel} : ${value.total_recurrent_mensuel} DZD`,`${labels.total_ponctuel_periode} : ${value.total_ponctuel_periode} DZD`,
  ...rows.map(row=>`${row.intitule} — ${row.categorie} — ${row.montant} DZD — ${row.type}${row.frequence?' / '+row.frequence:''} — ${row.date_charge}${row.date_prochaine_echeance?copy.finance.deadline+row.date_prochaine_echeance:''}`),
  ...(!complete?[copy.page(offset+1,offset+rows.length,matching.length)]:[])],gate);
 r.complete=complete;r.status=complete?(matching.length?'ok':'empty'):'partial';return r;
}
function readFinancePanel(callId:string,mode:string,du:string,au:string,offset:number,raw:unknown,revision?:string):AgentResult{
 const period=z.object({du:z.iso.date(),au:z.iso.date()}).parse(raw);
 if(period.du!==du||period.au!==au)throw new AgentReadError('malformed');
 const gate='get_finance_overview',f=copy.finance;
 if(mode==='composition'){
  const part=z.object({cle:z.string().max(100),libelle:z.string().max(200),montant:amount,part_pct:z.number().min(0).max(100)});
  const value=z.object({composition:z.object({revenus_par_type:z.array(part.extend({nb_seances:amount})).max(100),charges_par_categorie:z.array(part).max(100)})}).parse(raw);
  return result(callId,{...period,...value},[copy.period(du,au),f.amounts,f.revenueTypes,...value.composition.revenus_par_type.map(r=>f.typeName(r.libelle)+' — '+r.montant+copy.currency+' — '+r.nb_seances+' '+f.sessions+' — '+r.part_pct+' %'),f.chargeCategories,...value.composition.charges_par_categorie.map(r=>f.typeName(r.libelle)+' — '+r.montant+copy.currency+' — '+r.part_pct+' %')],gate);
 }
 if(mode==='evolution'){
  const value=z.object({evolution:z.array(z.object({mois_label:z.string().max(80),mois_iso:z.string().regex(/^\d{4}-\d{2}$/),revenu:amount,charges:amount,resultat_net:money})).length(6)}).parse(raw);
  return result(callId,value,[f.evolution,...value.evolution.map(r=>r.mois_iso+' — '+f.revenue+' : '+r.revenu+copy.currency+' — '+f.charges+' : '+r.charges+copy.currency+' — '+f.net+' : '+r.resultat_net+copy.currency)],gate);
 }
 if(mode==='attention'){
  const value=z.object({attention:z.object({impayes_total:amount,impayes_count:amount,plus_ancien_impaye_jours:amount,echeances_a_venir:z.array(z.object({intitule:z.string().max(500),montant:amount,date_echeance:z.iso.date(),jours_restants:amount})).max(3)})}).parse(raw),a=value.attention;
  const complete=a.echeances_a_venir.length<3;
  const r=result(callId,{...value,deadlineLimit:3,hasMore:complete?false:null},[f.attention,labels['impayes_total']+' : '+a.impayes_total+copy.currency,labels['impayes_count']+' : '+a.impayes_count,f.oldest+' : '+a.plus_ancien_impaye_jours+' '+f.days,...a.echeances_a_venir.map(e=>e.intitule+' — '+e.montant+copy.currency+' — '+e.date_echeance+' — '+e.jours_restants+' '+f.remaining),...(a.echeances_a_venir.length?[]:[f.noDeadline]),...(!complete?[f.deadlineCap]:[])],gate);
  r.complete=complete;r.status=complete?'ok':'partial';return r;
 }
 if(mode!=='calendar')throw new AgentReadError('malformed');
 const value=z.object({calendrier:z.array(z.object({jour_iso:z.iso.date(),montant:amount,nb_seances:amount,a_impaye:z.boolean()})).max(367),calendrier_par_type:z.object({types:z.array(z.object({cle:z.string().max(100),libelle:z.string().max(200)})).max(4),lignes:z.array(z.object({jour_iso:z.iso.date(),cle:z.string().max(100),nb:amount})).max(1468)})}).parse(raw);
 const days=value.calendrier.map(d=>d.jour_iso),types=value.calendrier_par_type.types.map(t=>t.cle),expectedDays=(Date.parse(au)-Date.parse(du))/86400000+1;
 if(days.length!==expectedDays||new Set(days).size!==days.length||days.some(d=>d<du||d>au)||new Set(types).size!==types.length||value.calendrier_par_type.lignes.length!==days.length*types.length||new Set(value.calendrier_par_type.lignes.map(r=>r.jour_iso+':'+r.cle)).size!==value.calendrier_par_type.lignes.length||value.calendrier_par_type.lignes.some(r=>!days.includes(r.jour_iso)||!types.includes(r.cle)))throw new AgentReadError('malformed');
 const sourceRevision=createHash('sha256').update(JSON.stringify({du,au,...value})).digest('hex');
 if(revision&&revision!==sourceRevision)throw new AgentReadError('changed');
 const rows=[...value.calendrier].sort((a,b)=>a.jour_iso.localeCompare(b.jour_iso)).slice(offset,offset+20),pageDays=new Set(rows.map(r=>r.jour_iso)),lines=value.calendrier_par_type.lignes.filter(r=>pageDays.has(r.jour_iso)),complete=offset+rows.length>=days.length;
 const r=result(callId,{...period,revision:sourceRevision,...(!complete?{nextOffset:offset+rows.length}:{}),total:days.length,offset,hasMore:!complete,calendrier:rows,calendrier_par_type:{types:value.calendrier_par_type.types,lignes:lines}},[copy.period(du,au),f.cashDates,f.groupedTypes,...rows.map(r=>r.jour_iso+' — '+r.montant+copy.currency+' — '+r.nb_seances+' '+f.sessions+(r.a_impaye?' — '+f.pending:'')),...lines.map(r=>r.jour_iso+' — '+f.typeName(r.cle)+' : '+r.nb+' '+f.sessions),...(!complete?[copy.page(offset+1,offset+rows.length,days.length)]:[])],gate);
 r.complete=complete;r.status=complete?'ok':'partial';return r;
}
export async function readAppointment(callId:string,id:string,patientId:string|undefined,rpc:Rpc,signal:AbortSignal):Promise<AgentResult>{
 const value=z.object({id:z.uuid(),patient_id:z.uuid().nullable(),starts_at:z.union([z.string(),z.date()]),ends_at:z.union([z.string(),z.date()]),status:z.string(),source:z.string(),kind:text,notes_admin:text,arrived_at:z.union([z.string(),z.date()]).nullable(),record_number:text,first_name:text,last_name:text,practitioner_name:text}).parse(await rpc('get_appointment',{p_id:id},signal));
 if(value.id!==id||(patientId&&value.patient_id!==patientId))throw new AgentReadError('permission');
 const durationMinutes=(new Date(value.ends_at).getTime()-new Date(value.starts_at).getTime())/60000;
 if(!Number.isInteger(durationMinutes)||durationMinutes<=0)throw new AgentReadError('malformed');
 const r=result(callId,{...value,durationMinutes},[`${value.first_name??''} ${value.last_name??''} — ${value.record_number??copy.recordMissing}`,`${copy.appointment.started} : ${new Date(value.starts_at).toLocaleString('fr-DZ',{timeZone:'Africa/Algiers'})}`,`${copy.appointment.duration} : ${durationMinutes} ${copy.appointment.minutes}`,`${copy.appointment.kind} : ${value.kind??copy.missing}`,`${copy.appointment.status} : ${value.status}`,`${copy.appointment.practitioner} : ${value.practitioner_name??copy.missing}`,`${copy.appointment.source} : ${value.source}`,`${copy.appointment.arrived} : ${value.arrived_at?new Date(value.arrived_at).toLocaleString('fr-DZ',{timeZone:'Africa/Algiers'}):copy.notArrived}`,`${copy.appointment.admin} : ${value.notes_admin??copy.adminMissing}`],'get_appointment');
 if(value.patient_id)r.patientId=value.patient_id;r.evidence.push({id,type:'appointment',label:copy.appointmentName});if(value.patient_id)r.evidence.push({id:value.patient_id,type:'patient',label:`${value.first_name??''} ${value.last_name??''}`.trim()});return r;
}

