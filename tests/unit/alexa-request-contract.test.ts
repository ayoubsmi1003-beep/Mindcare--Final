import {expect,it} from 'vitest';
import {constrainCountDeclaration,frenchPatientCountContract} from '@/shared/alexa/request-contract';
import type {RequestPart,SupportedCondition} from '@/shared/alexa/agent';
const part=(conditions:SupportedCondition[]):RequestPart=>({id:'p',goal:'Nombre',tools:['query_patients'],conditions,dependsOn:[],status:'pending',resultRefs:[]});
it('leaves a count plus another read to native multi-output interpretation',()=>{
 expect(frenchPatientCountContract('Combien de patients actifs ? Lis les notes du dossier courant.')).toBeNull();
 expect(frenchPatientCountContract('Combien de patients actifs et explique leur répartition ?')).toBeNull();
 expect(frenchPatientCountContract('Combien de patients sans numéro de document d’identité et combien de recettes ?')).toBeNull();
});
it('preserves additional requested compound predicates beyond a recognized missing-field hint',()=>{
 const conditions:SupportedCondition[]=[{field:'identity_card',op:'missing',value:null},{field:'completed_consultations',op:'gte',value:3}];
 const c=frenchPatientCountContract('Combien de patients sans identité ont au moins 3 consultations terminées ?')!;
 expect(constrainCountDeclaration([part(conditions)],c)[0]?.conditions).toEqual(conditions);
});
it('still rejects a recognized condition changed by the model and an unrequested additional field',()=>{
 const c=frenchPatientCountContract('Combien de patients sans identité ?')!;
 expect(()=>constrainCountDeclaration([part([{field:'phone',op:'missing',value:null}])],c)).toThrow();
 expect(()=>constrainCountDeclaration([part([{field:'identity_card',op:'missing',value:null},{field:'phone',op:'missing',value:null}])],c)).toThrow();
});
it('does not confuse a numeric age threshold with the adult boundary',()=>{
 const c=frenchPatientCountContract('Combien de patients ont au moins 1 an ?')!;
 expect(constrainCountDeclaration([part([{field:'age',op:'gte',value:1}])],c)).toHaveLength(1);
});
it('uses original-text positions when a mixed-script prefix contains combining marks',()=>{
 const c=frenchPatientCountContract('Pour سَلْمَى, combien de patients actifs et combien d’enfants ?');
 expect(c?.clauses[0]).toBe('combien de patients actifs');expect(c?.clauses[1]).toBe('combien d’enfants ?');
});
it('preserves a material patient condition that appears before the count phrase',()=>{
 const c=frenchPatientCountContract('Le numéro de carte d’identité manque pour combien de patients actifs ?')!;
 expect(c.clauses).toEqual(['Le numéro de carte d’identité manque pour combien de patients actifs ?']);
 expect(constrainCountDeclaration([part([{field:'identity_card',op:'missing',value:null}])],c)[0]?.conditions).toEqual([{field:'identity_card',op:'missing',value:null}]);
});

it('admits the ordinary French never-consulted wording without guessing another predicate',()=>{
 const c=frenchPatientCountContract('Combien de patients n’ont jamais consulté ?')!;expect(constrainCountDeclaration([part([{field:'completed_consultations',op:'eq',value:0}])],c)).toHaveLength(1);
});
it('rejects contradictory numeric constraints added to the minor population',()=>{
 const c=frenchPatientCountContract('Combien de patients mineurs ?')!;expect(()=>constrainCountDeclaration([part([{field:'age',op:'lt',value:18},{field:'age',op:'gte',value:18}])],c)).toThrow();
});
it('admits an empty age range so its count is verified by the database',()=>{
 const c=frenchPatientCountContract('Compte les patients de moins de zéro an.')!;
 expect(constrainCountDeclaration([part([{field:'age',op:'lt',value:0}])],c)[0]?.conditions).toEqual([{field:'age',op:'lt',value:0}]);
});
it('recognizes a count with a universal determiner while retaining the active scope',()=>{
 const c=frenchPatientCountContract('Compte tous les dossiers actifs.');
 expect(c?.clauses).toHaveLength(1);
 expect(constrainCountDeclaration([part([])],c!)[0]?.population).toBe('active');
});
