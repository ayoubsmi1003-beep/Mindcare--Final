import { expect, it, vi } from "vitest";
import {unfinishedNativeRequest} from '../helpers/alexa-unfinished-request';
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runAgentLoop,restoreAgentTask,savedAgentTask } from "@/server/alexa/agent-loop";
import {explicitAgentPeriod} from '@/server/alexa/agent-period';
import {agendaIdentityText,nativeAgendaStatusContract} from '@/shared/alexa/agenda-plan';
import { AgentReadError, conditionKey, patientMetricConditions, queryPatientsSchema, validateLedger } from "@/shared/alexa/agent";
import {frenchRequestedOutputs,requestedReadTool,frenchRequestAdmission,frenchPatientCompoundContract} from '@/shared/alexa/request-contract';
import {z} from 'zod';
import type { LocalCompletion } from "@/server/alexa/local-model-protocol";

const id = "11111111-1111-4111-8111-111111111111";
const parts = ["Actifs", "Sans identité", "Enfants", "Sans visite"].map((goal,i) => ({ id: `p${i}`, goal, tools:["query_patients"] as const, conditions: [], dependsOn: [] }));
const calls = (entries: {name:string;args:Record<string,unknown>}[]):LocalCompletion => ({kind:"calls", calls:entries.map((x,i)=>({id:`c${i}-${x.name}`, ...x})),
  message:{role:"assistant",content:null,tool_calls:entries.map((x,i)=>({id:`c${i}-${x.name}`,type:"function",function:{name:x.name,arguments:JSON.stringify(x.args)}}))},tokensIn:20,tokensOut:10});
