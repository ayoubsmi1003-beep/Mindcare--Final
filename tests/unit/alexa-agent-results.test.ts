import { expect, it, vi } from 'vitest';
vi.mock("@/server/alexa/local-model",async importOriginal=>({...await importOriginal<typeof import("@/server/alexa/local-model")>(),inferLocalText:vi.fn()}));
import { agentExecutor } from '@/server/alexa/agent-tools';
import {queryPatientsSchema} from '@/shared/alexa/agent';
import {inferLocalText} from '@/server/alexa/local-model';
import type {ClinicalContext} from '@/shared/alexa/clinical';
it.each([
 ['2026-10-20T11:00:00Z','2026-10-21T08:00:00Z','demain à 9 h'],
 ['2026-10-20T23:30:00Z','2026-10-21T08:30:00Z',"aujourd’hui à 9 h 30"],
])('renders agenda dates naturally in French using the frozen Algiers day: %s',async(asOf,at,expected)=>{
 const appointmentId='33333333-3333-4333-8333-333333333333',patientId='22222222-2222-4222-8222-222222222222';
 const row={id:appointmentId,patientId,label:'Patient-abc12345',at,status:'confirmed',amount:null};
 const profile={id:patientId,first_name:'Amel',last_name:'Bensaid',missing:[],completed_consultations:2,outstanding_balance:0};
 const rpc=vi.fn().mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='query_alexa_records'?{ok:true,data:[{total:1,rows:[row],totals:{},complete:true,offset:0}]}:name==='search_patients'?{ok:true,data:[{total:1,rows:[profile],metrics:{},unknownAge:0,revision:'a'.repeat(32),asOf,conditions:[],complete:true,offset:0,appliedSpec:JSON.parse(String(args.p_spec))}]}:{ok:false,error:{technical:'unexpected'}});
 const execute=agentExecutor({text:'Montre les rendez-vous du cabinet.',conversationId:'french-agenda',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'agenda',name:'query_agenda',args:{partIds:['agenda'],from:'2026-10-21T00:00:00+01:00',to:'2026-10-22T00:00:00+01:00',limit:5}},asOf,[],new AbortController().signal);
 expect(result.text).toContain(expected);expect(result.text).toContain('Amel Bensaid');expect(result.text).toContain('1 rendez-vous');
 expect(result.text).not.toMatch(/\b(?:AM|PM)\b|Résultat\(s\)/u);
 expect(result.data).toMatchObject({total:1,rows:[row]});expect(result.evidence).toContainEqual(expect.objectContaining({id:appointmentId,type:'appointment',label:'Amel Bensaid'}));
 expect(result.text).not.toContain('Patient-abc12345');
 expect(rpc.mock.calls.find(call=>call[0]==='query_alexa_records')?.[1].p_as_of).toBe(asOf);
 expect(rpc.mock.calls.find(call=>call[0]==='search_patients')?.[0]).toBe('search_patients');
});
it('never presents opaque agenda patient labels as names when the authorized name read is incomplete',async()=>{
 const asOf='2026-10-20T11:00:00Z',appointmentId='33333333-3333-4333-8333-333333333333',patientId='22222222-2222-4222-8222-222222222222';
 const row={id:appointmentId,patientId,label:'Patient-abc12345',at:'2026-10-21T08:00:00Z',status:'confirmed',amount:null};
 const rpc=vi.fn().mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='query_alexa_records'?{ok:true,data:[{total:1,rows:[row],totals:{},complete:true,offset:0}]}:name==='search_patients'?{ok:true,data:[{total:0,rows:[],metrics:{},unknownAge:0,revision:'b'.repeat(32),asOf,conditions:[],complete:true,offset:0,appliedSpec:JSON.parse(String(args.p_spec))}]}:{ok:false,error:{technical:'unexpected'}});
 const execute=agentExecutor({text:'Montre les rendez-vous du cabinet.',conversationId:'agenda-name-unavailable',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'agenda',name:'query_agenda',args:{partIds:['agenda'],from:'2026-10-21T00:00:00+01:00',to:'2026-10-22T00:00:00+01:00'}},asOf,[],new AbortController().signal);
 expect(result.status).toBe('partial');expect(result.complete).toBe(false);expect(result.text).toContain('nom');expect(result.text).not.toContain('Patient-abc12345');
});
it('limits an explicitly requested first-five agenda page to five verified patient names',async()=>{
 const asOf='2026-10-20T11:00:00Z',rows=Array.from({length:7},(_,index)=>({id:`33333333-3333-4333-8333-${String(index+1).padStart(12,'0')}`,patientId:`22222222-2222-4222-8222-${String(index+1).padStart(12,'0')}`,label:`Patient-${String(index+1).padStart(8,'0')}`,at:`2026-10-21T${String(index+8).padStart(2,'0')}:00:00Z`,status:'confirmed',amount:null}));
 const profiles=rows.map((row,index)=>({id:row.patientId,first_name:'Prenom'+(index+1),last_name:'Nom'+(index+1),missing:[],completed_consultations:2,outstanding_balance:0}));
 const rpc=vi.fn().mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='query_alexa_records'?{ok:true,data:[{total:7,rows,totals:{},complete:true,offset:0}]}:name==='search_patients'?{ok:true,data:[{total:5,rows:profiles.slice(0,5),metrics:{},unknownAge:0,revision:'c'.repeat(32),asOf,conditions:[],complete:true,offset:0,appliedSpec:JSON.parse(String(args.p_spec))}]}:{ok:false,error:{technical:'unexpected'}});
 const execute=agentExecutor({text:'Montre les cinq premiers rendez-vous de demain avec les noms des patients.',conversationId:'agenda-first-five-names',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'agenda',name:'query_agenda',args:{partIds:['agenda'],from:'2026-10-21T00:00:00+01:00',to:'2026-10-22T00:00:00+01:00'}},asOf,[],new AbortController().signal);
 expect(result.text).toContain('7 rendez-vous');expect(result.text).toContain('Prenom5 Nom5');expect(result.text).not.toContain('Prenom6 Nom6');expect(result.text).toContain('1–5 / 7');
 expect(result.data).toMatchObject({rows:rows.slice(0,5),hasMore:true});
 const agendaSpec=JSON.parse(String(rpc.mock.calls.find(call=>call[0]==='query_alexa_records')?.[1].p_spec));
 expect(agendaSpec).not.toHaveProperty('limit');
});
it('answers a chronological patient timeline as one concise paragraph without repeating every date',async()=>{
 const patientId='22222222-2222-4222-8222-222222222222',asOf='2026-10-15T12:00:00.000Z';
 const rows=[
  {occurred_at:'2026-10-03T08:00:00Z',event_id:'timeline-note',event_type:'note',label_key:'note',practitioner_name:null,detail:{}},
  {occurred_at:'2026-10-02T08:00:00Z',event_id:'timeline-consultation',event_type:'consultation',label_key:'consultation',practitioner_name:null,detail:{}},
  {occurred_at:'2026-10-01T08:00:00Z',event_id:'timeline-scale',event_type:'echelle',label_key:'scale',practitioner_name:null,detail:{}},
 ];
 const rpc=vi.fn().mockImplementation(async(name:string)=>name==='get_patient'?{ok:true,data:[{id:patientId,first_name:'Amel',last_name:'Bensaid'}]}:name==='list_patient_timeline'?{ok:true,data:rows}:{ok:false,error:{technical:'unexpected'}});
 const execute=agentExecutor({text:'Présente les événements cliniques dans leur ordre chronologique pour le dossier sélectionné.',conversationId:'concise-patient-timeline',clientTurnId:crypto.randomUUID(),appContext:{patientId,page:'/patients/'+patientId}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'timeline',name:'get_patient_context',args:{partIds:['timeline'],section:'timeline'}},asOf,[],new AbortController().signal);
 expect(result.status).toBe('ok');expect(result.complete).toBe(true);expect(result.text.length).toBeLessThan(300);expect(result.text).not.toContain('\n');
 expect(result.text.match(/\b\d{1,2} octobre 2026\b/gu)?.length).toBeLessThanOrEqual(2);
 expect((result.data as {rows:{event_type:string}[]}).rows.map(row=>row.event_type)).toEqual(['echelle','consultation','note']);
 expect(rpc.mock.calls.find(call=>call[0]==='list_patient_timeline')?.[1]).toMatchObject({p_id:patientId,p_limit:21});
});
it('marks a concise timeline summary partial and exposes its continuation when older events exist',async()=>{
 const patientId='22222222-2222-4222-8222-222222222222',asOf='2026-10-15T12:00:00.000Z';
 const rows=Array.from({length:21},(_,index)=>({occurred_at:new Date(Date.UTC(2026,9,15-index)).toISOString(),event_id:`timeline-${index}`,event_type:index%2?'consultation':'note',label_key:'event',practitioner_name:null,detail:{}}));
 const rpc=vi.fn().mockImplementation(async(name:string)=>name==='get_patient'?{ok:true,data:[{id:patientId,first_name:'Amel',last_name:'Bensaid'}]}:name==='list_patient_timeline'?{ok:true,data:rows}:{ok:false,error:{technical:'unexpected'}});
 const execute=agentExecutor({text:'Résume la chronologie du dossier sélectionné.',conversationId:'partial-concise-patient-timeline',clientTurnId:crypto.randomUUID(),appContext:{patientId,page:'/patients/'+patientId}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'timeline',name:'get_patient_context',args:{partIds:['timeline'],section:'timeline'}},asOf,[],new AbortController().signal);
 expect(result.status).toBe('partial');expect(result.complete).toBe(false);expect(result.data).toMatchObject({hasMore:true,timelineNext:{beforeId:'timeline-19'}});expect(result.text).toContain('suite');expect(result.text.length).toBeLessThan(400);
});
it('answers an empty tomorrow agenda in natural French and preserves the one-day window',async()=>{
 const asOf='2026-10-25T12:00:00.000Z',from='2026-10-26T00:00:00+01:00',to='2026-10-27T00:00:00+01:00';
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{total:0,rows:[],totals:{},complete:true,offset:0}]});
 const execute=agentExecutor({text:'Quels rendez-vous sont prévus demain ?',conversationId:'empty-tomorrow-agenda',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'agenda',name:'query_agenda',args:{partIds:['agenda'],from,to}},asOf,[],new AbortController().signal);
 expect(result.text).toBe('Aucun rendez-vous n’est prévu sur la période demandée.');
 expect(JSON.parse(rpc.mock.calls[0]![1].p_spec)).toMatchObject({from,to});
});
it.each([[8143,'Le cabinet compte 8 143 consultations enregistrées.'],[0,'Le cabinet ne compte aucune consultation enregistrée.']])('presents a cabinet consultation count as a natural French answer: %s',async(total,expected)=>{
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{total,rows:[],totals:{},complete:true,offset:0}]});
 const execute=agentExecutor({text:'Combien de consultations sont enregistrées au cabinet ?',conversationId:'natural-consultation-count',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'count',name:'query_consultations',args:{partIds:['count'],mode:'count',status:'all'}},'2026-10-25T12:00:00.000Z',[],new AbortController().signal);
 expect(result.text).toBe(expected);expect(result.data).toMatchObject({total});expect(rpc.mock.calls[0]?.[0]).toBe('query_alexa_records');
});
it.each([[1558,'Le cabinet compte 1 558 patients au total, actifs et archivés.'],[1,'Le cabinet compte 1 patient au total, actif ou archivé.'],[0,'Aucun patient actif ou archivé n’est enregistré au cabinet.']])('presents a count across active and archived patients without internal scope text: %s',async(total,expected)=>{
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{total,rows:[],metrics:{},unknownAge:0,revision:'a'.repeat(32),asOf:'2026-10-25T12:00:00.000Z',conditions:[],complete:true,offset:0}]});
 const text='Combien de patients au total, actifs et archivés ?',execute=agentExecutor({text,conversationId:'all-populations-count',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'all-count',name:'query_patients',args:{partIds:['count'],mode:'count',filters:[],population:'all'}},'2026-10-25T12:00:00.000Z',[],new AbortController().signal);
 expect(result.text).toBe(expected);expect(result.text).not.toMatch(/visibles|valeur nulle|âge au jour/u);
 expect(JSON.parse(rpc.mock.calls[0]![1].p_spec)).toMatchObject({mode:'count',population:'all'});
});
it('uses a bounded, date-free source selection for the six most recent consultation summary',async()=>{
 const patientId='22222222-2222-4222-8222-222222222222';
 const consultations=Array.from({length:6},(_,index)=>({
  id:'33333333-3333-4333-8333-'+String(index+1).padStart(12,'0'),
  startedAt:'2026-10-'+String(7-index).padStart(2,'0')+'T08:00:00Z',endedAt:'2026-10-'+String(7-index).padStart(2,'0')+'T09:00:00Z',rawNotes:null,
  notes:[{id:'44444444-4444-4444-8444-'+String(index+1).padStart(12,'0'),version:'1',status:'signed' as const,subjective:'La personne décrit une évolution documentée au suivi '+(index+1)+'.',objective:null,assessment:null,plan:null,amendments:[]}],
 }));
 const context:ClinicalContext={patientId,consultations,treatments:{current:[],history:[],historyComplete:true},diagnoses:[],scales:[],sourceRevision:'a'.repeat(64),coverage:{requested:6,returned:6,complete:true,hasMore:false}};
 const rpc=vi.fn().mockImplementation(async(name:string)=>{
  if(name==='get_patient')return {ok:true,data:[{id:patientId,first_name:'Patiente',last_name:'Fictive'}]};
  if(name==='get_alexa_clinical_context')return {ok:true,data:[context]};
  return {ok:false,error:{code:'unavailable',message:'Unavailable',technical:'XX000'}};
 });
 vi.mocked(inferLocalText).mockImplementation(async messages=>{
  const request=JSON.parse(String(messages[1]!.content)) as {choices?:{id:string}[]};
  return request.choices?.length?JSON.stringify({selection:request.choices[0]!.id}):'invalid-model-summary';
 });
 const execute=agentExecutor({text:'Résume les six dernières consultations du dossier courant.',conversationId:'six-consultation-summary',clientTurnId:crypto.randomUUID(),appContext:{patientId,page:'/patients/'+patientId}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'summary',name:'get_patient_context',args:{partIds:['summary'],patientId,section:'summary',count:6}},'2026-10-25T12:00:00.000Z',[],new AbortController().signal);
 expect(result.status).toBe('ok');expect(result.complete).toBe(true);expect(result.presentation).toBe('inference');
 expect(result.text).toContain('évolution documentée au suivi');
 expect(result.text).not.toMatch(/2026|octobre|non sign[ée]|brouillon/iu);
 expect(vi.mocked(inferLocalText).mock.calls.some(([messages])=>JSON.parse(String(messages[1]!.content)).choices!==undefined)).toBe(true);
});
it.each(['Affiche son profil.','Affiche son profil. ملاحظة'])('reads the full profile with French framing: %s',async text=>{
 const patientId='22222222-2222-4222-8222-222222222222';
 const profile={id:patientId,record_number:'EVAL-PROFILE',first_name:'Patiente',last_name:'Fictive',birth_date:'1988-02-03',phone:'0550000000',phone_alt:'0660000000',id_document_number:'ID-FICTIF',id_document_issuer:'Commune fictive',sex:'F',marital_status:'marie',address:'Adresse fictive à Alger',emergency_contact:{name:'Contact fictif',relation:'Sœur',phone:'0770000000'},notes_admin:'Préfère le matin',is_active:true};
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[profile]});
 const execute=agentExecutor({text,conversationId:'profile',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId,page:'/patients/'+patientId}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'profile',name:'get_patient_context',args:{partIds:['profile'],section:'profile'}},'2026-10-15T12:00:00.000Z',[],new AbortController().signal);
 expect(result.complete).toBe(true);expect(result.data).toMatchObject(profile);
 for(const value of ['EVAL-PROFILE','0660000000','Commune fictive','Adresse fictive à Alger','Contact fictif','Sœur','0770000000','Préfère le matin','Marié(e)'])expect(result.text).toContain(value);
 expect(rpc.mock.calls.every(call=>call[0]==='get_patient')).toBe(true);
});

