import {expect,it} from 'vitest';
import {runAgentLoop} from '@/server/alexa/agent-loop';
it('reads independent counts separately when one has an extended predicate',async()=>{
 const reads:unknown[]=[];
 const result=await runAgentLoop({text:'Combien de patients avec un téléphone renseigné ? Combien de patients mineurs ?',conversationId:'separate-extended-counts',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{actor:'separate-extended-counts',infer:async()=>{throw Error('Closed count requests need no routing inference');},execute:async call=>{reads.push(call.args);const conditions=(call.args['filterGroups']??[call.args['filters']??[]]) as Array<Array<{field:string;op:string;value:unknown}>>;return {callId:call.id,status:'ok',complete:true,text:'1 patient',conditionKeys:conditions.flat().map(c=>`${c.field}:${c.op}:${c.value}`),evidence:[]};}},new AbortController().signal);
 expect(reads).toHaveLength(2);
 expect(reads[0]).toMatchObject({mode:'count',filters:[{field:'phone',op:'present',value:null}]});
 expect(reads[1]).toMatchObject({mode:'count',filters:[{field:'age',op:'lt',value:18}]});
 expect(result.parts).toHaveLength(2);expect(result.status).toBe('completed');
});
it.each([
 ['Combien de patients sont sans carte d’identité ?','identity_card'],
 ['Quel est le nombre de patients sans téléphone ?','phone'],
])('routes a standalone missing-%s patient count to its exact read without MiniCPM',async(question,field)=>{
 const reads:unknown[]=[];let inferences=0;
 const result=await runAgentLoop({text:question,conversationId:'standalone-missing-field-count',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{actor:'standalone-missing-field-count',infer:async()=>{inferences++;throw Error('A closed missing-field count needs no model inference');},execute:async call=>{reads.push({name:call.name,args:call.args});return {callId:call.id,status:'ok',complete:true,text:'Comptage vérifié.',conditionKeys:[`${field}:missing:null`],evidence:[{id:call.id,type:'query',label:'Comptage patient vérifié'}]};}},new AbortController().signal);
 expect(inferences).toBe(0);expect(reads).toHaveLength(1);
 expect(reads[0]).toMatchObject({name:'query_patients',args:{mode:'count',filters:[{field,op:'missing',value:null}]}});
 expect(result.status).toBe('completed');expect(result.parts).toMatchObject([{status:'answered'}]);
});
it.each([
 ['Quels patients sont sans CNI ? Donne leurs noms.','identity_card'],
 ['Liste les patients sans téléphone et donne leurs noms.','phone'],
])('routes a simple missing-%s patient list to its exact read without MiniCPM',async(question,field)=>{
 const reads:unknown[]=[];let inferences=0;
 const result=await runAgentLoop({text:question,conversationId:'standalone-missing-field-list',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{actor:'standalone-missing-field-list',infer:async()=>{inferences++;throw Error('A closed missing-field list needs no model inference');},execute:async call=>{reads.push({name:call.name,args:call.args});return {callId:call.id,status:'ok',complete:true,text:'Liste vérifiée.',conditionKeys:[`${field}:missing:null`],evidence:[{id:call.id,type:'query',label:'Liste patient vérifiée'}]};}},new AbortController().signal);
 expect(inferences).toBe(0);expect(reads).toHaveLength(1);
 expect(reads[0]).toMatchObject({name:'query_patients',args:{mode:'list',filters:[{field,op:'missing',value:null}]}});
 expect(result.status).toBe('completed');expect(result.parts).toMatchObject([{status:'answered'}]);
});
