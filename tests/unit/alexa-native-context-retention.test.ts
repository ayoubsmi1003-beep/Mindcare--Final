import {expect,it,vi} from 'vitest';

const loop=vi.hoisted(()=>({runAgentLoop:vi.fn()}));
vi.mock('@/server/alexa/agent-loop',()=>loop);

import {runAlexa} from '@/server/alexa/orchestrator';
import {conversationState} from '@/server/alexa/conversation-state';
import type {TurnInput} from '@/shared/alexa/turn';

const patientId='22222222-2222-4222-8222-222222222222';
it('retains a verified patient reference after the native answer when the app page has no selected dossier',async()=>{
 const actor=`native-reference-${crypto.randomUUID()}`,conversationId=crypto.randomUUID(),events:unknown[]=[];
 const input:TurnInput={text:'Résume la dernière consultation.',conversationId,clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};
 loop.runAgentLoop.mockResolvedValue({status:'completed',parts:[{id:'requested_1',goal:input.text,tools:['get_patient_context'],conditions:[],dependsOn:[],status:'answered',resultRefs:['read-1']}],results:[{callId:'read-1',status:'ok',complete:true,patientId,text:'Résumé vérifié.',evidence:[],conditionKeys:[]}],sentences:['Résumé vérifié.'],sources:[],patientId,tokensIn:1,tokensOut:1});
 try{
  await runAlexa(input,{actor,native:true,db:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}},knowledge:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}}},event=>events.push(event),new AbortController().signal);
  expect(events.at(-1)).toMatchObject({type:'done',patientId,patientScope:'replace'});
  expect(conversationState.read(actor,conversationId,null,'/jarvis',Date.now(),JSON.stringify(input.appContext))).toMatchObject({selectedPatientId:patientId});
  const followup:TurnInput={...input,text:'Et celle d’avant ?',clientTurnId:crypto.randomUUID()};
  await runAlexa(followup,{actor,native:true,db:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}},knowledge:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}}},event=>events.push(event),new AbortController().signal);
  expect(loop.runAgentLoop.mock.calls[1]?.[0]).toMatchObject({text:'Résume l’avant-dernière consultation du patient sélectionné.',appContext:{patientId,page:'/jarvis'}});
 }finally{conversationState.clear(actor,conversationId);loop.runAgentLoop.mockReset();}
});
it('carries the last agenda day into a short status-count follow-up and lets an explicit new day replace it',async()=>{
 const actor=`native-agenda-reference-${crypto.randomUUID()}`,conversationId=crypto.randomUUID(),events:unknown[]=[];
 const first:TurnInput={text:'Liste les rendez-vous de demain.',conversationId,clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/agenda'}};
 const deps={actor,native:true as const,agentAsOf:'2026-10-27T09:00:00+01:00',db:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}},knowledge:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}}};
 loop.runAgentLoop.mockResolvedValue({status:'completed',parts:[{id:'requested_1',goal:first.text,tools:['query_agenda'],conditions:[],dependsOn:[],status:'answered',resultRefs:['read-1']}],results:[{callId:'read-1',status:'ok',complete:true,text:'6 rendez-vous vérifiés.',evidence:[],conditionKeys:[]}],sentences:['6 rendez-vous vérifiés.'],sources:[],patientId:null,tokensIn:1,tokensOut:1});
 try{
  await runAlexa(first,deps,event=>events.push(event),new AbortController().signal);
  const followup:TurnInput={...first,text:'Combien sont confirmés ?',clientTurnId:crypto.randomUUID()};
  await runAlexa(followup,deps,event=>events.push(event),new AbortController().signal);
  const scopedText=loop.runAgentLoop.mock.calls[1]?.[0].text as string;
  expect(scopedText).toContain('rendez-vous');expect(scopedText).toMatch(/2026-10-28/u);
  const explicitNewDay:TurnInput={...first,text:'Combien sont confirmés aujourd’hui ?',clientTurnId:crypto.randomUUID()};
  await runAlexa(explicitNewDay,deps,event=>events.push(event),new AbortController().signal);
  expect(loop.runAgentLoop.mock.calls[2]?.[0].text).toBe(explicitNewDay.text);
 }finally{conversationState.clear(actor,conversationId);loop.runAgentLoop.mockReset();}
});
it('reuses the verified patient and treatment domain for a short pause-state follow-up',async()=>{
 const actor=`native-treatment-reference-${crypto.randomUUID()}`,conversationId=crypto.randomUUID(),events:unknown[]=[];
 const first:TurnInput={text:'Montre les traitements actifs de Lina Test.',conversationId,clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};
 const deps={actor,native:true as const,db:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}},knowledge:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}}};
 loop.runAgentLoop.mockResolvedValue({status:'completed',parts:[{id:'requested_1',goal:first.text,tools:['get_patient_context'],conditions:[],dependsOn:[],status:'answered',resultRefs:['read-1']}],results:[{callId:'read-1',status:'ok',complete:true,patientId,text:'Traitement vérifié.',evidence:[],conditionKeys:[]}],sentences:['Traitement vérifié.'],sources:[],patientId,tokensIn:1,tokensOut:1});
 try{
  await runAlexa(first,deps,event=>events.push(event),new AbortController().signal);
  const followup:TurnInput={...first,text:'Quels sont ceux en pause ?',clientTurnId:crypto.randomUUID()};
  await runAlexa(followup,deps,event=>events.push(event),new AbortController().signal);
  expect(loop.runAgentLoop.mock.calls[1]?.[0]).toMatchObject({appContext:{patientId,page:'/jarvis'}});
  expect(loop.runAgentLoop.mock.calls[1]?.[0].text).toContain('traitements sont en pause');
  expect(loop.runAgentLoop.mock.calls[1]?.[0].text).toContain('patient sélectionné');
 }finally{conversationState.clear(actor,conversationId);loop.runAgentLoop.mockReset();}
});
it('resolves an ordinal follow-up only against the last verified patient list',async()=>{
 const actor=`native-list-reference-${crypto.randomUUID()}`,conversationId=crypto.randomUUID(),second='33333333-3333-4333-8333-333333333333';
 const first:TurnInput={text:'Liste les patients actifs sans téléphone.',conversationId,clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};
 const deps={actor,native:true as const,db:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}},knowledge:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}}};
 loop.runAgentLoop.mockResolvedValue({status:'completed',parts:[{id:'requested_1',goal:first.text,tools:['query_patients'],conditions:[],dependsOn:[],status:'answered',resultRefs:['read-1']}],results:[{callId:'read-1',status:'ok',complete:true,text:'2 patients.',data:{patientQuery:{mode:'list'},rows:[{id:'22222222-2222-4222-8222-222222222222',first_name:'Lina',last_name:'Test'},{id:second,first_name:'Nadia',last_name:'Test'}]},evidence:[],conditionKeys:[]}],sentences:['2 patients.'],sources:[],patientId:null,tokensIn:1,tokensOut:1});
 try{
  await runAlexa(first,deps,()=>{},new AbortController().signal);
  expect(conversationState.read(actor,conversationId,null,'/jarvis',Date.now(),JSON.stringify(first.appContext))?.patients).toEqual([{patientId:'22222222-2222-4222-8222-222222222222',label:'Lina Test'},{patientId:second,label:'Nadia Test'}]);
  const followup:TurnInput={...first,text:'Montre le deuxième.',clientTurnId:crypto.randomUUID()};
  await runAlexa(followup,deps,()=>{},new AbortController().signal);
  expect(loop.runAgentLoop.mock.calls[1]?.[0]).toMatchObject({appContext:{patientId:second},text:'Affiche le profil du patient sélectionné.'});
 }finally{conversationState.clear(actor,conversationId);loop.runAgentLoop.mockReset();}
});
it('retains a unique exact-name patient search for a patient-scoped follow-up',async()=>{
 const actor=`native-exact-patient-reference-${crypto.randomUUID()}`,conversationId=crypto.randomUUID();
 const first:TurnInput={text:'Cherche Lina Test.',conversationId,clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};
 const deps={actor,native:true as const,db:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}},knowledge:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}}};
 loop.runAgentLoop.mockResolvedValue({status:'completed',parts:[{id:'requested_1',goal:first.text,tools:['query_patients'],conditions:[],dependsOn:[],status:'answered',resultRefs:['read-1']}],results:[{callId:'read-1',status:'ok',complete:true,text:'Lina Test.',data:{patientQuery:{mode:'list',population:'all',query:'Lina Test'},total:1,rows:[{id:patientId,first_name:'Lina',last_name:'Test'}]},evidence:[],conditionKeys:[]}],sentences:['Lina Test.'],sources:[],patientId:null,tokensIn:1,tokensOut:1});
 try{
  await runAlexa(first,deps,()=>{},new AbortController().signal);
  expect(conversationState.read(actor,conversationId,null,'/jarvis',Date.now(),JSON.stringify(first.appContext))).toMatchObject({selectedPatientId:patientId});
  const followup:TurnInput={...first,text:'Quel est son numéro de téléphone ?',clientTurnId:crypto.randomUUID()};
  await runAlexa(followup,deps,()=>{},new AbortController().signal);
  expect(loop.runAgentLoop.mock.calls[1]?.[0]).toMatchObject({appContext:{patientId}});
 }finally{conversationState.clear(actor,conversationId);loop.runAgentLoop.mockReset();}
});
it('does not select one patient when an exact-name search has duplicate matches',async()=>{
 const actor=`native-duplicate-patient-reference-${crypto.randomUUID()}`,conversationId=crypto.randomUUID();
 const first:TurnInput={text:'Cherche Lina Test.',conversationId,clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};
 const deps={actor,native:true as const,db:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}},knowledge:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}}};
 loop.runAgentLoop.mockResolvedValue({status:'completed',parts:[{id:'requested_1',goal:first.text,tools:['query_patients'],conditions:[],dependsOn:[],status:'answered',resultRefs:['read-1']}],results:[{callId:'read-1',status:'ok',complete:true,text:'Deux patients correspondent.',data:{patientQuery:{mode:'list',population:'all',query:'Lina Test'},total:2,rows:[{id:patientId,first_name:'Lina',last_name:'Test'},{id:'33333333-3333-4333-8333-333333333333',first_name:'Lina',last_name:'Test'}]},evidence:[],conditionKeys:[]}],sentences:['Deux patients correspondent.'],sources:[],patientId:null,tokensIn:1,tokensOut:1});
 try{
  await runAlexa(first,deps,()=>{},new AbortController().signal);
  expect(conversationState.read(actor,conversationId,null,'/jarvis',Date.now(),JSON.stringify(first.appContext))?.selectedPatientId).toBeUndefined();
 }finally{conversationState.clear(actor,conversationId);loop.runAgentLoop.mockReset();}
});
it('replaces the selected patient after « cherche plutôt » and scopes the next clinical follow-up to the replacement',async()=>{
 const actor=`native-corrected-patient-reference-${crypto.randomUUID()}`,conversationId=crypto.randomUUID(),firstPatient='22222222-2222-4222-8222-222222222222',secondPatient='33333333-3333-4333-8333-333333333333';
 const first:TurnInput={text:'Cherche islam adjina.',conversationId,clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};
 const deps={actor,native:true as const,db:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}},knowledge:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}}};
 const searchResult=(patientId:string,first_name:string,last_name:string)=>({status:'completed',parts:[{id:'requested_1',goal:first.text,tools:['query_patients'],conditions:[],dependsOn:[],status:'answered',resultRefs:['read-1']}],results:[{callId:'read-1',status:'ok',complete:true,text:`${first_name} ${last_name}.`,data:{patientQuery:{mode:'list',population:'all',query:`${first_name} ${last_name}`},total:1,rows:[{id:patientId,first_name,last_name}]},evidence:[],conditionKeys:[]}],sentences:[`${first_name} ${last_name}.`],sources:[],patientId:null,tokensIn:1,tokensOut:1});
 loop.runAgentLoop.mockResolvedValueOnce(searchResult(firstPatient,'islam','adjina'));
 loop.runAgentLoop.mockResolvedValueOnce(searchResult(secondPatient,'samiha','ferhat'));
 loop.runAgentLoop.mockResolvedValueOnce({status:'completed',parts:[{id:'requested_1',goal:'Résume sa dernière séance.',tools:['get_patient_context'],conditions:[],dependsOn:[],status:'answered',resultRefs:['read-1']}],results:[{callId:'read-1',status:'ok',complete:true,patientId:secondPatient,text:'Résumé vérifié.',evidence:[],conditionKeys:[]}],sentences:['Résumé vérifié.'],sources:[],patientId:secondPatient,tokensIn:1,tokensOut:1});
 try{
  await runAlexa(first,deps,()=>{},new AbortController().signal);
  const corrected:TurnInput={...first,text:'Cherche plutôt samiha ferhat.',clientTurnId:crypto.randomUUID()};
  await runAlexa(corrected,deps,()=>{},new AbortController().signal);
  expect(conversationState.read(actor,conversationId,null,'/jarvis',Date.now(),JSON.stringify(first.appContext))).toMatchObject({selectedPatientId:secondPatient});
  const followup:TurnInput={...first,text:'Résume sa dernière séance.',clientTurnId:crypto.randomUUID()};
  await runAlexa(followup,deps,()=>{},new AbortController().signal);
  expect(loop.runAgentLoop.mock.calls[2]?.[0]).toMatchObject({appContext:{patientId:secondPatient}});
 }finally{conversationState.clear(actor,conversationId);loop.runAgentLoop.mockReset();}
});
it('carries the requested financial measure into a previous-month follow-up',async()=>{
 const actor=`native-finance-reference-${crypto.randomUUID()}`,conversationId=crypto.randomUUID();
 const asOf='2026-10-27T09:00:00+01:00',first:TurnInput={text:'Quel est le montant encaissé ce mois-ci ?',conversationId,clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};
 const deps={actor,native:true as const,agentAsOf:asOf,db:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}},knowledge:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}}};
 loop.runAgentLoop.mockResolvedValue({status:'completed',parts:[{id:'requested_1',goal:first.text,tools:['query_finance'],conditions:[],dependsOn:[],status:'answered',resultRefs:['read-1']}],results:[{callId:'read-1',status:'ok',complete:true,text:'Montant vérifié.',evidence:[],conditionKeys:[]}],sentences:['Montant vérifié.'],sources:[],patientId:null,tokensIn:1,tokensOut:1});
 try{
  await runAlexa(first,deps,()=>{},new AbortController().signal);
  const followup:TurnInput={...first,text:'Et le mois précédent ?',clientTurnId:crypto.randomUUID()};
  await runAlexa(followup,deps,()=>{},new AbortController().signal);
  expect(loop.runAgentLoop.mock.calls[1]?.[0].text).toContain('septembre 2026');
  expect(loop.runAgentLoop.mock.calls[1]?.[0].text).toContain('montant encaissé');
 }finally{conversationState.clear(actor,conversationId);loop.runAgentLoop.mockReset();}
});
it('reuses a count question while replacing its explicitly named patient',async()=>{
 const actor=`native-patient-replacement-${crypto.randomUUID()}`,conversationId=crypto.randomUUID(),firstPatient='22222222-2222-4222-8222-222222222222',secondPatient='33333333-3333-4333-8333-333333333333';
 const first:TurnInput={text:'Combien de consultations a eues Lina Test ?',conversationId,clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};
 const deps={actor,native:true as const,db:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}},knowledge:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}}};
 loop.runAgentLoop.mockResolvedValue({status:'completed',parts:[{id:'requested_1',goal:first.text,tools:['query_consultations'],conditions:[],dependsOn:[],status:'answered',resultRefs:['read-1']}],results:[{callId:'read-1',status:'ok',complete:true,patientId:firstPatient,text:'4 consultations.',evidence:[],conditionKeys:[]}],sentences:['4 consultations.'],sources:[],patientId:firstPatient,tokensIn:1,tokensOut:1});
 try{
  await runAlexa(first,deps,()=>{},new AbortController().signal);
  const followup:TurnInput={...first,text:'Et Nadia Test ?',clientTurnId:crypto.randomUUID()};
  await runAlexa(followup,deps,()=>{},new AbortController().signal);
  const next=loop.runAgentLoop.mock.calls[1]?.[0] as TurnInput;
  expect(next.text).toContain('Nadia Test');expect(next.text).not.toContain('Lina Test');
  expect(next.appContext.patientId).toBeNull();
 }finally{conversationState.clear(actor,conversationId);loop.runAgentLoop.mockReset();}
});
it('reframes “celle d’avant” as the second-latest consultation of the same verified patient',async()=>{
 const actor=`native-previous-consultation-${crypto.randomUUID()}`,conversationId=crypto.randomUUID();
 const first:TurnInput={text:'Résume la dernière consultation de Lina Test.',conversationId,clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};
 const patientId='22222222-2222-4222-8222-222222222222',deps={actor,native:true as const,db:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}},knowledge:{rpc:async()=>{throw new Error('Mocked loop must own this unit test');}}};
 loop.runAgentLoop.mockResolvedValue({status:'completed',parts:[{id:'requested_1',goal:first.text,tools:['get_patient_context'],conditions:[],dependsOn:[],status:'answered',resultRefs:['read-1']}],results:[{callId:'read-1',status:'ok',complete:true,patientId,text:'Résumé vérifié.',evidence:[],conditionKeys:[]}],sentences:['Résumé vérifié.'],sources:[],patientId,tokensIn:1,tokensOut:1});
 try{
  await runAlexa(first,deps,()=>{},new AbortController().signal);
  const followup:TurnInput={...first,text:'Et celle d’avant ?',clientTurnId:crypto.randomUUID()};
  await runAlexa(followup,deps,()=>{},new AbortController().signal);
  expect(loop.runAgentLoop.mock.calls[1]?.[0]).toMatchObject({text:'Résume l’avant-dernière consultation du patient sélectionné.',appContext:{patientId}});
 }finally{conversationState.clear(actor,conversationId);loop.runAgentLoop.mockReset();}
});
