import {expect,it,vi} from 'vitest';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import {scriptedAlexaRpc} from '../helpers/alexa-rpc';
const clock='2026-10-23T12:00:00+01:00';
const input=(text:string)=>({text,conversationId:crypto.randomUUID(),clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/agenda'}});
it('does not treat a generic arrived-patient status as a named identity or a selected-patient restriction',async()=>{
 const request=input('Liste les rendez-vous avec patient arrivé du 1 octobre 2026 au 31 octobre 2026.'),rpc=scriptedAlexaRpc(async()=>({ok:true as const,data:[{total:0,rows:[],totals:{},complete:true,offset:0}]})),infer=vi.fn(async()=>{throw Error('Unexpected inference');});
 const result=await runAgentLoop(request,{actor:'arrived-status',asOf:clock,infer,execute:agentExecutor(request,{rpc},{rpc:vi.fn()})},new AbortController().signal);
 expect(infer).not.toHaveBeenCalled();expect(result.status).toBe('completed');
 expect(rpc).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[0]?.[0]).toBe('query_alexa_records');
 expect(JSON.parse(String(rpc.mock.calls[0]?.[1]?.p_spec))).toEqual({from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00',statuses:['arrived']});
});
it.each(['Quels rendez-vous se terminent le 23 octobre 2026 ?','Liste les rendez-vous selon leur date de fin le 23 octobre 2026.'])('refuses an unavailable appointment end-date axis before identity or record reads: %s',async text=>{
 const rpc=vi.fn(),request=input(text);
 const result=await agentExecutor(request,{rpc},{rpc:vi.fn()})({id:'calendar',name:'query_agenda',args:{partIds:['p'],from:'2026-10-23T00:00:00+01:00',to:'2026-10-24T00:00:00+01:00'}},clock,[],new AbortController().signal);
 expect(result.status).toBe('unsupported');expect(rpc).not.toHaveBeenCalled();
});
