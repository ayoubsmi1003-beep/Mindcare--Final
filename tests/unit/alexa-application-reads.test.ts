import {scriptedAlexaRpc} from '../helpers/alexa-rpc';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('@/server/alexa/clinical-narrative',async original=>({...await original<object>(),summarizeClinicalContext:vi.fn(),summarizeClinicalCaseContext:vi.fn()}));
import {summarizeClinicalContext,summarizeClinicalCaseContext} from '@/server/alexa/clinical-narrative';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {agentSchemas} from '@/shared/alexa/agent';
import {readApplication} from '@/server/alexa/application-reads';
afterEach(()=>{vi.mocked(summarizeClinicalContext).mockReset();vi.mocked(summarizeClinicalCaseContext).mockReset();});
const patient='22222222-2222-4222-8222-222222222222',record='33333333-3333-4333-8333-333333333333';
const input={text:'Affiche les informations demandées.',conversationId:'all-app-reads',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:patient,page:'/patients/'+patient}};
const asOf='2026-10-15T12:00:00.000Z';
it('answers a complete consultation count naturally without a fictitious empty-page range',async()=>{
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{total:26,rows:[],totals:{},complete:true,offset:0}]});
 const result=await agentExecutor({...input,text:'Compte les consultations terminées.',appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()})({id:'count',name:'query_consultations',args:{partIds:['c'],mode:'count',status:'closed'}},asOf,[],new AbortController().signal);
 expect(result.text).toBe('Le cabinet compte 26 consultations terminées.');expect(result).toMatchObject({status:'ok',complete:true});
});
it.each(['Résume les trois premières consultations de Nadia Test.','Liste les premières consultations de ce patient.'])('blocks an unsupported oldest selection before reading any patient: %s',async text=>{
 const rpc=vi.fn();const result=await agentExecutor({...input,text},{rpc},{rpc:vi.fn()})({id:'oldest',name:'get_patient_context',args:{partIds:['s'],section:'summary'}},asOf,[],new AbortController().signal);
 expect(result.status).toBe('unsupported');expect(rpc).not.toHaveBeenCalled();expect(summarizeClinicalContext).not.toHaveBeenCalled();
});
it('blocks an invented model count on a whole-case request before any SQL',async()=>{
 const rpc=vi.fn();const result=await agentExecutor({...input,text:'Résume le cas du patient sélectionné.'},{rpc},{rpc:vi.fn()})({id:'s',name:'get_patient_context',args:{partIds:['s'],section:'summary',count:5}},asOf,[],new AbortController().signal);
 expect(result).toMatchObject({status:'error',error:{code:'unrequested-summary-count'}});expect(rpc).not.toHaveBeenCalled();
});
it.each(['diagnoses','scales'])('answers the recorded %s without treating unrelated missing consultations as a failure',async section=>{
 const context={patientId:patient,consultations:[],treatments:{current:[],history:[],historyComplete:true},sourceRevision:'a'.repeat(64),coverage:{requested:5,returned:0,complete:false,hasMore:false},diagnoses:[{id:record,label:'Diagnostic fictif consigné',code:'F-TEST',primary:true,onsetDate:null,resolvedAt:null}],scales:[{id:record,name:'Échelle fictive',administeredAt:asOf,score:8,interpretation:'Résultat fictif'}]};
  const rpc=scriptedAlexaRpc(async(name:string)=>({ok:true as const,data:[name==='get_patient'?{id:patient}:context]}));
 const result=await agentExecutor(input,{rpc},{rpc:vi.fn()})({id:'r',name:'get_patient_context',args:{partIds:['r'],section}},asOf,[],new AbortController().signal);
 expect(result.complete).toBe(true);expect(result.text).toContain(section==='diagnoses'?'Diagnostic fictif consigné':'Échelle fictive');expect(result.text).not.toContain('Aucune consultation');
});
it('reads cabinet identity from its existing application door without a patient lookup',async()=>{
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{id:record,name:'Cabinet fictif',address:'Adresse fictive',phone:'0550000000',created_at:asOf}]});
 const result=await agentExecutor({...input,text:'Quelle est l’adresse du cabinet ?'},{rpc},{rpc:vi.fn()})({id:'c',name:'query_app',args:{partIds:['c'],view:'cabinet'}},asOf,[],new AbortController().signal);
 expect(rpc).toHaveBeenCalledExactlyOnceWith('get_my_cabinet',{});expect(result.text).toContain('Adresse fictive');expect(result.data).not.toHaveProperty('created_at');
});
it.each([
 ['cabinet',{id:'00000000-0000-0000-0000-000000000001',name:'Cabinet fictif',address:'Adresse fictive',phone:'0550000000'}],
 ['practitioner',{id:'00000000-0000-0000-0000-000000000002',full_name:'Praticien fictif',title:null,speciality_fr:'Psychiatrie',speciality_ar:null,order_number:'12345',phone:null}],
])('accepts PostgreSQL UUIDs with legacy version bits for the %s read',async(view,row)=>{
 const result=await readApplication('legacy-id',view,vi.fn().mockResolvedValue(row),new AbortController().signal);
 expect(result.status).toBe('ok');expect(result.data).toMatchObject(row);
});
it('uses authoritative finance period totals and keeps monthly recurring charges separate',async()=>{
 const rpc=scriptedAlexaRpc(async(name:string)=>({ok:true as const,data:[name==='get_finance_overview'?{du:'2026-10-01',au:'2026-10-31',pulse:{revenu_periode:5000,charges_periode:1200,resultat_net_periode:3800,nb_seances_periode:3,panier_moyen:1667,impayes_total:2000,impayes_count:1,revenu_aujourdhui:500,revenu_semaine:2000,revenu_mois:5000,nb_charges_recurrentes:1}}:{lignes:[],total_recurrent_mensuel:1200,total_ponctuel_periode:300}]}));
 for(const mode of ['overview','charges']){
 const result=await agentExecutor({...input,appContext:{patientId:null,page:'/finances'}},{rpc},{rpc:vi.fn()})({id:mode,name:'query_finance',args:{partIds:[mode],mode,period:'ce mois'}},asOf,[],new AbortController().signal);
 expect(result.complete).toBe(true);expect(result.text).toContain(mode==='overview'?'3800':'1200');
 if(mode==='overview'){
  expect(result.text).toContain('Paiements encaissés de la période : 3');
  expect(result.text).toContain('Montant moyen par paiement encaissé : 1667');
  expect(result.text).not.toContain('Séances de la période');
 }
 }
 expect(rpc.mock.calls[0]).toEqual(['get_finance_overview',{p_period_start:'2026-10-01',p_period_end:'2026-10-31'}]);
 expect(rpc.mock.calls[1]?.[0]).toBe('get_charges_list');
});
it('does not silently broaden a patient-filtered finance overview to the whole cabinet',()=>{
 expect(agentSchemas.query_finance.safeParse({partIds:['a'],mode:'overview',patientId:patient,period:'ce mois'}).success).toBe(false);
});
it('reads verified appointment details including duration, kind and administrative notes',async()=>{
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{id:record,starts_at:'2026-10-16T08:00:00Z',ends_at:'2026-10-16T08:30:00Z',patient_id:patient,status:'confirmed',source:'cabinet',kind:'suivi',notes_admin:'Information fictive de préparation',arrived_at:null,record_number:'TEST-01',first_name:'Patient fictif',last_name:'Évaluation',practitioner_name:'Docteur fictif'}]});
 const result=await agentExecutor(input,{rpc},{rpc:vi.fn()})({id:'a',name:'query_agenda',args:{partIds:['a'],appointmentId:record}},asOf,[{callId:'previous',status:'ok',complete:true,text:'Rendez-vous',conditionKeys:[],evidence:[{id:record,type:'appointment',label:'Demain'}]}],new AbortController().signal);
 expect(result.complete).toBe(true);expect(result.data).toMatchObject({durationMinutes:30,kind:'suivi'});expect(result.text).toContain('Information fictive de préparation');expect(rpc).toHaveBeenCalledExactlyOnceWith('get_appointment',{p_id:record});
});

