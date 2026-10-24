import {expect,it} from 'vitest';
import {runAgentLoop} from '@/server/alexa/agent-loop';
it('keeps an explicit medical question and its population on the knowledge path',async()=>{
 const text='Selon le DSM-5, quels critères diagnostiques concernent les patients adolescents ?';
 const calls:unknown[]=[];
 const result=await runAgentLoop({text,conversationId:'direct-medical',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{actor:'direct-medical',infer:async()=>{throw Error('No routing inference expected');},execute:async(call,_asOf,_prior,_signal,_original,goal)=>{calls.push({name:call.name,args:call.args,goal});return {callId:call.id,status:'ok',complete:true,text:'Synthèse vérifiée par le lecteur de connaissance.',evidence:[],conditionKeys:[]};}},new AbortController().signal);
 expect(calls).toEqual([{name:'search_knowledge',args:{partIds:['requested_1'],query:text},goal:text}]);
 expect(result.status).toBe('completed');
});
