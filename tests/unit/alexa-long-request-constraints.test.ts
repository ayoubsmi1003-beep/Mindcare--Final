import {expect,it} from 'vitest';
import {runAgentLoop,savedAgentTask,restoreAgentTask} from '@/server/alexa/agent-loop';
it('retains a restriction after character 300 through direct execution and task restoration',async()=>{
 const text='Liste les patients '+('du cabinet '.repeat(70))+'adultes sans CNI ayant au moins deux consultations terminées en septembre 2026.';
 const input={text,conversationId:'long-source',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};
 let goal:unknown;
 const result=await runAgentLoop(input,{actor:'long-source',asOf:'2026-10-23T12:00:00+01:00',infer:async()=>{throw Error('Deterministic read expected');},execute:async(call,_asOf,_prior,_signal,_original,requestedGoal)=>{
  goal=requestedGoal;return {callId:call.id,status:'ok',complete:true,text:'1 patient',conditionKeys:['age:gte:18','identity_card:missing:null','completed_consultations:gte:2'],evidence:[]};
 }},new AbortController().signal);
 expect(goal).toBe(text);
 const period=result.parts[0]?.constraintLedger?.find(c=>c.kind==='period');
 expect(period?.span).toContain('septembre');expect(text).toContain(period?.span);
 const task=savedAgentTask('long-source','long-source');
 restoreAgentTask('long-source-restored','long-source',task);
 expect(savedAgentTask('long-source-restored','long-source')?.parts[0]?.goal).toBe(text);
});
