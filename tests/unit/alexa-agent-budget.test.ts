import {it,expect,vi} from 'vitest';
import {runAgentLoop,savedAgentTask,AGENT_LIMITS} from '@/server/alexa/agent-loop';
import type {LocalCompletion} from '@/server/alexa/local-model-protocol';
const call=(id:string,name:string,args:Record<string,unknown>):LocalCompletion=>({kind:'calls',calls:[{id,name,args}],message:{role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},tokensIn:1,tokensOut:1});
it('allows a verified domain read after slow local interpretation without changing inference, call or context limits',async()=>{
 vi.useFakeTimers({toFake:['Date']});const start=Date.now();let step=0;
 try{const r=await runAgentLoop({text:'Combien de patients actifs ?',conversationId:crypto.randomUUID(),clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}},{actor:'slow-hardware',infer:async(_messages,options)=>{if(step++===0){vi.setSystemTime(start+80000);return call('d','declare_request',{parts:[{id:'p',goal:'Patients actifs',tool:'query_patients',conditions:[],dependsOn:[]}]});}if((options.timeoutMs??0)<30000)throw Error('Insufficient remaining phase budget');vi.setSystemTime(start+110000);return call('q','query_patients',{partIds:['p'],mode:'count'});},execute:async c=>({callId:c.id,status:'ok',complete:true,text:'32 patients',conditionKeys:[],evidence:[]})},new AbortController().signal);
 expect(r.status).toBe('completed');expect(r.sentences).toContain('32 patients');expect(AGENT_LIMITS.calls).toBe(6);expect(AGENT_LIMITS.rounds).toBe(3);expect(AGENT_LIMITS.parallel).toBe(2);
 }finally{vi.useRealTimers();}
});
it('keeps explicit cancellation effective during the longer whole-request budget',async()=>{
 const controller=new AbortController();controller.abort();const execute=vi.fn(),infer=vi.fn();const r=await runAgentLoop({text:'Combien de patients actifs ?',conversationId:crypto.randomUUID(),clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}},{actor:'cancel',infer,execute},controller.signal);expect(r.status).toBe('cancelled');expect(execute).not.toHaveBeenCalled();expect(infer).not.toHaveBeenCalled();
});

it('budgets native declaration output for four explicit questions within the existing whole-turn deadline',async()=>{
 const text='Combien de patients actifs avons-nous, combien n’ont pas de numéro de carte d’identité, combien sont des enfants et combien n’ont pas eu de consultation terminée depuis six mois ?';let offered=0,maxOutput=0,timeout=0;
 const r=await runAgentLoop({text,conversationId:crypto.randomUUID(),clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{actor:'multi-output-budget',infer:async(_m,options)=>{offered++;maxOutput=options.maxOutputTokens??0;timeout=options.timeoutMs??0;throw Error('LocalModelUnavailable');},execute:async()=>{throw Error('No domain authority');}},new AbortController().signal);
 expect(offered).toBe(1);expect(maxOutput).toBe(1024);expect(timeout).toBeGreaterThan(150000);expect(r.parts).toHaveLength(4);expect(r.parts.every(p=>p.status==='failed'&&p.resultRefs.length===0)).toBe(true);expect(r.parts[1]?.conditions).toEqual([{field:'identity_card',op:'missing',value:null}]);expect(r.parts[2]?.conditions).toEqual([{field:'age',op:'lt',value:18}]);expect(r.parts[3]?.conditions).toEqual([{field:'no_completed_months',op:'eq',value:6}]);
});

it('keeps a closed failure reason in server diagnostics without logging request contents',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});const execute=vi.fn();
 try{const r=await runAgentLoop({text:'Téléphone du patient FICTIF ?',conversationId:crypto.randomUUID(),clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{actor:'diagnostic',infer:async()=>{throw Error('LocalModelAssetAccess');},execute},new AbortController().signal);expect(r.status).toBe('failed');expect(execute).not.toHaveBeenCalled();expect(warn).toHaveBeenCalledExactlyOnceWith('[alexa-agent] failure','LocalModelAssetAccess');}
 finally{warn.mockRestore();}
});

it('allows cold first interpretation on slow hardware without extending subsequent inference or the whole-turn cap',async()=>{
 const budgets:number[]=[];let step=0;
 const r=await runAgentLoop({text:'Combien de patients actifs ?',conversationId:crypto.randomUUID(),clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{actor:'cold-simple',infer:async(_m,options)=>{budgets.push(options.timeoutMs??0);return ++step===1?call('d','declare_request',{parts:[{id:'p',goal:'Patients actifs',tool:'query_patients',conditions:[],dependsOn:[]}]}):call('q','query_patients',{partIds:['p'],mode:'count'});},execute:async c=>({callId:c.id,status:'ok',complete:true,text:'2 patients',conditionKeys:[],evidence:[]})},new AbortController().signal);
 expect(r.status).toBe('completed');expect(budgets[0]).toBe(170000);expect(budgets[1]).toBeLessThanOrEqual(85000);expect(AGENT_LIMITS.deadlineMs).toBe(360000);
});

async function countBeforeRetry(){
 const request={text:'Combien de patients sans numéro de carte d’identité ?',conversationId:crypto.randomUUID(),clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};const actor='cold-retry',condition={field:'identity_card',op:'missing',value:null};let step=0;
 const r=await runAgentLoop(request,{actor,infer:async()=>++step===1?call('d','declare_request',{parts:[{id:'p',goal:request.text,tool:'query_patients',conditions:['identity_card:missing'],dependsOn:[]}]}):call('q','query_patients',{partIds:['p'],mode:'count'}),execute:async c=>({callId:c.id,status:'ok',complete:true,text:'1 patient',conditionKeys:['identity_card:missing:null'],evidence:[],data:{patientQuery:{mode:'count',population:'active',filters:[condition]},asOf:'2026-10-15T12:00:00Z',revision:'a'.repeat(32),offset:0,rows:[]}})},new AbortController().signal);expect(r.status).toBe('completed');return {request,actor,condition};
}
it('gives the first resumed domain call the cold-start allowance without re-declaring its existing query',async()=>{
 const {request,actor}=await countBeforeRetry();let timeout=0,tools:string[]=[];
 await runAgentLoop({...request,text:'Lesquels ?',clientTurnId:crypto.randomUUID()},{actor,infer:async(_m,o)=>{timeout=o.timeoutMs??0;tools=o.tools?.map(t=>t.function.name)??[];throw Error('LocalModelUnavailable');},execute:vi.fn()},new AbortController().signal);
 expect(tools).toContain('query_patients');expect(tools).not.toContain('declare_request');expect(timeout).toBe(170000);
});
it('retains the exact saved patient query after a failed follow-up so a retry does not broaden or lose it',async()=>{
 const {request,actor,condition}=await countBeforeRetry();const r=await runAgentLoop({...request,text:'Lesquels ?',clientTurnId:crypto.randomUUID()},{actor,infer:async()=>{throw Error('LocalModelUnavailable');},execute:vi.fn()},new AbortController().signal);
 expect(r.status).toBe('failed');expect(r.results).toHaveLength(0);expect(savedAgentTask(actor,request.conversationId)?.results[0]?.data).toMatchObject({patientQuery:{mode:'count',population:'active',filters:[condition]},asOf:'2026-10-15T12:00:00Z',revision:'a'.repeat(32)});
});
