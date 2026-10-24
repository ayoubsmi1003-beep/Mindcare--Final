import {expect,it} from 'vitest';
import {agentExecutor} from '@/server/alexa/agent-tools';
import type {DbPort} from '@/services/db/port';
const input=(text:string)=>({text,conversationId:'date-axis',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}});
const asOf='2026-10-23T12:00:00+01:00';
it('binds the requested consultation month and rejects contradictory model dates before SQL',async()=>{
 let called=0;const db:Pick<DbPort,'rpc'>={rpc:async()=>{called++;return {ok:true,data:[]};}};
 const run=agentExecutor(input('Compte les consultations terminées en septembre 2026.'),db,{rpc:async()=>({data:null,error:null})});
 const result=await run({id:'x',name:'query_consultations',args:{partIds:['p'],mode:'count',status:'closed',from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'}},asOf,[],new AbortController().signal);
 expect(result.status).toBe('needs_input');expect(called).toBe(0);
});
