import {expect,it} from 'vitest';
import {agentExecutor} from '@/server/alexa/agent-tools';
import type {DbPort,RpcArgs} from '@/services/db/port';

const input={text:'Compte les patients de sexe féminin.',conversationId:'constraint-echo',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};
const asOf='2026-10-23T12:00:00+01:00';
const group=[[{field:'sex',op:'eq',value:'F'}]];
it('compares applied JSON objects independently of PostgreSQL key order and retains groups on continuation',async()=>{
 const queries:Record<string,unknown>[]=[];
 const db:Pick<DbPort,'rpc'>={rpc:async<T>(_name:string,args:RpcArgs)=>{
  const spec=JSON.parse(String(args?.['p_spec']));queries.push(spec);
  const appliedSpec={...spec,filterGroups:[[{value:'F',op:'eq',field:'sex'}]]};
  const rows=spec.mode==='list'?[{id:'22222222-2222-4222-8222-222222222222',first_name:'Synthétique',last_name:'Fixture',missing:[],completed_consultations:null,outstanding_balance:null}]:[];
  return {ok:true,data:[{total:1,rows,metrics:{},unknownAge:0,revision:'a'.repeat(32),asOf,conditions:group.flat(),complete:true,offset:0,appliedSpec}] as T[]};
 }};
 const knowledge={rpc:async()=>({data:null,error:null})};
 const first=await agentExecutor(input,db,knowledge)({id:'first',name:'query_patients',args:{partIds:['p'],mode:'count'}},asOf,[],new AbortController().signal);
 expect(first.status).toBe('ok');
 const next=await agentExecutor({...input,text:'Lesquels ?'},db,knowledge)({id:'next',name:'query_patients',args:{partIds:['p'],mode:'list',reusePrevious:true}},asOf,[first],new AbortController().signal);
 expect(next.status).toBe('ok');expect(queries[1]?.['filterGroups']).toEqual(group);expect(queries[1]).not.toHaveProperty('filters');
});
