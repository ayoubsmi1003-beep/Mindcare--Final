import {expect,it,vi} from 'vitest';
import {noteQueryGrounded} from '@/shared/alexa/note-query';
import {agentSchemas} from '@/shared/alexa/agent';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import type {LocalCompletion} from '@/server/alexa/local-model-protocol';
it.each([
 ['Montre les subjectifs enregistrés de Ayoub Salmi.','Ayoub Salmi',false],
 ['Montre les conduites à tenir de Ayoub Salmi.','Ayoub Salmi',false],
 ['Cherche l’expression « sommeil bleu » dans les notes de Ayoub Salmi.','sommeil bleu',true],
 ['Montre les notes qui parlent du sommeil.','sommeil',true],
 ['Montre les notes qui parlent du sommeil.','agressivité',false],
 ['Cherche le mot « Ayoub Salmi » dans les notes.','Ayoub Salmi',true],
])('grounds a note content filter separately from a patient name: %s',(text,query,expected)=>{expect(noteQueryGrounded(text,query)).toBe(expected);});
it('does not silently discard a changed filter during note continuation',()=>{
 expect(agentSchemas.get_patient_context.safeParse({partIds:['n'],section:'notes',reusePrevious:true,area:'objective'}).success).toBe(false);
});
it('rejects an invented note-content query before any patient/database read',async()=>{
 const rpc=vi.fn();const result=await agentExecutor({text:'Montre les subjectifs de Ayoub Salmi.',conversationId:'ground',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()})({id:'n',name:'get_patient_context',args:{partIds:['n'],section:'notes',query:'Ayoub Salmi'}},'2026-10-15T12:00:00Z',[],new AbortController().signal);
 expect(result.status).toBe('error');expect(rpc).not.toHaveBeenCalled();
});
it.each([
 ['Liste les documents émis de Ayoub Salmi.','Ayoub Salmi','error'],
 ['Cherche les documents contenant « sommeil bleu » pour Ayoub Salmi.','sommeil bleu','unsupported'],
 ['Cherche les certificats contenant « stress » pour Ayoub Salmi.','stress','unsupported'],
 ['Cherche les ordonnances mentionnant « stress » pour Ayoub Salmi.','stress','unsupported'],
])('does not substitute a name or an unsupported body search for a document filter: %s',async(text,query,status)=>{
 const rpc=vi.fn();const result=await agentExecutor({text,conversationId:'document-ground',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()})({id:'d',name:'query_documents',args:{partIds:['d'],status:'issued',query}},'2026-10-15T12:00:00Z',[],new AbortController().signal);
 expect(result.status).toBe(status);expect(rpc).not.toHaveBeenCalled();
});
it('does not offer free-text search for an unfiltered note-area read, and recovers without that filter',async()=>{
 const call=(name:string,args:Record<string,unknown>):LocalCompletion=>({kind:'calls',calls:[{id:'c'+name+step,name,args}],message:{role:'assistant',content:null,tool_calls:[]},tokensIn:1,tokensOut:1});
 let step=0,offered=true,executed=0;
 const text='Montre les subjectifs enregistrés dans les consultations de Ayoub Salmi.';
 const result=await runAgentLoop({text,conversationId:'note-filter-native',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}},{actor:'note-filter-native',infer:async(_m,options)=>{
  if(step++===0)return call('declare_request',{parts:[{id:'n',goal:text,tool:'get_patient_context',conditions:[],dependsOn:[]}]});
  const schema=options.tools?.find(t=>t.function.name==='get_patient_context')?.function.parameters as {properties?:Record<string,unknown>};offered=!!schema.properties?.query;
  return call('get_patient_context',step===2?{partIds:['n'],query:'Ayoub Salmi'}:{partIds:['n']});
 },execute:async c=>{executed++;expect(c.args).toMatchObject({section:'notes',area:'subjective'});expect(c.args).not.toHaveProperty('query');return {callId:c.id,status:'ok',complete:true,text:'Subjectif enregistré.',conditionKeys:[],evidence:[]};}},new AbortController().signal);
 expect(result.status).toBe('completed');expect(offered).toBe(false);expect(executed).toBe(1);
});
