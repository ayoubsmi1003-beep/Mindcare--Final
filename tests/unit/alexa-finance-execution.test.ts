import {expect,it,vi} from 'vitest';
import {agentExecutor} from '@/server/alexa/agent-tools';

it('passes the closed-consultation condition to the existing audited finance read gate',async()=>{
 const text='Combien de consultations terminées n’ont pas de tarif ?';
 const rpc=vi.fn().mockResolvedValue({ok:true,data:[{total:0,rows:[],totals:{pendingDzd:0,collectedDzd:0,unpriced:4},complete:true,offset:0}]});
 const execute=agentExecutor({text,conversationId:'unpriced-consultations',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'finance',name:'query_finance',args:{partIds:['finance'],mode:'totals',state:'all',consultationStatus:'closed'}},'2026-10-26T12:00:00+01:00',[],new AbortController().signal);
 expect(result.status,result.text).toBe('ok');
 const query=rpc.mock.calls.find(([name])=>name==='query_alexa_records');
 expect(query?.[1].p_domain).toBe('finance');
 expect(JSON.parse(String(query?.[1].p_spec))).toMatchObject({mode:'totals',state:'all',consultationStatus:'closed'});
});
