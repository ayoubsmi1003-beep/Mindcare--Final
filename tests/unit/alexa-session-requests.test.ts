import {expect,it} from 'vitest';
import {frenchRequestAdmission,frenchReadArgumentBindings,explicitFrenchDayRange} from '@/shared/alexa/request-contract';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import {parsePatientMention} from '@/shared/alexa/patient-mention';
it('keeps the period introducer out of a named patient identity',()=>expect(parsePatientMention('Cherche le mot « sommeil » dans les notes de Ayoub Salmi entre le 1 juin et le 15 juin 2026.')).toEqual({status:'named',name:'Ayoub Salmi'}));
it('keeps treatment changes on the existing treatment read rather than a whole-case synthesis',()=>expect(frenchRequestAdmission('Quel est son traitement actuel et quels changements sont documentés ?',false)).toMatchObject({tools:['get_patient_context'],patientSection:'treatments'}));
it('reads the content of an older difficulty rather than consultation headers',()=>expect(frenchRequestAdmission('Retrouve une difficulté mentionnée dans une ancienne consultation.',false)).toMatchObject({patientSection:'notes',noteArea:'subjective'}));
it('reads a dated cabinet agenda without reusing the previous patient as a global filter',async()=>{
 let reads=0;const patientId='22222222-2222-4222-8222-222222222222';
 const result=await runAgentLoop({text:'Quels rendez-vous sont prévus le 29/10/2026 et quels sont leurs statuts ?',conversationId:'dated-agenda',clientTurnId:'11111111-1111-4111-8111-111111111115',appContext:{patientId,page:'/jarvis'}},{actor:'dated-agenda',infer:async()=>{throw Error('GroundedAgendaMustNotInferFilters');},execute:async call=>{
  reads++;expect(call.name).toBe('query_agenda');expect(call.args).toMatchObject({from:'2026-10-29T00:00:00+01:00',to:'2026-10-30T00:00:00+01:00'});expect(call.args).not.toHaveProperty('patientId');
  return {callId:call.id,status:'ok',complete:true,text:'Rendez-vous enregistrés.',conditionKeys:[],evidence:[]};
 }},new AbortController().signal);
 expect(result.status).toBe('completed');expect(reads).toBe(1);
});
it('dispatches a fully grounded dated focus read without asking the model to guess its date or note section',async()=>{
 const patientId='22222222-2222-4222-8222-222222222222';let reads=0;
 const result=await runAgentLoop({text:'Quel était le focus de sa séance du 26/04/2026 ?',conversationId:'dated-focus',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId,page:'/patients/'+patientId}},{actor:'dated-focus',infer:async()=>{throw Error('GroundedReadMustNotInferFilters');},execute:async call=>{
  reads++;expect(call.name).toBe('get_patient_context');expect(call.args).toMatchObject({section:'notes',area:'structured',from:'2026-04-26T00:00:00+01:00',to:'2026-04-27T00:00:00+01:00'});
  return {callId:call.id,status:'ok',complete:true,text:'Focus enregistré.',patientId,conditionKeys:[],evidence:[]};
 }},new AbortController().signal);
 expect(result.status).toBe('completed');expect(reads).toBe(1);
});
it.each(['Quel était le focus de sa séance du 26/04/2026 ?','Que disent les cinq notes de sa consultation du 26 avril 2026 ?'])('keeps the requested civil day on the audited note read: %s',text=>{
 const scope=frenchRequestAdmission(text,false);
 expect(frenchReadArgumentBindings(scope,'get_patient_context')).toMatchObject({section:'notes',from:'2026-04-26T00:00:00+01:00',to:'2026-04-27T00:00:00+01:00'});
});
it.each(['Depuis le 26/04/2026','Avant le 26/04/2026','Entre le 26/04/2026 et le 27/04/2026','Le 31/02/2026'])('does not turn a range or invalid day into a single-day read: %s',text=>expect(explicitFrenchDayRange(text)).toBeNull());
it.each(['Quel était le focus de sa séance du 12 octobre 2026 ?','Comment ses mesures ont-elles évolué ?'])('reads persisted session details: %s',text=>{
 expect(frenchRequestAdmission(text,false)).toMatchObject({patientSection:'notes',noteArea:'structured'});
});
it('reads clinical comparisons rather than just listing appointment headers',()=>{
 expect(frenchRequestAdmission('Qu’est-ce qui a changé entre ses deux dernières consultations ?',false)).toMatchObject({patientSection:'summary',consultationCount:2});
});
it('reads the documented follow-up plan',()=>{
 expect(frenchRequestAdmission('Quel suivi est prévu pour ce patient ?',false)).toMatchObject({patientSection:'notes',noteArea:'plan'});
});
