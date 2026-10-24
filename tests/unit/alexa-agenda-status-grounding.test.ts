import {expect,it,vi} from 'vitest';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import {explicitFrenchDayRange} from '@/shared/alexa/request-contract';
import {scriptedAlexaRpc} from '../helpers/alexa-rpc';
const clock='2026-10-23T12:00:00+01:00';
const input=(text:string)=>({text,conversationId:crypto.randomUUID(),clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/agenda'}});
const range={from:'2026-01-01T00:00:00+01:00',to:'2027-01-02T00:00:00+01:00'};
const empty=()=>scriptedAlexaRpc(async()=>({ok:true as const,data:[{total:0,rows:[],totals:{},complete:true,offset:0}]}));
it('rejects model-added agenda statuses before any read',async()=>{
 const rpc=empty(),request=input('Combien de rendez-vous sont prévus du 1 janvier 2026 au 1 janvier 2027 inclus ?');
 const result=await agentExecutor(request,{rpc},{rpc:vi.fn()})({id:'calendar',name:'query_agenda',args:{partIds:['p'],...range,statuses:['requested','confirmed','arrived','in_session','completed','no_show','cancelled']}},clock,[],new AbortController().signal);
 expect(result.complete).toBe(false);expect(result.error?.code).toBe('unrequested-agenda-status');expect(rpc).not.toHaveBeenCalled();
});
it('binds explicitly requested statuses even when the selected tool omits them',async()=>{
 const rpc=empty(),request=input('Liste les rendez-vous confirmés ou arrivés du 1 janvier 2026 au 1 janvier 2027 inclus.');
 await agentExecutor(request,{rpc},{rpc:vi.fn()})({id:'calendar',name:'query_agenda',args:{partIds:['p'],...range}},clock,[],new AbortController().signal);
 expect(rpc).toHaveBeenCalledTimes(1);expect(JSON.parse(String(rpc.mock.calls[0]?.[1]?.p_spec)).statuses).toEqual(['confirmed','arrived']);
});
it('refuses a narrower model status filter than the requested disjunction',async()=>{
 const rpc=empty(),request=input('Liste les rendez-vous confirmés ou arrivés du 1 janvier 2026 au 1 janvier 2027 inclus.');
 const result=await agentExecutor(request,{rpc},{rpc:vi.fn()})({id:'calendar',name:'query_agenda',args:{partIds:['p'],...range,statuses:['confirmed']}},clock,[],new AbortController().signal);
 expect(result.complete).toBe(false);expect(rpc).not.toHaveBeenCalled();
});
it('routes an explicit absolute civil range through the existing server parser',async()=>{
 const request=input('Combien de rendez-vous sont prévus du 1 janvier 2026 au 1 janvier 2027 inclus ?'),rpc=empty(),infer=vi.fn(async()=>{throw Error('Unexpected routing inference');});
 const result=await runAgentLoop(request,{actor:'absolute-calendar',asOf:clock,infer,execute:agentExecutor(request,{rpc},{rpc:vi.fn()})},new AbortController().signal);
 expect(infer).not.toHaveBeenCalled();expect(result.status).toBe('completed');
 expect(JSON.parse(String(rpc.mock.calls[0]?.[1]?.p_spec))).toEqual(range);
});
it.each([
 ['Liste les rendez-vous non honorés du 1 janvier 2026 au 1 janvier 2027 inclus.',['no_show']],
 ['Liste les rendez-vous non annulés du 1 janvier 2026 au 1 janvier 2027 inclus.',['requested','confirmed','arrived','in_session','completed','no_show']],
 ['Liste les rendez-vous non confirmés du 1 janvier 2026 au 1 janvier 2027 inclus.',['requested','arrived','in_session','completed','no_show']],
 ['Liste les rendez-vous en cours du 1 janvier 2026 au 1 janvier 2027 inclus.',['in_session']],
])('preserves explicit absence and status exclusion: %s',async(text,statuses)=>{
 const rpc=empty();await agentExecutor(input(text),{rpc},{rpc:vi.fn()})({id:'calendar',name:'query_agenda',args:{partIds:['p'],...range}},clock,[],new AbortController().signal);
 expect(rpc).toHaveBeenCalledTimes(1);expect(JSON.parse(String(rpc.mock.calls[0]?.[1]?.p_spec)).statuses).toEqual(statuses);
});
it.each(['terminées non signées','ouvertes non signées','non terminées','pas en cours'])('refuses a clinical restriction which the single status field cannot represent: %s',async qualifier=>{
 const rpc=scriptedAlexaRpc(async(name,args)=>({ok:true as const,data:[name==='get_patient'?{id:args.p_id,first_name:'Fixture',last_name:'Synthétique'}:{total:0,rows:[],totals:{},complete:true,offset:0}]})),text=`Combien de consultations ${qualifier} pour ce patient ?`;
 const request={...input(text),appContext:{patientId:'11111111-1111-4111-8111-111111111111',page:'/patients'}};
 const result=await agentExecutor(request,{rpc},{rpc:vi.fn()})({id:'count',name:'query_consultations',args:{partIds:['p'],mode:'count',status:'unsigned'}},clock,[],new AbortController().signal);
 expect(result.complete).toBe(false);expect(rpc).not.toHaveBeenCalled();
});
it('does not turn an unknown status negation into an unrestricted agenda',async()=>{
 const rpc=empty(),text='Liste les rendez-vous pas encore validés du 1 janvier 2026 au 1 janvier 2027 inclus.';
 const result=await agentExecutor(input(text),{rpc},{rpc:vi.fn()})({id:'calendar',name:'query_agenda',args:{partIds:['p'],...range}},clock,[],new AbortController().signal);
 expect(result.complete).toBe(false);expect(rpc).not.toHaveBeenCalled();
});
it('keeps a sibling question status out of the current agenda scope',async()=>{
 const rpc=empty(),goal='Liste les rendez-vous du 1 janvier 2026 au 1 janvier 2027 inclus.';
 await agentExecutor(input(goal+' Puis les rendez-vous annulés de demain.'),{rpc},{rpc:vi.fn()})({id:'calendar',name:'query_agenda',args:{partIds:['p'],...range}},clock,[],new AbortController().signal,undefined,goal);
 expect(rpc).toHaveBeenCalledTimes(1);expect(JSON.parse(String(rpc.mock.calls[0]?.[1]?.p_spec))).not.toHaveProperty('statuses');
});
it('routes an unsigned consultation count directly without changing its clinical status',async()=>{
 const request={...input('Combien de consultations non signées pour ce patient ?'),appContext:{patientId:'11111111-1111-4111-8111-111111111111',page:'/patients'}},rpc=scriptedAlexaRpc(async(name,args)=>({ok:true as const,data:[name==='get_patient'?{id:args.p_id,first_name:'Fixture',last_name:'Synthétique'}:{total:0,rows:[],totals:{},complete:true,offset:0}]})),infer=vi.fn(async()=>{throw Error('Unexpected routing inference');});
 const result=await runAgentLoop(request,{actor:'unsigned-count',asOf:clock,infer,execute:agentExecutor(request,{rpc},{rpc:vi.fn()})},new AbortController().signal);
 expect(infer).not.toHaveBeenCalled();expect(result.status).toBe('completed');
 const query=rpc.mock.calls.find(([name])=>name==='query_alexa_records');
 expect(JSON.parse(String(query?.[1]?.p_spec))).toMatchObject({status:'unsigned',mode:'count',patientId:request.appContext.patientId});
});
it.each(['Rendez-vous le 23 octobre 2026 à 9 h.','Rendez-vous le 23/10/2026 à 09:30.'])('does not turn an intraday restriction into a whole civil day: %s',text=>{
 expect(explicitFrenchDayRange(text)).toBe(null);
});
