import {expect,it,vi} from 'vitest';
import type {AgentOutcome} from '@/server/alexa/agent-loop';
import type {AlexaEvent,AlexaSource} from '@/shared/alexa/turn';
const {loop}=vi.hoisted(()=>({loop:vi.fn()}));
vi.mock('@/server/alexa/agent-loop',()=>({runAgentLoop:loop}));
import {runAlexa} from '@/server/alexa/orchestrator';
it('attributes each native sentence to its own result, including identical text and unresolved parts',async()=>{
 const a:AlexaSource={id:'a',type:'patient',label:'Patient A'},b:AlexaSource={id:'b',type:'patient',label:'Patient B'};
 loop.mockResolvedValue({status:'partial',parts:[{id:'missing',goal:'Lecture',conditions:[],dependsOn:[],status:'failed',reason:'Indisponible.',resultRefs:[]}],patientId:null,tokensIn:1,tokensOut:1,sources:[a,b],sentences:['Téléphone non renseigné.','Téléphone non renseigné.','Lecture — Indisponible.'],results:[
  {callId:'a',status:'ok',complete:true,text:'Téléphone non renseigné.',evidence:[a],conditionKeys:[]},
  {callId:'b',status:'ok',complete:true,text:'Téléphone non renseigné.',evidence:[b],conditionKeys:[],presentation:'inference'},
 ]} satisfies AgentOutcome);
 const events:AlexaEvent[]=[];const rpc=vi.fn();
 await runAlexa({text:'Coordonnées de deux patients',conversationId:crypto.randomUUID(),clientTurnId:crypto.randomUUID(),appContext:{page:'/jarvis',patientId:null}},{native:true,actor:'source-attribution',db:{rpc},knowledge:{rpc}},e=>events.push(e),new AbortController().signal);
 expect(events.filter(e=>e.type==='sentence')).toEqual([
  {type:'sentence',text:'Téléphone non renseigné.',kind:'fact',sources:[a]},
  {type:'sentence',text:'Téléphone non renseigné.',kind:'inference',sources:[b]},
  {type:'sentence',text:'Lecture — Indisponible.',kind:'fact',sources:[]},
 ]);
});
it.each(['needs_input','cancelled'] as const)('keeps a direct %s message factual and without patient sources',async status=>{
 loop.mockResolvedValue({status,parts:[],patientId:null,tokensIn:0,tokensOut:0,sources:[],sentences:['Question ou annulation.'],results:[]} satisfies AgentOutcome);
 const events:AlexaEvent[]=[],rpc=vi.fn();
 await runAlexa({text:'Continuer',conversationId:crypto.randomUUID(),clientTurnId:crypto.randomUUID(),appContext:{page:'/jarvis',patientId:null}},{native:true,actor:'direct-status',db:{rpc},knowledge:{rpc}},e=>events.push(e),new AbortController().signal);
 expect(events.find(e=>e.type==='sentence')).toEqual({type:'sentence',text:'Question ou annulation.',kind:'fact',sources:[]});
});
