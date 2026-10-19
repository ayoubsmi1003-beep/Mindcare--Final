import {expect,it} from 'vitest';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import type {LocalCompletion} from '@/server/alexa/local-model-protocol';
const text='Compte les patients actifs, montre les rendez-vous de demain, compte les consultations terminées et donne les encaissements.';
const goals=['Compte les patients actifs','montre les rendez-vous de demain','compte les consultations terminées','donne les encaissements.'];
const names=['query_patients','query_agenda','query_consultations','query_finance'];
const args=[{mode:'count',population:'active'},{period:'demain'},{mode:'count',status:'closed'},{mode:'totals',state:'collected'}];
it.each([false,true])('accounts for four independently requested reads without increasing the call/deadline budgets (dependent=%s)',async dependent=>{
 let step=0;const executed:string[]=[];
 const call=(name:string,a:Record<string,unknown>):LocalCompletion=>({kind:'calls',calls:[{id:'c'+step,name,args:a}],message:{role:'assistant',content:null,tool_calls:[]},tokensIn:1,tokensOut:1});
 const r=await runAgentLoop({text,conversationId:crypto.randomUUID(),clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{actor:'read-budget',infer:async()=>{
  if(step++===0)return call('declare_request',{parts:goals.map((goal,i)=>({id:'p'+i,goal,tool:names[i],conditions:[],dependsOn:dependent&&i===3?['p0']:[]}))});
  const i=step-2;return call(names[i]!,{partIds:['p'+i],...args[i]});
 },execute:async c=>{executed.push(c.name);return {callId:c.id,status:c.name==='query_finance'?'error':'ok',complete:c.name!=='query_finance',text:c.name==='query_finance'?'Lecture financière indisponible.':'Résultat vérifié.',conditionKeys:[],evidence:[]};}},new AbortController().signal);
 expect(executed).toEqual(names.slice(0,dependent?3:4));expect(r.status).toBe('partial');
 expect(r.parts.filter(p=>p.status==='answered')).toHaveLength(3);
 expect(r.parts.find(p=>p.tools?.includes('query_finance'))?.status).toBe(dependent?'budget_limited':'failed');
});
