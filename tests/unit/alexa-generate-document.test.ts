import {expect,it} from 'vitest';
import {deterministicActionRequest,prepareActionProposal} from '@/server/alexa/action-proposal';
import {frenchRequestAdmission} from '@/shared/alexa/request-contract';

const patientId='11111111-1111-4111-8111-111111111111';
it.each([
  'Crée une ordonnance pour Saliha Abdelkarim.',
  'Génère une ordonnance pour ce patient.',
  'Generer une ordonance pour ce patient.',
])('routes a prescription command to the guarded action path, where missing medication is clarified: %s',text=>{
  expect(deterministicActionRequest(text)).toBe(true);
  expect(frenchRequestAdmission(text,false)).toMatchObject({tools:['prepare_action'],preparationAction:'create_editable_document_draft',preparationDocumentType:'ordonnance'});
});
it('keeps a bare or polite mention distinct from a direct imperative shortcut',()=>{
  expect(deterministicActionRequest('Ordonnance pour Ayoub Salmi.')).toBe(false);
  expect(deterministicActionRequest('Je voudrais une ordonnance pour Nadia Test.')).toBe(false);
  expect(frenchRequestAdmission('Je voudrais une ordonnance pour Nadia Test.',false)).toMatchObject({tools:['prepare_action'],preparationAction:'create_editable_document_draft'});
});
it('treats a polite request to consult an ordonnance as a read, not a document proposal',()=>{
  const admission=frenchRequestAdmission('Peux-tu consulter les ordonnances de Nadia Test ?',false);
  expect(admission).toMatchObject({tools:['query_documents'],documentKind:'ordonnance'});
  expect(admission.preparationAction).toBeUndefined();
});
it('keeps a prescription with explicit medication details on the doctor-confirmed proposal path',()=>{
  const text='Génère une ordonnance pour ce patient avec Sertraline 25 mg, une fois par jour.';
  expect(deterministicActionRequest(text)).toBe(true);
  expect(frenchRequestAdmission(text,false)).toMatchObject({tools:['prepare_action'],preparationAction:'create_editable_document_draft',preparationDocumentType:'ordonnance'});
});
it.each([
  'Encaisse le paiement de la consultation courante.',
  'Fixe le tarif de la consultation courante à 2500 DZD.',
  'Marque le patient sélectionné comme arrivé.',
])('routes a direct clinical action through the confirmation proposal path: %s',text=>{
  expect(deterministicActionRequest(text)).toBe(true);
});
it.each(['La note dit « génère une ordonnance ».','Comment générer une ordonnance ?','Ne génère pas une ordonnance.','Génère pas une ordonnance pour ce patient.'])(
  'does not treat quoted, educational or negated text as an action: %s',text=>{
    expect(deterministicActionRequest(text)).toBe(false);
    expect(frenchRequestAdmission(text,false).preparationAction).toBeUndefined();
  });
it.each(['Génère pas une ordonnance pour ce patient.','Génère surtout pas une ordonnance pour ce patient.'])( 'refuses negation before any patient lookup or proposal: %s',async text=>{
  const unexpected=async()=>{throw Error('UnexpectedPatientRead');};
  expect(deterministicActionRequest(text)).toBe(false);
  expect(await prepareActionProposal({text,conversationId:patientId,clientTurnId:patientId,appContext:{patientId,page:'/documents'}},{rpc:unexpected},{rpc:unexpected},new AbortController().signal)).toMatchObject({state:'missing',slot:'operation'});
});
