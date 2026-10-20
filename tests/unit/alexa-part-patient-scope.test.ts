import {expect,it,vi} from 'vitest';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import {scriptedAlexaRpc} from '../helpers/alexa-rpc';
import type {LocalCompletion} from '@/server/alexa/local-model-protocol';
const ayoub='a3000000-0000-4000-8000-000000000001',nadia='a3000000-0000-4000-8000-000000000002';
const text='Montre le téléphone de Ayoub Salmi et montre les coordonnées de Belkacem Nadia.';
const input={text,conversationId:'two-named-patients',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:ayoub,page:'/jarvis'}};
it('resolves each named part independently instead of reusing the selected patient or global ambiguity',async()=>{
 const row={id:nadia,record_number:'FICTIF-N',first_name:'Nadia',last_name:'Belkacem',birth_date:null,phone:'0000000004',phone_alt:null,id_document_number:null,id_document_issuer:null,sex:'F',marital_status:null,address:null,emergency_contact:null,notes_admin:null,is_active:true,total_count:1};
 const rpc=scriptedAlexaRpc(async()=>({ok:true as const,data:[row]}));
 const r=await agentExecutor(input,{rpc},{rpc:vi.fn()})({id:'n',name:'get_patient_context',args:{partIds:['n'],section:'profile'}},'2026-10-15T12:00:00Z',[],new AbortController().signal,undefined,'montre les coordonnées de Belkacem Nadia.');
 expect(r).toMatchObject({status:'ok',patientId:nadia});expect(r.text).toContain('Nadia Belkacem');expect(r.text).toContain('0000000004');expect(r.text).not.toContain('Ayoub');
 const stale=await agentExecutor({...input,patientName:'Ayoub Salmi'},{rpc},{rpc:vi.fn()})({id:'n2',name:'get_patient_context',args:{partIds:['n'],section:'profile'}},'2026-10-15T12:00:00Z',[],new AbortController().signal,undefined,'montre les coordonnées de Belkacem Nadia.');
 expect(stale).toMatchObject({status:'ok',patientId:nadia});
});
it('passes only exact human clauses as internal per-part scope',async()=>{
 let step=0;const scopes:(string|undefined)[]=[];
 const call=(entries:{name:string;args:Record<string,unknown>}[]):LocalCompletion=>({kind:'calls',calls:entries.map((c,i)=>({id:'c'+step+i,...c})),message:{role:'assistant',content:null,tool_calls:[]},tokensIn:1,tokensOut:1});
 const goals=['Montre le téléphone de Ayoub Salmi','montre les coordonnées de Belkacem Nadia.'];
 const r=await runAgentLoop(input,{actor:'part-scopes',infer:async()=>step++===0?call([{name:'declare_request',args:{parts:goals.map((goal,i)=>({id:'p'+i,goal,tool:'get_patient_context',conditions:[],dependsOn:[]}))}}]):call(goals.map((_goal,i)=>({name:'get_patient_context',args:{partIds:['p'+i]}}))),execute:async(c,_a,_p,_s,_o,goal)=>{scopes.push(goal);return {callId:c.id,status:'ok',complete:true,text:'Information vérifiée',evidence:[],conditionKeys:[]};}},new AbortController().signal);
 expect(r.status).toBe('completed');expect(scopes).toEqual(goals);
});
it('keeps named sub-question identity ahead of a stale global patient name',async()=>{
 const ayoubRow={id:ayoub,record_number:'FICTIF-A',first_name:'Ayoub',last_name:'Salmi',birth_date:null,phone:'0000000001',phone_alt:null,id_document_number:null,id_document_issuer:null,sex:'M',marital_status:null,address:null,emergency_contact:null,notes_admin:null,is_active:true,total_count:1};
 const nadiaRow={id:nadia,record_number:'FICTIF-N',first_name:'Nadia',last_name:'Belkacem',birth_date:null,phone:'0000000004',phone_alt:null,id_document_number:null,id_document_issuer:null,sex:'F',marital_status:null,address:null,emergency_contact:null,notes_admin:null,is_active:true,total_count:1};
 const searches:string[]=[];
 const rpc=scriptedAlexaRpc(async(name,args)=>{
  if(name==='search_patients'){
   const query=String(args.p_query);searches.push(query);
   const row=/belkacem|nadia/iu.test(query)?nadiaRow:ayoubRow;
   return {ok:true as const,data:[row]};
  }
  if(name==='get_patient')return {ok:true as const,data:[args.p_id===nadia?nadiaRow:ayoubRow]};
  throw new Error(`Unexpected RPC ${name}`);
 });
 const scopedInput={...input,patientName:'Ayoub Salmi'};
 const r=await runAgentLoop(scopedInput,{actor:'stale-global-name',infer:async()=>{throw new Error('Direct reads should not invoke the model');},execute:(call,asOf,prior,signal,original,goal)=>agentExecutor(scopedInput,{rpc},{rpc:vi.fn()})(call,asOf,prior,signal,original,goal)},new AbortController().signal);
 expect(searches).toContain('Belkacem Nadia');
 expect(r.results.map(result=>result.patientId)).toEqual([ayoub,nadia]);
 expect(r.results[0]?.text).toContain('0000000001');
 expect(r.results[1]?.text).toContain('0000000004');
});
it('also gives a single explicitly named patient priority over a stale global patientName',async()=>{
 const row={id:nadia,record_number:'FICTIF-N',first_name:'Nadia',last_name:'Belkacem',birth_date:null,phone:'0000000004',phone_alt:null,id_document_number:null,id_document_issuer:null,sex:'F',marital_status:null,address:null,emergency_contact:null,notes_admin:null,is_active:true,total_count:1};
 const rpc=scriptedAlexaRpc(async()=>({ok:true as const,data:[row]}));
 const r=await agentExecutor({...input,text:'Montre le téléphone de Belkacem Nadia.',patientName:'Ayoub Salmi'},{rpc},{rpc:vi.fn()})({id:'single',name:'get_patient_context',args:{partIds:['n'],section:'profile'}},'2026-10-15T12:00:00Z',[],new AbortController().signal);
 expect(r).toMatchObject({status:'ok',patientId:nadia});expect(r.text).not.toContain('Ayoub');
});
it('observes a copy of the final validated dispatch without letting the observer change its scope',async()=>{
 let step=0;
 const call=(name:string,args:Record<string,unknown>):LocalCompletion=>({kind:'calls',calls:[{id:'c'+step,name,args}],message:{role:'assistant',content:null,tool_calls:[]},tokensIn:1,tokensOut:1});
 const goal='Montre les diagnostics actifs du dossier courant.';
 const execute=vi.fn(async(c:{id:string;args:Record<string,unknown>})=>({callId:c.id,status:'ok' as const,complete:true,text:'Diagnostic vérifié.',evidence:[],conditionKeys:[]}));
 const observeCall=vi.fn(c=>{expect(c.args).toMatchObject({section:'diagnoses',diagnosisState:'active'});c.args.diagnosisState='resolved';});
 const r=await runAgentLoop({...input,text:goal,conversationId:crypto.randomUUID()},{actor:'dispatch-observer',observeCall,execute,infer:async()=>++step===1?call('declare_request',{parts:[{id:'d',goal,tool:'get_patient_context',conditions:[],dependsOn:[]}]}):call('get_patient_context',{partIds:['d']})},new AbortController().signal);
 expect(r.status).toBe('completed');expect(observeCall).toHaveBeenCalledOnce();expect(execute.mock.calls[0]?.[0].args).toMatchObject({section:'diagnoses',diagnosisState:'active'});
});
