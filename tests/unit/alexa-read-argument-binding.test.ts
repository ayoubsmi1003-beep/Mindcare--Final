import {unfinishedNativeRequest} from '../helpers/alexa-unfinished-request';
import {expect,it,vi} from 'vitest';
import {frenchRequestAdmission} from '@/shared/alexa/request-contract';
import {runAgentLoop as runNativeLoop} from '@/server/alexa/agent-loop';
import type {LocalCompletion} from '@/server/alexa/local-model-protocol';
const patientId='ed000000-0000-4000-8000-000000000001';
const input=(text:string)=>({text,conversationId:crypto.randomUUID(),clientTurnId:crypto.randomUUID(),appContext:{patientId,page:'/patients/'+patientId}});
const call=(id:string,name:string,args:Record<string,unknown>):LocalCompletion=>({kind:'calls',calls:[{id,name,args}],message:{role:'assistant',content:null},tokensIn:1,tokensOut:1});
it.each([
 ['Que disent les notes brutes du dossier courant ?', {tools:['get_patient_context'],patientSection:'notes',noteArea:'working'}],
 ['Quelles évaluations SOAP sont renseignées dans ses consultations ?', {tools:['get_patient_context'],patientSection:'notes',noteArea:'assessment'}],
 ['Lis les conduites à tenir consignées dans ses consultations.', {tools:['get_patient_context'],patientSection:'notes',noteArea:'plan'}],
 ['Affiche les champs Subjectif enregistrés.', {tools:['get_patient_context'],patientSection:'notes',noteArea:'subjective'}],
 ['Montre la liste des consultations du dossier courant et le total exact.', {tools:['query_consultations'],consultationMode:'list',consultationStatus:'all'}],
 ['Compte ses consultations terminées.', {tools:['query_consultations'],consultationMode:'count',consultationStatus:'closed'}],
 ['Montre les indicateurs financiers du mois courant.', {tools:['query_finance'],financeMode:'overview'}],
 ['Vérifie les informations administratives enregistrées dans le dossier courant.', {tools:['get_patient_context'],patientSection:'profile'}],
])('binds the requested operation rather than a model default: %s',(text,expected)=>{
 expect(frenchRequestAdmission(text,false)).toMatchObject(expected);
});
it('fills an omitted section and requested note area before any domain execution',async()=>{
 let step=0;
 const execute=vi.fn(async(c:{id:string})=>({callId:c.id,status:'ok' as const,complete:true,text:'Texte source vérifié',evidence:[],conditionKeys:[]}));
 const result=await runAgentLoop(input('Lis les notes de travail du dossier courant.'),{actor:'binding-test',execute,infer:async()=>++step===1?call('d','declare_request',{parts:[{id:'p',goal:'Lis les notes de travail du dossier courant.',tool:'get_patient_context',conditions:[],dependsOn:[]}]}):call('q','get_patient_context',{partIds:['p']})},new AbortController().signal);
 expect(result.status).toBe('completed');
 expect(execute).toHaveBeenCalledTimes(1);
 expect(execute.mock.calls[0]?.[0]).toMatchObject({args:{section:'notes',area:'working'}});
});
it('blocks an invented open-only filter and preserves the requested list with its total',async()=>{
 let step=0;
 const execute=vi.fn(async(c:{id:string})=>({callId:c.id,status:'ok' as const,complete:true,text:'3 consultations vérifiées',evidence:[],conditionKeys:[]}));
 const text='Montre la liste des consultations du dossier courant et le total exact.';
 const result=await runAgentLoop(input(text),{actor:'binding-test',execute,infer:async()=>{
  step++;if(step===1)return call('d','declare_request',{parts:[{id:'p',goal:text,tool:'query_consultations',conditions:[],dependsOn:[]}]});
  return call('q'+step,'query_consultations',{partIds:['p'],mode:'list',status:step===2?'open':'all'});
 }},new AbortController().signal);
 expect(result.status).toBe('completed');expect(execute).toHaveBeenCalledTimes(1);
 expect(execute.mock.calls[0]?.[0]).toMatchObject({args:{mode:'list',status:'all'}});
});
it('rejects duplicated outputs before an authoritative read and accepts a repaired declaration',async()=>{
 let step=0,sawDuplicate=false;
 const text='Quels diagnostics sont enregistrés pour le patient sélectionné ?';
 const execute=vi.fn(async(c:{id:string})=>({callId:c.id,status:'ok' as const,complete:true,text:'Lecture diagnostique vérifiée',evidence:[],conditionKeys:[]}));
 const part={goal:text,tool:'get_patient_context',conditions:[],dependsOn:[]};
 const result=await runAgentLoop(input(text),{actor:'binding-test',execute,infer:async(messages)=>{
  step++;if(step===1)return call('d1','declare_request',{parts:[{id:'p1',...part},{id:'p2',...part}]});
  if(step===2){sawDuplicate=messages.some(m=>m.role==='tool'&&m.content.includes('DuplicateRequestedOutputs'));return call('d2','declare_request',{parts:[{id:'p',...part}]});}
  return call('q','get_patient_context',{partIds:['p'],section:'diagnoses'});
 }},new AbortController().signal);
 expect(sawDuplicate).toBe(true);expect(result.status).toBe('completed');expect(result.parts).toHaveLength(1);expect(execute).toHaveBeenCalledTimes(1);
});

