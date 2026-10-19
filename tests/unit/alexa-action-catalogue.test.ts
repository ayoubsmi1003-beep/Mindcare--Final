import {expect,it} from 'vitest';
import {agentSchemas} from '@/shared/alexa/agent';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import type {LocalCompletion} from '@/server/alexa/local-model-protocol';
it('does not accept unrelated financial/document fields on an appointment proposal',()=>{
 expect(agentSchemas.prepare_action.safeParse({partIds:['a'],action:'create_appointment',startsAt:'2026-10-16T11:00:00+01:00',durationMinutes:30,amountDzd:1,documentType:'suivi_medical'}).success).toBe(false);
});
it('exposes only slots for the requested action and specifies the mandatory timezone',async()=>{
 const text='Prépare un rendez-vous pour le patient sélectionné le 16 octobre 2026 à 11 heures, pour 30 minutes.';
 let step=0;const call=(name:string,args:Record<string,unknown>):LocalCompletion=>({kind:'calls',calls:[{id:'c'+step,name,args}],message:{role:'assistant',content:null,tool_calls:[]},tokensIn:1,tokensOut:1});
 let observed=false;
 await runAgentLoop({text,conversationId:crypto.randomUUID(),clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{actor:'action-catalogue',infer:async(_m,o)=>{
  if(step++===0)return call('declare_request',{parts:[{id:'a',goal:text,tool:'prepare_action',conditions:[],dependsOn:[]}]});
  const p=o.tools?.find(t=>t.function.name==='prepare_action')?.function.parameters.properties as Record<string,{description?:string}>;
  for(const field of ['appointmentId','consultationId','paymentId','amountDzd','reason','documentType','variables'])expect(p).not.toHaveProperty(field);
  expect(p.startsAt?.description).toContain('+01:00');observed=true;
  return call('prepare_action',{partIds:['a'],action:'create_appointment',startsAt:'2026-10-16T11:00:00+01:00',durationMinutes:30});
 },execute:async c=>({callId:c.id,status:'ok',complete:true,text:'Préparation vérifiée.',evidence:[],conditionKeys:[]})},new AbortController().signal);
 expect(observed).toBe(true);
});
