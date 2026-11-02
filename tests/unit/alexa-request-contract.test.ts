import {expect,it} from 'vitest';
import {constrainCountDeclaration,countContractHints,countContractParts,explicitFrenchComparedMonthRanges,explicitFrenchDayRange,explicitFrenchDateRange,frenchPatientCompoundContract,frenchPatientCountContract,frenchReadArgumentBindings,frenchRequestAdmission,frenchRequestedOutputs,isFrenchAlexaCapabilityQuestion,requestedCountRead,requestedReadTool} from '@/shared/alexa/request-contract';
import {parsePatientMention} from '@/shared/alexa/patient-mention';
import {patientQueryContract} from '@/shared/alexa/patient-query-contract';
import type {RequestPart,SupportedCondition} from '@/shared/alexa/agent';
const part=(conditions:SupportedCondition[]):RequestPart=>({id:'p',goal:'Nombre',tools:['query_patients'],conditions,dependsOn:[],status:'pending',resultRefs:[]});
it.each([
 ['Dans le dossier de Nadia Test, ajoute uniquement une date de fin au traitement ZOLOFT 25 mg : 27/10/2026.','update_treatment'],
 ['Pour Nadia Test, fixe uniquement la date de fin du Zoloft 25 mg au 27/10/2026.','update_treatment'],
 ['Pour Amel Bensaid, fixe la date de fin du traitement Sertraline 50 mg au 27/10/2026.','update_treatment'],
 ['Alexa, modifie uniquement la fréquence du traitement de Lina Test à une prise par jour.','update_treatment'],
 ['Pour Nadia Test, supprime uniquement la date de fin du Zoloft 25 mg et remets-le sans date de fin.','update_treatment'],
 ['Pour Amel Bensaid, retire uniquement la date de fin du traitement Sertraline 50 mg et laisse-le sans date de fin.','update_treatment'],
 ['Pour Nadia Test, arrête le traitement Zoloft 25 mg.','stop_treatment'],
 ['Peux-tu cesser le traitement de Lina Test ?','stop_treatment'],
])('admits explicit French medication mutations through the confirmed action tool: %s',(text,preparationAction)=>{
 expect(frenchRequestAdmission(text,false)).toMatchObject({tools:['prepare_action'],preparationAction});
});
it.each([
  ['Ajoute pour islam adjina une consultation le 4 novembre 2026 à 10 h, durée 30 minutes.', 'create_appointment', 'islam adjina'],
  ['Place islam adjina sur le créneau déjà occupé sélectionné.', 'create_appointment', 'islam adjina'],
  ['Pour samiha ferhat, prévois une consultation le 6 novembre 2026.', 'create_appointment', 'samiha ferhat'],
  ['Décale le rendez-vous choisi de islam adjina au 5 novembre 2026 à 11 h.', 'reschedule_appointment', 'islam adjina'],
])('admits a lower-case synthetic patient name in an explicit action: %s', (text, preparationAction, name) => {
  expect(parsePatientMention(text)).toEqual({ status: 'named', name });
  expect(frenchRequestAdmission(text, false)).toMatchObject({ tools: ['prepare_action'], preparationAction });
});
it('leaves a count plus another read to native multi-output interpretation',()=>{
 expect(frenchPatientCountContract('Combien de patients actifs ? Lis les notes du dossier courant.')).toBeNull();
 expect(frenchPatientCountContract('Combien de patients actifs et explique leur répartition ?')).toBeNull();
 expect(frenchPatientCountContract('Combien de patients sans numéro de document d’identité et combien de recettes ?')).toBeNull();
});
it('routes a named national-identity lookup through the patient profile gate',()=>{
 const admission=frenchRequestAdmission('Quel numéro national est enregistré pour Lina Test ?',false);
 expect(admission.tools).toEqual(['get_patient_context']);
 expect(admission.patientSection).toBe('profile');
});
it.each(['Quel est le nombre de patients sans téléphone ?','Quel est le total des patients sans carte d’identité ?'])('recognizes a natural patient total question as a count: %s',text=>expect(requestedCountRead(text)).toBe(true));
it('recognizes a single total over the explicitly requested active and archived populations',()=>{
 const contract=frenchPatientCountContract('Combien de patients au total, actifs et archivés ?');
 expect(contract?.clauses).toEqual(['Combien de patients au total, actifs et archivés ?']);
 expect(countContractParts(contract!)).toMatchObject([{population:'all',conditions:[],tools:['query_patients']}]);
});
it.each([
 ['Combien de dossiers, actifs et archivés réunis ?','all',[]],
 ['Combien de patients actifs possèdent un téléphone ?','active',[{field:'phone',op:'present',value:null}]],
 ['Combien de dossiers actifs possèdent un numéro de carte d’identité ?','active',[{field:'identity_card',op:'present',value:null}]],
] as const)('binds the complete requested patient population and positive filter for %s',(text,population,conditions)=>{
 const contract=frenchPatientCountContract(text);
 expect(contract).not.toBeNull();
 expect(countContractParts(contract!)).toMatchObject([{population,conditions,tools:['query_patients']}]);
});
it('keeps separate missing-identity and missing-phone counts as two typed clauses',()=>{
 const contract=frenchPatientCountContract('Compte les patients sans carte d’identité et ceux sans téléphone, séparément.');
 expect(contract?.clauses).toHaveLength(2);
 expect(countContractHints(contract!).map(item=>item.conditions)).toEqual([['identity_card:missing'],['phone:missing']]);
});
it('converts an explicitly recorded birth date into a positive patient filter',()=>{
 const contract=frenchPatientCountContract('Compte les patients avec une date de naissance renseignée.');
 expect(countContractParts(contract!)).toMatchObject([{population:'active',conditions:[{field:'birth_date',op:'present',value:null}],tools:['query_patients']}]);
});
it.each([['Compte les patients de sexe féminin.','F'],['Compte les patients de sexe masculin.','M']])('keeps an explicit French sex filter as a typed patient predicate: %s',(text,value)=>{
 const contract=frenchPatientCountContract(text);
 expect(countContractParts(contract!)).toMatchObject([{conditions:[{field:'sex',op:'eq',value}],tools:['query_patients']}]);
});
it('maps a six-month not-seen count to the completed-visit recency predicate',()=>{
 const contract=frenchPatientCountContract('Combien de patients n’ont pas été vus depuis six mois ?');
 expect(countContractParts(contract!)).toMatchObject([{conditions:[{field:'no_completed_months',op:'eq',value:6}],tools:['query_patients']}]);
});
it('binds an explicit French month range to a named clinical summary',()=>{
 const admission=frenchRequestAdmission('Résume en un seul paragraphe l’évolution racontée dans les six consultations d’avril à septembre 2026 de Amel Bensaid.',false);
 expect(admission).toMatchObject({tools:['get_patient_context'],patientSection:'summary',consultationCount:6,from:'2026-04-01T00:00:00+01:00',to:'2026-10-01T00:00:00+01:00'});
});
it('keeps a single named month on a completed-consultation request and anchors it to the cabinet year',()=>{
 const admission=frenchRequestAdmission('Combien de consultations terminées du dossier courant en septembre ?',false,'2026-10-25T12:00:00+01:00');
 expect(admission).toMatchObject({tools:['query_consultations'],consultationMode:'count',consultationStatus:'closed',from:'2026-09-01T00:00:00+01:00',to:'2026-10-01T00:00:00+01:00',dateAxis:'started_at'});
});
it('binds a selected-patient pending-payment month to payment creation dates',()=>{
 const text='Liste les paiements en attente du patient sélectionné en octobre 2026.';
 const admission=frenchRequestAdmission(text,false,'2026-10-25T12:00:00+01:00');
 expect(admission).toMatchObject({tools:['query_finance'],financeState:'pending',from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'});
 expect(frenchReadArgumentBindings(admission,'query_finance')).toMatchObject({state:'pending',from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'});
});
it('routes appointment requests awaiting treatment to the reception queue',()=>{
 expect(frenchRequestAdmission('Combien de demandes de rendez-vous restent à traiter ?',false)).toMatchObject({tools:['query_app'],applicationView:'reception'});
});
it('keeps a pause-state treatment follow-up on the selected patient treatment read',()=>{
 expect(frenchRequestAdmission('Quels traitements sont en pause pour le patient sélectionné ?',false)).toMatchObject({tools:['get_patient_context'],patientSection:'treatments',treatmentState:'paused'});
});
it.each([
 ['Quels diagnostics sont actuellement notés comme actifs pour le patient sélectionné ?','active'],
 ['Quels diagnostics sont actuellement notés comme actifs pour Nadia Test ?','active'],
 ['Quels diagnostics sont actuellement notés comme résolus pour Nadia Test ?','resolved'],
])('routes diagnosis questions about %s to the diagnosis section, not consultation notes',(text,diagnosisState)=>{
 expect(frenchRequestAdmission(text,false)).toMatchObject({tools:['get_patient_context'],patientSection:'diagnoses',diagnosisState});
});
it('preserves an explicit single-day range and issued status in a patient document read',()=>{
 const text='Quels documents émis concernent le dossier courant le 1 janvier 1900 ?';
 const admission=frenchRequestAdmission(text,false);
 expect(admission).toMatchObject({tools:['query_documents'],documentStatus:'issued',from:'1900-01-01T00:00:00+01:00',to:'1900-01-02T00:00:00+01:00'});
 expect(frenchReadArgumentBindings(admission,'query_documents')).toMatchObject({status:'issued',from:'1900-01-01T00:00:00+01:00',to:'1900-01-02T00:00:00+01:00'});
});
it('routes a daily finance calendar request to its bounded calendar mode',()=>{
 const text='Affiche la première page du calendrier financier d’octobre 2026 avec les montants quotidiens et les indicateurs d’impayés.';
 const admission=frenchRequestAdmission(text,false,'2026-10-25T12:00:00+01:00');
 expect(admission).toMatchObject({tools:['query_finance'],financeMode:'calendar',from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'});
 expect(frenchReadArgumentBindings(admission,'query_finance')).toMatchObject({mode:'calendar',from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'});
});
it.each([
 ['Quel est le montant encaissé ce mois-ci ?','totals','collected'],
 ['Quel est le chiffre d’affaires du mois en cours ?','overview',undefined],
 ['Quel résultat net le cabinet a-t-il réalisé ce mois-ci ?','overview',undefined],
] as const)('binds a current-month finance read to the cabinet calendar for %s',(text,financeMode,financeState)=>{
 const admission=frenchRequestAdmission(text,false,'2026-10-27T09:00:00+01:00');
 expect(admission).toMatchObject({tools:['query_finance'],financeMode,from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'});
 if(financeState)expect(admission.financeState).toBe(financeState);
});
it.each(['Quels patients sont attendus demain matin ?','Quels patients sont attendus demain après-midi ?','Qui est attendu demain avant midi ?'])('routes patient-attendee wording to the agenda read gate: %s',text=>{
 expect(frenchRequestAdmission(text,false,'2026-10-27T09:00:00+01:00')).toMatchObject({tools:['query_agenda']});
});
it.each([
 ['Comment les charges sont-elles réparties par catégorie en octobre 2026 ?',{tools:['query_finance'],financeMode:'composition',from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'}],
 ['Quel est le résultat net du cabinet pour octobre 2026 ?',{tools:['query_finance'],financeMode:'overview',from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'}],
 ['Quel montant représentent les paiements encaissés du 1 octobre 2026 au 31 octobre 2026 ?',{tools:['query_finance'],financeMode:'totals',financeState:'collected',from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'}],
 ['Quel montant a été encaissé par le cabinet en octobre 2026 ?',{tools:['query_finance'],financeMode:'totals',financeState:'collected',from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'}],
 ['Quel solde reste à encaisser, toutes dates confondues ?',{tools:['query_finance'],financeMode:'totals',financeState:'all'}],
 ['Quelle différence entre recettes encaissées et paiements créés en octobre 2026 ?',{tools:['query_finance'],financeMode:'totals',financeState:'all',from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'}],
 ['Combien de consultations terminées n’ont pas de tarif ?',{tools:['query_finance'],financeMode:'totals',financeState:'all',financeConsultationStatus:'closed'}],
])('keeps the requested finance view and scope for %s', (text,expected)=>{
 const admission=frenchRequestAdmission(text,false,'2026-10-25T12:00:00+01:00');
 expect(admission).toMatchObject(expected);
});
it('routes a named last-consultation summary to exactly the latest visit',()=>{
 const admission=frenchRequestAdmission('Résume la dernière consultation de Amel Bensaid.',false);
 expect(admission).toMatchObject({tools:['get_patient_context'],patientSection:'summary',consultationCount:1});
});
it('routes principal problems in the current consultation to a one-visit clinical summary',()=>{
 const admission=frenchRequestAdmission('Quels problèmes principaux sont documentés dans la consultation actuelle de islam adjina ?',false);
 expect(admission).toMatchObject({tools:['get_patient_context'],patientSection:'summary',consultationCount:1});
});
it('reads the requested note sections from a named patient latest consultation without asking about signature state',()=>{
 const admission=frenchRequestAdmission('Lis les notes de la dernière consultation de Amel Bensaid.',false);
 expect(admission).toMatchObject({tools:['get_patient_context'],patientSection:'notes'});
 expect(admission).not.toHaveProperty('consultationCount');
 expect(admission).not.toHaveProperty('consultationStatus');
});
it.each([
 ['Résume la dernière consultation de Salmi Ayoub.','Salmi Ayoub'],
 ['Fais-moi un résumé du dernier rendez-vous de Ayoub Salmi.','Ayoub Salmi'],
 ['Peux-tu me résumer sa consultation la plus récente, dossier de Belkacem Nadia ?','Belkacem Nadia'],
 ['Donne-moi les notes de la dernière consultation de Belkacem Nadia.','Belkacem Nadia'],
 ['Qu’est-ce qui a été noté pendant la séance la plus récente de Nadia Belkacem ?','Nadia Belkacem'],
 ['Raconte-moi brièvement la dernière séance du patient Ayoub Salmi.','Ayoub Salmi'],
 ['Un petit résumé de la dernière visite de Salmi Ayoub, s’il te plaît.','Salmi Ayoub'],
 ['Qu’est-ce qui ressort de la dernière consultation de Salmi Ayoub ?','Salmi Ayoub'],
 ['Peux-tu m’expliquer la séance la plus récente de Ayoub Salmi ?','Ayoub Salmi'],
 ['Fais le compte rendu du dernier rendez-vous de Belkacem Nadia.','Belkacem Nadia'],
])('understands varied French requests for the latest patient visit without a signature question: %s',(text,name)=>{
 const admission=frenchRequestAdmission(text,false);
 expect(parsePatientMention(text)).toEqual({status:'named',name});
 const notesRequested=/\bnotes?\b/u.test(text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase());
 expect(admission).toMatchObject({tools:['get_patient_context'],patientSection:notesRequested?'notes':'summary',...(notesRequested?{}:{consultationCount:1})});
 expect(admission).not.toHaveProperty('consultationStatus');
});
it('keeps full note transcription available only when the user explicitly asks for it',()=>{
 expect(frenchRequestAdmission('Lis le texte intégral des notes de la dernière consultation de Amel Bensaid.',false)).toMatchObject({tools:['get_patient_context'],patientSection:'notes'});
});
it('routes an explicit chronological clinical-events request to the timeline reader',()=>{
  expect(frenchRequestAdmission('Présente les événements cliniques du patient sélectionné dans leur ordre chronologique.',false)).toMatchObject({tools:['get_patient_context'],patientSection:'timeline'});
});
it.each([
 'Présente les événements cliniques dans leur ordre chronologique et indique les échelles enregistrées pour Amel Bensaid.',
 'Présente les événements cliniques dans leur ordre chronologique ; indique les traitements du dossier courant.',
])('keeps compound chronology requests on the full interpretation path: %s',text=>{
 const admission=frenchRequestAdmission(text,false);
 expect(admission).not.toHaveProperty('tools');
 expect(admission).not.toHaveProperty('patientSection');
});
it.each([
 'Quelles échelles ont été enregistrées pour Amel Bensaid ?',
 'Quels scores sont disponibles dans le dossier courant ?',
])('routes named or current-patient scale questions to recorded scale data: %s',text=>{
 expect(frenchRequestAdmission(text,false)).toMatchObject({tools:['get_patient_context'],patientSection:'scales'});
});
it('recognizes a patient named after the clinical preposition « à » in an administered-scales question',()=>{
 const text='Quelles échelles ont été administrées à islam adjina ?';
 expect(parsePatientMention(text)).toEqual({status:'named',name:'islam adjina'});
 expect(frenchRequestAdmission(text,false)).toMatchObject({tools:['get_patient_context'],patientSection:'scales'});
});
it('keeps an administered-scale history question on the scale reader when it also names consultations',()=>{
 const text='Quelles échelles ont été administrées à said doumer et dans quelles consultations ?';
 expect(frenchRequestAdmission(text,false)).toMatchObject({tools:['get_patient_context'],patientSection:'scales'});
});
it('keeps a consultation count attached to the patient named after « a eues »',()=>{
 const text='Combien de consultations a eues islam adjina ?';
 expect(parsePatientMention(text)).toEqual({status:'named',name:'islam adjina'});
 expect(frenchRequestAdmission(text,false)).toMatchObject({tools:['query_consultations'],consultationMode:'count'});
});
it('routes a direct full-name patient search to the patient query tool',()=>{
 const text='Cherche islam adjina.';
 expect(parsePatientMention(text)).toEqual({status:'named',name:'islam adjina'});
 expect(frenchRequestAdmission(text,false)).toMatchObject({tools:['query_patients']});
});
it('treats « cherche plutôt » as a correction to the patient search',()=>{
 const text='Cherche plutôt samiha ferhat.';
 expect(parsePatientMention(text)).toEqual({status:'named',name:'samiha ferhat'});
 expect(frenchRequestAdmission(text,false)).toMatchObject({tools:['query_patients']});
});
it('treats an all-cabinet amount to collect as a cabinet-wide pending balance',()=>{
 expect(frenchRequestAdmission('Quel reste à encaisser pour l’ensemble du cabinet ?',false)).toMatchObject({tools:['query_finance'],financeMode:'totals',financeState:'all'});
});
it('uses the close date only when the question explicitly names that date axis',()=>{
 const admission=frenchRequestAdmission('Combien de consultations terminées du dossier courant à la date de clôture en septembre 2026 ?',false,'2026-10-25T12:00:00+01:00');
 expect(admission).toMatchObject({tools:['query_consultations'],from:'2026-09-01T00:00:00+01:00',to:'2026-10-01T00:00:00+01:00',dateAxis:'ended_at'});
});
it.each([
 ['du 1 septembre 2026 au 30 septembre 2026',{from:'2026-09-01T00:00:00+01:00',to:'2026-10-01T00:00:00+01:00'}],
 ['entre le 1er septembre 2026 et le 30 septembre 2026',{from:'2026-09-01T00:00:00+01:00',to:'2026-10-01T00:00:00+01:00'}],
 ['du 01/09/2026 au 30/09/2026',{from:'2026-09-01T00:00:00+01:00',to:'2026-10-01T00:00:00+01:00'}],
])('keeps explicit civil date ranges and the requested consultation date axis: %s',(period,range)=>{
 expect(frenchRequestAdmission(`Compte les consultations du dossier courant selon la date de clôture ${period}.`,false,'2026-10-25T12:00:00+01:00')).toMatchObject({tools:['query_consultations'],consultationMode:'count',consultationStatus:'closed',dateAxis:'ended_at',...range});
});
it.each([
 'Les consultations du 15 octobre.',
 'Montre les consultations le 15 octobre.',
 'Liste les séances de 15 octobre.',
 'Les consultations du 15/10.',
 'Les consultations du quinze octobre.',
])('binds a day and month without a year to one cabinet date for %s',text=>{
 if(text.includes('quinze'))expect(explicitFrenchDayRange(text,'2026-10-26T12:00:00+01:00')).toEqual({from:'2026-10-15T00:00:00+01:00',to:'2026-10-16T00:00:00+01:00'});
 expect(parsePatientMention(text)).toEqual({status:'none'});
 expect(frenchRequestAdmission(text,false,'2026-10-26T12:00:00+01:00')).toMatchObject({tools:['query_consultations'],from:'2026-10-15T00:00:00+01:00',to:'2026-10-16T00:00:00+01:00',dateAxis:'started_at'});
});
it.each([
 'Compte les consultations entre le 15 octobre et le 20 octobre.',
 'Compte les consultations du quinze octobre au vingt octobre.',
 'Compte les consultations entre le 15/10 et le 20/10.',
 'Liste les séances du 15 au 20 octobre.',
 'Compte les consultations entre le quinze et le vingt octobre.',
])('preserves both ends of a closed consultation date range: %s',text=>{
 expect(explicitFrenchDateRange(text,'2026-10-26T12:00:00+01:00')).toEqual({from:'2026-10-15T00:00:00+01:00',to:'2026-10-21T00:00:00+01:00'});
 expect(frenchRequestAdmission(text,false,'2026-10-26T12:00:00+01:00')).toMatchObject({tools:['query_consultations'],consultationMode:text.startsWith('Compte')?'count':'list',from:'2026-10-15T00:00:00+01:00',to:'2026-10-21T00:00:00+01:00',dateAxis:'started_at'});
});
it('keeps a year-crossing day range unresolved instead of guessing its year',()=>{
 const text='Compte les consultations du 15 décembre au 20 janvier.';
 expect(explicitFrenchDateRange(text,'2026-10-26T12:00:00+01:00')).toBeNull();
 expect(frenchRequestAdmission(text,false,'2026-10-26T12:00:00+01:00')).toMatchObject({tools:['query_consultations'],unboundedPeriod:false});
 expect(frenchRequestAdmission(text,false,'2026-10-26T12:00:00+01:00')).not.toHaveProperty('from');
});
it('routes documented suspended treatments on the open patient dossier to its treatment reader',()=>{
 expect(frenchRequestAdmission('Quels traitements suspendus sont documentés ?',false)).toMatchObject({tools:['get_patient_context'],patientSection:'treatments',treatmentState:'paused'});
});
it('recognizes application-capability and clarification questions as public assistant questions',()=>{
 for(const text of ['Quelles lectures peux-tu effectuer dans MindCare ?','Peux-tu demander une précision lorsque ma question est ambiguë ?']){
  expect(isFrenchAlexaCapabilityQuestion(text)).toBe(true);
  expect(frenchRequestAdmission(text,true).tools).toEqual(['answer_general']);
 }
});
it.each([
 'Pourquoi un miroir se couvre-t-il de buée ?',
 'Pourquoi les feuilles changent-elles de couleur en automne ?',
 'Pourquoi les nuages paraissent-ils blancs ?',
 'Pourquoi le métal semble-t-il plus froid que le bois à température égale ?',
 'Quelle différence y a-t-il entre la masse et le poids ?',
])('routes an open French general question to MiniCPM without an application read: %s',text=>{
 expect(frenchRequestAdmission(text,true).tools).toEqual(['answer_general']);
});
it('keeps two compared clinical months as separate periods and routes to consultation counts',()=>{
 const text='Compare les consultations terminées de septembre et d’octobre 2026.';
 expect(explicitFrenchComparedMonthRanges(text)).toEqual([
  {month:'septembre',year:2026,from:'2026-09-01T00:00:00+01:00',to:'2026-10-01T00:00:00+01:00'},
  {month:'octobre',year:2026,from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'},
 ]);
 expect(frenchRequestAdmission(text,false,'2026-10-25T12:00:00+01:00')).toMatchObject({tools:['query_consultations'],consultationMode:'count',consultationStatus:'closed',dateAxis:'started_at'});
 expect(explicitFrenchComparedMonthRanges('Compare les notes de septembre et d’octobre 2026.')).toBeNull();
});
it('extracts the same explicit CNI filter for a count followed by a patient-name page',()=>{
 const contract=frenchPatientCompoundContract('Donne le nombre de patients sans CNI, puis la liste des 20 premiers avec leurs noms.');
 expect(contract).toMatchObject({count:true,conditions:[{field:'identity_card',op:'missing',value:null}]});
});
it('routes a request about Alexa capabilities to the local general-answer path',()=>{
 expect(frenchRequestAdmission('Bonjour Alexa, comment peux-tu m’aider au cabinet ?',true).tools).toEqual(['answer_general']);
 expect(frenchRequestAdmission('Quels sont les rendez-vous de demain ?',true).tools).toEqual(['query_agenda']);
});
it.each([
 'Dis-moi en deux phrases comment tu gères une information absente.',
 'Quelle est la différence entre un son aigu et un son grave ?',
 'Pourquoi le jour et la nuit se succèdent-ils ?',
 'Pourquoi la glace flotte-t-elle sur l’eau ?',
])('admits a natural safe French request phrasing for local MiniCPM: %s',text=>{
 expect(frenchRequestAdmission(text,true).tools).toEqual(['answer_general']);
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
it.each([
 ['Pour Ayoub Salmi, montre les ordonnances et les certificats médicaux, puis résume ses traitements en cours.',[
  'Pour Ayoub Salmi, montre l’ordonnance.',
  'Pour Ayoub Salmi, montre le certificat médical.',
  'Pour Ayoub Salmi, résume ses traitements en cours.',
 ],['query_documents','query_documents','get_patient_context']],
 ['Peux-tu ouvrir l’ordonnance et le certificat médical de Ghizlene Abaci ?',[
  'Pour Ghizlene Abaci, montre l’ordonnance.',
  'Pour Ghizlene Abaci, montre le certificat médical.',
 ],['query_documents','query_documents']],
 ['Affiche les certificats médicaux, les justificatifs et les suivis médicaux pour Wafa Aksas.',[
  'Pour Wafa Aksas, montre le certificat médical.',
  'Pour Wafa Aksas, montre la justification.',
  'Pour Wafa Aksas, montre le certificat de suivi médical.',
 ],['query_documents','query_documents','query_documents']],
])('separates each requested document type from other requested results without losing the patient: %s',(text,expected,tools)=>{
 const outputs=frenchRequestedOutputs(text);
 expect(outputs).toEqual(expected);
 expect(outputs!.map(goal=>requestedReadTool(goal,text))).toEqual(tools);
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
it.each([
 'Quels seuils de symptômes et de durée faut-il vérifier pour caractériser un épisode dépressif ?',
 'Comment la lamotrigine agit-elle sur les canaux sodiques ?',
 'Quelle posologie de sertraline est proposée dans la dépression ?',
 'Quels effets métaboliques sont documentés pour l’olanzapine ?',
 'Quelle surveillance hématologique accompagne un traitement par clozapine ?',
 'Quel critère distingue le trouble bipolaire de type I du type II ?',
 'Quels groupes de symptômes structurent le tableau de stress post-traumatique ?',
 'Quelle cible de lithémie est recommandée en entretien ?',
])('routes general clinical knowledge to the source gate without a book name: %s',text=>{
 expect(frenchRequestAdmission(text,false).tools).toEqual(['search_knowledge']);
});
it.each([
 'Quels traitements sont actifs pour Lina Test ?',
 'Quels traitements sont actifs pour le patient sélectionné ?',
 'Combien de consultations terminées ce mois-ci ?',
 'Quel est le téléphone du cabinet ?',
 'Quel est le prix actuel du lithium en Algérie ?',
 'Combien de dossiers sont archivés ?',
 'Quel est le résultat net du mois en cours ?',
])('does not send a patient-scoped, app or price question to the source gate: %s',text=>{
 expect(frenchRequestAdmission(text,false).tools??[]).not.toContain('search_knowledge');
});
it.each([
 'Pardon, c’est samiha ferhat que je voulais.',
 'Non, c’est samiha ferhat.',
 'Je me suis trompé, remplace par samiha ferhat.',
])('keeps the corrected patient name in a self-correction: %s',text=>{
 expect(parsePatientMention(text)).toEqual({status:'named',name:'samiha ferhat'});
});
it('keeps a dossier field lookup on the named patient instead of reading “porte” as a name',()=>{
 expect(parsePatientMention('Quel numéro de dossier porte islam adjina ?')).toEqual({status:'named',name:'islam adjina'});
});
it.each([
 'Quels diagnostics porte actuellement islam adjina ?',
 'Quelles échelles islam adjina a-t-il passées ?',
 'Quel score le plus récent figure pour islam adjina ?',
])('keeps a lower-case synthetic name attached to its clinical section: %s',text=>{
 expect(parsePatientMention(text)).toEqual({status:'named',name:'islam adjina'});
 expect(frenchRequestAdmission(text,false,'2026-10-31T12:00:00+01:00').tools).toEqual(['get_patient_context']);
});
it.each([
 'Combien de dossiers actifs ont une carte d’identité ?',
 'Combien de dossiers actifs sont administrativement incomplets ?',
 'Répartis les dossiers actifs selon la présence ou l’absence de téléphone.',
])('routes a patient-population count without mixing in the profile reader: %s',text=>{
 const admission=frenchRequestAdmission(text,false,'2026-10-31T12:00:00+01:00');
 expect(admission.tools).toEqual(['query_patients']);
 expect(admission.patientSection).toBeUndefined();
 if(text.startsWith('Répartis')) expect(patientQueryContract(text,'2026-10-31T12:00:00+01:00').unsupported).toEqual([]);
});
it('counts active children when the question names the population without “patients”',()=>{
 const contract=frenchPatientCountContract('Quel est le nombre d’enfants actifs au cabinet ?');
 expect(contract).not.toBeNull();
 expect(countContractParts(contract!)).toMatchObject([{population:'active',conditions:[{field:'age',op:'lt',value:18}],tools:['query_patients']}]);
});
it('counts active and archived dossiers together when the cabinet is the subject',()=>{
 const contract=frenchPatientCountContract('Combien de dossiers compte le cabinet, actifs et archivés réunis ?');
 expect(contract).not.toBeNull();
 expect(countContractParts(contract!)).toMatchObject([{population:'all',conditions:[],tools:['query_patients']}]);
});
it('keeps the administrative-incomplete predicate explicit instead of rejecting it',()=>{
 const plan=patientQueryContract('Combien de dossiers actifs sont administrativement incomplets ?','2026-10-31T12:00:00+01:00');
 expect(plan.unsupported).toEqual([]);
 expect(plan.filterGroups).toEqual([[{field:'administrative_incomplete',op:'eq',value:true}]]);
});
it.each([
 ['Combien de patients actifs n’ont ni téléphone ni carte d’identité ?',[{field:'phone',op:'missing',value:null},{field:'identity_card',op:'missing',value:null}]],
 ['Combien d’adultes actifs sont sans téléphone ?',[{field:'age',op:'gte',value:18},{field:'phone',op:'missing',value:null}]],
 ['Combien d’enfants actifs sont sans carte d’identité ?',[{field:'age',op:'lt',value:18},{field:'identity_card',op:'missing',value:null}]],
 ['Combien de patients actifs comptent trois consultations terminées ou plus ?',[{field:'completed_consultations',op:'gte',value:3}]],
])('keeps a natural compound patient count explicit: %s',(text,conditions)=>{
 const plan=patientQueryContract(text,'2026-10-31T12:00:00+01:00');
 expect(plan.unsupported).toEqual([]);
 expect(plan.filterGroups[0]).toEqual(expect.arrayContaining(conditions));
});
it('recognizes a present identity card stated with the verb “ont”',()=>{
 const contract=frenchPatientCountContract('Combien de dossiers actifs ont une carte d’identité ?');
 expect(contract).not.toBeNull();
 expect(countContractParts(contract!)).toMatchObject([{conditions:[{field:'identity_card',op:'present',value:null}],tools:['query_patients']}]);
});


it('routes the next cabinet slot to the agenda read gate',()=>{
 expect(frenchRequestAdmission('Quel est le prochain horaire disponible au cabinet ?',false,'2026-10-28T12:00:00+01:00').tools).toEqual(['query_agenda']);
});

it.each([
 'Donne le téléphone et l’adresse du cabinet.',
 'Quelle adresse professionnelle est enregistrée ?',
])('routes cabinet contact details to the app read gate: %s',text=>{
 expect(frenchRequestAdmission(text,false).tools).toEqual(['query_app']);
});


it('routes a completed-visit threshold count to the patient gate, not a consultation list',()=>{
 expect(frenchRequestAdmission('Combien de patients actifs comptent trois consultations terminées ou plus ?',false,'2026-10-28T12:00:00+01:00').tools).toEqual(['query_patients']);
});

it('keeps the three-completed-visits count grounded without a disjunction error',()=>{
 const c=frenchPatientCountContract('Combien de patients actifs comptent trois consultations terminées ou plus ?')!;
 expect(c).not.toBeNull();
 expect(()=>constrainCountDeclaration(countContractParts(c),c)).not.toThrow();
});
import {deterministicActionRequest} from '@/server/alexa/action-proposal';















