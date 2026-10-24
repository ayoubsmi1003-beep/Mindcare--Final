import {expect,it} from 'vitest';
import {planKnowledgeQuery} from '@/server/alexa/knowledge-query';
import {agentExecutor} from '@/server/alexa/agent-tools';
it('does not qualify unfinished Stahl or substitute another book for it',()=>{
 expect(planKnowledgeQuery('Selon Stahl, quelles précautions pour la sertraline ?')).toBeNull();
 expect(planKnowledgeQuery('Selon Taylor, quelles précautions pour la sertraline ?')).not.toBeNull();
});
it('keeps an explicit Stahl request unavailable even if the model substitutes Taylor',async()=>{
 let reads=0;
 const input={text:'Selon Stahl, quelles précautions pour la sertraline ?',conversationId:'unfinished-book',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};
 const run=agentExecutor(input,{rpc:async()=>{reads++;return {ok:true,data:[]};}},{rpc:async()=>{reads++;return {data:null,error:null};}});
 const result=await run({id:'k',name:'search_knowledge',args:{partIds:['p'],query:'Selon Taylor, précautions sertraline'}},'2026-10-23T12:00:00+01:00',[],new AbortController().signal,input.text,'Selon Taylor, précautions sertraline');
 expect(reads).toBe(0);expect(result.status).toBe('unsupported');expect(result.text).toContain('Stahl');expect(result.evidence).toEqual([]);
});
it.each(['Selon le DSM-5-TR, quels critères de panique ?','Selon un ouvrage inconnu, quels critères de panique ?'])('does not substitute a qualified book for an unavailable requested source: %s',async text=>{
 let reads=0;
 const input={text,conversationId:'unavailable-book',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};
 const run=agentExecutor(input,{rpc:async()=>{reads++;return {ok:true,data:[]};}},{rpc:async()=>{reads++;return {data:null,error:null};}});
 const result=await run({id:'k',name:'search_knowledge',args:{partIds:['p'],query:'Selon Taylor, critères panique'}},'2026-10-23T12:00:00+01:00',[],new AbortController().signal);
 expect(reads).toBe(0);expect(result.status).toBe('unsupported');expect(result.evidence).toEqual([]);
});
