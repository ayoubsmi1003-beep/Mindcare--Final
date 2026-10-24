import {expect,it} from 'vitest';
import {runAgentLoop} from '@/server/alexa/agent-loop';
it('reads independent counts separately when one has an extended predicate',async()=>{
 const reads:unknown[]=[];
 const result=await runAgentLoop({text:'Combien de patients avec un téléphone renseigné ? Combien de patients mineurs ?',conversationId:'separate-extended-counts',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{actor:'separate-extended-counts',infer:async()=>{throw Error('Closed count requests need no routing inference');},execute:async call=>{reads.push(call.args);const conditions=(call.args['filterGroups']??[call.args['filters']??[]]) as Array<Array<{field:string;op:string;value:unknown}>>;return {callId:call.id,status:'ok',complete:true,text:'1 patient',conditionKeys:conditions.flat().map(c=>`${c.field}:${c.op}:${c.value}`),evidence:[]};}},new AbortController().signal);
 expect(reads).toHaveLength(2);
 expect(reads[0]).toMatchObject({mode:'count',filterGroups:[[{field:'phone',op:'present',value:null}]]});
 expect(reads[1]).toMatchObject({mode:'count',filters:[{field:'age',op:'lt',value:18}]});
 expect(result.parts).toHaveLength(2);expect(result.status).toBe('completed');
});
