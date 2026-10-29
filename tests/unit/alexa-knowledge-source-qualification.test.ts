import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {agentDescriptions,agentMetadataPrompt} from '@/i18n/alexa-agent';
import {planKnowledgeQuery} from '@/server/alexa/knowledge-query';
import {agentExecutor} from '@/server/alexa/agent-tools';
const STAHL = "Prescriber's Guide (Stahl's Essential Psychopharmacology)";
const DSM = "DSM-5 — Manuel diagnostique et statistique des troubles mentaux";
const TAYLOR = "The Maudsley Prescribing Guidelines in Psychiatry";
const bookCases = (JSON.parse(readFileSync('tests/eval/knowledge.books-v4-2026-10-28.json', 'utf8')) as {
 cas: {id:string;question:string;answerable:boolean;attendu:{source:string}}[];
}).cas;
it('advertises automatic search across every approved knowledge book without requiring a title',()=>{
 const description=agentDescriptions.search_knowledge;
 expect(description).toContain('DSM-5');expect(description).toContain('Taylor/Maudsley');expect(description).toContain('Stahl');
 expect(agentMetadataPrompt(['search_knowledge'])).toContain('sans nommer de livre');
});
it('qualifie Stahl par son nom et ne le confond pas avec Taylor',()=>{
 const stahl=planKnowledgeQuery('Selon Stahl, quelles précautions pour la sertraline ?');
 expect(stahl?.sourceTitle).toBe(STAHL);expect(stahl?.sourceLabel).toBe('Stahl');
 expect(planKnowledgeQuery('Selon Taylor, quelles précautions pour la sertraline ?')?.sourceLabel).toBe('Taylor');
});
it.each(["Selon le Prescriber's Guide, quelles précautions pour la sertraline ?", "Selon le Prescriber’s Guide, quelles précautions pour la sertraline ?"])(
 'maps the approved Stahl title alias to its canonical source: %s', question => {
  const stahl=planKnowledgeQuery(question);
  expect(stahl?.sourceTitle).toBe(STAHL);expect(stahl?.sourceLabel).toBe('Stahl');
 });
it('plans every answerable book golden and keeps each explicitly named source exact',()=>{
 const namedSources:[RegExp,string][]=[[/\bdsm(?:\s*-?\s*5)?\b/iu,DSM],[/\b(?:maudsley|taylor)\b/iu,TAYLOR],[/\b(?:stahl|prescriber['’]s\s+guide)\b/iu,STAHL]];
 const sourceTitleByLabel:Record<string,string>={"DSM-5":DSM,"Maudsley":TAYLOR,"Prescriber's Guide":STAHL};
 for(const scenario of bookCases.filter(item=>item.answerable)){
  const plan=planKnowledgeQuery(scenario.question);
  expect(plan,scenario.id).not.toBeNull();
  const namedSource=namedSources.find(([marker])=>marker.test(scenario.question));
  const expectedTitle=sourceTitleByLabel[scenario.attendu.source];
  expect(expectedTitle,scenario.id).toBeDefined();
  if(namedSource)expect(namedSource[1],scenario.id).toBe(expectedTitle);
  expect(plan?.sourceTitle,scenario.id).toBe(namedSource ? expectedTitle : null);
 }
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