it('cites the current consultation only and reports omitted long source text as partial',async()=>{
 const historical='44444444-4444-4444-8444-444444444444',current={id:record,startedAt:'2026-10-15T12:00:00Z',endedAt:null,rawNotes:'Texte fictif très long. '.repeat(50),rawNotesVersion:'a'.repeat(64),notes:[]};
 const context={patientId:patient,consultations:[{id:historical,startedAt:'2026-10-01T12:00:00Z',endedAt:'2026-10-01T12:30:00Z',notes:[]}],currentConsultation:current,treatments:{current:[],history:[],historyComplete:true},sourceRevision:'a'.repeat(64),coverage:{requested:1,returned:1,complete:true,hasMore:false},diagnoses:[],scales:[]};
 const rpc=scriptedAlexaRpc(async(name:string)=>({ok:true as const,data:[name==='get_patient'?{id:patient}:context]}));const r=await agentExecutor(input,{rpc},{rpc:vi.fn()})({id:'r',name:'get_patient_context',args:{partIds:['r'],section:'current',count:1}},asOf,[],new AbortController().signal);
 expect(r.complete).toBe(false);expect(r.status).toBe('partial');expect(r.evidence.some(e=>e.id===record&&e.type==='consultation')).toBe(true);expect(r.evidence.some(e=>e.id===historical)).toBe(false);expect(r.data).not.toHaveProperty('consultations');
});
it('does not put an old one-off charge inside the requested month',async()=>{
 const charge=(n:number,type:string,date_charge:string)=>({id:'55555555-5555-4555-8555-'+String(n).padStart(12,'0'),intitule:'Charge fictive '+n,categorie:'autre',montant:100,type,frequence:type==='recurrente'?'mensuelle':null,date_charge,date_prochaine_echeance:null});
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{lignes:[charge(1,'ponctuelle','2026-01-01'),charge(2,'ponctuelle','2026-10-15'),charge(3,'recurrente','2026-01-01')],total_recurrent_mensuel:100,total_ponctuel_periode:100}]});
 const r=await agentExecutor(input,{rpc},{rpc:vi.fn()})({id:'r',name:'query_finance',args:{partIds:['r'],mode:'charges',period:'ce mois'}},asOf,[],new AbortController().signal);expect(r.text).not.toContain('Charge fictive 1');expect(r.text).toContain('Charge fictive 2');expect(r.text).toContain('Charge fictive 3');expect(r.text).toContain('récurrentes actives');
});
it('blocks reversed finance periods and refuses ignored note count arguments',()=>{
 expect(agentSchemas.query_finance.safeParse({partIds:['r'],mode:'charges',from:'2026-10-31T00:00:00+01:00',to:'2026-10-01T00:00:00+01:00'}).success).toBe(false);
 expect(agentSchemas.get_patient_context.safeParse({partIds:['r'],section:'notes',count:5}).success).toBe(false);
});