it('rejects metrics arguments on a count or list before database dispatch',()=>{
 for(const mode of ['count','list'])expect(queryPatientsSchema.safeParse({partIds:['x'],mode,metrics:['missing_identity_card']}).success).toBe(false);
});

it('refuses a successful metrics envelope that omits one requested metric', async () => {
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{total:32,rows:[],metrics:{active:32},unknownAge:1,revision:'a'.repeat(32),asOf:'2026-10-15T12:00:00.000Z',conditions:[],complete:true,offset:0}]});
 const execute=agentExecutor({text:'Compte les actifs et les enfants.',conversationId:'test',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 await expect(execute({id:'metrics',name:'query_patients',args:{partIds:['active','children'],mode:'metrics',metrics:['active','children']}},'2026-10-15T12:00:00.000Z',[],new AbortController().signal)).rejects.toMatchObject({code:'malformed'});
});
it('answers only the separately requested patient metrics without adding unrequested counts or scope text',async()=>{
 const asOf='2026-10-25T12:00:00.000Z',metrics={unknown_age:0,missing_phone:206,missing_identity_card:308,active:1558,children:0,not_seen_6m:0,never_seen:0};
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{total:1558,rows:[],metrics,unknownAge:0,revision:'d'.repeat(32),asOf,conditions:[],complete:true,offset:0}]});
 const text='Compte les patients sans carte d’identité et ceux sans téléphone, séparément.';
 const execute=agentExecutor({text,conversationId:'separate-missing-metrics',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'metrics',name:'query_patients',args:{partIds:['id-card','phone'],mode:'metrics',metrics:['missing_identity_card','missing_phone'],population:'active'}},asOf,[],new AbortController().signal);
 expect(result.text).toBe('Sans numéro de pièce d’identité : 308\nSans téléphone : 206');
 expect(result.text).not.toMatch(/âge non renseigné|Patients actifs visibles|âge au jour du cabinet/u);
});
it.each([[0,'Le cabinet ne compte aucun patient actif.'],[1,'Le cabinet compte 1 patient actif.'],[1558,`Le cabinet compte ${new Intl.NumberFormat('fr-DZ').format(1558)} patients actifs.`]])('answers a plain active count as one natural French sentence: %s',async(total,expected)=>{
 const asOf='2026-10-25T12:00:00.000Z',rpc=vi.fn().mockResolvedValue({ok:true,data:[{total,rows:[],metrics:{},unknownAge:0,revision:'a'.repeat(32),asOf,conditions:[],complete:true,offset:0}]});
 const execute=agentExecutor({text:'Combien de patients actifs ?',conversationId:'plain-active-count',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'count',name:'query_patients',args:{partIds:['count'],mode:'count',filters:[],population:'active'}},asOf,[],new AbortController().signal);
 expect(result.text).toBe(expected);expect(result.data).toMatchObject({total,patientQuery:{mode:'count',population:'active'}});
 expect(rpc.mock.calls[0]?.[0]).toBe('search_patients');
});
it('describes a six-month consultation absence count naturally and includes never-seen patients',async()=>{
 const asOf='2026-10-25T12:00:00.000Z',condition={field:'no_completed_months',op:'eq',value:6};
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{total:1221,rows:[],metrics:{},unknownAge:0,revision:'d'.repeat(32),asOf,conditions:[condition],complete:true,offset:0,appliedSpec:{filters:[condition]}}]});
 const execute=agentExecutor({text:'Combien de patients n’ont pas été vus depuis six mois ?',conversationId:'natural-not-seen-count',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'count',name:'query_patients',args:{partIds:['count'],mode:'count',filters:[condition],population:'active'}},asOf,[],new AbortController().signal);
 expect(result.text).toBe('Parmi les patients actifs, 1 221 n’ont pas eu de consultation terminée depuis 6 mois, y compris ceux qui n’en ont jamais eu.');
 expect(result.text).not.toMatch(/patient\(s\)|visibles|valeur nulle|âge au jour/u);
});
it('states every filter in a combined patient count without internal schema definitions',async()=>{
 const asOf='2026-10-25T12:00:00.000Z',filters=[{field:'phone',op:'missing',value:null},{field:'completed_consultations',op:'gte',value:1}];
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{total:5,rows:[],metrics:{},unknownAge:0,revision:'e'.repeat(32),asOf,conditions:filters,complete:true,offset:0,appliedSpec:{filters}}]});
 const execute=agentExecutor({text:'Combien de patients sans téléphone ont au moins une consultation terminée ?',conversationId:'natural-combined-patient-count',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'count',name:'query_patients',args:{partIds:['count'],mode:'count',filters,population:'active'}},asOf,[],new AbortController().signal);
 expect(result.text).toBe('Parmi les patients actifs, 5 répondent aux critères : sans numéro de téléphone et avec au moins une consultation terminée.');
 expect(result.text).not.toMatch(/patient\(s\)|visibles|valeur nulle|âge au jour/u);
});
it.each([[5,'En octobre 2026, 5 patients actifs ont eu au moins 3 consultations commencées dans le mois et terminées.'],[0,'En octobre 2026, aucun patient actif n’a eu au moins 3 consultations commencées dans le mois et terminées.']])('summarizes a verified patient count for completed consultations in a month: %s',async(total,expected)=>{
 const asOf='2026-10-25T12:00:00.000Z',condition={field:'completed_consultations',op:'gte',value:3},consultationPeriod={from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00',axis:'started_at'};
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{total,rows:[],metrics:{},unknownAge:0,revision:'c'.repeat(32),asOf,conditions:[condition],complete:true,offset:0,appliedSpec:{filterGroups:[[condition]],consultationPeriod}}]});
 const question='Compte les patients ayant au moins 3 consultations terminées en octobre 2026.';
 const execute=agentExecutor({text:question,conversationId:'natural-period-patient-count',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'count',name:'query_patients',args:{partIds:['count'],mode:'count',filters:[condition],consultationPeriod,population:'active'}},asOf,[],new AbortController().signal);
 expect(result.text).toBe(expected);expect(result.text).not.toMatch(/patient\(s\)|visibles|valeur nulle|âge au jour/u);
 expect(result.data).toMatchObject({total,patientQuery:{mode:'count',filterGroups:[[condition]],consultationPeriod}});
});
it.each([
 ['phone','Combien de patients sont sans téléphone ?','Parmi les patients actifs de votre périmètre, 25 n’ont pas de numéro de téléphone renseigné.'],
 ['identity_card','Combien de patients sont sans carte d’identité ?','Parmi les patients actifs de votre périmètre, 25 n’ont pas de numéro de carte d’identité renseigné.'],
])('answers a verified missing-%s count in concise French without listing patient identities',async(field,question,expected)=>{
 const asOf='2026-10-25T12:00:00.000Z',condition={field,op:'missing',value:null};
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{total:25,rows:[],metrics:{},unknownAge:0,revision:'b'.repeat(32),asOf,conditions:[condition],complete:true,offset:0}]});
 const execute=agentExecutor({text:question,conversationId:'missing-patient-field-count',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'count',name:'query_patients',args:{partIds:['count'],mode:'count',filters:[condition],population:'active'}},asOf,[],new AbortController().signal);
 expect(result.text).toBe(expected);expect(result.data).toMatchObject({total:25,patientQuery:{mode:'count',filters:[condition]}});
 expect(result.evidence).toHaveLength(1);expect(result.evidence[0]?.type).toBe('query');
 expect(rpc.mock.calls[0]?.[0]).toBe('search_patients');
 expect(JSON.parse(rpc.mock.calls[0]![1].p_spec)).toMatchObject({mode:'count',filters:[condition],population:'active'});
});
it.each(['empty','metric','next-page'])('resumes %s with exact prior predicates and no injected model narrowing',async variant=>{
 const filters=[{field:'identity_card',op:'missing',value:null}];
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{total:variant==='empty'?0:25,rows:[],metrics:{},unknownAge:1,revision:'a'.repeat(32),asOf:'2026-10-15T12:00:00.000Z',conditions:filters,complete:true,offset:variant==='next-page'?20:0}]});
 const execute=agentExecutor({text:variant==='empty'?'من هم؟':'Lesquels ?',conversationId:'variants',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 await execute({id:'list',name:'query_patients',args:{partIds:['list'],mode:'count',offset:999,patientIds:['22222222-2222-4222-8222-222222222222']}},'2026-10-16T12:00:00.000Z',[{callId:'previous',status:variant==='empty'?'empty':'ok',complete:true,text:'25',conditionKeys:[],evidence:[],data:{patientQuery:variant==='metric'?{mode:'metrics',metrics:['missing_identity_card']}:{mode:variant==='next-page'?'list':'count',filters},asOf:'2026-10-15T12:00:00.000Z',revision:'a'.repeat(32),offset:0,rows:variant==='next-page'?Array(20).fill({}):[]}}],new AbortController().signal);
 const spec=JSON.parse(rpc.mock.calls[0]![1].p_spec);expect(spec).toMatchObject({mode:'list',filters,offset:variant==='next-page'?20:0,revision:'a'.repeat(32)});expect(spec).not.toHaveProperty('patientIds');expect(spec).not.toHaveProperty('metrics');
});
it.each(['missing','ambiguous'])('does not broaden a %s prior query into an unfiltered list',async variant=>{
 const rpc=vi.fn();const execute=agentExecutor({text:'Lesquels ?',conversationId:'no-broadening',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'list',name:'query_patients',args:{partIds:['list'],mode:'list',reusePrevious:true}},'2026-10-16T12:00:00.000Z',variant==='missing'?[]:[{callId:'previous',status:'ok',complete:true,text:'Metrics',conditionKeys:[],evidence:[],data:{patientQuery:{mode:'metrics',metrics:['active','children']}}}],new AbortController().signal);
 expect(result.status).toBe('needs_input');expect(rpc).not.toHaveBeenCalled();
});
it('keeps the verified count filter and anchor for an explicit list continuation without a model reuse flag',async()=>{
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{total:25,rows:[],metrics:{},unknownAge:1,revision:'a'.repeat(32),asOf:'2026-10-15T12:00:00.000Z',conditions:[{field:'identity_card',op:'missing',value:null}],complete:true,offset:0}]});
 const execute=agentExecutor({text:'Lesquels ?',conversationId:'followup',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 await execute({id:'list',name:'query_patients',args:{partIds:['list'],mode:'count'}},'2026-10-16T12:00:00.000Z',[{callId:'previous',status:'ok',complete:true,text:'25',conditionKeys:['identity_card:missing:null'],evidence:[],data:{patientQuery:{mode:'count',filters:[{field:'identity_card',op:'missing',value:null}]},asOf:'2026-10-15T12:00:00.000Z',revision:'a'.repeat(32),offset:0,rows:[]}}],new AbortController().signal);
 const args=rpc.mock.calls[0]![1];expect(args.p_as_of).toBe('2026-10-15T12:00:00.000Z');expect(JSON.parse(args.p_spec)).toMatchObject({mode:'list',offset:0,filters:[{field:'identity_card',op:'missing',value:null}]});
});

