import {expect,it,vi} from 'vitest';
import {scriptedAlexaRpc} from '../helpers/alexa-rpc';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {emptySessionDetails} from '@/shared/alexa/session-details';
const patient='22222222-2222-4222-8222-222222222222',latest='33333333-3333-4333-8333-333333333333',previous='44444444-4444-4444-8444-444444444444';
const visit=(id:string,day:string,score:number)=>({id,startedAt:`2026-10-${day}T09:00:00Z`,endedAt:`2026-10-${day}T10:00:00Z`,rawNotes:'Difficultés familiales.',notes:[],sessionDetails:{...emptySessionDetails(),mesures:{anxiete:score,sommeil:score,humeur:score}}});
const visits=[visit(latest,'20',4),visit(previous,'10',7)];
const snapshot={status:'active',dose:'50',doseUnit:'mg',frequency:'une prise par jour',timing:['matin'],instructions:null,startDate:'2026-01-01',endDate:null};
const treatment={...snapshot,id:'55555555-5555-4555-8555-555555555555',medication:'Sertraline',version:2};
const change={id:'66666666-6666-4666-8666-666666666666',treatmentId:treatment.id,version:1,action:'update',occurredAt:'2026-10-10T09:00:00Z',previous:{...snapshot,dose:'25'},next:snapshot,reason:'Modification consignée.',notes:null};
function fixture(text:string,options:{oneVisit?:boolean;nextAppointment?:boolean;scales?:{id:string;name:string;administeredAt:string;score:number|null;interpretation:string|null;consultationId?:string|null}[]}={}){
 const rpc=scriptedAlexaRpc(async(name,args)=>{
  if(name==='get_patient')return {ok:true as const,data:[{id:patient}]};
  if(name==='get_alexa_clinical_context'){const rows=options.oneVisit?visits.slice(0,1):visits;return {ok:true as const,data:[{patientId:patient,consultations:rows,treatments:{current:[treatment],history:[change],historyComplete:true},diagnoses:[],scales:options.scales??[],sourceRevision:'a'.repeat(64),coverage:{requested:args.p_limit,returned:rows.length,hasMore:false,complete:true}}]};}
  if(name==='get_patient_workspace')return {ok:true as const,data:[{identite:{id:patient},agenda:{prochain_rendez_vous:options.nextAppointment?{id:latest}:null}}]};
  if(name==='query_alexa_note_sections'){const spec=JSON.parse(String(args.p_spec)) as {consultationId?:string};const id=spec.consultationId??previous;const selected=visits.find(item=>item.id===id)??visits[1]!;return {ok:true as const,data:[{patientId:patient,total:1,revision:'a'.repeat(32),complete:true,rows:[{consultationId:id,startedAt:selected.startedAt,consultationStatus:'closed',sourceId:id,area:'subjective',status:'draft',version:'1',signedAt:null,aiDraft:false,reason:null,text:'Les difficultés familiales persistent.',textLength:38,textOffset:0}]}]};}
  throw Error('UnexpectedGate '+name);
 });
 const execute=agentExecutor({text,conversationId:'session-facts',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:patient,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 return {rpc,execute};
}
it('computes recorded score evolution with both consultations as evidence',async()=>{
 const f=fixture('Comment ses mesures ont-elles évolué ?');
 const result=await f.execute({id:'scores',name:'get_patient_context',args:{partIds:['scores'],section:'notes',area:'structured'}},'2026-10-22T12:00:00Z',[],new AbortController().signal);
 expect(result.text).toContain('baisse de 3 points');expect(result.text).toContain('score précédent 7/10, score actuel 4/10');expect(result.complete).toBe(true);
 expect(result.evidence.filter(e=>e.type==='consultation').map(e=>e.id)).toEqual(expect.arrayContaining([previous,latest]));
});
it('does not invent score comparisons when only one consultation is recorded',async()=>{
 const f=fixture('Comment ses mesures ont-elles évolué ?',{oneVisit:true});
 const result=await f.execute({id:'scores',name:'get_patient_context',args:{partIds:['scores'],section:'notes',area:'structured'}},'2026-10-22T12:00:00Z',[],new AbortController().signal);
 expect(result.text).toMatch(/comparaison.*indisponible|pas.*compar|pas assez/iu);expect(result.text).not.toContain('baisse de');
});
it('returns recorded treatment changes together with the current treatment',async()=>{
 const f=fixture('Quel est son traitement actuel et quels changements sont documentés ?');
 const result=await f.execute({id:'medicines',name:'get_patient_context',args:{partIds:['medicines'],section:'treatments'}},'2026-10-22T12:00:00Z',[],new AbortController().signal);
 expect(result.text).toContain('25');expect(result.text).toContain('50');expect(result.evidence.some(e=>e.id===change.id)).toBe(true);
});
it('anchors an older difficulty to the actual preceding consultation before reading its note',async()=>{
 const f=fixture('Retrouve une difficulté mentionnée dans une ancienne consultation.');
 await f.execute({id:'older',name:'get_patient_context',args:{partIds:['older'],section:'notes',area:'subjective'}},'2026-10-22T12:00:00Z',[],new AbortController().signal);
 const read=f.rpc.mock.calls.find(c=>c[0]==='query_alexa_note_sections');expect(JSON.parse((read![1] as {p_spec:string}).p_spec).consultationId).toBe(previous);
});
it('anchors explicitly requested full notes from the last consultation without a signature clarification',async()=>{
 const f=fixture('Lis le texte intégral des notes de la dernière consultation du dossier courant.');
 await f.execute({id:'latest-notes',name:'get_patient_context',args:{partIds:['latest-notes'],section:'notes'}},'2026-10-22T12:00:00Z',[],new AbortController().signal);
 const read=f.rpc.mock.calls.find(c=>c[0]==='query_alexa_note_sections');
 expect(read).toBeDefined();
 expect(JSON.parse((read![1] as {p_spec:string}).p_spec)).toMatchObject({patientId:patient,consultationId:latest});
 expect(JSON.parse((read![1] as {p_spec:string}).p_spec)).not.toHaveProperty('status');
});
it('answers scale questions with the recorded values and interpretation',async()=>{
 const f=fixture('Quelles échelles sont enregistrées dans le dossier courant ?',{scales:[
  {id:'77777777-7777-4777-8777-777777777777',name:'MADRS',administeredAt:'2026-10-20T09:00:00Z',score:14,interpretation:'Valeur enregistrée.',consultationId:latest},
  {id:'99999999-9999-4999-8999-999999999999',name:'GAD-7',administeredAt:'2026-10-20T09:05:00Z',score:8,interpretation:'légère',consultationId:latest},
  {id:'88888888-8888-4888-8888-888888888888',name:'HAM-D',administeredAt:'2026-10-10T09:00:00Z',score:9,interpretation:null,consultationId:previous},
 ]});
 const result=await f.execute({id:'scales',name:'get_patient_context',args:{partIds:['scales'],section:'scales'}},'2026-10-22T12:00:00Z',[],new AbortController().signal);
 expect(result.complete).toBe(true);expect(result.text).toContain('MADRS');expect(result.text).toContain('14');expect(result.text).toContain('GAD-7');expect(result.text).toContain('8');expect(result.text).toContain('HAM-D');expect(result.text).toContain('9');
 expect(result.text.match(/Consultation du/gu)).toHaveLength(2);
 expect(result.evidence.filter(e=>e.type==='scale')).toHaveLength(3);
});
it('reports a genuinely missing next appointment from the authorized workspace instead of asking for a date',async()=>{
 const f=fixture('Quand est son prochain rendez-vous ?');
 const result=await f.execute({id:'next',name:'query_agenda',args:{partIds:['next']}},'2026-10-22T12:00:00Z',[],new AbortController().signal);
 expect(result.complete).toBe(true);expect(result.text).toMatch(/aucun rendez-vous.*venir/iu);expect(f.rpc.mock.calls.some(c=>c[0]==='get_patient_workspace')).toBe(true);
});