it('retains authorized diagnoses, treatments, scales, current consultation and history while delegating the concise paragraph',async()=>{
 vi.mocked(summarizeClinicalContext).mockResolvedValueOnce({text:'Le patient rapporte des difficultés familiales.',complete:true,generated:true,sourceIds:[]});
 const context={patientId:patient,consultations:[{id:record,startedAt:'2026-10-01T09:00:00Z',endedAt:'2026-10-01T09:30:00Z',rawNotes:'Fait historique fictif',rawNotesVersion:'b'.repeat(64),notes:[]}],currentConsultation:{id:'44444444-4444-4444-8444-444444444444',startedAt:'2026-10-15T09:00:00Z',endedAt:null,rawNotes:'Séance courante fictive',rawNotesVersion:'c'.repeat(64),notes:[]},treatments:{current:[{id:'55555555-5555-4555-8555-555555555555',medication:'Traitement fictif',version:1,status:'active',dose:'25',doseUnit:'mg',frequency:'matin',timing:[],instructions:null,startDate:'2026-10-01',endDate:null}],history:[],historyComplete:true},sourceRevision:'a'.repeat(64),coverage:{requested:1,returned:1,complete:true,hasMore:false},diagnoses:[{id:'66666666-6666-4666-8666-666666666666',label:'Diagnostic fictif consigné',code:'F-TEST',primary:true,onsetDate:null,resolvedAt:null}],scales:[{id:'77777777-7777-4777-8777-777777777777',name:'Échelle fictive',administeredAt:asOf,score:8,interpretation:'Résultat fictif'}]};
  const rpc=scriptedAlexaRpc(async(name:string)=>({ok:true as const,data:[name==='get_patient'?{id:patient}:context]}));
 const r=await agentExecutor({...input,text:'Résume la dernière consultation de ce dossier.'},{rpc},{rpc:vi.fn()})({id:'s',name:'get_patient_context',args:{partIds:['s'],section:'summary',count:1}},asOf,[],new AbortController().signal);
 expect(r.text).toContain('Le patient rapporte des difficultés familiales.');
 expect(r.data).toMatchObject({summary:{diagnoses:context.diagnoses,treatments:context.treatments,scales:context.scales,currentConsultation:context.currentConsultation,consultations:context.consultations}});
  expect(summarizeClinicalContext).toHaveBeenCalledWith(expect.objectContaining({patientId:patient,consultations:context.consultations}),expect.any(AbortSignal),false,true,{includeDates:false});
 for(const type of ['diagnostic','treatment','scale','consultation'])expect(r.evidence.some(e=>e.type===type)).toBe(true);
 expect(r.data).toHaveProperty('summary');expect(r.complete).toBe(true);
});