it.each([['08006','database'],['57014','timeout'],['42501','permission']])('reports a patient-resolution query failure as its real read failure: %s',async(technical,code)=>{const rpc=vi.fn().mockResolvedValue({ok:false,error:{code:'indisponible',message:'Diagnostic technique privé',technical}});const execute=agentExecutor({text:'Affiche son profil.',conversationId:'resolution-failure',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:'22222222-2222-4222-8222-222222222222',page:'/patients/test'}},{rpc},{rpc:vi.fn()});await expect(execute({id:'p',name:'get_patient_context',args:{partIds:['p'],section:'profile'}},'2026-10-15T12:00:00Z',[],new AbortController().signal)).rejects.toMatchObject({code});});

it('resolves a name supplied by the doctor even when the model omits patient arguments on a record query',async()=>{
 const patientId='22222222-2222-4222-8222-222222222222',profile={id:patientId,first_name:'Nadia',last_name:'Test',total_count:1};
 const rpc=vi.fn().mockImplementation(async(name:string)=>({ok:true,data:name==='search_patients'||name==='get_patient'?[profile]:[{total:0,rows:[],totals:{},complete:true,offset:0}]}));
 const execute=agentExecutor({text:'Liste les consultations de Nadia Test.',conversationId:'explicit-record-scope',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'read',name:'query_consultations',args:{partIds:['read'],mode:'list',status:'all'}},'2026-10-15T12:00:00Z',[],new AbortController().signal);
 expect(result.patientId).toBe(patientId);expect(result.text).toContain('Nadia Test');expect(rpc.mock.calls[0]?.[0]).toBe('search_patients');const query=rpc.mock.calls.find(c=>c[0]==='query_alexa_records');expect(JSON.parse(query?.[1].p_spec)).toMatchObject({patientId});
});
it.each([
 ['Quels certificats de bonne santé mentale ont été émis ?', '22222222-2222-4222-8222-222222222222'],
 ['Quels certificats de bonne santé mentale ont été émis au cabinet ?', null],
])('binds implicit document reads to the selected patient unless the question is cabinet-wide: %s',async(text,expectedPatientId)=>{
 const patientId='22222222-2222-4222-8222-222222222222',asOf='2026-10-15T12:00:00.000Z';
 const profile={id:patientId,first_name:'Nadia',last_name:'Test',total_count:1};
 const rpc=vi.fn().mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='get_patient'?{ok:true,data:[profile]}:name==='query_alexa_records'?{ok:true,data:[{total:0,rows:[],totals:{},complete:true,offset:0}]}:name==='search_patients'?{ok:true,data:[{total:0,rows:[],metrics:{},unknownAge:0,revision:'a'.repeat(32),asOf,conditions:[],complete:true,offset:0,appliedSpec:JSON.parse(String(args.p_spec))}]}:{ok:false,error:{technical:'unexpected'}});
 const execute=agentExecutor({text,conversationId:'implicit-document-patient-scope',clientTurnId:crypto.randomUUID(),appContext:{patientId,page:'/patients/'+patientId}},{rpc},{rpc:vi.fn()});
 await execute({id:'documents',name:'query_documents',args:{partIds:['documents'],kind:'bonne_sante_mentale',status:'issued'}},asOf,[],new AbortController().signal);
 const query=rpc.mock.calls.find(call=>call[0]==='query_alexa_records');expect(query).toBeDefined();
 expect(JSON.parse(String(query?.[1].p_spec)).patientId??null).toBe(expectedPatientId);
});
it('answers an empty document search in natural French instead of exposing the generic result label',async()=>{
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{total:0,rows:[],totals:{},complete:true,offset:0}]});
 const execute=agentExecutor({text:'Quels documents ont été émis au cabinet ?',conversationId:'empty-document-list',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'documents',name:'query_documents',args:{partIds:['documents'],status:'issued'}},'2026-10-15T12:00:00.000Z',[],new AbortController().signal);
 expect(result.text).toBe('Aucun document ne correspond à votre demande.');expect(result.status).toBe('empty');
});
it('opens the sole issued ordonnance for the explicitly named patient',async()=>{
 const patientId='22222222-2222-4222-8222-222222222222',documentId='44444444-4444-4444-8444-444444444444',asOf='2026-10-15T12:00:00.000Z';
 const profile={id:patientId,first_name:'Nadia',last_name:'Test',total_count:1};
 const record={total:1,rows:[{id:documentId,patientId,label:'Ordonnance',at:asOf,status:'issued',amount:null}],totals:{},complete:true,offset:0};
 const rpc=vi.fn().mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='search_patients'&&typeof args.p_query==='string'?{ok:true,data:[profile]}:name==='get_patient'?{ok:true,data:[profile]}:name==='query_alexa_records'?{ok:true,data:[record]}:{ok:false,error:{technical:'unexpected'}});
 const execute=agentExecutor({text:'Ouvre les ordonnances de Nadia Test.',conversationId:'open-named-ordonnance',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'documents',name:'query_documents',args:{partIds:['documents'],kind:'ordonnance',status:'issued'}},asOf,[],new AbortController().signal);
 const query=rpc.mock.calls.find(c=>c[0]==='query_alexa_records');
 expect(JSON.parse(query?.[1].p_spec)).toMatchObject({patientId,kind:'ordonnance',status:'issued'});
 expect(result.patientId).toBe(patientId);expect(result.navigation).toEqual({target:'document',patientId,documentId});
});
it('opens an ordonnance only for a unique explicit open request',async()=>{
 const patientId='22222222-2222-4222-8222-222222222222',asOf='2026-10-15T12:00:00.000Z';
 const profile={id:patientId,first_name:'Nadia',last_name:'Test',total_count:1};
 const scenarios=[
  {text:'Liste les ordonnances de Nadia Test.',rows:[{id:'44444444-4444-4444-8444-444444444444',patientId,label:'Ordonnance',at:asOf,status:'issued',amount:null}]},
  {text:'Ouvre les ordonnances de Nadia Test.',rows:[{id:'44444444-4444-4444-8444-444444444444',patientId,label:'Ordonnance récente',at:asOf,status:'issued',amount:null},{id:'55555555-5555-4555-8555-555555555555',patientId,label:'Ordonnance ancienne',at:asOf,status:'issued',amount:null}]},
 ];
 for(const [index,scenario] of scenarios.entries()){
  const record={total:scenario.rows.length,rows:scenario.rows,totals:{},complete:true,offset:0};
  const rpc=vi.fn().mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='search_patients'&&typeof args.p_query==='string'?{ok:true,data:[profile]}:name==='get_patient'?{ok:true,data:[profile]}:name==='query_alexa_records'?{ok:true,data:[record]}:{ok:false,error:{technical:'unexpected'}});
  const execute=agentExecutor({text:scenario.text,conversationId:`no-unrequested-document-open-${index}`,clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
  const result=await execute({id:'documents',name:'query_documents',args:{partIds:['documents'],kind:'ordonnance',status:'issued'}},asOf,[],new AbortController().signal);
  if(index===0)expect(result.navigation).toBeUndefined();
  else {
   expect(result.navigation).toEqual({target:'documents',patientId,documentKind:'ordonnance'});
   expect(result.navigation).not.toHaveProperty('documentId');
  }
 }
});
it('does not broaden a two-name document request when the model omits identity arguments',async()=>{const rpc=vi.fn();const execute=agentExecutor({text:'Liste les documents de Nadia Test et de Test Nadia.',conversationId:'ambiguous-record-scope',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});const result=await execute({id:'r',name:'query_documents',args:{partIds:['r'],status:'issued'}},'2026-10-15T12:00:00Z',[],new AbortController().signal);expect(result.status).toBe('needs_input');expect(rpc).not.toHaveBeenCalled();});
it('includes the authorized patient name in cabinet document rows',async()=>{
 const patientId='22222222-2222-4222-8222-222222222222',documentId='44444444-4444-4444-8444-444444444444',asOf='2026-10-15T12:00:00.000Z';
 const record={total:1,rows:[{id:documentId,patientId,label:'Ordonnance',at:'2026-10-10T10:00:00.000Z',status:'issued',amount:null}],totals:{},complete:true,offset:0};
 const profile={id:patientId,first_name:'Amel',last_name:'Bensaid',missing:[],completed_consultations:2,outstanding_balance:0};
 const rpc=vi.fn().mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='query_alexa_records'?{ok:true,data:[record]}:name==='search_patients'?{ok:true,data:[{total:1,rows:[profile],metrics:{},unknownAge:0,revision:'a'.repeat(32),asOf,conditions:[],complete:true,offset:0,appliedSpec:JSON.parse(String(args.p_spec))}]}:{ok:false,error:{technical:'unexpected'}});
 const execute=agentExecutor({text:'Liste les documents récents du cabinet.',conversationId:'documents-with-patient-names',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'documents',name:'query_documents',args:{partIds:['documents'],status:'issued'}},asOf,[],new AbortController().signal);
 expect(result.text).toContain('Amel Bensaid');expect(result.text).not.toContain('Patient-');
 const patientsRead=rpc.mock.calls.find(call=>call[0]==='search_patients');expect(patientsRead).toBeDefined();
 expect(JSON.parse(patientsRead?.[1].p_spec as string)).toMatchObject({mode:'list',population:'all',patientIds:[patientId]});
});
it('marks cabinet documents partial when their associated patient names cannot be read',async()=>{
 const patientId='22222222-2222-4222-8222-222222222222',documentId='44444444-4444-4444-8444-444444444444',asOf='2026-10-15T12:00:00.000Z';
 const record={total:1,rows:[{id:documentId,patientId,label:'Ordonnance',at:null,status:'issued',amount:null}],totals:{},complete:true,offset:0};
 const rpc=vi.fn().mockImplementation(async(name:string)=>name==='query_alexa_records'?{ok:true,data:[record]}:{ok:true,data:[{total:0,rows:[],metrics:{},unknownAge:0,revision:'a'.repeat(32),asOf,conditions:[],complete:true,offset:0}]});
 const execute=agentExecutor({text:'Liste les documents récents du cabinet.',conversationId:'documents-with-hidden-patient-names',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'documents',name:'query_documents',args:{partIds:['documents'],status:'issued'}},asOf,[],new AbortController().signal);
 expect(result.status).toBe('partial');expect(result.complete).toBe(false);expect(result.text).toContain('Les noms de certains patients associés à ces documents');expect(result.text).not.toContain('Patient-');
});
it('keeps a document detail partial when its associated patient name cannot be read',async()=>{
 const patientId='22222222-2222-4222-8222-222222222222',documentId='44444444-4444-4444-8444-444444444444',asOf='2026-10-15T12:00:00.000Z';
 const record={total:1,rows:[{id:documentId,patientId,label:'Ordonnance',at:null,status:'issued',amount:null}],totals:{},complete:true,offset:0};
 const rpc=vi.fn().mockImplementation(async(name:string)=>name==='query_alexa_records'?{ok:true,data:[record]}:name==='get_document'?{ok:true,data:[{document_id:documentId,patient_id:patientId,rendered_html:'<p>Contenu du document</p>'}]}:{ok:true,data:[{total:0,rows:[],metrics:{},unknownAge:0,revision:'a'.repeat(32),asOf,conditions:[],complete:true,offset:0}]});
 const execute=agentExecutor({text:`Lis le contenu du document ${documentId}.`,conversationId:'document-detail-hidden-patient-name',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'document-detail',name:'query_documents',args:{partIds:['document-detail'],documentId,status:'issued'}},asOf,[],new AbortController().signal);
 expect(result.status).toBe('partial');expect(result.complete).toBe(false);expect(result.text).toContain('Les noms de certains patients associés à ces documents');expect(result.text).toContain('Contenu du document');
});

