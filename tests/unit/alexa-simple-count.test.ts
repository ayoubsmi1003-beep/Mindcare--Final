import {expect,it,vi} from 'vitest';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import type {AgentCall} from '@/shared/alexa/agent';
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