it('links a clinical summary to the authorized patient dossier as well as its clinical evidence',async()=>{
 vi.mocked(summarizeClinicalContext).mockResolvedValueOnce({text:'Résumé clinique fictif.',complete:true,generated:true,sourceIds:[record]});
 const context={patientId:patient,consultations:[{id:record,startedAt:'2026-10-01T09:00:00Z',endedAt:'2026-10-01T09:30:00Z',rawNotes:'Fait clinique fictif',rawNotesVersion:'b'.repeat(64),notes:[]}],treatments:{current:[],history:[],historyComplete:true},sourceRevision:'a'.repeat(64),coverage:{requested:1,returned:1,complete:true,hasMore:false},diagnoses:[],scales:[]};
 const rpc=scriptedAlexaRpc(async(name:string)=>({ok:true as const,data:[name==='get_patient'?{id:patient}:context]}));
 const result=await agentExecutor({...input,text:'Résume la dernière consultation de ce dossier.'},{rpc},{rpc:vi.fn()})({id:'linked-summary',name:'get_patient_context',args:{partIds:['summary'],section:'summary',count:1}},asOf,[],new AbortController().signal);
 expect(result.evidence).toContainEqual(expect.objectContaining({id:patient,type:'patient'}));
 expect(result.evidence).toContainEqual(expect.objectContaining({id:record,type:'consultation'}));
});

it('answers an explicitly repeated documented theme without waiting for whole-case generation',async()=>{
 const visits=Array.from({length:3},(_,i)=>({id:`88888888-8888-4888-8888-${String(i+1).padStart(12,'0')}`,startedAt:`2026-0${3-i}-10T09:00:00Z`,endedAt:`2026-0${3-i}-10T09:30:00Z`,notes:[{id:`99999999-9999-4999-8999-${String(i+1).padStart(12,'0')}`,version:'1',status:'signed',subjective:'Le patient décrit un sommeil fragmenté.',objective:'Aucun examen clinique renseigné.',assessment:'Thème récurrent « sommeil fragmenté ».',plan:'Une habitude du soir sera discutée.',amendments:[]}]}));
 const context={patientId:patient,consultations:visits,diagnoses:[],scales:[],treatments:{current:[],history:[],historyComplete:true},sourceRevision:'a'.repeat(64),coverage:{requested:3,returned:3,complete:true,hasMore:false}};
 const rpc=scriptedAlexaRpc(async(name:string)=>({ok:true as const,data:[name==='get_patient'?{id:patient}:context]}));
 vi.mocked(summarizeClinicalContext).mockReset();
 const result=await agentExecutor({...input,text:'Quel est le thème récurrent des notes de ce patient ?'},{rpc},{rpc:vi.fn()})({id:'theme',name:'get_patient_context',args:{partIds:['theme'],section:'summary'}},asOf,[],new AbortController().signal);
 expect(summarizeClinicalContext).not.toHaveBeenCalled();
 expect(result).toMatchObject({status:'ok',complete:true,text:'Les notes font ressortir le thème récurrent « sommeil fragmenté ».',presentation:'inference'});
 expect([...new Set(result.evidence.filter(e=>e.type==='consultation').map(e=>e.id))].sort()).toEqual(visits.map(visit=>visit.id).sort());
});

