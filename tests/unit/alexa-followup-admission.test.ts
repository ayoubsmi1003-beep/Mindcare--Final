import {expect,it,vi} from 'vitest';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import {scriptedAlexaRpc} from '../helpers/alexa-rpc';
const clock='2026-10-23T12:00:00+01:00',range={from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'};
const input=(text:string)=>({text,conversationId:crypto.randomUUID(),clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}});
const empty=()=>scriptedAlexaRpc(async()=>({ok:true as const,data:[{total:0,rows:[],totals:{pendingDzd:0,collectedDzd:0,unpriced:0},complete:true,offset:0}]}));
it.each([
 ['Quel montant représentent les paiements encaissés du 1 octobre 2026 au 31 octobre 2026 ?','collected'],
 ['Quel montant représentent les paiements non encaissés du 1 octobre 2026 au 31 octobre 2026 ?','pending'],
 ['Quel montant représentent les paiements en attente du 1 octobre 2026 au 31 octobre 2026 ?','pending'],
])('binds the human payment state even when MiniCPM omits it: %s',async(text,state)=>{
 const rpc=empty();await agentExecutor(input(text),{rpc},{rpc:vi.fn()})({id:'money',name:'query_finance',args:{partIds:['p'],mode:'totals',...range}},clock,[],new AbortController().signal);
 expect(rpc).toHaveBeenCalledTimes(1);expect(JSON.parse(String(rpc.mock.calls[0]?.[1]?.p_spec)).state).toBe(state);
});
it('keeps the original payment state when model metadata abbreviates the human question',async()=>{
 const request=input('Quel montant représentent les paiements encaissés du 1 octobre 2026 au 31 octobre 2026 ?'),rpc=empty();let step=0;
 const infer=vi.fn(async()=>{
  const name=step++===0?'declare_request':'query_finance',args=name==='declare_request'?{parts:[{id:'p',goal:'Paiements',tool:'query_finance',conditions:[],dependsOn:[]}]}:{partIds:['p'],mode:'totals',...range};
  return {kind:'calls' as const,calls:[{id:'c'+step,name,args}],message:{role:'assistant' as const,content:null},tokensIn:1,tokensOut:1};
 });
 const result=await runAgentLoop(request,{actor:'financial-source-scope',asOf:clock,infer,execute:agentExecutor(request,{rpc},{rpc:vi.fn()})},new AbortController().signal);
 expect(result.status).toBe('completed');expect(rpc).toHaveBeenCalledTimes(1);
 expect(JSON.parse(String(rpc.mock.calls[0]?.[1]?.p_spec)).state).toBe('collected');
});
it.each([
 ['Quel montant représentent les paiements encaissés en octobre 2026 ?','pending'],
 ['Liste les paiements en octobre 2026.','collected'],
])('rejects a model payment-state restriction that changes the human request: %s',async(text,state)=>{
 const rpc=empty();const result=await agentExecutor(input(text),{rpc},{rpc:vi.fn()})({id:'money',name:'query_finance',args:{partIds:['p'],mode:'totals',state,...range}},clock,[],new AbortController().signal);
 expect(result.complete).toBe(false);expect(rpc).not.toHaveBeenCalled();
});
it('routes an independently parsed single clock interval without routing inference',async()=>{
 const request=input('Affiche les rendez-vous du 23 octobre 2026 entre 9 h et 11 h.'),rpc=empty(),infer=vi.fn(async()=>{throw Error('Unexpected inference');});
 const result=await runAgentLoop(request,{actor:'exact-clock-direct',asOf:clock,infer,execute:agentExecutor(request,{rpc},{rpc:vi.fn()})},new AbortController().signal);
 expect(infer).not.toHaveBeenCalled();expect(result.status).toBe('completed');
 expect(JSON.parse(String(rpc.mock.calls[0]?.[1]?.p_spec))).toEqual({from:'2026-10-23T09:00:00+01:00',to:'2026-10-23T11:00:00+01:00'});
});
it.each([false,true])('keeps requested agenda count versus names separate, list=%s',async list=>{
 const rows=[{id:'11111111-1111-4111-8111-111111111111',patientId:null,label:'FICTIF Alpha',at:'2026-10-23T09:00:00+01:00',status:'confirmed',amount:null},{id:'22222222-2222-4222-8222-222222222222',patientId:null,label:'FICTIF Bêta',at:'2026-10-23T10:00:00+01:00',status:'confirmed',amount:null}];
 const rpc=scriptedAlexaRpc(async()=>({ok:true as const,data:[{total:2,rows,totals:{},complete:true,offset:0}]}));
 const result=await agentExecutor(input((list?'Liste les rendez-vous':'Combien de rendez-vous')+' du 23 octobre 2026 ?'),{rpc},{rpc:vi.fn()})({id:'agenda',name:'query_agenda',args:{partIds:['p'],from:'2026-10-23T00:00:00+01:00',to:'2026-10-24T00:00:00+01:00'}},clock,[],new AbortController().signal);
 expect(result.text).toContain('2 rendez-vous');
 for(const row of rows)expect(result.text.includes(row.label)).toBe(list);
 expect(result.links?.length??0).toBe(0);
 expect(result.evidence.some(source=>source.type==='appointment')).toBe(list);
});
