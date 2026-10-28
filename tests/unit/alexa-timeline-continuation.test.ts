import {expect,it} from 'vitest';
import {agentExecutor} from '@/server/alexa/agent-tools';
import type {DbPort} from '@/services/db/port';
import type {AgentResult} from '@/shared/alexa/agent';
import {restoreAgentTask,savedAgentTask,runAgentLoop} from '@/server/alexa/agent-loop';

const patient='22222222-2222-4222-8222-222222222222';
const event='33333333-3333-4333-8333-333333333333';
const asOf='2026-10-23T12:00:00+01:00';
it('retains an unsupported timeline date filter before reading',async()=>{
 let reads=0;
 const run=agentExecutor({text:'Montre la chronologie de septembre 2026.',conversationId:'bounded-timeline',clientTurnId:crypto.randomUUID(),appContext:{patientId:patient,page:'/jarvis'}},{rpc:async()=>{reads++;return {ok:true,data:[]};}},{rpc:async()=>({data:null,error:null})});
 const result=await run({id:'x',name:'get_patient_context',args:{partIds:['p'],section:'timeline'}},asOf,[],new AbortController().signal);
 expect(result.status).toBe('unsupported');expect(reads).toBe(0);
});
it('routes an explicit chronological order request to the patient timeline before model routing',async()=>{
 let reads=0,inferences=0;
 let routed:unknown;
 const outcome=await runAgentLoop({text:'Présente les événements cliniques dans leur ordre chronologique.',conversationId:'timeline-order-admission',clientTurnId:crypto.randomUUID(),appContext:{patientId:patient,page:'/patients/'+patient}},{actor:'timeline-order-admission',infer:async()=>{inferences++;throw new Error('UnexpectedInference');},execute:async call=>{reads++;routed=call.args;return {callId:call.id,status:'ok',complete:true,text:'Résumé clinique bref.',conditionKeys:[],evidence:[]};}},new AbortController().signal);
 expect(outcome.status).toBe('completed');expect(routed).toMatchObject({section:'timeline'});expect(outcome.sentences.join(' ')).toBe('Résumé clinique bref.');expect(reads).toBe(1);expect(inferences).toBe(0);
});
it.each([
 'Présente les événements cliniques dans leur ordre chronologique et indique les échelles enregistrées pour Amel Bensaid.',
 'Présente les événements cliniques dans leur ordre chronologique ; indique les traitements du dossier courant.',
])('does not collapse a compound chronology request into a single summary read: %s',async text=>{
 let reads=0,inferences=0;
 await runAgentLoop({text,conversationId:'compound-timeline-admission',clientTurnId:crypto.randomUUID(),appContext:{patientId:patient,page:'/patients/'+patient}},{actor:'compound-timeline-admission',infer:async()=>{inferences++;throw new Error('ExpectedModelPath');},execute:async call=>{reads++;return {callId:call.id,status:'ok',complete:true,text:'Résumé clinique bref.',conditionKeys:[],evidence:[]};}},new AbortController().signal);
 expect(inferences).toBeGreaterThan(0);expect(reads).toBe(0);
});
it('resumes only the verified timeline cursor and retains its patient',async()=>{
 const observed:unknown[]=[];
 let revisions=0;
 const db:Pick<DbPort,'rpc'>={rpc:async <T>(name:string,args:unknown)=>{
  if(name==='get_patient')return {ok:true,data:[{id:patient,first_name:'Patient',last_name:'Synthétique',record_number:'SYN-1'}] as T[]};
  if(name==='get_patient_timeline_revision'){revisions++;return {ok:true,data:[{revision:'a'.repeat(32),total:22}] as T[]};}
  if(name==='list_patient_timeline')observed.push(args);return {ok:true,data:[]};
 }};
 const input={text:'La suite.',conversationId:'timeline',clientTurnId:crypto.randomUUID(),appContext:{patientId:patient,page:'/jarvis'}};
 const run=agentExecutor(input,db,{rpc:async()=>({data:null,error:null})});
 const previous:AgentResult={callId:'first',status:'partial',complete:false,text:'Page 1',conditionKeys:[],patientId:patient,evidence:[],data:{timelineQuery:{patientId:patient,count:20},timelineNext:{beforeAt:'2026-09-30T12:00:00Z',beforeId:event},revision:'a'.repeat(32)}};
 const result=await run({id:'next',name:'get_patient_context',args:{partIds:['p'],section:'timeline',reusePrevious:true}},asOf,[previous],new AbortController().signal);
 expect(observed).toEqual([{p_id:patient,p_before_at:'2026-09-30T12:00:00Z',p_before_id:event,p_limit:21}]);
 expect(revisions).toBe(2);
 expect(result.status).toBe('empty');
});
it('normalizes PostgreSQL timestamp values before validating timeline rows',async()=>{
 let revisionReads=0;
 const db:Pick<DbPort,'rpc'>={rpc:async <T>(name:string)=>{
  if(name==='get_patient')return {ok:true,data:[{id:patient,first_name:'Patient',last_name:'Synthétique',record_number:'SYN-1'}] as T[]};
  if(name==='get_patient_timeline_revision'){revisionReads++;return {ok:true,data:[{revision:'b'.repeat(32),total:1}] as T[]};}
  return {ok:true,data:[{occurred_at:new Date('2026-10-22T10:00:00.000Z'),event_id:event,event_type:'consultation',label_key:'alexa.timeline.consultation',practitioner_name:null,detail:{}}] as T[]};
 }};
 const run=agentExecutor({text:'Affiche la chronologie du dossier courant.',conversationId:'timeline-postgres-date',clientTurnId:crypto.randomUUID(),appContext:{patientId:patient,page:'/patients/'+patient}},db,{rpc:async()=>({data:null,error:null})});
 const result=await run({id:'timeline-date',name:'get_patient_context',args:{partIds:['p'],section:'timeline'}},asOf,[],new AbortController().signal);
 expect(result.status).toBe('ok');expect(result.text).toMatch(/consultation/iu);expect(revisionReads).toBe(2);
});
it('stops a resumed timeline before reading when its source revision changed',async()=>{
 let timelineReads=0;
 const db:Pick<DbPort,'rpc'>={rpc:async <T>(name:string)=>{
  if(name==='get_patient')return {ok:true,data:[{id:patient,first_name:'Patient',last_name:'Synthétique',record_number:'SYN-1'}] as T[]};
  if(name==='get_patient_timeline_revision')return {ok:true,data:[{revision:'b'.repeat(32),total:22}] as T[]};
  if(name==='list_patient_timeline')timelineReads++;
  return {ok:true,data:[] as T[]};
 }};
 const input={text:'La suite chronologie',conversationId:'timeline-stale',clientTurnId:crypto.randomUUID(),appContext:{patientId:patient,page:'/jarvis'}};
 const run=agentExecutor(input,db,{rpc:async()=>({data:null,error:null})});
 const previous:AgentResult={callId:'first-stale',status:'partial',complete:false,text:'Page 1',conditionKeys:[],patientId:patient,evidence:[],data:{timelineQuery:{patientId:patient,count:20},timelineNext:{beforeAt:'2026-09-30T12:00:00Z',beforeId:event},revision:'a'.repeat(32)}};
 await expect(run({id:'next-stale',name:'get_patient_context',args:{partIds:['p'],section:'timeline',reusePrevious:true}},asOf,[previous],new AbortController().signal)).rejects.toThrow();
 expect(timelineReads).toBe(0);
});
it('does not accept a model supplied timeline cursor',async()=>{
 let reads=0;
 const input={text:'Montre la chronologie.',conversationId:'timeline-invention',clientTurnId:crypto.randomUUID(),appContext:{patientId:patient,page:'/jarvis'}};
 const run=agentExecutor(input,{rpc:async()=>{reads++;return {ok:true,data:[]};}},{rpc:async()=>({data:null,error:null})});
 const result=await run({id:'x',name:'get_patient_context',args:{partIds:['p'],section:'timeline',beforeAt:asOf,beforeId:event}},asOf,[],new AbortController().signal);
 expect(result.status).toBe('unsupported');expect(reads).toBe(0);
});
it('restores a timeline continuation without retaining event contents',async()=>{
 const actor='timeline-resume';
  const data={timelineQuery:{patientId:patient,count:20},timelineNext:{beforeAt:'2026-09-30T12:00:00Z',beforeId:event},revision:'a'.repeat(32),rows:[{detail:'CLINICAL_BODY'}]};
 restoreAgentTask(actor,actor,{original:'Chronologie du dossier.',parts:[{id:'p',goal:'Chronologie',tools:['get_patient_context'],conditions:[],dependsOn:[],status:'budget_limited',resultRefs:['first']}],results:[{callId:'first',status:'partial',complete:false,text:'Page',conditionKeys:[],evidence:[],patientId:patient,data}],at:Date.now(),patientId:patient,page:'/jarvis'});
 expect(JSON.stringify(savedAgentTask(actor,actor))).not.toContain('CLINICAL_BODY');
 let dispatched:unknown;
 await runAgentLoop({text:'La suite.',conversationId:actor,clientTurnId:crypto.randomUUID(),appContext:{patientId:patient,page:'/jarvis'}},{actor,infer:async()=>({kind:'calls',calls:[{id:'next',name:'get_patient_context',args:{partIds:['continuation'],section:'summary'}}],message:{role:'assistant',content:null},tokensIn:0,tokensOut:0}),execute:async call=>{dispatched=call.args;return {callId:call.id,status:'empty',complete:true,text:'Fin',conditionKeys:[],evidence:[]};}},new AbortController().signal);
 expect(dispatched).toEqual({partIds:['continuation'],section:'timeline',reusePrevious:true});
});