it('bounds an unqualified chronology to six recent consultations and reports older history',async()=>{
 const visits=Array.from({length:6},(_,i)=>({id:`88888888-8888-4888-8888-${String(i+1).padStart(12,'0')}`,startedAt:`2026-10-${String(15-i).padStart(2,'0')}T09:00:00Z`,endedAt:`2026-10-${String(15-i).padStart(2,'0')}T09:30:00Z`,notes:[{id:`99999999-9999-4999-8999-${String(i+1).padStart(12,'0')}`,version:'1',subjective:'Événement clinique consigné.',objective:null,assessment:null,plan:null,amendments:[]}]}));
 const context={patientId:patient,consultations:visits,diagnoses:[],scales:[],treatments:{current:[],history:[],historyComplete:true},sourceRevision:'a'.repeat(64),coverage:{requested:6,returned:6,complete:true,hasMore:true,next:{startedAt:visits.at(-1)!.startedAt,id:visits.at(-1)!.id}}};
 vi.mocked(summarizeClinicalContext).mockResolvedValueOnce({text:'Les consultations récentes décrivent une évolution clinique suivie.',complete:false,generated:true,sourceIds:visits.map(visit=>visit.id)});
 const rpc=scriptedAlexaRpc(async(name:string,args)=>({ok:true as const,data:[name==='get_patient'?{id:patient}:{...context,coverage:{...context.coverage,requested:Number(args.p_limit),hasMore:Number(args.p_limit)===6,...(Number(args.p_limit)===6?{next:{startedAt:visits.at(-1)!.startedAt,id:visits.at(-1)!.id}}:{})}}]}));
 const question='Présente les événements cliniques dans leur ordre chronologique pour ce dossier.';
 const result=await agentExecutor({...input,text:question},{rpc},{rpc:vi.fn()})({id:'chronology',name:'get_patient_context',args:{partIds:['chronology'],section:'summary'}},asOf,[],new AbortController().signal);
 const clinicalRead=rpc.mock.calls.find(([name])=>name==='get_alexa_clinical_context');
 expect(clinicalRead?.[1]).toMatchObject({p_patient_id:patient,p_limit:6,p_before_at:null,p_before_id:null});
 expect(summarizeClinicalContext).toHaveBeenCalledWith(expect.objectContaining({consultations:visits}),expect.any(AbortSignal),true,true,{chronological:true,includeDates:false});
 expect(result).toMatchObject({status:'partial',complete:false});expect(result.text).toContain('Les consultations récentes');expect(result.text).toContain('six consultations terminées les plus récentes');expect(result.text).toContain('les précédentes restent à parcourir');
});

