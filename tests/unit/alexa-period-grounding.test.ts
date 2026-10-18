import {it,expect,vi} from 'vitest';
import {explicitAgentPeriod} from '@/server/alexa/agent-period';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import {scriptedAlexaRpc} from '../helpers/alexa-rpc';
import type {LocalTextOptions,LocalCompletion} from '@/server/alexa/local-model-protocol';
const clock='2026-10-15T12:00:00.000Z',input={text:'Quels sont les rendez-vous de demain ?',conversationId:'grounded-period',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/agenda'}};
it('resolves the single whole relative day from source text and the frozen cabinet clock',()=>{expect(explicitAgentPeriod(input.text,clock)).toEqual({period:'demain',from:'2026-10-16T00:00:00+01:00',to:'2026-10-17T00:00:00+01:00'});expect(explicitAgentPeriod('Quel est le chiffre d’affaires de ce mois ?','2028-02-29T12:00:00Z')).toMatchObject({from:'2028-02-01T00:00:00+01:00',to:'2028-03-01T00:00:00+01:00'});});
it.each(['Demain entre 9h et 11h','Demain matin','Compare demain et aujourd’hui','Du 2026-10-16 au 2026-10-20','Demain à l’ouverture','Les recettes de ce mois à ce jour'])('does not constrain material ranges/windows/comparisons to a whole day: %s',text=>{expect(explicitAgentPeriod(text,clock)).toBeNull();});
it('rejects conflicting relative and absolute date arguments before SQL',async()=>{
 const rpc=vi.fn();const r=await agentExecutor(input,{rpc},{rpc:vi.fn()})({id:'d',name:'query_agenda',args:{partIds:['d'],period:'demain',from:'2023-09-01T00:00:00+01:00',to:'2023-09-02T00:00:00+01:00'}},clock,[],new AbortController().signal);expect(r.complete).toBe(false);expect(r.error?.code).toBe('period-conflict');expect(rpc).not.toHaveBeenCalled();
});
it('rejects an invented day that contradicts an unambiguous original request even without a period argument',async()=>{
 const rpc=vi.fn();const r=await agentExecutor(input,{rpc},{rpc:vi.fn()})({id:'d',name:'query_agenda',args:{partIds:['d'],from:'2023-09-01T00:00:00+01:00',to:'2023-09-02T00:00:00+01:00'}},clock,[],new AbortController().signal);expect(r.complete).toBe(false);expect(r.error?.code).toBe('requested-period-mismatch');expect(rpc).not.toHaveBeenCalled();
});
it('retains explicit intraday bounds and allows a coherent redundant period',async()=>{
 const rpc=scriptedAlexaRpc(async()=>({ok:true as const,data:[{total:0,rows:[],totals:{},complete:true,offset:0}]}));
 for(const [text,args]of [['Rendez-vous demain entre 9h et 11h',{from:'2026-10-16T09:00:00+01:00',to:'2026-10-16T11:00:00+01:00'}],[input.text,{period:'demain',from:'2026-10-16T00:00:00+01:00',to:'2026-10-17T00:00:00+01:00'}]] as const){const r=await agentExecutor({...input,text},{rpc},{rpc:vi.fn()})({id:'d',name:'query_agenda',args:{partIds:['d'],...args}},clock,[],new AbortController().signal);expect(r.complete).toBe(true);}
});
it('offers only the recognized relative period and resolves its absolute dates on the server',async()=>{
 let step=0;const options:LocalTextOptions[]=[];await runAgentLoop({...input,conversationId:crypto.randomUUID()},{actor:'dates',asOf:clock,execute:vi.fn(),infer:async(_m,o)=>{options.push(o);if(step++>0)throw Error('Capture only');const args={parts:[{id:'d',goal:'Agenda',tool:'query_agenda',conditions:[],dependsOn:[]}]};return {kind:'calls',calls:[{id:'d',name:'declare_request',args}],message:{role:'assistant',content:null,tool_calls:[{id:'d',type:'function',function:{name:'declare_request',arguments:JSON.stringify(args)}}]},tokensIn:1,tokensOut:1} satisfies LocalCompletion;}},new AbortController().signal);
 const tool=options[1]?.tools?.find(t=>t.function.name==='query_agenda');expect(tool?.function.parameters).toMatchObject({properties:{period:{enum:['demain']}},required:expect.arrayContaining(['period'])});expect(tool?.function.parameters['properties']).not.toHaveProperty('from');expect(tool?.function.parameters['properties']).not.toHaveProperty('to');
});

it('preserves the absolute date interface for an intraday window instead of replacing it with a whole day',async()=>{
 let step=0;const options:LocalTextOptions[]=[];await runAgentLoop({...input,text:'Rendez-vous demain entre 9h et 11h',conversationId:crypto.randomUUID()},{actor:'dates',asOf:clock,execute:vi.fn(),infer:async(_m,o)=>{options.push(o);if(step++>0)throw Error('Capture only');const args={parts:[{id:'d',goal:'Agenda',tool:'query_agenda',conditions:[],dependsOn:[]}]};return {kind:'calls',calls:[{id:'d',name:'declare_request',args}],message:{role:'assistant',content:null,tool_calls:[{id:'d',type:'function',function:{name:'declare_request',arguments:JSON.stringify(args)}}]},tokensIn:1,tokensOut:1} satisfies LocalCompletion;}},new AbortController().signal);
 const properties=options[1]?.tools?.find(t=>t.function.name==='query_agenda')?.function.parameters['properties'];expect(properties).toHaveProperty('from');expect(properties).toHaveProperty('to');
});

it('reads the global agenda without asking for a patient named after a dependent workflow purpose',async()=>{
 const text='Montre les rendez-vous de demain, identifie les dossiers administratifs incomplets, résume les champs manquants et prépare les corrections pour revue.';
 const rpc=scriptedAlexaRpc(async()=>({ok:true as const,data:[{total:0,rows:[],totals:{},complete:true,offset:0}]}));
 const result=await agentExecutor({...input,text},{rpc},{rpc:vi.fn()})({id:'agenda',name:'query_agenda',args:{partIds:['p1'],period:'demain'}},clock,[],new AbortController().signal);
 expect(result.complete).toBe(true);expect(rpc).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[0]?.[0]).toBe('query_alexa_records');expect(rpc.mock.calls[0]?.[1]).toMatchObject({p_domain:'agenda'});
 expect(JSON.parse(rpc.mock.calls[0]?.[1]?.p_spec as string)).not.toHaveProperty('patientId');
});
