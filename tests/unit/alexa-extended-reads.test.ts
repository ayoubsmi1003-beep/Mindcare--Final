import {expect,it} from 'vitest';
import {agentSchemas} from '@/shared/alexa/agent';
import {readApplication} from '@/server/alexa/application-reads';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {restoreAgentTask,runAgentLoop,savedAgentTask} from '@/server/alexa/agent-loop';
it('requires a literal catalogue query and rejects unrelated parameters',()=>{
 expect(agentSchemas.query_app.safeParse({partIds:['p'],view:'medication_catalog',query:'sertraline'}).success).toBe(true);
 expect(agentSchemas.query_app.safeParse({partIds:['p'],view:'medication_catalog'}).success).toBe(false);
 expect(agentSchemas.query_app.safeParse({partIds:['p'],view:'cabinet',query:'sertraline'}).success).toBe(false);
 expect(agentSchemas.get_patient_context.safeParse({partIds:['p'],section:'timeline'}).success).toBe(true);
});
it('reads catalogue source fields without inventing a prescription',async()=>{
 const calls:string[]=[];
 const result=await readApplication('c','medication_catalog',async name=>{calls.push(name);return [{id:'catalogue-1',raw_name:'SERTRALINE 50 mg',inn:'SERTRALINE',brand_name:null,form:'comprimé',strength:'50 mg',normalized_name:null,source:'catalogue',rank:1}];},new AbortController().signal,{query:'sertraline'});
 expect(calls).toEqual(['search_medications']);expect(result.text).toContain('SERTRALINE');expect(result.text).not.toMatch(/prescri(?:s|t|ve)/iu);
});
it('preserves queue members and detects a changed reception page',async()=>{
 const journee=Array.from({length:21},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,status:'arrived',first_name:'Synthétique',last_name:String(i),arrived_at:'2026-10-23T09:00:00Z'}));
 // The application counts status=arrived; a missing timestamp must not remove a visible member.
 const readRows=()=>journee.map((row,index)=>index===0?{...row,arrived_at:null}:row);
 const read=async()=>({journee:readRows(),demandes:[],paiements:[]});
 const first=await readApplication('r','reception',read,new AbortController().signal,{asOf:'2026-10-23T12:00:00+01:00',queue:'waiting'});
 const data=first.data as {total:number;rows:unknown[];revision:string};
 expect(data.total).toBe(21);expect(data.rows).toHaveLength(20);expect(first.complete).toBe(false);
 expect(first.text).toMatch(/^21 patients en attente/u);
 const second=await readApplication('r2','reception',read,new AbortController().signal,{asOf:'2026-10-23T12:00:00+01:00',queue:'waiting',offset:20,revision:data.revision});
 expect((second.data as {rows:unknown[]}).rows).toHaveLength(1);expect(second.complete).toBe(true);
 journee.pop();
 await expect(readApplication('r3','reception',read,new AbortController().signal,{asOf:'2026-10-23T12:00:00+01:00',queue:'waiting',offset:20,revision:data.revision})).rejects.toMatchObject({code:'changed'});
});
it('rejects an invented reception date before reading the board',async()=>{
 let reads=0;
 const input={text:'Montre la salle d’attente demain.',conversationId:'reception-date',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};
 const run=agentExecutor(input,{rpc:async()=>{reads++;return {ok:true,data:[]};}},{rpc:async()=>({data:null,error:null})});
 const result=await run({id:'r',name:'query_app',args:{partIds:['p'],view:'reception',day:'2026-09-01',queue:'waiting'}},'2026-10-23T12:00:00+01:00',[],new AbortController().signal);
 expect(result.status).toBe('needs_input');expect(reads).toBe(0);
});
it('resumes the saved reception queue and omits names from persisted cursor data',async()=>{
 const actor='reception-continuation';
 restoreAgentTask(actor,actor,{original:'Liste la salle d’attente.',parts:[{id:'p',goal:'Accueil',tools:['query_app'],conditions:[],dependsOn:[],status:'budget_limited',resultRefs:['first']}],results:[{callId:'first',status:'partial',complete:false,text:'Page',conditionKeys:[],evidence:[],data:{applicationQuery:{view:'reception',day:'2026-10-23',queue:'waiting'},nextOffset:20,revision:'a'.repeat(32),rows:[{first_name:'NAME_MUST_NOT_PERSIST'}]}}],at:Date.now(),patientId:null,page:'/jarvis'});
 expect(JSON.stringify(savedAgentTask(actor,actor))).not.toContain('NAME_MUST_NOT_PERSIST');
 let dispatched:unknown;
 await runAgentLoop({text:'La suite.',conversationId:actor,clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{actor,infer:async()=>({kind:'calls',calls:[{id:'next',name:'query_app',args:{partIds:['continuation'],view:'system'}}],message:{role:'assistant',content:null},tokensIn:0,tokensOut:0}),execute:async call=>{dispatched=call.args;return {callId:call.id,status:'empty',complete:true,text:'Fin',conditionKeys:[],evidence:[]};}},new AbortController().signal);
 expect(dispatched).toEqual({partIds:['continuation'],view:'reception',reusePrevious:true});
});
