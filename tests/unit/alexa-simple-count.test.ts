import {expect,it,vi} from 'vitest';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import type {AgentCall} from '@/shared/alexa/agent';
import {frenchRequestAdmission} from '@/shared/alexa/request-contract';
import {parsePatientMention} from '@/shared/alexa/patient-mention';
const id='11111111-1111-4111-8111-111111111111';
const input=(text:string)=>({text,conversationId:'simple-count-'+text,clientTurnId:id,appContext:{patientId:null,page:'/jarvis'}});

it.each(['Combien de patients actifs sont enregistrés ?','Combien de patients actifs avons-nous ?','Combien de patients actifs ?','Quel est le nombre de patients actifs ?'])(
 'reads a complete plain active count without waiting for model generation: %s',async text=>{
   const infer=vi.fn(async()=>{throw Error('UnnecessaryModelRead');}),calls:AgentCall[]=[];
   const result=await runAgentLoop(input(text),{actor:'plain-count',infer,execute:async call=>{calls.push(call);return {callId:call.id,status:'ok',complete:true,text:'32 patients actifs vérifiés.',conditionKeys:[],evidence:[]};}},new AbortController().signal);
   expect(result.status).toBe('completed');expect(result.sentences.join(' ')).toContain('32 patients actifs');
   expect(infer).not.toHaveBeenCalled();expect(calls).toHaveLength(1);
   expect(calls[0]).toMatchObject({name:'query_patients',args:{mode:'count',population:'active',filters:[]}});
 });
it.each(['Combien de patients actifs sous antidépresseur ?','Combien de patients actifs sont enregistrés en septembre 2025 ?','Combien de patients actifs sont enregistrés pour ce praticien seulement ?'])(
 'does not silently turn an additional restriction into an unrestricted count: %s',async text=>{
   const calls:AgentCall[]=[];
   await runAgentLoop(input(text),{actor:'restricted-count',infer:async()=>{throw Error('ModelUnavailable');},execute:async call=>{calls.push(call);return {callId:call.id,status:'error',complete:false,text:'Lecture indisponible.',conditionKeys:[],evidence:[]};}},new AbortController().signal);
   expect(calls.some(call=>call.name==='query_patients'&&call.args['mode']==='count'&&Array.isArray(call.args['filters'])&&call.args['filters'].length===0&&!call.args['createdPeriod']&&!call.args['consultationPeriod']&&!call.args['filterGroups'])).toBe(false);
 });
it('reads a plain cabinet consultation count directly without waiting for MiniCPM',async()=>{
 const infer=vi.fn(async()=>{throw Error('UnnecessaryModelRead');}),calls:AgentCall[]=[];
 const text='Combien de consultations sont enregistrées au cabinet ?';
 expect(frenchRequestAdmission(text,false)).toMatchObject({tools:['query_consultations'],consultationMode:'count',consultationStatus:'all',unboundedPeriod:true});expect(parsePatientMention(text).status).toBe('none');
 const result=await runAgentLoop(input(text),{actor:'consultation-count',infer,execute:async call=>{calls.push(call);return {callId:call.id,status:'ok',complete:true,text:'Le cabinet compte 8 143 consultations au total.',conditionKeys:[],evidence:[]};}},new AbortController().signal);
 expect(result.status).toBe('completed');expect(result.sentences.join(' ')).toBe('Le cabinet compte 8 143 consultations au total.');
 expect(infer).not.toHaveBeenCalled();expect(calls).toHaveLength(1);
 expect(calls[0]).toMatchObject({name:'query_consultations',args:{mode:'count',status:'all'}});
});
it.each(['Combien de consultations sont enregistrées pour Ayoub Salmi ?','Combien de consultations sont enregistrées en septembre 2026 ?'])(
 'does not broaden a named-patient or period consultation count: %s',async text=>{
  const infer=vi.fn(async()=>{throw Error('ModelUnavailable');}),calls:AgentCall[]=[];
  await runAgentLoop(input(text),{actor:'consultation-count-scope',infer,execute:async call=>{calls.push(call);return {callId:call.id,status:'error',complete:false,text:'Lecture indisponible.',conditionKeys:[],evidence:[]};}},new AbortController().signal);
  const countCall=calls.find(call=>call.name==='query_consultations'&&call.args['mode']==='count');
  expect(countCall).toBeDefined();
  if(text.includes('Ayoub Salmi'))expect(countCall?.args).toMatchObject({patientName:'Ayoub Salmi'});
  else expect(countCall?.args).toMatchObject({from:expect.any(String),to:expect.any(String)});
 });