it.each([['Liste ses consultations.','22222222-2222-4222-8222-222222222222'],['Compte les consultations du dossier sélectionné.','22222222-2222-4222-8222-222222222222'],['Liste les consultations du dossier courant.','22222222-2222-4222-8222-222222222222'],['Liste les consultations du cabinet.',null]])('grounds selected-patient scope only when requested: %s',async(text,wanted)=>{const patientId='22222222-2222-4222-8222-222222222222';const rpc=vi.fn().mockImplementation(async(name:string)=>({ok:true,data:name==='get_patient'?[{id:patientId,first_name:'Amel',last_name:'Bensaid'}]:[{total:0,rows:[],totals:{},complete:true,offset:0}]}));const execute=agentExecutor({text,conversationId:'selected-record-scope',clientTurnId:crypto.randomUUID(),appContext:{patientId,page:'/patients/'+patientId}},{rpc},{rpc:vi.fn()});const result=await execute({id:'r',name:'query_consultations',args:{partIds:['r'],mode:'list',status:'all'}},'2026-10-15T12:00:00Z',[],new AbortController().signal);const query=rpc.mock.calls.find(c=>c[0]==='query_alexa_records');expect(JSON.parse(query?.[1].p_spec).patientId??null).toBe(wanted);if(wanted){expect(result.patientId).toBe(wanted);expect(result.text).toContain('Amel Bensaid');}});

