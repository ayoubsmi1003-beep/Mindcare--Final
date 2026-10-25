import {expect,it} from 'vitest';
import {constrainCountDeclaration,countContractHints,countContractParts,frenchPatientCountContract,frenchRequestAdmission,frenchRequestedOutputs,requestedCountRead,requestedReadTool} from '@/shared/alexa/request-contract';
import type {RequestPart,SupportedCondition} from '@/shared/alexa/agent';
const part=(conditions:SupportedCondition[]):RequestPart=>({id:'p',goal:'Nombre',tools:['query_patients'],conditions,dependsOn:[],status:'pending',resultRefs:[]});
it('leaves a count plus another read to native multi-output interpretation',()=>{
 expect(frenchPatientCountContract('Combien de patients actifs ? Lis les notes du dossier courant.')).toBeNull();
 expect(frenchPatientCountContract('Combien de patients actifs et explique leur répartition ?')).toBeNull();
 expect(frenchPatientCountContract('Combien de patients sans numéro de document d’identité et combien de recettes ?')).toBeNull();
});
it('routes a named national-identity lookup through the patient profile gate',()=>{
 const admission=frenchRequestAdmission('Quel numéro national est enregistré pour Lina Ziani ?',false);
 expect(admission.tools).toEqual(['get_patient_context']);
 expect(admission.patientSection).toBe('profile');
});
it.each(['Quel est le nombre de patients sans téléphone ?','Quel est le total des patients sans carte d’identité ?'])('recognizes a natural patient total question as a count: %s',text=>expect(requestedCountRead(text)).toBe(true));
it('binds an explicit French month range to a named clinical summary',()=>{
 const admission=frenchRequestAdmission('Résume en un seul paragraphe l’évolution racontée dans les six consultations d’avril à septembre 2026 de Amel Bensaid.',false);
 expect(admission).toMatchObject({tools:['get_patient_context'],patientSection:'summary',consultationCount:6,from:'2026-04-01T00:00:00+01:00',to:'2026-10-01T00:00:00+01:00'});
});
it('does not infer a year or accept reversed months in a clinical summary range',()=>{
 for(const text of ['Résume le cas de Amel Bensaid d’avril à septembre.','Résume le cas de Amel Bensaid de septembre à avril 2026.']){
  const admission=frenchRequestAdmission(text,false);
  expect(admission.from,text).toBeUndefined();expect(admission.to,text).toBeUndefined();
 }
});
it('compiles a bounded list of French patient metrics before native dispatch',()=>{
 const text='Pour le cabinet, compte les dossiers actifs, ceux sans identité nationale, les mineurs et les patients sans consultation achevée au cours des six derniers mois.';
 const contract=frenchPatientCountContract(text);
 expect(contract?.clauses).toHaveLength(4);
 expect(countContractHints(contract!).map(item=>item.conditions)).toEqual([
  [],['identity_card:missing'],['age:lt:18'],['no_completed_months:eq:6'],
 ]);
 expect(countContractParts(contract!).map(part=>part.tools)).toEqual(Array(4).fill(['query_patients']));
});
it('normalizes common French four-metric list phrasings to the same closed conditions',()=>{
 const inputs=[
  'Indique séparément le nombre d’actifs, de numéros d’identité manquants, de patients mineurs et d’absences de consultation sur six mois.',
  'Fais un bilan en quatre points : effectif actif, identité manquante, patients de moins de 18 ans, absence de consultation clôturée depuis six mois.',
  'Quels sont les quatre nombres correspondants aux patients actifs, aux CNI manquantes, aux moins de 18 ans et aux patients sans visite terminée sur six mois ?',
 ];
 for(const text of inputs){
  const contract=frenchPatientCountContract(text);
  expect(contract?.clauses,text).toHaveLength(4);
  expect(countContractHints(contract!).map(item=>item.conditions)).toEqual([[],['identity_card:missing'],['age:lt:18'],['no_completed_months:eq:6']]);
 }
});
it('splits a named-patient note question from its completed-consultation count',()=>{
 const text='Pour Amel Bensaid, quel est le thème récurrent des notes et combien de consultations terminées sont enregistrées ?';
 const outputs=frenchRequestedOutputs(text);
 expect(outputs).toEqual([
  'Pour Amel Bensaid, quel est le thème récurrent des notes',
  'Pour Amel Bensaid, combien de consultations terminées sont enregistrées ?',
 ]);
 expect(outputs!.map(goal=>requestedReadTool(goal,text))).toEqual(['get_patient_context','query_consultations']);
});
it('splits a selected-patient name and completed-consultation count into two grounded reads',()=>{
 const text='Pour le patient sélectionné, indique son nom et le nombre de consultations terminées.';
 const outputs=frenchRequestedOutputs(text);
 expect(outputs).toEqual([
  'Pour le patient sélectionné, indique son nom',
  'le nombre de consultations terminées',
 ]);
 expect(outputs!.map(goal=>requestedReadTool(goal,text))).toEqual(['get_patient_context','query_consultations']);
});
it('splits a French shared-verb list into reads for each explicitly named patient',()=>{
 const text='Donne le téléphone de Amina Meziane, la date de naissance de Sofiane Cherif et le nombre de consultations de Amel Bensaid.';
 const outputs=frenchRequestedOutputs(text);
 expect(outputs).toEqual([
  'Donne le téléphone de Amina Meziane',
  'Donne la date de naissance de Sofiane Cherif',
  'Donne le nombre de consultations de Amel Bensaid.',
 ]);
 expect(outputs!.map(goal=>requestedReadTool(goal,text))).toEqual(['get_patient_context','get_patient_context','query_consultations']);
 expect(frenchRequestedOutputs('Donne le téléphone et la date de naissance de Amel Bensaid.')).toBeNull();
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
