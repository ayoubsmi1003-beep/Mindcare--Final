import {expect,it,vi} from 'vitest';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {runAgentLoop,savedAgentTask,restoreAgentTask,clearAgentTask} from '@/server/alexa/agent-loop';
import {scriptedAlexaRpc} from '../helpers/alexa-rpc';
import type {AgentResult} from '@/shared/alexa/agent';
import type {LocalCompletion} from '@/server/alexa/local-model-protocol';
const clock='2026-10-15T12:00:00.000Z',input={text:'Lis le calendrier financier de ce mois.',conversationId:'calendar-continuation',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/finances'}};
const source=()=>({du:'2026-10-01',au:'2026-10-31',calendrier:Array.from({length:31},(_,i)=>({jour_iso:'2026-10-'+String(i+1).padStart(2,'0'),montant:i,nb_seances:0,a_impaye:false})),calendrier_par_type:{types:[],lignes:[]}});
function reader(){const rpc=scriptedAlexaRpc(async()=>({ok:true as const,data:[source()]}));return {rpc,execute:agentExecutor(input,{rpc},{rpc:vi.fn()})};}
const call=(id:string,name:string,args:Record<string,unknown>):LocalCompletion=>({kind:'calls',calls:[{id,name,args}],message:{role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},tokensIn:1,tokensOut:1});
it('retains exact calendar period and revision and detects changed SQL source before a continuation',async()=>{
 const {execute}=reader(),first=await execute({id:'first',name:'query_finance',args:{partIds:['f'],mode:'calendar',period:'ce mois'}},clock,[],new AbortController().signal);
 expect(first.data).toMatchObject({nextOffset:20,revision:expect.stringMatching(/^[a-f0-9]{64}$/),financeQuery:{mode:'calendar',from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'}});
 const raw=source();raw.calendrier[0]!.montant=999;const rpc=scriptedAlexaRpc(async()=>({ok:true as const,data:[raw]}));
 await expect(agentExecutor({...input,text:'La suite.'},{rpc},{rpc:vi.fn()})({id:'next',name:'query_finance',args:{partIds:['f'],mode:'calendar',reusePrevious:true}},'2026-11-01T12:00:00.000Z',[first],new AbortController().signal)).rejects.toMatchObject({code:'changed'});
});
it('continues the calendar after saved-state reload without changing month or restarting its first page',async()=>{
 const actor='calendar-owner',conversationId=crypto.randomUUID(),turn={...input,conversationId},read=reader();let step=0;
 const infer=vi.fn(async()=>step++===0?call('declare','declare_request',{parts:[{id:'f',goal:input.text,tool:'query_finance',conditions:[],dependsOn:[]}]}):call('finance','query_finance',{partIds:['f'],mode:'calendar',period:'ce mois'}));
 await runAgentLoop(turn,{actor,infer,execute:read.execute,asOf:clock},new AbortController().signal);const saved=savedAgentTask(actor,conversationId);expect(saved?.results[0]?.data).toHaveProperty('financeQuery');clearAgentTask(actor,conversationId);restoreAgentTask(actor,conversationId,saved);
 const next=await runAgentLoop({...turn,text:'La suite.'},{actor,asOf:'2026-11-01T12:00:00.000Z',infer:vi.fn(async()=>call('next','query_finance',{partIds:['continuation'],mode:'calendar',period:'ce mois'})),execute:read.execute},new AbortController().signal);
 expect(next.status).toBe('completed');expect(next.results[0]?.data).toMatchObject({offset:20,total:31,hasMore:false,du:'2026-10-01'});clearAgentTask(actor,conversationId);
});
it('does not review only the last page as if it covered all patients in a multi-page agenda',async()=>{
 const rpc=vi.fn(),prior:AgentResult[]=[{callId:'a',status:'ok',complete:true,text:'Première page',conditionKeys:[],evidence:[],data:{agendaPatientIds:['22222222-2222-4222-8222-222222222222'],offset:0,hasMore:true}},{callId:'b',status:'ok',complete:true,text:'Deuxième page',conditionKeys:[],evidence:[],data:{agendaPatientIds:['33333333-3333-4333-8333-333333333333'],offset:20,hasMore:false}}];
 const result=await agentExecutor(input,{rpc},{rpc:vi.fn()})({id:'review',name:'query_patients',args:{partIds:['r'],mode:'review'}},clock,prior,new AbortController().signal);
 expect(result.complete).toBe(false);expect(result.status).toBe('needs_input');expect(result.error?.code).toBe('agenda-coverage');expect(rpc).not.toHaveBeenCalled();expect(result.text).toContain('couverture');
});