it.each([
 ['eq',0,'avec un solde de 0 DZD'],
 ['gt',0,'avec un solde impayé'],
 ['gt',100,'avec un solde supérieur à 100 DZD'],
 ['gte',100,'avec un solde supérieur ou égal à 100 DZD'],
 ['lt',100,'avec un solde inférieur à 100 DZD'],
 ['lte',100,'avec un solde inférieur ou égal à 100 DZD'],
])('describes an outstanding-balance %s filter with its actual operator',async(op,value,criterion)=>{
 const asOf='2026-10-25T12:00:00.000Z',filter={field:'outstanding_balance',op,value};
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{total:5,rows:[],metrics:{},unknownAge:0,revision:'f'.repeat(32),asOf,conditions:[filter],complete:true,offset:0,appliedSpec:{filters:[filter]}}]});
 const execute=agentExecutor({text:'Compte les patients selon leur solde.',conversationId:`balance-count-${op}-${value}`,clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'count',name:'query_patients',args:{partIds:['count'],mode:'count',filters:[filter],population:'active'}},asOf,[],new AbortController().signal);
 expect(result.text).toBe(`Parmi les patients actifs, 5 répondent aux critères : ${criterion}.`);
});

it.each([
 'Quels certificats ont été émis dans l’ensemble du cabinet ?',
 'Quels certificats ont été émis à l’échelle de l’ensemble du cabinet ?',
 'Quels certificats ont été émis pour tout le cabinet ?',
])('keeps explicit whole-cabinet document requests out of selected-patient scope: %s',async text=>{
 const patientId='22222222-2222-4222-8222-222222222222';
 const rpc=vi.fn().mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='get_patient'?{ok:true,data:[{id:patientId,first_name:'Nadia',last_name:'Test'}]}:name==='query_alexa_records'?{ok:true,data:[{total:0,rows:[],totals:{},complete:true,offset:0}]}:name==='search_patients'?{ok:true,data:[{total:0,rows:[],metrics:{},unknownAge:0,revision:'a'.repeat(32),asOf:'2026-10-15T12:00:00.000Z',conditions:[],complete:true,offset:0,appliedSpec:JSON.parse(String(args.p_spec))}]}:{ok:false,error:{technical:'unexpected'}});
 const execute=agentExecutor({text,conversationId:'cabinet-document-scope',clientTurnId:crypto.randomUUID(),appContext:{patientId,page:'/patients/'+patientId}},{rpc},{rpc:vi.fn()});
 await execute({id:'documents',name:'query_documents',args:{partIds:['documents'],status:'issued'}},'2026-10-15T12:00:00.000Z',[],new AbortController().signal);
 const query=rpc.mock.calls.find(call=>call[0]==='query_alexa_records');expect(query).toBeDefined();
 expect(JSON.parse(String(query?.[1].p_spec)).patientId??null).toBeNull();
});