it('honors an explicit number in a chronological summary instead of the default six',async()=>{
 const visits=Array.from({length:3},(_,i)=>({id:`88888888-8888-4888-8888-${String(i+1).padStart(12,'0')}`,startedAt:`2026-10-${String(15-i).padStart(2,'0')}T09:00:00Z`,endedAt:`2026-10-${String(15-i).padStart(2,'0')}T09:30:00Z`,notes:[{id:`99999999-9999-4999-8999-${String(i+1).padStart(12,'0')}`,version:'1',subjective:'Événement clinique consigné.',objective:null,assessment:null,plan:null,amendments:[]}]}));
 const context={patientId:patient,consultations:visits,diagnoses:[],scales:[],treatments:{current:[],history:[],historyComplete:true},sourceRevision:'a'.repeat(64),coverage:{requested:3,returned:3,complete:true,hasMore:true,next:{startedAt:visits.at(-1)!.startedAt,id:visits.at(-1)!.id}}};
 vi.mocked(summarizeClinicalContext).mockResolvedValueOnce({text:'Les trois consultations retracent une évolution.',complete:true,generated:true,sourceIds:visits.map(visit=>visit.id)});
 const rpc=scriptedAlexaRpc(async(name:string,args)=>({ok:true as const,data:[name==='get_patient'?{id:patient}:{...context,coverage:{...context.coverage,requested:Number(args.p_limit)}}]}));
 const question='Résume les trois consultations de ce dossier dans leur ordre chronologique.';
 const result=await agentExecutor({...input,text:question},{rpc},{rpc:vi.fn()})({id:'chronology-three',name:'get_patient_context',args:{partIds:['chronology-three'],section:'summary',count:3}},asOf,[],new AbortController().signal);
 const clinicalRead=rpc.mock.calls.find(([name])=>name==='get_alexa_clinical_context');
 expect(clinicalRead?.[1]).toMatchObject({p_patient_id:patient,p_limit:3,p_before_at:null,p_before_id:null});
  expect(summarizeClinicalContext).toHaveBeenCalledWith(expect.objectContaining({consultations:visits}),expect.any(AbortSignal),false,true,{includeDates:false});
 expect(result).toMatchObject({status:'ok',complete:true});
});

it('rejects an empty OR-status filter rather than presenting an accidental empty agenda',()=>{expect(agentSchemas.query_agenda.safeParse({partIds:['p'],period:'demain',statuses:[]}).success).toBe(false);});

it('rejects a finance request with no explicit view before any authoritative read',()=>{expect(agentSchemas.query_finance.safeParse({partIds:['f'],period:'ce mois'}).success).toBe(false);});

it('reports a model synthesis failure as an error rather than an inferred partial answer',async()=>{
 vi.mocked(summarizeClinicalCaseContext).mockResolvedValueOnce({text:'La synthèse fiable est indisponible.',complete:false,generated:false,sourceIds:[]});
 const context={patientId:patient,consultations:[{id:record,startedAt:'2026-10-01T09:00:00Z',endedAt:'2026-10-01T09:30:00Z',rawNotes:'Fait clinique fictif à synthétiser.',rawNotesVersion:'b'.repeat(64),notes:[]}],treatments:{current:[],history:[],historyComplete:true},sourceRevision:'a'.repeat(64),coverage:{requested:5,returned:1,complete:true,hasMore:false},diagnoses:[],scales:[]};
 const rpc=scriptedAlexaRpc(async(name:string)=>({ok:true as const,data:[name==='get_patient'?{id:patient}:context]}));
 const r=await agentExecutor(input,{rpc},{rpc:vi.fn()})({id:'s',name:'get_patient_context',args:{partIds:['s'],section:'summary'}},asOf,[],new AbortController().signal);
 expect(r).toMatchObject({status:'error',complete:false,error:{code:'clinical-synthesis-unavailable'}});
 expect(r.presentation).toBeUndefined();
 expect(summarizeClinicalCaseContext).toHaveBeenCalledTimes(1);
});

it('returns authoritative empty clinical coverage as empty rather than a model outage',async()=>{
 vi.mocked(summarizeClinicalCaseContext).mockResolvedValueOnce({text:'Aucun élément clinique renseigné.',complete:true,generated:false,sourceIds:[]});
 const context={patientId:patient,consultations:[],treatments:{current:[],history:[],historyComplete:true},sourceRevision:'a'.repeat(64),coverage:{requested:5,returned:0,complete:true,hasMore:false},diagnoses:[],scales:[]};
 const rpc=scriptedAlexaRpc(async(name:string)=>({ok:true as const,data:[name==='get_patient'?{id:patient}:context]}));
 const result=await agentExecutor(input,{rpc},{rpc:vi.fn()})({id:'e',name:'get_patient_context',args:{partIds:['e'],section:'summary'}},asOf,[],new AbortController().signal);
 expect(result).toMatchObject({status:'empty',complete:true});expect(result.error).toBeUndefined();expect(result.presentation).toBeUndefined();
});
