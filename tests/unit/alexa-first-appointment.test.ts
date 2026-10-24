import {expect,it,vi} from 'vitest';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {scriptedAlexaRpc} from '../helpers/alexa-rpc';
const patients=['e4000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000002'];
const ids=['a4000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002'];
const input=(text:string)=>({text,conversationId:crypto.randomUUID(),clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}});
const args={partIds:['p'],from:'2026-10-24T00:00:00+01:00',to:'2026-10-25T00:00:00+01:00'};
it('presents only the first ordered appointment and its source, without offering a list continuation',async()=>{
 const rows=ids.map((id,index)=>({id,patientId:patients[index],label:index?'Yacine DEMONSTRATION':'Amina FICTIVE',at:`2026-10-24T${index?'10':'09'}:00:00+01:00`,status:'confirmed',amount:null}));
 const rpc=scriptedAlexaRpc(async()=>({ok:true as const,data:[{total:30,rows,totals:{},complete:true,offset:0}]}));
 const result=await agentExecutor(input('Donne le premier rendez-vous le 24 octobre 2026.'),{rpc},{rpc:vi.fn()})({id:'first',name:'query_agenda',args},'2026-10-23T12:00:00+01:00',[],new AbortController().signal);
 expect(result.text).toContain('Premier rendez-vous');expect(result.text).toContain('Amina FICTIVE');expect(result.text).not.toContain('Yacine DEMONSTRATION');
 expect(result.text).not.toContain('/ 30');expect(result.links).toHaveLength(1);
 expect(result.evidence.filter(source=>source.type==='appointment').map(source=>source.id)).toEqual([ids[0]]);
});
it('does not turn an empty period into an invented first appointment',async()=>{
 const rpc=scriptedAlexaRpc(async()=>({ok:true as const,data:[{total:0,rows:[],totals:{},complete:true,offset:0}]}));
 const result=await agentExecutor(input('Donne le premier rendez-vous le 24 octobre 2026.'),{rpc},{rpc:vi.fn()})({id:'first',name:'query_agenda',args},'2026-10-23T12:00:00+01:00',[],new AbortController().signal);
 expect(result.status).toBe('empty');expect(result.text).toContain('0 rendez-vous');expect(result.links).toBeUndefined();
});
it('refuses an unsupported first-and-last selection before reading',async()=>{
 const rpc=vi.fn();const result=await agentExecutor(input('Donne le premier et le dernier rendez-vous le 24 octobre 2026.'),{rpc},{rpc:vi.fn()})({id:'first',name:'query_agenda',args},'2026-10-23T12:00:00+01:00',[],new AbortController().signal);
 expect(result.complete).toBe(false);expect(rpc).not.toHaveBeenCalled();
});
it.each([{offset:20},{appointmentId:ids[1]}])('rejects a later page or an invented detail selection for a first appointment: %j',async injected=>{
 const rpc=vi.fn();const result=await agentExecutor(input('Donne le premier rendez-vous le 24 octobre 2026.'),{rpc},{rpc:vi.fn()})({id:'first',name:'query_agenda',args:{...args,...injected}},'2026-10-23T12:00:00+01:00',[],new AbortController().signal);
 expect(result.complete).toBe(false);expect(rpc).not.toHaveBeenCalled();
});
it('refuses a nonempty total without a verifiable first member',async()=>{
 const rpc=scriptedAlexaRpc(async()=>({ok:true as const,data:[{total:1,rows:[],totals:{},complete:true,offset:0}]}));
 await expect(agentExecutor(input('Donne le premier rendez-vous le 24 octobre 2026.'),{rpc},{rpc:vi.fn()})({id:'first',name:'query_agenda',args},'2026-10-23T12:00:00+01:00',[],new AbortController().signal)).rejects.toMatchObject({code:'malformed'});
});
