import {afterEach,expect,it,vi} from 'vitest';

const loop=vi.hoisted(()=>({runAgentLoop:vi.fn()}));
vi.mock('@/server/alexa/agent-loop',()=>loop);

import {runAlexa,type OrchestratorDependencies} from '@/server/alexa/orchestrator';
import {conversationState} from '@/server/alexa/conversation-state';
import type {TurnInput} from '@/shared/alexa/turn';

const patientId='22222222-2222-4222-8222-222222222222';
const otherPatientId='33333333-3333-4333-8333-333333333333';
const noRead=async()=>{throw new Error('Mocked loop must own this unit test');};
const cleanups:(()=>void)[]=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup();loop.runAgentLoop.mockReset();});

function session(){
 const actor=`continuity-${crypto.randomUUID()}`,conversationId=crypto.randomUUID();
 cleanups.push(()=>conversationState.clear(actor,conversationId));
 const deps:OrchestratorDependencies={actor,native:true,agentAsOf:'2026-10-27T09:00:00+01:00',db:{rpc:noRead},knowledge:{rpc:noRead}};
 const turn=(text:string):TurnInput=>({text,conversationId,clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}});
 const run=(text:string)=>runAlexa(turn(text),deps,()=>undefined,new AbortController().signal);
 const reference=()=>conversationState.read(actor,conversationId,null,'/jarvis',Date.now(),JSON.stringify({patientId:null,page:'/jarvis'}));
 return {run,reference};
}
function patientRead(id:string|null,text='Résumé vérifié.'){
 return {status:'completed',parts:[{id:'requested_1',goal:'lecture',tools:['get_patient_context'],conditions:[],dependsOn:[],status:'answered',resultRefs:['read-1']}],results:[{callId:'read-1',status:'ok',complete:true,...(id?{patientId:id}:{}),text,evidence:[],conditionKeys:[]}],sentences:[text],sources:[],patientId:id,tokensIn:1,tokensOut:1};
}

it.each(['Merci.','Quelle heure est-il ?','Bonjour'])('keeps the active patient after the neutral turn %s',async neutral=>{
 const {run,reference}=session();
 loop.runAgentLoop.mockResolvedValue(patientRead(patientId));
 await run('Résume la dernière consultation de Lina Test.');
 expect(reference()).toMatchObject({selectedPatientId:patientId});
 await run(neutral);
 expect(reference()).toMatchObject({selectedPatientId:patientId});
 await run('Et son traitement ?');
 expect(loop.runAgentLoop.mock.calls.at(-1)?.[0]).toMatchObject({appContext:{patientId}});
});

it('keeps the active patient across a book question so a later follow-up can still reach it',async()=>{
 const {run,reference}=session();
 loop.runAgentLoop.mockResolvedValueOnce(patientRead(patientId));
 await run('Résume la dernière consultation de Lina Test.');
 loop.runAgentLoop.mockResolvedValueOnce(patientRead(null,'Passage cité.'));
 await run('Quels sont les critères du trouble bipolaire ?');
 expect(loop.runAgentLoop.mock.calls.at(-1)?.[0]).toMatchObject({appContext:{patientId:null}});
 expect(reference()).toMatchObject({selectedPatientId:patientId});
});

it('never carries the previous patient when another patient is named and not resolved',async()=>{
 const {run,reference}=session();
 loop.runAgentLoop.mockResolvedValueOnce(patientRead(patientId));
 await run('Résume la dernière consultation de Lina Test.');
 loop.runAgentLoop.mockResolvedValueOnce({...patientRead(null,'Patient introuvable.'),status:'needs_input'});
 await run('Résume la dernière consultation de Rania Autre.');
 expect(reference()?.selectedPatientId).toBeUndefined();
});

it('replaces the patient when a different one is verified',async()=>{
 const {run,reference}=session();
 loop.runAgentLoop.mockResolvedValueOnce(patientRead(patientId));
 await run('Résume la dernière consultation de Lina Test.');
 loop.runAgentLoop.mockResolvedValueOnce(patientRead(otherPatientId));
 await run('Résume la dernière consultation de Rania Autre.');
 expect(reference()).toMatchObject({selectedPatientId:otherPatientId});
});

it('rewrites the consultation comparison follow-up with clean French',async()=>{
 const {run}=session();
 loop.runAgentLoop.mockResolvedValue(patientRead(patientId));
 await run('Résume la dernière consultation du patient sélectionné.');
 await run('Qu’est-ce qui a changé entre les deux ?');
 const text=String(loop.runAgentLoop.mock.calls.at(-1)?.[0].text);
 expect(text).not.toContain('?res');
 expect(text).not.toContain('s?lection');
});
