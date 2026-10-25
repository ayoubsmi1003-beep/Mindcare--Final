import { expect, it, vi } from 'vitest';
import { agentExecutor } from '@/server/alexa/agent-tools';
import {queryPatientsSchema} from '@/shared/alexa/agent';
it.each([
 ['2026-10-20T11:00:00Z','2026-10-21T08:00:00Z','demain à 9 h'],
 ['2026-10-20T23:30:00Z','2026-10-21T08:30:00Z',"aujourd’hui à 9 h 30"],
])('renders agenda dates naturally in French using the frozen Algiers day: %s',async(asOf,at,expected)=>{
 const appointmentId='33333333-3333-4333-8333-333333333333',patientId='22222222-2222-4222-8222-222222222222';
 const row={id:appointmentId,patientId,label:'Amel Bensaid',at,status:'confirmed',amount:null};
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{total:1,rows:[row],totals:{},complete:true,offset:0}]});
 const execute=agentExecutor({text:'Montre les rendez-vous du cabinet.',conversationId:'french-agenda',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'agenda',name:'query_agenda',args:{partIds:['agenda'],from:'2026-10-21T00:00:00+01:00',to:'2026-10-22T00:00:00+01:00'}},asOf,[],new AbortController().signal);
 expect(result.text).toContain(expected);expect(result.text).toContain('Amel Bensaid');expect(result.text).toContain('1 rendez-vous');
 expect(result.text).not.toMatch(/\b(?:AM|PM)\b|Résultat\(s\)/u);
 expect(result.data).toMatchObject({total:1,rows:[row]});expect(result.evidence).toContainEqual(expect.objectContaining({id:appointmentId,type:'appointment'}));
 expect(rpc.mock.calls[0]?.[0]).toBe('query_alexa_records');expect(rpc.mock.calls[0]?.[1].p_as_of).toBe(asOf);
});
it('answers an empty tomorrow agenda in natural French and preserves the one-day window',async()=>{
 const asOf='2026-10-25T12:00:00.000Z',from='2026-10-26T00:00:00+01:00',to='2026-10-27T00:00:00+01:00';
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{total:0,rows:[],totals:{},complete:true,offset:0}]});
 const execute=agentExecutor({text:'Quels rendez-vous sont prévus demain ?',conversationId:'empty-tomorrow-agenda',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'agenda',name:'query_agenda',args:{partIds:['agenda'],from,to}},asOf,[],new AbortController().signal);
 expect(result.text).toBe('Aucun rendez-vous n’est prévu sur la période demandée.');
 expect(JSON.parse(rpc.mock.calls[0]![1].p_spec)).toMatchObject({from,to});
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
it.each([[0,'Le cabinet ne compte aucun patient actif.'],[1,'Le cabinet compte 1 patient actif.'],[1558,`Le cabinet compte ${new Intl.NumberFormat('fr-DZ').format(1558)} patients actifs.`]])('answers a plain active count as one natural French sentence: %s',async(total,expected)=>{
 const asOf='2026-10-25T12:00:00.000Z',rpc=vi.fn().mockResolvedValue({ok:true,data:[{total,rows:[],metrics:{},unknownAge:0,revision:'a'.repeat(32),asOf,conditions:[],complete:true,offset:0}]});
 const execute=agentExecutor({text:'Combien de patients actifs ?',conversationId:'plain-active-count',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'count',name:'query_patients',args:{partIds:['count'],mode:'count',filters:[],population:'active'}},asOf,[],new AbortController().signal);
 expect(result.text).toBe(expected);expect(result.data).toMatchObject({total,patientQuery:{mode:'count',population:'active'}});
 expect(rpc.mock.calls[0]?.[0]).toBe('search_patients');
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
 const patientId='22222222-2222-4222-8222-222222222222',profile={id:patientId,first_name:'Ayoub',last_name:'Salmi',total_count:1};
 const rpc=vi.fn().mockImplementation(async(name:string)=>({ok:true,data:name==='search_patients'||name==='get_patient'?[profile]:[{total:0,rows:[],totals:{},complete:true,offset:0}]}));
 const execute=agentExecutor({text:'Liste les consultations de Ayoub Salmi.',conversationId:'explicit-record-scope',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'read',name:'query_consultations',args:{partIds:['read'],mode:'list',status:'all'}},'2026-10-15T12:00:00Z',[],new AbortController().signal);
 expect(result.patientId).toBe(patientId);expect(rpc.mock.calls[0]?.[0]).toBe('search_patients');const query=rpc.mock.calls.find(c=>c[0]==='query_alexa_records');expect(JSON.parse(query?.[1].p_spec)).toMatchObject({patientId});
});
it('does not broaden a two-name document request when the model omits identity arguments',async()=>{const rpc=vi.fn();const execute=agentExecutor({text:'Liste les documents de Ayoub Salmi et de Belkacem Nadia.',conversationId:'ambiguous-record-scope',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});const result=await execute({id:'r',name:'query_documents',args:{partIds:['r'],status:'issued'}},'2026-10-15T12:00:00Z',[],new AbortController().signal);expect(result.status).toBe('needs_input');expect(rpc).not.toHaveBeenCalled();});

it.each([['Liste ses consultations.','22222222-2222-4222-8222-222222222222'],['Compte les consultations du dossier sélectionné.','22222222-2222-4222-8222-222222222222'],['Liste les consultations du dossier courant.','22222222-2222-4222-8222-222222222222'],['Liste les consultations du cabinet.',null]])('grounds selected-patient scope only when requested: %s',async(text,wanted)=>{const patientId='22222222-2222-4222-8222-222222222222';const rpc=vi.fn().mockImplementation(async(name:string)=>({ok:true,data:name==='get_patient'?[{id:patientId}]:[{total:0,rows:[],totals:{},complete:true,offset:0}]}));const execute=agentExecutor({text,conversationId:'selected-record-scope',clientTurnId:crypto.randomUUID(),appContext:{patientId,page:'/patients/'+patientId}},{rpc},{rpc:vi.fn()});const result=await execute({id:'r',name:'query_consultations',args:{partIds:['r'],mode:'list',status:'all'}},'2026-10-15T12:00:00Z',[],new AbortController().signal);const query=rpc.mock.calls.find(c=>c[0]==='query_alexa_records');expect(JSON.parse(query?.[1].p_spec).patientId??null).toBe(wanted);if(wanted)expect(result.patientId).toBe(wanted);});
