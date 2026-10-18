import {scriptedAlexaRpc} from '../helpers/alexa-rpc';
import {expect,it,vi} from 'vitest';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {agentSchemas} from '@/shared/alexa/agent';
const patient='22222222-2222-4222-8222-222222222222',record='33333333-3333-4333-8333-333333333333';
const input={text:'Affiche les informations demandées.',conversationId:'all-app-reads',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:patient,page:'/patients/'+patient}};
const asOf='2026-10-15T12:00:00.000Z';
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
it('uses authoritative finance period totals and keeps monthly recurring charges separate',async()=>{
 const rpc=scriptedAlexaRpc(async(name:string)=>({ok:true as const,data:[name==='get_finance_overview'?{du:'2026-10-01',au:'2026-10-31',pulse:{revenu_periode:5000,charges_periode:1200,resultat_net_periode:3800,nb_seances_periode:3,panier_moyen:1667,impayes_total:2000,impayes_count:1,revenu_aujourdhui:500,revenu_semaine:2000,revenu_mois:5000,nb_charges_recurrentes:1}}:{lignes:[],total_recurrent_mensuel:1200,total_ponctuel_periode:300}]}));
 for(const mode of ['overview','charges']){
 const result=await agentExecutor({...input,appContext:{patientId:null,page:'/finances'}},{rpc},{rpc:vi.fn()})({id:mode,name:'query_finance',args:{partIds:[mode],mode,period:'ce mois'}},asOf,[],new AbortController().signal);
 expect(result.complete).toBe(true);expect(result.text).toContain(mode==='overview'?'3800':'1200');
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

it('summarizes diagnoses, treatments, scales, current consultation and history together with their own sources',async()=>{
 const context={patientId:patient,consultations:[{id:record,startedAt:'2026-10-01T09:00:00Z',endedAt:'2026-10-01T09:30:00Z',rawNotes:'Fait historique fictif',rawNotesVersion:'b'.repeat(64),notes:[]}],currentConsultation:{id:'44444444-4444-4444-8444-444444444444',startedAt:'2026-10-15T09:00:00Z',endedAt:null,rawNotes:'Séance courante fictive',rawNotesVersion:'c'.repeat(64),notes:[]},treatments:{current:[{id:'55555555-5555-4555-8555-555555555555',medication:'Traitement fictif',version:1,status:'active',dose:'25',doseUnit:'mg',frequency:'matin',timing:[],instructions:null,startDate:'2026-10-01',endDate:null}],history:[],historyComplete:true},sourceRevision:'a'.repeat(64),coverage:{requested:1,returned:1,complete:true,hasMore:false},diagnoses:[{id:'66666666-6666-4666-8666-666666666666',label:'Diagnostic fictif consigné',code:'F-TEST',primary:true,onsetDate:null,resolvedAt:null}],scales:[{id:'77777777-7777-4777-8777-777777777777',name:'Échelle fictive',administeredAt:asOf,score:8,interpretation:'Résultat fictif'}]};
 const rpc=scriptedAlexaRpc(async(name:string)=>({ok:true as const,data:[name==='get_patient'?{id:patient}:context]}));
 const r=await agentExecutor({...input,text:'Résume les éléments cliniques de ce dossier.'},{rpc},{rpc:vi.fn()})({id:'s',name:'get_patient_context',args:{partIds:['s'],section:'summary',count:1}},asOf,[],new AbortController().signal);
 for(const fact of ['Diagnostic fictif consigné','Traitement fictif','Échelle fictive','Séance courante fictive','Fait historique fictif'])expect(r.text).toContain(fact);
 for(const type of ['diagnostic','treatment','scale','consultation'])expect(r.evidence.some(e=>e.type===type)).toBe(true);
 expect(r.data).toHaveProperty('summary');expect(r.complete).toBe(true);
});

it('rejects an empty OR-status filter rather than presenting an accidental empty agenda',()=>{expect(agentSchemas.query_agenda.safeParse({partIds:['p'],period:'demain',statuses:[]}).success).toBe(false);});

it('rejects a finance request with no explicit view before any authoritative read',()=>{expect(agentSchemas.query_finance.safeParse({partIds:['f'],period:'ce mois'}).success).toBe(false);});
