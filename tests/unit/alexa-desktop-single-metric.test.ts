import { expect,it } from 'vitest';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import type {AgentCall} from '@/shared/alexa/agent';
it.each([
 ['Combien de patients n’ont pas de numéro de carte d’identité ?','missing_identity_card'],
 ['Combien de patients n’ont pas de numéro de téléphone ?','missing_phone'],
])('reads the requested single administrative metric without inference: %s',async(text,metric)=>{
 const observed:unknown[]=[];
 const result=await runAgentLoop({text,conversationId:metric,clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/patients'}},{actor:'desktop-regression',infer:async()=>{throw Error('Model should not select a known metric');},execute:async call=>{
 observed.push(call);return {callId:call.id,status:'ok',complete:true,text:'Résultat de la lecture autorisée.',data:{metrics:{[metric]:6}},evidence:[{id:call.id,type:'query',label:'Lecture autorisée'}],conditionKeys:[]};
 }},new AbortController().signal);
 expect(observed).toMatchObject([{name:'query_patients',args:{mode:'count',filters:[{field:metric==='missing_phone'?'phone':'identity_card',op:'missing',value:null}],population:'active'}}]);expect(result.status).toBe('completed');
});

it('reads a patient treatment requested with a lowercase compound name without inference',async()=>{
 const observed:unknown[]=[];
 const result=await runAgentLoop({text:'traitement de ait ali kamel',conversationId:'lowercase-treatment',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/patients'}},{actor:'desktop-treatment',infer:async()=>{throw Error('Unnecessary model selection');},execute:async call=>{observed.push(call);return {callId:call.id,status:'ok',complete:true,text:'Aucun traitement enregistré dans le dossier vérifié.',evidence:[],conditionKeys:[]};}},new AbortController().signal);
 expect(observed).toMatchObject([{name:'get_patient_context',args:{section:'treatments'}}]);expect(result.status).toBe('completed');
});
it('keeps explicit reads fast after a completed turn in the same desktop conversation',async()=>{
 const observations:unknown[]=[];
 const deps={actor:'desktop-two-counts',infer:async()=>{throw Error('Unnecessary inference after completed read');},execute:async(call:AgentCall)=>{observations.push(call.args.filters);return {callId:call.id,status:'ok' as const,complete:true,text:'Lecture vérifiée.',evidence:[],conditionKeys:[]};}};
 const base={conversationId:'desktop-two-counts',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/patients'}};
 for(const text of ['Combien de patients n’ont pas de numéro de carte d’identité ?','Combien de patients n’ont pas de numéro de téléphone ?']){
  const result=await runAgentLoop({...base,text},deps,new AbortController().signal);expect(result.status).toBe('completed');
 }
 expect(observations).toEqual([[{field:'identity_card',op:'missing',value:null}],[{field:'phone',op:'missing',value:null}]]);
});