const input = {text:"Combien de patients actifs, sans identité, enfants et sans visite depuis six mois ?",conversationId:"loop-test",clientTurnId:id,appContext:{patientId:null,page:"/jarvis"}};
const evalCases=(JSON.parse(readFileSync(resolve(process.cwd(),"tests/eval/alexa-minicpm-100-algerian-cases.json"),"utf8")) as {cases:Array<{id:string;family:string;input:string;context:{patientId:string|null;page:string};expected:{toolArguments:Array<{name:string;args:Record<string,unknown>}>}}>} ).cases;
const multiMetricCases=evalCases.filter(testCase=>testCase.family==="questions_multiples_completeness");
const noteCases=evalCases.filter(testCase=>testCase.family==="notes_cliniques");
const generalCases=evalCases.filter(testCase=>testCase.family==="question_generale_llm");
const diagnosisCases=evalCases.filter(testCase=>testCase.family==="diagnostics_fictifs");
const agendaCases=evalCases.filter(testCase=>testCase.family==="agenda");
it('serializes reads that synthesize with the one-slot local model',async()=>{
 let step=0,inFlight=0,peak=0;
 const steps=[calls([{name:'declare_request',args:{parts:[{id:'s',goal:'Synthèse clinique',tools:['get_patient_context'],conditions:[],dependsOn:[]},{id:'k',goal:'Références approuvées',tools:['search_knowledge'],conditions:[],dependsOn:[]}]}}]),calls([{name:'get_patient_context',args:{partIds:['s'],section:'summary'}},{name:'search_knowledge',args:{partIds:['k'],query:'Dépression DSM-5'}}])];
 const result=await runAgentLoop({...input,text:'Compare les éléments disponibles.',conversationId:'one-slot-reads'},{actor:'one-slot-reads',infer:async()=>steps[step++]??{kind:'answer',text:'',tokensIn:0,tokensOut:0},execute:async call=>{
  inFlight++;peak=Math.max(peak,inFlight);await new Promise(resolve=>setTimeout(resolve,5));inFlight--;
  return {callId:call.id,status:'ok',complete:true,text:'Éléments vérifiés',evidence:[],conditionKeys:[]};
 }},new AbortController().signal);
 expect(result.status).toBe('completed');expect(peak).toBe(1);
});
it('does not let a model-chosen count silently narrow a whole-case summary',async()=>{
 let step=0,countOffered=true,executed=0;
 const steps=[calls([{name:'declare_request',args:{parts:[{id:'s',goal:'Résume le cas du patient sélectionné.',tools:['get_patient_context'],conditions:[],dependsOn:[]}]}}]),calls([{name:'get_patient_context',args:{partIds:['s'],section:'summary',count:5}}]),{kind:'answer' as const,text:'',tokensIn:0,tokensOut:0}];
 const result=await runAgentLoop({...input,text:'Résume le cas du patient sélectionné.',conversationId:'whole-case-count'},{actor:'whole-case-count',infer:async(_messages,options)=>{
  if(step===1){const schema=options.tools?.find(t=>t.function.name==='get_patient_context')?.function.parameters as {properties?:Record<string,unknown>};countOffered=!!schema.properties?.count;}
  return steps[step++]??{kind:'answer',text:'',tokensIn:0,tokensOut:0};
 },execute:async call=>{executed++;return {callId:call.id,status:'ok',complete:true,text:'Résumé',evidence:[],conditionKeys:[]};}},new AbortController().signal);
 expect(countOffered).toBe(false);expect(executed).toBe(0);expect(result.status).not.toBe('completed');
});
it.each([
 'Quel numéro national est enregistré pour Lina Ziani ?',
 'Quel numéro de CNI est enregistré pour Yacine Amrani ?',
 'Le dossier de Riad Khelifi contient-il un numéro de CNI ?',
 'Peux-tu vérifier si Samir Ferhat a un numéro de carte d’identité ?',
 'Quel est l’identifiant de la carte nationale de Sarah Boudiaf ?',
])('binds a named French identity read to the profile gate: %s',async text=>{
 let inferenceCalls=0,dispatched:Record<string,unknown>|undefined;
 const result=await runAgentLoop({...input,text,conversationId:'profile-read-'+text},{actor:'profile-read-'+text,infer:async()=>{inferenceCalls++;throw new Error('Unexpected model call');},execute:async call=>{
  dispatched=call.args;
  return {callId:call.id,status:'ok',complete:true,patientId:id,text:'Numéro national : Non renseigné.',evidence:[{id,type:'patient',label:'Patient fictif'}],conditionKeys:[]};
 }},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(dispatched).toMatchObject({partIds:['requested_1'],section:'profile'});
 expect(result.parts).toHaveLength(1);expect(result.parts[0]).toMatchObject({id:'requested_1',goal:text,status:'answered'});
});
it('routes a named completed-consultation count through the exact read tool without model selection',async()=>{
 const text='Combien de consultations terminées sont enregistrées pour Amel Bensaid ?';let inferenceCalls=0;const observed:Record<string,unknown>[]=[];
 expect(frenchRequestAdmission(text,false)).toMatchObject({tools:['query_consultations'],consultationMode:'count',consultationStatus:'closed'});
 const result=await runAgentLoop({...input,text,conversationId:'direct-consultation-count'},{actor:'direct-consultation-count',infer:async()=>{inferenceCalls++;throw new Error('Unexpected model call');},observeCall:call=>observed.push({name:call.name,args:call.args}),execute:async call=>({callId:call.id,status:'ok',complete:true,patientId:id,text:'6 consultations terminées.',evidence:[{id,type:'patient',label:'Patient fictif'}],conditionKeys:[]})},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(observed).toEqual([{name:'query_consultations',args:{partIds:['requested_1'],patientName:'Amel Bensaid',mode:'count',status:'closed'}}]);
 expect(result).toMatchObject({status:'completed',parts:[{id:'requested_1',status:'answered',tools:['query_consultations']} ]});
});
it.each(diagnosisCases)('routes a named diagnosis read through the patient-context gate without model selection: $id',async testCase=>{
 let inferenceCalls=0;const observed:Record<string,unknown>[]=[];
 expect(frenchRequestAdmission(testCase.input,false)).toMatchObject({tools:['get_patient_context'],patientSection:'diagnoses'});
 const result=await runAgentLoop({...input,text:testCase.input,conversationId:'direct-diagnosis-'+testCase.id,appContext:testCase.context},{actor:'direct-diagnosis-'+testCase.id,infer:async()=>{inferenceCalls++;throw new Error('Unexpected model call');},observeCall:call=>observed.push({name:call.name,args:call.args}),execute:async call=>({callId:call.id,status:'ok',complete:true,patientId:id,text:'Marqueur de test fictif.',evidence:[{id,type:'diagnostic',label:'Marqueur de test fictif'}],conditionKeys:[]})},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(observed).toEqual([{name:'get_patient_context',args:{partIds:['requested_1'],section:'diagnoses'}}]);
 expect(result).toMatchObject({status:'completed',parts:[{id:'requested_1',status:'answered',tools:['get_patient_context']}]});
});
it('treats requested patient names as agenda display fields and keeps the requested status filter',async()=>{
 const text='Liste les rendez-vous confirmés du 1 octobre 2026 au 31 octobre 2026 avec le nom et le prénom de chaque patient.';
 let inferenceCalls=0;const observed:Record<string,unknown>[]=[];
 expect(frenchRequestedOutputs(text)).toBeNull();
 expect(frenchRequestAdmission(text,false)).toMatchObject({tools:['query_agenda']});
 expect(agendaIdentityText(text)).not.toMatch(/patient/iu);
 expect(nativeAgendaStatusContract(text)).toEqual({complete:true,statuses:['confirmed']});
 const result=await runAgentLoop({...input,text,conversationId:'agenda-patient-names-display',appContext:{patientId:null,page:'/jarvis'}},{actor:'agenda-patient-names-display',asOf:'2026-10-25T12:00:00+01:00',infer:async()=>{inferenceCalls++;throw new Error('Unexpected model call');},observeCall:call=>observed.push({name:call.name,args:call.args}),execute:async call=>({callId:call.id,status:'ok',complete:true,text:'2 rendez-vous prévus. Amina FICTIVE — 2026-10-26 09:00 — Confirmé.',evidence:[],conditionKeys:[]})},new AbortController().signal);
 expect(inferenceCalls).toBe(0);
 expect(observed).toEqual([{name:'query_agenda',args:{partIds:['requested_1'],from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00',statuses:['confirmed']}}]);
 expect(result).toMatchObject({status:'completed',parts:[{id:'requested_1',status:'answered',tools:['query_agenda']}]});
});
it.each(agendaCases)('routes a single French tomorrow-agenda read through its bounded date gate: $id',async testCase=>{
 let inferenceCalls=0;const observed:Record<string,unknown>[]=[];
 expect(frenchRequestedOutputs(testCase.input)).toBeNull();expect(frenchRequestAdmission(testCase.input,false)).toMatchObject({tools:['query_agenda']});
 expect(explicitAgentPeriod(testCase.input,'2026-10-20T11:00:00Z')).toMatchObject({from:'2026-10-21T00:00:00+01:00',to:'2026-10-22T00:00:00+01:00'});
 const result=await runAgentLoop({...input,text:testCase.input,conversationId:'direct-agenda-'+testCase.id,appContext:testCase.context},{actor:'direct-agenda-'+testCase.id,asOf:'2026-10-20T11:00:00Z',infer:async()=>{inferenceCalls++;throw new Error('Unexpected model call');},observeCall:call=>observed.push({name:call.name,args:call.args}),execute:async call=>({callId:call.id,status:'ok',complete:true,text:'Rendez-vous fictif vérifié.',evidence:[{id:'33333333-3333-4333-8333-333333333333',type:'appointment',label:'Demain'}],conditionKeys:[]})},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(observed).toHaveLength(1);expect(observed[0]).toMatchObject({name:'query_agenda',args:{partIds:['requested_1'],from:'2026-10-21T00:00:00+01:00',to:'2026-10-22T00:00:00+01:00'}});
 if(testCase.id==='mc-100-079')expect((observed[0]?.args as Record<string,unknown>).patientName).toBe('Amel Bensaid');
 expect(result).toMatchObject({status:'completed',parts:[{id:'requested_1',status:'answered',tools:['query_agenda']}]});
});
it.each([
 ["Ouvre l'agenda",'agenda'],
 ['Va au tableau de bord','dashboard'],
 ['Ouvre la liste des patients','patients'],
 ['Ouvre les documents','documents'],
 ['Va aux finances','finances'],
 ['Ouvre les paramètres du cabinet','parametres'],
 ['Ouvre Alexa','jarvis'],
])('uses the closed French route for one explicit global navigation: %s',async(text,target)=>{
 let inferenceCalls=0,dispatched:Record<string,unknown>|undefined;
 expect(frenchRequestAdmission(text,false)).toMatchObject({tools:['navigate'],navigationTarget:target});
 const result=await runAgentLoop({...input,text,conversationId:'direct-nav-'+text},{actor:'direct-nav-'+text,infer:async()=>{inferenceCalls++;throw new Error('Unexpected model call');},execute:async call=>{
  dispatched=call.args;
  return {callId:call.id,status:'ok',complete:true,text:'Page prête.',evidence:[],conditionKeys:[],navigation:{target:target as 'agenda'|'dashboard'|'patients'|'documents'|'finances'|'parametres'|'jarvis'}};
 }},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(dispatched).toMatchObject({partIds:['requested_1'],target});expect(result).toMatchObject({status:'completed',navigation:{target}});
});
it.each(['Combien de notifications non lues ai-je ?','Montre les notifications du cabinet.','Quel est le nombre total de notifications ?'])('uses the audited notification gate without model selection: %s',async text=>{
 let inferenceCalls=0,dispatched:Record<string,unknown>|undefined;
 expect(frenchRequestAdmission(text,false)).toMatchObject({tools:['query_app'],applicationView:'notifications'});
 const result=await runAgentLoop({...input,text,conversationId:'direct-notifications-'+text},{actor:'direct-notifications-'+text,infer:async()=>{inferenceCalls++;throw new Error('Unexpected model call');},execute:async call=>{
  dispatched={name:call.name,...call.args};
  return {callId:call.id,status:'ok',complete:true,text:'Aucune notification n’est visible pour le moment.',evidence:[],conditionKeys:[]};
 }},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(dispatched).toMatchObject({name:'query_app',partIds:['requested_1'],view:'notifications'});expect(result).toMatchObject({status:'completed'});
});
it.each(noteCases)('executes an explicit, validated note search through the notes gate without model selection: $id',async testCase=>{
 let inferenceCalls=0;const observed:Record<string,unknown>[]=[];
 const expectedArgs=testCase.expected.toolArguments.find(entry=>entry.name==='get_patient_context')?.args;
 const result=await runAgentLoop({...input,text:testCase.input,conversationId:'direct-notes-'+testCase.id,appContext:testCase.context},{actor:'direct-notes-'+testCase.id,infer:async()=>{inferenceCalls++;throw new Error('Unexpected model call');},observeCall:call=>observed.push({name:call.name,args:call.args}),execute:async call=>({callId:call.id,status:'ok',complete:true,text:'Marqueur de consultation retrouvé.',patientId:testCase.context.patientId??id,evidence:[],conditionKeys:[]})},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(observed).toEqual([{name:'get_patient_context',args:{partIds:['requested_1'],section:'notes',...expectedArgs}}]);
 expect(result).toMatchObject({status:'completed',parts:[{id:'requested_1',status:'answered',tools:['get_patient_context']}]});
});
it.each(multiMetricCases)('executes all independently requested French cabinet metrics in one authorized read: $id',async testCase=>{
 let inferenceCalls=0;const observed:Record<string,unknown>[]=[];
 const result=await runAgentLoop({...input,text:testCase.input,conversationId:'direct-metrics-'+testCase.id},{actor:'direct-metrics-'+testCase.id,infer:async()=>{inferenceCalls++;throw new Error('Unexpected model call');},observeCall:call=>observed.push({name:call.name,args:call.args}),execute:async call=>({callId:call.id,status:'ok',complete:true,text:'Métriques vérifiées pour les patients actifs.',data:{metrics:Object.fromEntries((call.args['metrics'] as string[]).map(metric=>[metric,1]))},evidence:[{id:call.id,type:'query',label:'Patients actifs'}],conditionKeys:[]})},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(observed).toHaveLength(1);expect(observed[0]).toMatchObject({name:'query_patients',args:{mode:'metrics',population:'active',metrics:['active','missing_identity_card','children','not_seen_6m']}});
 expect((observed[0]?.args as Record<string,unknown>)['partIds']).toHaveLength(4);
 expect(result.status).toBe('completed');expect(result.parts).toHaveLength(4);expect(result.parts.every(part=>part.status==='answered')).toBe(true);
});
it('runs a mixed agenda and administrative review as dependent authorized reads with a four-part ledger',async()=>{
 const text='Montre les rendez-vous de demain, repère les dossiers administratifs incomplets parmi ces patients, résume les champs manquants et prépare une liste de corrections à vérifier.';
 expect(frenchRequestedOutputs(text)).toHaveLength(4);
 const patients=Array.from({length:10},(_,i)=>`b5000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`),appointments=Array.from({length:10},(_,i)=>`b5400000-0000-4000-8000-${String(i+1).padStart(12,'0')}`),reviewed=patients.slice(0,8),observed:Record<string,unknown>[]=[];let inferenceCalls=0;
 const result=await runAgentLoop({...input,text,conversationId:'direct-agenda-review'},{actor:'direct-agenda-review',asOf:'2026-10-20T11:00:00Z',infer:async()=>{inferenceCalls++;throw Error('Unexpected model call');},observeCall:call=>observed.push({name:call.name,args:call.args}),execute:async(call,_asOf,prior)=>{
  if(call.name==='query_agenda')return {callId:call.id,status:'ok',complete:true,text:'10 rendez-vous demain.',data:{total:10,rows:appointments.map(id=>({id})),offset:0,agendaPatientIds:patients,hasMore:false},evidence:appointments.map(id=>({id,type:'appointment' as const,label:'Rendez-vous fictif'})),conditionKeys:[]};
  expect(call.name).toBe('query_patients');expect(prior.some(item=>item.data&&typeof item.data==='object'&&'agendaPatientIds' in item.data)).toBe(true);
  return {callId:call.id,status:'ok',complete:true,text:'8 dossiers incomplets.',data:{total:8,rows:reviewed.map(id=>({id,missing:['phone']})),complete:true},evidence:reviewed.map(id=>({id,type:'patient' as const,label:'Patient fictif'})),conditionKeys:[conditionKey({field:'administrative_incomplete',op:'eq',value:true})]};
 }},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(observed.map(call=>call.name)).toEqual(['query_agenda','query_patients']);expect(observed[0]).toMatchObject({args:{from:'2026-10-21T00:00:00+01:00',to:'2026-10-22T00:00:00+01:00'}});expect(observed[1]).toMatchObject({args:{mode:'review',filters:[{field:'administrative_incomplete',op:'eq',value:true}],partIds:['requested_2','requested_3','requested_4']}});
 expect(result.status).toBe('completed');expect(result.parts.map(part=>part.id)).toEqual(['requested_1','requested_2','requested_3','requested_4']);expect(result.parts.every(part=>part.status==='answered')).toBe(true);expect(result.parts.slice(1).every(part=>part.dependsOn.includes('requested_1'))).toBe(true);expect(result.sentences.join('\n')).toMatch(/aucune correction n[’']a été enregistrée/i);expect(result.sentences.join('\n')).toMatch(/à vérifier dans chaque dossier/i);
});
it('answers a mixed three-metric and agenda request while retaining verified metrics after an agenda failure',async()=>{
 const text='Combien de patients sont actifs, combien n’ont pas de CNI, combien ont moins de 18 ans et quels rendez-vous sont prévus demain ?',observed:Record<string,unknown>[]=[];let inferenceCalls=0;
 const result=await runAgentLoop({...input,text,conversationId:'mixed-metrics-agenda-failure'},{actor:'mixed-metrics-agenda-failure',asOf:'2026-10-20T11:00:00Z',infer:async()=>{inferenceCalls++;throw Error('Unexpected model call');},observeCall:call=>observed.push({name:call.name,args:call.args}),execute:async call=>{
  if(call.name==='query_agenda')throw new AgentReadError('database');
  const metrics=['active','missing_identity_card','children'];expect(call.name).toBe('query_patients');return {callId:call.id,status:'ok',complete:true,text:'Patients actifs : 47\nSans identité : 9\nEnfants : 7',data:{metrics:{active:47,missing_identity_card:9,children:7}},evidence:[{id:call.id,type:'query',label:'Métriques vérifiées'}],conditionKeys:metrics.flatMap(metric=>patientMetricConditions[metric as keyof typeof patientMetricConditions].map(conditionKey))};
 }},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(observed).toHaveLength(2);expect(observed.find(call=>call.name==='query_patients')).toMatchObject({args:{mode:'metrics',population:'active',metrics:['active','missing_identity_card','children'],partIds:['requested_1','requested_2','requested_3']}});expect(result.status).toBe('partial');expect(result.parts).toHaveLength(4);expect(result.parts.filter(part=>part.status==='answered')).toHaveLength(3);expect(result.parts.find(part=>part.id==='requested_4')).toMatchObject({status:'failed',tools:['query_agenda']});
});
it('executes a supported compound count-and-list as one atomic filtered query',async()=>{
 const text='Trouve les adultes ayant au moins trois consultations terminées, un solde restant dû positif et aucune consultation terminée depuis 90 jours. Donne le nombre, la liste et trie par solde décroissant.';
 const contract=frenchPatientCompoundContract(text);expect(contract).not.toBeNull();let inferenceCalls=0;const observed:Record<string,unknown>[]=[];
 const result=await runAgentLoop({...input,text,conversationId:'direct-compound-filter'},{actor:'direct-compound-filter',infer:async()=>{inferenceCalls++;throw new Error('Unexpected model call');},observeCall:call=>observed.push({name:call.name,args:call.args}),execute:async call=>({callId:call.id,status:'empty',complete:true,text:'0 patient correspondant.',data:{total:0,rows:[],complete:true,offset:0},evidence:[{id:call.id,type:'query',label:'Filtre patient vérifié'}],conditionKeys:contract!.conditions.map(conditionKey)})},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(observed).toHaveLength(1);expect(observed[0]).toMatchObject({name:'query_patients',args:{mode:'list',population:'active',sort:'outstanding_desc',limit:20,filters:contract!.conditions}});expect((observed[0]?.args as Record<string,unknown>).partIds).toEqual(['count','list']);
 expect(result.status).toBe('completed');expect(result.parts.map(part=>part.id)).toEqual(['count','list']);expect(result.parts.every(part=>part.status==='answered')).toBe(true);
});
const namedReadRouteCases=[
 {id:'mc-100-094',parts:2,calls:2,status:'completed'},
 {id:'mc-100-095',parts:2,calls:2,status:'completed'},
 {id:'mc-100-097',parts:3,calls:3,status:'completed'},
 {id:'mc-100-098',parts:2,calls:2,status:'completed'},
 {id:'mc-100-099',parts:2,calls:1,status:'completed'},
 {id:'mc-100-100',parts:2,calls:1,status:'partial'},
] as const;
it.each(namedReadRouteCases)('routes independent named fields and counts through exact read gates: $id',async route=>{
 const testCase=evalCases.find(item=>item.id===route.id);expect(testCase).toBeDefined();let inferenceCalls=0;const observed:Record<string,unknown>[]=[];
 const result=await runAgentLoop({...input,text:testCase!.input,conversationId:'named-route-'+route.id},{actor:'named-route-'+route.id,asOf:'2026-10-20T11:00:00Z',infer:async()=>{inferenceCalls++;throw Error('Unexpected model call');},observeCall:call=>observed.push({name:call.name,args:call.args}),execute:async call=>{
  if(route.id==='mc-100-095'&&call.name==='get_patient_context')return {callId:call.id,status:'partial',complete:false,text:'Page de notes partielle.',data:{total:11,rows:[{consultationId:'90000000-0000-4000-8000-000000000095',startedAt:'2026-10-19T09:00:00+01:00',area:'working',text:'REPERE-001-S06'},{consultationId:'90000000-0000-4000-8000-000000000094',startedAt:'2026-10-18T09:00:00+01:00',area:'working',text:'Note antérieure.'}],noteQuery:{offset:0}},evidence:[{id:call.id,type:'query',label:'Lecture des notes',provenance:{gate:'query_alexa_note_sections',total:11}},{id:'90000000-0000-4000-8000-000000000095',type:'consultation',label:'Dernière consultation'}],conditionKeys:[]};
  return {callId:call.id,status:'ok',complete:true,text:call.name==='query_consultations'?'6 consultations terminées.':call.name==='query_agenda'?'1 rendez-vous demain.':call.args['section']==='notes'?'REPERE-001-S06':'Coordonnées vérifiées.',evidence:[{id:call.id,type:'query',label:'Lecture vérifiée'}],conditionKeys:[]};
 }},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(observed).toHaveLength(route.calls);expect(result.parts).toHaveLength(route.parts);expect(result.status).toBe(route.status);if(route.id==='mc-100-095'){expect(observed).toContainEqual(expect.objectContaining({name:'get_patient_context',args:expect.objectContaining({section:'notes',patientName:'Amel Bensaid'})}));expect(result.parts.find(part=>part.id==='requested_2')?.status).toBe('answered');expect(result.results.find(item=>item.callId.includes('requested_2'))?.text).toContain('REPERE-001-S06');}if(route.id==='mc-100-099')expect(observed[0]).toMatchObject({name:'get_patient_context',args:{section:'profile',partIds:['requested_1','requested_2']}});if(route.id==='mc-100-100'){expect(result.parts.find(part=>part.status==='unsupported')).toBeDefined();expect(observed.every(call=>call.name==='get_patient_context')).toBe(true);}
});
it.each(generalCases)('routes an explicitly admitted public question to the local answer tool without a selection turn: $id',async testCase=>{
 let inferenceCalls=0;const observed:Record<string,unknown>[]=[];
 const result=await runAgentLoop({...input,text:testCase.input,conversationId:'direct-general-'+testCase.id},{actor:'direct-general-'+testCase.id,infer:async()=>{inferenceCalls++;throw new Error('Public domain is already admitted');},observeCall:call=>observed.push({name:call.name,args:call.args}),execute:async call=>({callId:call.id,status:'ok',complete:true,text:'Réponse générale locale.',evidence:[{id:call.id,type:'query',label:'Réponse locale',provenance:{gate:'local_model'}}],conditionKeys:[]})},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(observed).toEqual([{name:'answer_general',args:{partIds:['requested_1'],question:testCase.input}}]);
 expect(result).toMatchObject({status:'completed',parts:[{id:'requested_1',goal:testCase.input,tools:['answer_general'],status:'answered'}]});
});
it('lets synthetic evaluations observe only the result status and safe error code',async()=>{
 const observed:unknown[]=[];const result=await runAgentLoop({...input,text:'Comment fonctionne un ordinateur ?',conversationId:'observe-direct-result'},{actor:'observe-direct-result',observeResult:value=>observed.push(value),execute:async call=>({callId:call.id,status:'error',complete:false,text:'Réponse indisponible.',evidence:[],conditionKeys:[],error:{code:'general-invalid-response',retryable:false}})},new AbortController().signal);
 expect(result.status).toBe('failed');expect(observed).toEqual([{callId:expect.any(String),name:'answer_general',status:'error',errorCode:'general-invalid-response'}]);
});
it('keeps a raw note page out of MiniCPM context before an independent second read',async()=>{
 const text='Pour Amel Bensaid, quelles sont les notes de consultation et combien de consultations terminées sont enregistrées ?';
 const goals=frenchRequestedOutputs(text);expect(goals).toHaveLength(2);
 const tools=goals!.map(goal=>requestedReadTool(goal,text));let step=0,modelReply:Record<string,unknown>|undefined;
 const steps:LocalCompletion[]=[
  calls([{name:'declare_request',args:{parts:goals!.map((goal,i)=>({id:`p${i+1}`,goal,tool:tools[i],conditions:[],dependsOn:[]}))}}]),
  calls([{name:'get_patient_context',args:{partIds:['p1'],section:'notes'}}]),
  calls([{name:'query_consultations',args:{partIds:['p2'],mode:'count'}}]),
  {kind:'answer',text:'Le thème revient dans les notes ; six consultations sont terminées.',tokensIn:20,tokensOut:12},
 ];
 const result=await runAgentLoop({...input,text,conversationId:'compact-note-result'},{actor:'compact-note-result',infer:async(messages)=>{
  if(step===2){const last=messages.at(-1);modelReply=last?.role==='tool'?JSON.parse(String(last.content)) as Record<string,unknown>:undefined;}
  return steps[step++]??steps.at(-1)!;
 },execute:async call=>call.name==='get_patient_context'
  ?{callId:call.id,status:'ok',complete:true,text:'Sommeil fragmenté. '+('Note clinique fictive. '.repeat(300)),data:{rawNotes:'NOTE_BODY_MUST_STAY_OUT_OF_MODEL_CONTEXT'},evidence:[{id:'consultation-a',type:'consultation',label:'Consultation fictive'}],conditionKeys:[]}
  :{callId:call.id,status:'ok',complete:true,text:'6 consultations terminées.',data:{count:6},evidence:[],conditionKeys:[]}
 },new AbortController().signal);
 expect(result.parts.every(part=>part.status==='answered')).toBe(true);
 expect(modelReply).toMatchObject({status:'ok',complete:true});
 expect(modelReply?.data).toBeUndefined();expect(String(modelReply?.text)).toContain('Sommeil fragmenté');expect(String(modelReply?.text).length).toBeLessThan(1000);
 expect(JSON.stringify(modelReply)).not.toContain('NOTE_BODY_MUST_STAY_OUT_OF_MODEL_CONTEXT');
});
it('executes an explicit recurring-theme and completed-consultation count with the authorized gates, without a MiniCPM declaration',async()=>{
 const text='Pour Amel Bensaid, quel est le thème récurrent des notes et combien de consultations terminées sont enregistrées ?';
 const callsSeen:Record<string,unknown>[]=[];let inferenceCalls=0;
 const result=await runAgentLoop({...input,text,conversationId:'direct-theme-and-count'},{actor:'direct-theme-and-count',infer:async()=>{inferenceCalls++;throw new Error('Unexpected model call');},observeCall:call=>callsSeen.push({name:call.name,args:call.args}),execute:async(call,_asOf,prior,_signal,original,goal)=>{
  expect(prior).toHaveLength(0);expect(original).toBe(text);
  const answer=call.name==='get_patient_context'?'Les notes font ressortir le thème récurrent « sommeil fragmenté ».':'6 consultations terminées.';
  return {callId:call.id,status:'ok',complete:true,text:answer,patientId:id,evidence:[],conditionKeys:[]};
 }},new AbortController().signal);
 expect(inferenceCalls).toBe(0);
 expect(callsSeen).toEqual([
  {name:'get_patient_context',args:{partIds:['requested_1'],section:'summary'}},
  {name:'query_consultations',args:{partIds:['requested_2'],mode:'count',status:'closed'}},
 ]);
 expect(result.status).toBe('completed');expect(result.parts.map(part=>part.status)).toEqual(['answered','answered']);
 expect(result.sentences).toEqual(['Les notes font ressortir le thème récurrent « sommeil fragmenté ». 6 consultations terminées.']);
});
it('dispatches one unbounded patient-case summary through its exact authorized read gate',async()=>{
 const text='Résume le cas de Amel Bensaid.';let inferenceCalls=0;const callsSeen:Record<string,unknown>[]=[];
 const result=await runAgentLoop({...input,text,conversationId:'direct-whole-summary'},{actor:'direct-whole-summary',infer:async()=>{inferenceCalls++;throw new Error('Unexpected model call');},observeCall:call=>callsSeen.push({name:call.name,args:call.args}),execute:async call=>({callId:call.id,status:'ok',complete:true,text:'Le fil conducteur des consultations est le sommeil fragmenté.',patientId:id,evidence:[],conditionKeys:[]})},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(callsSeen).toEqual([{name:'get_patient_context',args:{partIds:['requested_1'],section:'summary'}}]);
 expect(result.status).toBe('completed');expect(result.parts).toMatchObject([{id:'requested_1',status:'answered',tools:['get_patient_context']}]);
});
it('routes an explicit patient-case date range directly without dropping either boundary',async()=>{
 const text='Résume en un seul paragraphe l’évolution racontée dans les six consultations d’avril à septembre 2026 de Amel Bensaid.';let inferenceCalls=0;const callsSeen:Record<string,unknown>[]=[];
 const result=await runAgentLoop({...input,text,conversationId:'dated-summary-direct'},{actor:'dated-summary-direct',infer:async()=>{inferenceCalls++;throw new Error('Unexpected model call');},observeCall:call=>callsSeen.push({name:call.name,args:call.args}),execute:async call=>({callId:call.id,status:'ok',complete:true,text:'Résumé des consultations de la période.',patientId:id,evidence:[],conditionKeys:[]})},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(callsSeen).toEqual([{name:'get_patient_context',args:{partIds:['requested_1'],section:'summary',count:6,from:'2026-04-01T00:00:00+01:00',to:'2026-10-01T00:00:00+01:00'}}]);
 expect(result).toMatchObject({status:'completed',parts:[{id:'requested_1',status:'answered',tools:['get_patient_context']}]});
});
it('keeps an explicit consultation period out of the all-time direct-read shortcut',async()=>{
 const text='Pour Amel Bensaid, quel est le thème récurrent des notes et combien de consultations terminées sont enregistrées pendant les six derniers mois ?';
 let inferenceCalls=0;const result=await runAgentLoop({...input,text,conversationId:'theme-count-period'},{actor:'theme-count-period',infer:async()=>{inferenceCalls++;return {kind:'answer',text:'',tokensIn:0,tokensOut:0};},execute:async call=>({callId:call.id,status:'ok',complete:true,text:'Réponse de test',evidence:[],conditionKeys:[]})},new AbortController().signal);
 expect(inferenceCalls).toBeGreaterThan(0);expect(result.status).not.toBe('completed');
 expect(result.parts.map(part=>part.status)).not.toEqual(['answered','answered']);
});
it('preserves a verified result and reports an actual read failure in the sibling part',async()=>{
 const text='Pour Amel Bensaid, quel est le thème récurrent des notes et combien de consultations terminées sont enregistrées ?';
 let inferenceCalls=0;const result=await runAgentLoop({...input,text,conversationId:'theme-count-partial'},{actor:'theme-count-partial',infer:async()=>{inferenceCalls++;throw new Error('Unexpected model call');},execute:async call=>{
  if(call.name==='query_consultations')throw new Error('synthetic database fault');
  return {callId:call.id,status:'ok',complete:true,text:'Les notes font ressortir le thème récurrent « sommeil fragmenté ».',evidence:[],conditionKeys:[]};
 }},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(result.status).toBe('partial');
 expect(result.parts.map(part=>part.status)).toEqual(['answered','failed']);
 expect(result.sentences).toContain('Les notes font ressortir le thème récurrent « sommeil fragmenté ».');
 expect(result.sentences.some(sentence=>sentence.includes('requête de données a échoué'))).toBe(true);
});
it('keeps a partial note read pending and allows its saved cursor to resume in the same turn',async()=>{
 const text='Pour Amel Bensaid, quelles sont les notes de consultation et combien de consultations terminées sont enregistrées ?';
 const goals=frenchRequestedOutputs(text)!;let step=0,continuationMarker:unknown;const callsSeen:Record<string,unknown>[]=[];
 const sequence:LocalCompletion[]=[
  calls([{name:'declare_request',args:{parts:goals.map((goal,i)=>({id:`p${i+1}`,goal,tool:requestedReadTool(goal,text),conditions:[],dependsOn:[]}))}}]),
  calls([{name:'get_patient_context',args:{partIds:['p1'],section:'notes'}}]),
  calls([{name:'query_consultations',args:{partIds:['p2'],mode:'count'}}]),
  calls([{name:'get_patient_context',args:{partIds:['p1'],section:'notes',reusePrevious:true}}]),
 ];
 const result=await runAgentLoop({...input,text,conversationId:'notes-cursor-same-turn'},{actor:'notes-cursor-same-turn',infer:async(messages)=>{
  const toolMessage=[...messages].reverse().find(message=>message.role==='tool'&&String(message.content).includes('continuation'));
  if(toolMessage)continuationMarker=JSON.parse(String(toolMessage.content)).continuation;
  return sequence[step++]??{kind:'answer',text:'',tokensIn:0,tokensOut:0};
 },execute:async(call,_asOf,prior)=>{
  callsSeen.push(call.args);
  if(call.name==='get_patient_context'&&!call.args['reusePrevious'])return {callId:call.id,status:'partial',complete:false,text:'Première page des notes.',data:{patientId:'b5000000-0000-4000-8000-000000000001',total:10,noteQuery:{patientId:'b5000000-0000-4000-8000-000000000001'},asOf:'2026-10-20T11:00:00Z',revision:'a'.repeat(32),next:{offset:5,textOffset:0}},evidence:[],conditionKeys:[]};
  if(call.name==='get_patient_context')return {callId:call.id,status:'ok',complete:true,text:'Dernière page des notes.',data:{patientId:'b5000000-0000-4000-8000-000000000001',total:10,noteQuery:{patientId:'b5000000-0000-4000-8000-000000000001'},asOf:'2026-10-20T11:00:00Z',revision:'a'.repeat(32)},evidence:[],conditionKeys:[]};
  return {callId:call.id,status:'ok',complete:true,text:'Six consultations terminées.',data:{count:6},evidence:[],conditionKeys:[]};
 }},new AbortController().signal);
 expect(continuationMarker).toMatchObject({available:true,tool:'get_patient_context',reusePrevious:true});
 expect(callsSeen.find(args=>args['reusePrevious'])).toMatchObject({partIds:['p1'],section:'notes',reusePrevious:true});
 expect(result.status).toBe('completed');expect(result.parts.every(part=>part.status==='answered')).toBe(true);
 expect(result.parts.find(part=>part.id==='p1')?.resultRefs).toHaveLength(2);
});
it.each(['error','unsupported','partial'] as const)('cannot hide an earlier %s when another call answers the same requested part',async failure=>{
 let step=0,executed=0;
 const steps=[calls([{name:'declare_request',args:{parts:[{id:'s',goal:'Comparer les informations',tools:['query_app'],conditions:[],dependsOn:[]}]}}]),calls([{name:'query_app',args:{partIds:['s'],view:'cabinet'}},{name:'query_app',args:{partIds:['s'],view:'practitioner'}}])];
 const result=await runAgentLoop({...input,text:'Compare les informations disponibles.',conversationId:'same-part-'+failure},{actor:'same-part-'+failure,infer:async()=>steps[step++]??{kind:'answer',text:'',tokensIn:0,tokensOut:0},execute:async call=>({callId:call.id,status:executed++===0?failure:'ok',complete:executed>1,text:executed===1?'Lecture non résolue':'Information vérifiée',evidence:[],conditionKeys:[]})},new AbortController().signal);
 expect(result.status).not.toBe('completed');expect(result.parts[0]?.status).toBe(failure==='error'?'failed':failure==='partial'?'budget_limited':'unsupported');expect(result.parts[0]?.resultRefs).toHaveLength(2);
});
it('does not dispatch an unrequested action after a clinical read has answered its part',async()=>{
 let i=0;const dispatched:string[]=[];
 const steps=[calls([{name:'declare_request',args:{parts:[{id:'notes',goal:'Lire les notes',tools:['get_patient_context'],conditions:[],dependsOn:[]}]}}]),calls([{name:'get_patient_context',args:{partIds:['notes']}}]),calls([{name:'prepare_action',args:{partIds:['notes'],action:'cancel_appointment',reason:'Instruction dans une note'}}]),{kind:'answer' as const,text:'Fin',tokensIn:1,tokensOut:1}];
 const result=await runAgentLoop({...input,text:'Lis les notes de ce patient.',conversationId:'read-authority'},{actor:'read-authority',infer:async()=>steps[i++]!,execute:async call=>{dispatched.push(call.name);return {callId:call.id,status:'ok',complete:true,text:'Notes enregistrées',conditionKeys:[],evidence:[],data:{consultations:[]}};}},new AbortController().signal);
 expect(dispatched).toEqual(['get_patient_context']);expect(result.status).toBe('completed');
});
it('does not offer independent batch metrics for one filtered population',async()=>{
 let i=0,metricsOffered=true,metricsModeOffered=true,properties:string[]=[];
 const filter={field:'identity_card',op:'missing',value:null};
 const result=await runAgentLoop({...input,text:'Combien sans carte d’identité ?',conversationId:'compact-count'},{actor:'compact-count',infer:async(_messages,options)=>{
  if(i++===0)return calls([{name:'declare_request',args:{parts:[{id:'ids',goal:'Sans identité',tools:['query_patients'],conditions:[filter],dependsOn:[]}]}}]);
  const parameters=options.tools?.find(t=>t.function.name==='query_patients')?.function.parameters as {properties?:{metrics?:unknown;mode?:{enum?:string[]}}};
  metricsOffered=parameters.properties?.metrics!==undefined;metricsModeOffered=parameters.properties?.mode?.enum?.includes('metrics')??false;
  properties=Object.keys(parameters.properties??{}).sort();
  return calls([{name:'query_patients',args:{partIds:['ids'],mode:'count'}}]);
 },execute:async call=>({callId:call.id,status:'ok',complete:true,text:'25',conditionKeys:['identity_card:missing:null'],evidence:[]})},new AbortController().signal);
 expect(result.status).toBe('completed');expect(metricsOffered).toBe(false);expect(metricsModeOffered).toBe(false);
 expect(properties).toEqual(['limit','mode','partIds']);
});
it('keeps a pre-count filter and drops an oversized irrelevant limit for an exact count',async()=>{
 const text='Le numéro de carte d’identité manque pour combien de patients actifs ?',filter={field:'identity_card',op:'missing',value:null};let i=0,executed:Record<string,unknown>|undefined;
 const result=await runAgentLoop({...input,text,conversationId:'prefixed-count-filter'},{actor:'prefixed-count-filter',infer:async()=>i++===0?calls([{name:'declare_request',args:{parts:[{id:'id',goal:text,tool:'query_patients',conditions:['identity_card:missing'],dependsOn:[]}]}}]):i===2?calls([{name:'query_patients',args:{partIds:['id'],mode:'count',limit:100}}]):{kind:'answer',text:'',tokensIn:0,tokensOut:0},execute:async call=>{executed=call.args;return {callId:call.id,status:'ok',complete:true,text:'7 patients',conditionKeys:['identity_card:missing:null'],evidence:[]};}},new AbortController().signal);
 expect(result.status).toBe('completed');expect(executed).toMatchObject({mode:'count',population:'active',filters:[filter]});expect(executed?.limit).toBeUndefined();
});
it('does not expose or execute a patient search term for a count that names no patient',async()=>{
 let i=0,queryOffered=true,executed=0,executedQuery:unknown='not-called';
 const result=await runAgentLoop({...input,text:'Compte les patients actifs.',conversationId:'active-count-no-query'},{actor:'active-count-no-query',infer:async(_messages,options)=>{
  if(i++===0)return calls([{name:'declare_request',args:{parts:[{id:'active',goal:'Compte les patients actifs',tools:['query_patients'],conditions:[],dependsOn:[]}]}}]);
  const parameters=options.tools?.find(t=>t.function.name==='query_patients')?.function.parameters as {properties?:Record<string,unknown>};
  queryOffered=Object.hasOwn(parameters.properties??{},'query');
  return calls([{name:'query_patients',args:{partIds:['active'],mode:'count',query:'adulte'}}]);
 },execute:async call=>{executed++;executedQuery=call.args['query'];return {callId:call.id,status:'ok',complete:true,text:'32',conditionKeys:[],evidence:[]};}},new AbortController().signal);
 expect(queryOffered).toBe(false);
 expect(executed).toBe(1);
 expect(executedQuery).toBeUndefined();
 expect(result.status).toBe('completed');
});
it('limits a patient-name search to the exact grounded French name',async()=>{
 let i=0,querySchema:Record<string,unknown>|undefined;
 const result=await runAgentLoop({...input,text:'Montre le dossier du patient Nadia Test.',conversationId:'named-patient-query'},{actor:'named-patient-query',infer:async(_messages,options)=>{
  if(i++===0)return calls([{name:'declare_request',args:{parts:[{id:'patient',goal:'Montre le dossier du patient Nadia Test',tools:['query_patients'],literalQuery:'Nadia Test',conditions:[],dependsOn:[]}]}}]);
  const parameters=options.tools?.find(t=>t.function.name==='query_patients')?.function.parameters as {properties?:Record<string,{enum?:string[]}>};
  querySchema=parameters.properties?.query;
  return calls([{name:'query_patients',args:{partIds:['patient'],mode:'list',query:'Nadia Test'}}]);
 },execute:async call=>({callId:call.id,status:'ok',complete:true,text:'1 patient',conditionKeys:[],evidence:[]})},new AbortController().signal);
 expect(querySchema?.enum).toEqual(['Nadia Test']);
 expect(result.status).toBe('completed');
});
it('carries a verified query into a short list continuation before native domain selection',async()=>{
 const actor='list-resume',conversationId='list-resume';let i=0;
 const filter={field:'identity_card',op:'missing',value:null};
 const steps=[calls([{name:'declare_request',args:{parts:[{id:'ids',goal:'Sans identité',tools:['query_patients'],conditions:[filter],dependsOn:[]}]}}]),calls([{name:'query_patients',args:{partIds:['ids'],mode:'count'}}])];
 await runAgentLoop({...input,conversationId},{actor,infer:async()=>steps[i++]!,execute:async call=>({callId:call.id,status:'ok',complete:true,text:'25',conditionKeys:['identity_card:missing:null'],evidence:[],data:{patientQuery:{mode:'count',filters:[filter]},asOf:'2026-10-15T12:00:00.000Z'}})},new AbortController().signal);
 let metadataOffered=true;
 const next=await runAgentLoop({...input,conversationId,text:'Lesquels ?'},{actor,infer:async(_messages,options)=>{metadataOffered=!!options.tools?.some(t=>t.function.name==='declare_request');return calls([{name:'query_patients',args:{partIds:['continuation'],mode:'list'}}]);},execute:async call=>({callId:call.id,status:'ok',complete:true,text:'25',conditionKeys:['identity_card:missing:null'],evidence:[]})},new AbortController().signal);
 expect(metadataOffered).toBe(false);expect(next.status).toBe('completed');expect(next.parts[0]?.conditions).toEqual([filter]);
});
it('registers metadata split across native calls atomically before dependent reads',async()=>{
 let i=0;
 const steps=[calls(parts.map(p=>({name:'declare_request',args:{parts:[p]}}))),calls([{name:'query_patients',args:{partIds:parts.map(p=>p.id),mode:'metrics',metrics:['active']}}])];
 const result=await runAgentLoop({...input,conversationId:'split-metadata'},{actor:'split-metadata',infer:async()=>steps[i++]!,execute:async call=>({callId:call.id,status:'ok',complete:true,text:'32',conditionKeys:[],evidence:[]})},new AbortController().signal);
 expect(result.parts).toHaveLength(4);expect(result.parts.every(p=>p.status==='answered')).toBe(true);
});
it("answers four registered parts without the legacy three-question limit",async()=>{
 let index=0;const steps=[calls([{name:"declare_request",args:{parts}}]),calls([{name:"query_patients",args:{partIds:parts.map(p=>p.id),mode:"metrics",metrics:["active","missing_identity_card","children","not_seen_6m"]}}]),{kind:"answer" as const,text:"Terminé",tokensIn:20,tokensOut:10}];
 const result=await runAgentLoop(input,{actor:"four",infer:async()=>steps[index++]!,execute:async(call)=>({callId:call.id,status:"ok",complete:true,data:{total:4},evidence:[],text:"Données vérifiées",conditionKeys:[]})},new AbortController().signal);
 expect(result.parts.map(p=>p.status)).toEqual(["answered","answered","answered","answered"]);
 expect(result.status).toBe("completed");expect(result.sentences.join(" ")).toContain("Données vérifiées");
});
it.each(['database','timeout','malformed'])("keeps three verified answers when an independent fourth query fails: %s",async(kind)=>{
 let index=0;const steps=[calls([{name:"declare_request",args:{parts}}]),calls(parts.map(p=>({name:"query_patients",args:{partIds:[p.id],mode:"count"}}))),{kind:"answer" as const,text:"",tokensIn:0,tokensOut:0}];
 const result=await runAgentLoop({...input,conversationId:"partial"},{actor:"partial",infer:async()=>steps[index++]!,execute:async(call)=>{
  if((call.args["partIds"] as string[])[0]==="p2"){
   if(kind==='timeout')throw new AgentReadError('timeout');
   if(kind==='malformed')z.object({total:z.number()}).parse({total:'invalid'});
   throw new Error("private database diagnostic");
  }
  return {callId:call.id,status:"ok",complete:true,data:{total:2},text:"2 patients",evidence:[],conditionKeys:[]};
 }},new AbortController().signal);
 expect(result.status).toBe("partial");expect(result.parts.filter(p=>p.status==="answered")).toHaveLength(3);
 expect(JSON.stringify(result)).not.toContain("private database diagnostic");
});
it("refuses dropped compound conditions and invalid ledger dependencies",()=>{
 expect(()=>queryPatientsSchema.parse({partIds:["a"],mode:"count",filters:[{field:"sql",op:"eq",value:"SELECT"}]})).toThrow();
 expect(()=>validateLedger([{id:"a",goal:"A",conditions:[],dependsOn:["a"]}])).toThrow();
 expect(()=>validateLedger([{id:"a",goal:"A",conditions:[],dependsOn:[]},{id:"a",goal:"B",conditions:[],dependsOn:[]}])).toThrow();
});
it("does not claim an answer when an executed query omitted a material filter",async()=>{
 let index=0;const condition={field:"age",op:"gte",value:18};
 const steps=[calls([{name:"declare_request",args:{parts:[{id:"adult",goal:"Adultes",tools:["query_patients"],conditions:[condition],dependsOn:[]}]}}]),calls([{name:"query_patients",args:{partIds:["adult"],mode:"count"}}]),{kind:"answer" as const,text:"10 adultes",tokensIn:0,tokensOut:0}];
 const result=await runAgentLoop({...input,conversationId:"predicate"},{actor:"predicate",infer:async()=>steps[index++]!,execute:async(call)=>({callId:call.id,status:"ok",complete:true,data:{total:10},text:"10 patients",evidence:[],conditionKeys:[]})},new AbortController().signal);
 expect(result.status).not.toBe("completed");expect(result.sentences.join(" ")).not.toContain("10 adultes");
});
it('withholds a model-only financial answer when a registered database read was never executed',async()=>{
 let i=0;const steps=[calls([{name:'declare_request',args:{parts:[{id:'money',goal:'Recettes',tools:['query_finance'],conditions:[],dependsOn:[]}]}}]),{kind:'answer' as const,text:'Les recettes sont de 9000 DZD.',tokensIn:10,tokensOut:10}];
 const result=await runAgentLoop({...input,text:'Quel est le chiffre d’affaires ?',conversationId:'unexecuted-read'},{actor:'finance',infer:async()=>steps[i++]!,execute:async()=>{throw Error('Unexpected');}},new AbortController().signal);
 expect(result.status).toBe('failed');expect(result.sentences.join(' ')).not.toContain('9000');
});
it('does not credit two independent metrics as proof of one AND-filtered count',async()=>{
 let i=0,executed=0;const filters=[{field:'phone',op:'missing',value:null},{field:'age',op:'lt',value:18}];
 const steps=[calls([{name:'declare_request',args:{parts:[{id:'children_without_phone',goal:'Enfants sans téléphone',tools:['query_patients'],conditions:filters,dependsOn:[]}]}}]),calls([{name:'query_patients',args:{partIds:['children_without_phone'],mode:'metrics',metrics:['missing_phone','children']}}]),{kind:'answer' as const,text:'2',tokensIn:0,tokensOut:0}];
 const result=await runAgentLoop({...input,text:'Combien d’enfants sans téléphone ?',conversationId:'metric-and'},{actor:'metric-and',infer:async()=>steps[i++]!,execute:async call=>{executed++;return {callId:call.id,status:'ok',complete:true,text:'2',evidence:[],conditionKeys:['phone:missing:null','age:lt:18']};}},new AbortController().signal);
 expect(executed).toBe(0);expect(result.status).not.toBe('completed');
});
it('rejects an extra model filter that narrows the registered population',async()=>{
 let i=0,executed=0;const steps=[calls([{name:'declare_request',args:{parts:[{id:'id',goal:'Sans identité',tools:['query_patients'],conditions:[{field:'identity_card',op:'missing',value:null}],dependsOn:[]}]}}]),calls([{name:'query_patients',args:{partIds:['id'],mode:'count',filters:[{field:'phone',op:'missing',value:null}]}}]),{kind:'answer' as const,text:'2',tokensIn:0,tokensOut:0}];
 await runAgentLoop({...input,conversationId:'extra-filter'},{actor:'extra-filter',infer:async()=>steps[i++]!,execute:async call=>{executed++;return {callId:call.id,status:'ok',complete:true,text:'2',evidence:[],conditionKeys:['identity_card:missing:null']};}},new AbortController().signal);
 expect(executed).toBe(0);
});
it('retains the original task when the client adopts the patient resolved during clarification',async()=>{
 const patient='11111111-1111-4111-8111-111111111111',conversationId='adopt-resolved';let i=0;
 const declaration=calls([{name:'declare_request',args:{parts:[{id:'rdv',goal:'Préparer le rendez-vous',tools:['prepare_action'],conditions:[],dependsOn:[]}]}}]);
 const steps=[declaration,calls([{name:'prepare_action',args:{partIds:['rdv'],action:'create_appointment',patientId:patient}}])];
 const first={...input,text:'Prépare un rendez-vous pour le patient sélectionné.',conversationId};
 await runAgentLoop(first,{actor:'scope-adoption',infer:async()=>steps[i++]!,execute:async call=>({callId:call.id,status:'needs_input',complete:false,patientId:patient,text:'Quelle heure ?',evidence:[],conditionKeys:[]})},new AbortController().signal);
 let metadata='';await runAgentLoop({...first,text:'Demain à 10 heures',appContext:{patientId:patient,page:'/jarvis'}},{actor:'scope-adoption',infer:async messages=>{metadata=messages[1]?.content??'';return {kind:'answer',text:'',tokensIn:0,tokensOut:0};},execute:async()=>{throw Error('Unexpected');}},new AbortController().signal);
 expect(metadata).toContain(first.text);
});


it('recovers once from an unsupported model answer while a database part is still pending',async()=>{
 let index=0;const steps=[calls([{name:'declare_request',args:{parts:[{id:'p',goal:'Patients actifs',tools:['query_patients'],conditions:[],dependsOn:[]}]}}]),{kind:'answer' as const,text:'Il y a 999 patients.',tokensIn:1,tokensOut:1},calls([{name:'query_patients',args:{partIds:['p'],mode:'count'}}])];
 const request=unfinishedNativeRequest({...input,text:'Combien de patients actifs ?',conversationId:'plain-recovery'},'plain-recovery');
 const result=await runAgentLoop(request,{actor:'plain-recovery',infer:async()=>steps[index++]!,execute:async call=>({callId:call.id,status:'ok',complete:true,text:'32 patients actifs vérifiés',conditionKeys:[],evidence:[]})},new AbortController().signal);
 expect(result.status).toBe('completed');expect(result.sentences.join(' ')).toContain('32 patients actifs');expect(result.sentences.join(' ')).not.toContain('999');
});

it('pins a saved note continuation to notes even if the model selects profile',async()=>{
 const actor='note-resume',conversationId='note-resume',patient='22222222-2222-4222-8222-222222222222';let i=0;
 const first=[calls([{name:'declare_request',args:{parts:[{id:'n',goal:'Lire les notes',tools:['get_patient_context'],conditions:[],dependsOn:[]}]}}]),calls([{name:'get_patient_context',args:{partIds:['n'],section:'notes'}}])];
 await runAgentLoop({...input,text:'Lis les notes.',conversationId,appContext:{patientId:patient,page:'/patients/'+patient}},{actor,infer:async()=>first[i++]!,execute:async call=>({callId:call.id,status:'partial',complete:false,patientId:patient,text:'Extrait partiel',conditionKeys:[],evidence:[],data:{noteQuery:{patientId:patient,area:'working'},asOf:'2026-10-15T12:00:00Z',revision:'a'.repeat(32),next:{offset:0,textOffset:1200}}})},new AbortController().signal);
 let executed:unknown;await runAgentLoop({...input,text:'La suite.',conversationId,appContext:{patientId:patient,page:'/patients/'+patient}},{actor,infer:async()=>calls([{name:'get_patient_context',args:{partIds:['continuation'],section:'profile'}}]),execute:async call=>{executed=call.args;return {callId:call.id,status:'ok',complete:true,text:'Suite exacte',evidence:[],conditionKeys:[]};}},new AbortController().signal);
 expect(executed).toMatchObject({section:'notes',reusePrevious:true});
});

it('reports a verified partial read as partial rather than failed',async()=>{let i=0;const steps=[calls([{name:'declare_request',args:{parts:[{id:'n',goal:'Les notes',tools:['get_patient_context'],conditions:[],dependsOn:[]}]}}]),calls([{name:'get_patient_context',args:{partIds:['n'],section:'notes'}}])];const r=await runAgentLoop({...input,conversationId:'single-partial',text:'Lis les notes.'},{actor:'single-partial',infer:async()=>steps[i++]!,execute:async call=>({callId:call.id,status:'partial',complete:false,text:'Extrait vérifié ; suite disponible.',evidence:[],conditionKeys:[]})},new AbortController().signal);expect(r.status).toBe('partial');expect(r.sentences.join(' ')).toContain('Extrait vérifié');});

it('pins a stored analysis continuation to its exact query and persists only the cursor',async()=>{
 const actor='analysis-resume',conversationId='analysis-resume',patient='22222222-2222-4222-8222-222222222222',consultation='33333333-3333-4333-8333-333333333333';let i=0;
 const first=[calls([{name:'declare_request',args:{parts:[{id:'a',goal:'Analyse',tools:['query_consultations'],conditions:[],dependsOn:[]}]}}]),calls([{name:'query_consultations',args:{partIds:['a'],consultationId:consultation,view:'analysis'}}])];
 await runAgentLoop({...input,text:'Lis cette analyse.',conversationId,appContext:{patientId:patient,page:'/consultation/'+consultation}},{actor,infer:async()=>first[i++]!,execute:async call=>({callId:call.id,status:'partial',complete:false,patientId:patient,text:'Extrait partiel',conditionKeys:[],evidence:[],data:{consultationQuery:{consultationId:consultation,view:'analysis',textOffset:0,revision:'a'.repeat(64)},asOf:'2026-10-15T12:00:00Z',revision:'a'.repeat(64),nextTextOffset:1200,analysis:{text:'Do not persist this body'}}})},new AbortController().signal);
 let executed:unknown;await runAgentLoop({...input,text:'La suite.',conversationId,appContext:{patientId:patient,page:'/consultation/'+consultation}},{actor,infer:async()=>calls([{name:'query_consultations',args:{partIds:['continuation'],mode:'count'}}]),execute:async call=>{executed=call.args;return {callId:call.id,status:'ok',complete:true,text:'Suite exacte',evidence:[],conditionKeys:[]};}},new AbortController().signal);
 expect(executed).toEqual({partIds:['continuation'],view:'analysis',reusePrevious:true});
});

it('coalesces equivalent duplicate metadata for one explicit count and enforces count-only execution',async()=>{
 const condition={field:'identity_card',op:'missing',value:null},duplicates=['a','b'].map(id=>({id,goal:'has_card_identity',tool:'query_patients',conditions:['identity_card:missing'],dependsOn:[]}));let i=0,executed:unknown;
 const steps=[calls([{name:'declare_request',args:{parts:duplicates}}]),calls([{name:'query_patients',args:{partIds:['a'],mode:'list'}}])];
 const r=await runAgentLoop({...input,text:'Combien de patients n’ont pas de numéro de carte d’identité ?',conversationId:'one-count-contract'},{actor:'one-count-contract',infer:async()=>steps[i++]!,execute:async call=>{executed=call.args;return {callId:call.id,status:'ok',complete:true,text:'25 patients',conditionKeys:["identity_card:missing:null"],evidence:[]};}},new AbortController().signal);
 expect(r.parts).toHaveLength(1);expect(r.parts[0]?.conditions).toEqual([condition]);expect(r.status).toBe('completed');expect(executed).toMatchObject({mode:'count'});
});
it('keeps count and list as distinct outputs when both were explicitly requested',async()=>{
 let i=0;const requested=['count','list'].map(id=>({id,goal:id,tool:'query_patients',conditions:['identity_card:missing'],dependsOn:[]}));
 const steps=[calls([{name:'declare_request',args:{parts:requested}}]),calls([{name:'query_patients',args:{partIds:['count'],mode:'count'}},{name:'query_patients',args:{partIds:['list'],mode:'list'}}])];const modes:string[]=[];
 const r=await runAgentLoop({...input,text:'Combien de patients n’ont pas de numéro de carte d’identité ? Liste-les aussi.',conversationId:'count-and-list-contract'},{actor:'count-and-list-contract',infer:async()=>steps[i++]!,execute:async call=>{modes.push(String(call.args.mode));return {callId:call.id,status:'ok',complete:true,text:'25',conditionKeys:['identity_card:missing:null'],evidence:[]};}},new AbortController().signal);
 expect(r.parts).toHaveLength(2);expect(modes).toEqual(['count','list']);
});
it('cannot coalesce two different populations into a purported single count',async()=>{
 let i=0,reads=0;const steps=[calls([{name:'declare_request',args:{parts:[{id:'a',goal:'actifs',tool:'query_patients',conditions:[],dependsOn:[]},{id:'b',goal:'enfants',tool:'query_patients',conditions:['age:lt:18'],dependsOn:[]}]}}])];
 const request=unfinishedNativeRequest({...input,text:'Combien de patients actifs avons-nous ?',conversationId:'different-populations-contract'},'different-populations-contract');
 const r=await runAgentLoop(request,{actor:'different-populations-contract',infer:async()=>{if(i++===0)return steps[0]!;throw Error('No valid repair');},execute:async()=>{reads++;throw Error('No dispatch');}},new AbortController().signal);
 expect(reads).toBe(0);expect(r.parts).toHaveLength(1);expect(r.parts[0]?.status).not.toBe('answered');
});
it('answers a complete four-metric request through one typed read even when MiniCPM is unavailable',async()=>{
 let inferenceCalls=0,reads=0;const observed:Record<string,unknown>[]=[];
 const r=await runAgentLoop({...input,text:'Combien de patients actifs, combien sans identité, combien d’enfants et combien sans consultation terminée depuis six mois ?',conversationId:'four-count-omission-contract'},{actor:'four-count-omission-contract',infer:async()=>{inferenceCalls++;throw Error('Model should not be needed for this closed read');},observeCall:call=>observed.push({name:call.name,args:call.args}),execute:async call=>{reads++;return {callId:call.id,status:'ok',complete:true,text:'Métriques vérifiées.',data:{metrics:Object.fromEntries((call.args['metrics'] as string[]).map(metric=>[metric,1]))},evidence:[],conditionKeys:[]};}},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(reads).toBe(1);expect(observed[0]).toMatchObject({name:'query_patients',args:{mode:'metrics',metrics:['active','missing_identity_card','children','not_seen_6m']}});
 expect(r.parts).toHaveLength(4);expect(r.parts.every(part=>part.status==='answered')).toBe(true);expect(r.status).toBe('completed');
});
it('never substitutes identity-number counts for the unsupported email field',async()=>{
 let i=0,reads=0;const steps=[calls([{name:'declare_request',args:{parts:[{id:'a',goal:'sans identité',tool:'query_patients',conditions:['identity_card:missing'],dependsOn:[]}]}}])];
 const r=await runAgentLoop({...input,text:'Combien de patients n’ont pas d’adresse électronique ?',conversationId:'unsupported-email-contract'},{actor:'unsupported-email-contract',infer:async()=>{if(i++===0)return steps[0]!;throw Error('No dispatch');},execute:async()=>{reads++;throw Error('No dispatch');}},new AbortController().signal);
 expect(reads).toBe(0);expect(r.parts[0]?.status).toBe('unsupported');expect(r.sentences.join(' ')).toMatch(/courriel|adresse électronique/iu);
});

function mixedReadingTask(actor:string,bothPartial:boolean){
 const patient='22222222-2222-4222-8222-222222222222',consultation='33333333-3333-4333-8333-333333333333';
 const note={callId:'n',status:bothPartial?'partial':'ok',complete:!bothPartial,text:'Notes',conditionKeys:[],evidence:[],data:{noteQuery:{patientId:patient,area:'working'},asOf:'2026-10-15T12:00:00Z',revision:'a'.repeat(32),...(bothPartial?{next:{offset:0,textOffset:1200}}:{})}};
 const analysis={callId:'a',status:'partial',complete:false,text:'Analyse',conditionKeys:[],evidence:[],data:{consultationQuery:{consultationId:consultation,view:'analysis',textOffset:0,revision:'b'.repeat(64)},asOf:'2026-10-15T12:00:00Z',revision:'b'.repeat(64),nextTextOffset:1200,analysis:{text:'Body not persisted'}}};
 restoreAgentTask(actor,actor,{original:'Lis les notes puis l’analyse.',parts:[{id:'p',goal:'Lectures',tools:['get_patient_context','query_consultations'],conditions:[],dependsOn:[],status:'budget_limited',resultRefs:['n','a']}],results:[note,analysis],at:Date.now(),patientId:patient,page:'/consultation/'+consultation});
 return {...input,conversationId:actor,text:'La suite.',appContext:{patientId:patient,page:'/consultation/'+consultation}};
}
it('resumes the sole unfinished analysis instead of completed notes',async()=>{
 const actor='sole-analysis-cursor',next=mixedReadingTask(actor,false);let executed:unknown;
 const r=await runAgentLoop(next,{actor,infer:async()=>calls([{name:'query_consultations',args:{partIds:['continuation'],mode:'list'}}]),execute:async call=>{executed=call.args;return {callId:call.id,status:'ok',complete:true,text:'Analyse suivante',conditionKeys:[],evidence:[]};}},new AbortController().signal);
 expect(r.status).toBe('completed');expect(executed).toMatchObject({view:'analysis',reusePrevious:true});
});
it('clarifies two unfinished text readings and resumes the explicitly selected analysis',async()=>{
 const actor='ambiguous-reading-cursors',next=mixedReadingTask(actor,true);let inferred=0,executed:unknown;
 const deps={actor,infer:async(_messages:unknown,options:{tools?:readonly {function:{name:string}}[]})=>{inferred++;return options.tools?.some(t=>t.function.name==='get_patient_context')?calls([{name:'get_patient_context',args:{partIds:['continuation'],section:'profile'}}]):calls([{name:'query_consultations',args:{partIds:['continuation'],mode:'list'}}]);},execute:async(call:{id:string;args:Record<string,unknown>})=>{executed=call.args;return {callId:call.id,status:'ok' as const,complete:true,text:'Suite',conditionKeys:[],evidence:[]};}};
 const choice=await runAgentLoop(next,deps,new AbortController().signal);expect(choice.status).toBe('needs_input');expect(inferred).toBe(0);expect(choice.sentences.join(' ')).toMatch(/notes.*analyse/i);
 const persisted=savedAgentTask(actor,actor)!;expect(JSON.stringify(persisted)).not.toContain('Body not persisted');restoreAgentTask(actor,actor,persisted);
 const final=await runAgentLoop({...next,text:'L’analyse'},deps,new AbortController().signal);expect(final.status).toBe('completed');expect(executed).toMatchObject({view:'analysis',reusePrevious:true});const remaining=await runAgentLoop({...next,text:'Les notes'},deps,new AbortController().signal);expect(remaining.status).toBe('completed');expect(executed).toMatchObject({section:'notes',reusePrevious:true});
});
it('blocks an unrequested missing-identity predicate in a positive phone lookup',async()=>{
 let i=0,reads=0;const r=await runAgentLoop({...input,text:'Quel est le téléphone enregistré du patient sélectionné ?',conversationId:'phone-not-missing-id'},{actor:'phone-not-missing-id',infer:async()=>{if(i++===0)return calls([{name:'declare_request',args:{parts:[{id:'a',goal:'Téléphone',tool:'query_patients',conditions:['identity_card:missing'],dependsOn:[]}]}}]);throw Error('No repair');},execute:async()=>{reads++;throw Error('No read');}},new AbortController().signal);expect(reads).toBe(0);expect(r.status).toBe('failed');
});

it('routes a selected-patient phone read directly through the patient-context gate',async()=>{
 let inferenceCalls=0;const observed:Record<string,unknown>[]=[];
 const patient='22222222-2222-4222-8222-222222222222';
 const result=await runAgentLoop({...input,text:'Quel est le téléphone du patient sélectionné ?',conversationId:'metadata-selected-patient',appContext:{patientId:patient,page:'/patients/'+patient}},{actor:'metadata-selected-patient',infer:async()=>{inferenceCalls++;throw Error('Unexpected model call');},observeCall:call=>observed.push({name:call.name,args:call.args}),execute:async call=>({callId:call.id,status:'ok',complete:true,patientId:patient,text:'Téléphone vérifié.',evidence:[{id:patient,type:'patient',label:'Dossier patient'}],conditionKeys:[]})},new AbortController().signal);
 expect(inferenceCalls).toBe(0);expect(observed).toEqual([{name:'get_patient_context',args:{partIds:['requested_1'],section:'profile'}}]);expect(result.status).toBe('completed');
});

it('routes a whole relative agenda period with bounded dates and no invented record identifiers',async()=>{
 const observed:Record<string,unknown>[]=[];
 await runAgentLoop({...input,text:'Quels sont les rendez-vous de demain ?',conversationId:'grounded-agenda-catalogue'},{actor:'grounded-agenda-catalogue',asOf:'2026-10-20T11:00:00Z',infer:async()=>{throw Error('Unexpected model call');},observeCall:call=>observed.push({name:call.name,args:call.args}),execute:async call=>({callId:call.id,status:'empty',complete:true,text:'0 rendez-vous',conditionKeys:[],evidence:[]})},new AbortController().signal);
 expect(observed).toEqual([{name:'query_agenda',args:{partIds:['requested_1'],from:'2026-10-21T00:00:00+01:00',to:'2026-10-22T00:00:00+01:00'}}]);
});

it.each(['Montre les rendez-vous de demain entre 9h et 12h.','Quels sont les rendez-vous demain dans la matinée ?','Montre les rendez-vous demain en fin de journée.'])('keeps precise bounds available for the fully specified window %s',async text=>{
 let i=0,parameters:Record<string,unknown>={};
 await runAgentLoop(unfinishedNativeRequest({...input,text,conversationId:'precise-agenda-'+text},'precise-agenda'),{actor:'precise-agenda',infer:async(_m,o)=>{if(i++===0)return calls([{name:'declare_request',args:{parts:[{id:'a',goal:text,tool:'query_agenda',conditions:[],dependsOn:[]}]}}]);parameters=o.tools!.find(t=>t.function.name==='query_agenda')!.function.parameters;return calls([{name:'query_agenda',args:{partIds:['a'],from:'2026-10-16T09:00:00+01:00',to:'2026-10-16T12:00:00+01:00'}}]);},execute:async call=>({callId:call.id,status:'empty',complete:true,text:'0 rendez-vous',conditionKeys:[],evidence:[]})},new AbortController().signal);
 expect(parameters.properties).toHaveProperty('from');expect(parameters.properties).toHaveProperty('to');expect(parameters.required).not.toContain('period');
});
it('keeps explicit absolute agenda bounds on the direct path',async()=>{
 const observed:Record<string,unknown>[]=[],infer=vi.fn(async()=>{throw Error('Unexpected model call');});
 await runAgentLoop({...input,text:'Quels sont les rendez-vous du 2026-10-01 au 2026-10-15 ?',conversationId:'absolute-agenda'},{actor:'absolute-agenda',asOf:'2026-10-20T11:00:00Z',infer,observeCall:call=>observed.push({name:call.name,args:call.args}),execute:async call=>({callId:call.id,status:'empty',complete:true,text:'0 rendez-vous',conditionKeys:[],evidence:[]})},new AbortController().signal);
 expect(infer).not.toHaveBeenCalled();expect(observed).toEqual([{name:'query_agenda',args:{partIds:['requested_1'],from:'2026-10-01T00:00:00+01:00',to:'2026-10-16T00:00:00+01:00'}}]);
});
