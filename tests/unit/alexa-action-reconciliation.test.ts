import {it,expect} from 'vitest';import {executerEcritureConfirmee,type DependancesExecution} from '@/services/jarvis-execution';import {ok} from '@/services/result';
it('reconciles a lost response against the same executed action and still verifies its effect without another write',async()=>{
 let writes=0,reads=0,verified=0;
 const deps:DependancesExecution={executer:async()=>{writes++;throw Error('lost response');},delaiMs:10,maintenant:Date.now,reconcilier:async()=>{reads++;return {state:'executed',tool:'create_editable_document_draft',affectedId:'22222222-2222-4222-8222-222222222222'};},verifierPour:()=>({nom:'create_editable_document_draft',description:'',critique:false,preparer:async()=>ok({args:{},titre:'',champs:[]}),verifier:async()=>{verified++;return ok(undefined);}})};
 const result=await executerEcritureConfirmee({actionId:'11111111-1111-4111-8111-111111111111',outil:'create_editable_document_draft',argsCanoniques:{}},deps);
 expect(result.ok).toBe(true);expect({writes,reads,verified}).toEqual({writes:1,reads:1,verified:1});
});