it('rejects invented historical dates on an unbounded consultation count before querying',async()=>{
 let step=0;const text='Compte les consultations terminées du dossier courant.';const execute=vi.fn(async(c:{id:string})=>({callId:c.id,status:'ok' as const,complete:true,text:'3 consultations',evidence:[],conditionKeys:[]}));
 const result=await runAgentLoop(input(text),{actor:'unbounded-test',execute,infer:async(_m,options)=>{step++;if(step===1)return call('d','declare_request',{parts:[{id:'p',goal:text,tool:'query_consultations',conditions:[],dependsOn:[]}]});if(step===2){const properties=options.tools?.find(t=>t.function.name==='query_consultations')?.function.parameters['properties'] as Record<string,unknown>;expect(properties).not.toHaveProperty('from');expect(properties).not.toHaveProperty('to');return call('bad','query_consultations',{partIds:['p'],mode:'count',status:'closed',from:'2020-01-01T00:00:00Z',to:'2023-12-31T00:00:00Z'});}return call('good','query_consultations',{partIds:['p'],mode:'count',status:'closed'});}},new AbortController().signal);
 expect(result.status).toBe('completed');expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0]?.[0]).toMatchObject({id:'good'});
});

it('preserves the actual mental-health certificate kind',()=>expect(frenchRequestAdmission('Liste les certificats de bonne santé mentale de Ayoub Salmi.',false)).toMatchObject({tools:['query_documents'],documentKind:'bonne_sante_mentale'}));

it.each(['Liste les certificats médicaux du dossier courant.','Liste le certificat médical du dossier courant.'])('binds the medical certificate singular and plural: %s',text=>expect(frenchRequestAdmission(text,false)).toMatchObject({documentKind:'certificat_medical'}));
it('does not treat a digit in an explicit patient label as a requested date restriction',()=>expect(frenchRequestAdmission('Compte les consultations du patient Patient 7 Test.',false)).toMatchObject({unboundedPeriod:true}));

it('does not turn a record identifier into an invented date range',()=>expect(frenchRequestAdmission('Compte les consultations du dossier EVAL-7.',false)).toMatchObject({unboundedPeriod:true}));

it('does not permit an invented document type or date filter on a generic draft list',async()=>{let step=0;const text='Montre les brouillons de documents du dossier courant.';const execute=vi.fn(async(c:{id:string})=>({callId:c.id,status:'ok' as const,complete:true,text:'1 brouillon vérifié',evidence:[],conditionKeys:[]}));const result=await runAgentLoop(input(text),{actor:'document-scope',execute,infer:async(_m,options)=>{step++;if(step===1)return call('d','declare_request',{parts:[{id:'p',goal:text,tool:'query_documents',conditions:[],dependsOn:[]}]});if(step===2){const properties=options.tools?.find(t=>t.function.name==='query_documents')?.function.parameters['properties'] as Record<string,unknown>;for(const field of ['kind','from','to','period','reusePrevious','textOffset'])expect(properties).not.toHaveProperty(field);return call('bad','query_documents',{partIds:['p'],status:'draft',kind:'certificat_medical'});}return call('good','query_documents',{partIds:['p'],status:'draft'});}},new AbortController().signal);expect(result.status).toBe('completed');expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0]?.[0]).toMatchObject({id:'good'});});

it('keeps a known note section on the server instead of asking the model to repeat fixed slots',async()=>{let step=0;const text='Montre les Objectif enregistrés dans les consultations du dossier courant.';const execute=vi.fn(async(c:{id:string})=>({callId:c.id,status:'ok' as const,complete:true,text:'Objectif source',evidence:[],conditionKeys:[]}));const result=await runAgentLoop(input(text),{actor:'fixed-read-slots',execute,infer:async(_m,options)=>{if(++step===1)return call('d','declare_request',{parts:[{id:'p',goal:text,tool:'get_patient_context',conditions:[],dependsOn:[]}]});const tool=options.tools?.find(t=>t.function.name==='get_patient_context');const properties=tool?.function.parameters['properties'] as Record<string,unknown>;expect(properties).not.toHaveProperty('section');expect(properties).not.toHaveProperty('area');expect(tool?.function.parameters['required']).not.toContain('section');return call('read','get_patient_context',{partIds:['p']});}},new AbortController().signal);expect(result.status).toBe('completed');expect(execute.mock.calls[0]?.[0]).toMatchObject({args:{section:'notes',area:'objective'}});});

// Keep native admission assertions independent of fresh deterministic shortcuts.
const runAgentLoop=(...args:Parameters<typeof runNativeLoop>)=>runNativeLoop(unfinishedNativeRequest(args[0],args[1].actor),args[1],args[2]);
