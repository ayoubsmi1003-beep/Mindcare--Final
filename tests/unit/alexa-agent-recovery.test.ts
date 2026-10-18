import {it,expect} from 'vitest';
import {restoreAgentTask,savedAgentTask,clearAgentTask} from '@/server/alexa/agent-loop';
import {parseDeclaration} from '@/shared/alexa/agent';

it('rejects malformed persisted task parts instead of trusting an unknown cast',()=>{
 const actor='recovery',conversation='malformed';clearAgentTask(actor,conversation);
 restoreAgentTask(actor,conversation,{original:'Patients actifs',parts:[{id:'a',conditions:'broken'}],results:[],at:Date.now(),patientId:null,page:'/jarvis'});
 expect(savedAgentTask(actor,conversation)).toBeNull();
});
it('rejects a future-dated checkpoint and an unrestricted persisted query',()=>{
 const part={id:'a',goal:'Patients',conditions:[],dependsOn:[],status:'answered',resultRefs:['c']};
 const task={original:'Patients',parts:[part],results:[],at:Date.now()+3600000,patientId:null,page:'/jarvis'};
 restoreAgentTask('recovery','future',task);expect(savedAgentTask('recovery','future')).toBeNull();
 restoreAgentTask('recovery','query',{...task,at:Date.now(),results:[{callId:'c',status:'ok',complete:true,evidence:[],text:'1',conditionKeys:[],data:{patientQuery:{mode:'list',sql:'SELECT *'}}}]});
 expect(savedAgentTask('recovery','query')).toBeNull();
});
it('normalizes native conditions while retaining unsupported predicates as unresolved',()=>{
 const parts=parseDeclaration({parts:[{id:'a',goal:'Adultes',tool:'query_patients',conditions:['age:gte:18','{"field":"identity_card","op":"missing","value":null}','email:missing'],dependsOn:[]}]});
 expect(parts[0]?.conditions).toHaveLength(2);expect(parts[0]?.unsupportedConditions).toEqual(['email:missing']);
});
it('restores a full20-row query checkpoint with its additional query evidence',()=>{
 const actor='recovery',conversation='full-page',query={mode:'list',filters:[{field:'identity_card',op:'missing',value:null}]};
 const evidence=Array.from({length:21},(_,i)=>({id:'source'+i,type:i===20?'query':'patient',label:'Synthetic'}));
 restoreAgentTask(actor,conversation,{original:'Lesquels ?',parts:[{id:'a',goal:'Liste',conditions:[],dependsOn:[],status:'answered',resultRefs:['c']}],results:[{callId:'c',status:'ok',complete:true,text:'25 patients',conditionKeys:['identity_card:missing:null'],evidence,data:{patientQuery:query,asOf:'2026-10-15T12:00:00.000Z',revision:'a'.repeat(32),offset:0,rows:Array(20).fill({})}}],at:Date.now(),patientId:null,page:'/jarvis'});
 expect(savedAgentTask(actor,conversation)?.results[0]?.evidence).toHaveLength(21);
});

it('normalizes native metadata labels into safe internal IDs and rewrites dependencies consistently',()=>{
 const result=parseDeclaration({parts:[{id:'identity_card:missing',goal:'Compter',tool:'query_patients',conditions:['identity_card:missing'],dependsOn:[]},{id:'après la lecture',goal:'Afficher',tool:'navigate',conditions:[],dependsOn:['identity_card:missing']}]});
 expect(result.map(p=>p.id)).toEqual(['p1','p2']);expect(result[1]?.dependsOn).toEqual(['p1']);
});
it('does not silently disambiguate duplicated native labels with dependencies',()=>{
 expect(()=>parseDeclaration({parts:[{id:'même:label',goal:'Un',tool:'query_patients',conditions:[],dependsOn:[]},{id:'même:label',goal:'Deux',tool:'query_patients',conditions:[],dependsOn:['même:label']}]})).toThrow();
});

it('preserves unsupported native metadata conditions separately from recognized typed conditions',()=>{const result=parseDeclaration({parts:[{id:'a',goal:'Patients',tool:'query_patients',conditions:['age:gte:18'],unsupportedConditions:['assurance non enregistrée'],dependsOn:[]}]});expect(result[0]?.conditions).toEqual([{field:'age',op:'gte',value:18}]);expect(result[0]?.unsupportedConditions).toEqual(['assurance non enregistrée']);});
