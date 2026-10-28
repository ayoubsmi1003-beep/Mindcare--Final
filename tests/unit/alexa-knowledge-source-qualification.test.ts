import {expect,it} from 'vitest';
import {planKnowledgeQuery} from '@/server/alexa/knowledge-query';
import {agentExecutor} from '@/server/alexa/agent-tools';
const STAHL = "Prescriber's Guide (Stahl's Essential Psychopharmacology)";
it('qualifie Stahl par son nom et ne le confond pas avec Taylor',()=>{
 const stahl=planKnowledgeQuery('Selon Stahl, quelles précautions pour la sertraline ?');
 expect(stahl?.sourceTitle).toBe(STAHL);expect(stahl?.sourceLabel).toBe('Stahl');
 expect(planKnowledgeQuery('Selon Taylor, quelles précautions pour la sertraline ?')?.sourceLabel).toBe('Taylor');
});
it('refuse qu’un autre livre soit substitué à une demande Stahl',async()=>{
 let reads=0;
 const input={text:'Selon Stahl, quelles précautions pour la sertraline ?',conversationId:'stahl-no-substitution',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};
 const run=agentExecutor(input,{rpc:async()=>{reads++;return {ok:true,data:[]};}},{rpc:async()=>{reads++;return {data:null,error:null};}});
 const result=await run({id:'k',name:'search_knowledge',args:{partIds:['p'],query:'Selon Taylor, précautions sertraline'}},'2026-10-23T12:00:00+01:00',[],new AbortController().signal,input.text,'Selon Taylor, précautions sertraline');
 // Aucune lecture : le livre proposé par le modèle ne remplace jamais celui demandé.
 expect(reads).toBe(0);expect(result.status).toBe('unsupported');expect(result.evidence).toEqual([]);
});
it.each(['Selon le DSM-5-TR, quels critères de panique ?','Selon un ouvrage inconnu, quels critères de panique ?'])('does not substitute a qualified book for an unavailable requested source: %s',async text=>{
 let reads=0;
 const input={text,conversationId:'unavailable-book',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};
 const run=agentExecutor(input,{rpc:async()=>{reads++;return {ok:true,data:[]};}},{rpc:async()=>{reads++;return {data:null,error:null};}});
 const result=await run({id:'k',name:'search_knowledge',args:{partIds:['p'],query:'Selon Taylor, critères panique'}},'2026-10-23T12:00:00+01:00',[],new AbortController().signal);
 expect(reads).toBe(0);expect(result.status).toBe('unsupported');expect(result.evidence).toEqual([]);
});
