import {beforeEach,expect,it,vi} from 'vitest';
import type {EtatConversationPublique} from '@/services/conversation';
import type {AlexaTurnResult,envoyerTourAlexa} from '@/services/alexa-turn';
const boundary=vi.hoisted(()=>({ensure:vi.fn(),turn:vi.fn(),adopt:vi.fn(),clear:vi.fn(),propose:vi.fn(),refuse:vi.fn()}));
vi.mock('@/services/alexa-turn',()=>({ensureAlexaConversation:boundary.ensure,envoyerTourAlexa:boundary.turn,adoptAlexaConversation:boundary.adopt,clearAlexaConversation:boundary.clear,AlexaTurnError:class extends Error{partial=false;}}));
vi.mock('@/services/alexa-local',()=>({abonnerPropositionVoixLocale:()=>()=>{},abonnerTourVoixLocale:()=>()=>{},arreterVoixLocale:()=>{}}));
vi.mock('@/services/alexa-proposal',()=>({alexaProposalLabels:async()=>new Map()}));
vi.mock('@/services/jarvis-ecritures',()=>({capaciteEcriture:()=>({preparer:async(args:unknown)=>({ok:true,data:{args,titre:'Proposition synthétique',champs:[]}}),critique:false})}));
vi.mock('@/services/jarvis-tools',async original=>({...await original<typeof import('@/services/jarvis-tools')>(),proposerAction:boundary.propose,refuserAction:boundary.refuse}));
type Callbacks=NonNullable<Parameters<typeof envoyerTourAlexa>[2]>;
const completed=(text:string):AlexaTurnResult=>({texte:text,sources:[],patientId:null,limited:false,persiste:true,status:'completed',speechAllowed:false});
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();boundary.ensure.mockReset().mockResolvedValue('a1000000-0000-4000-8000-000000000001');boundary.turn.mockReset();});
async function setup(){const api=await import('@/services/conversation');let state:EtatConversationPublique|undefined;const stop=api.abonnerConversation(s=>{state=s;});return {api,get state(){return state;},stop};}
function heldTurns(){const held:{resolve:(value:AlexaTurnResult)=>void;reject:(error:Error)=>void;callbacks:Callbacks}[]=[];boundary.turn.mockImplementation((_text:string,_signal:AbortSignal,callbacks:Callbacks)=>new Promise<AlexaTurnResult>((resolve,reject)=>{held.push({resolve,reject,callbacks});}));return held;}
it('an aborted old turn cannot reset a newer active stream or publish stale callbacks',async()=>{
 const held=heldTurns(),h=await setup();try{const first=h.api.envoyer('Demande A');await flush();held[0]!.callbacks.onStage?.('analysis');h.api.purgerContexteSession();const second=h.api.envoyer('Demande B');await flush();held[1]!.callbacks.onStage?.('analysis');const stage=h.state?.etapeEnCours;held[0]!.reject(new DOMException('Interrupted','AbortError'));await first;expect(h.state?.etat).toBe('envoi');expect(h.state?.etapeEnCours).toBe(stage);held[0]!.callbacks.onSentence?.('Ancienne réponse A');held[0]!.callbacks.onStage?.('knowledge');expect(h.state?.etat).toBe('envoi');expect(h.state?.etapeEnCours).toBe(stage);expect(h.state?.tours.some(t=>t.texte.includes('Ancienne réponse'))).toBe(false);await h.api.envoyer('Demande C');expect(boundary.turn).toHaveBeenCalledTimes(2);held[1]!.resolve(completed('Réponse B'));await second;expect(h.state?.etat).toBe('composition');expect(h.state?.tours.at(-1)?.texte).toBe('Réponse B');}finally{h.stop();}
});
it('a late aborted turn leaves an explicitly purged conversation empty',async()=>{
 const held=heldTurns(),h=await setup();try{const first=h.api.envoyer('Ancienne demande');await flush();h.api.purgerContexteSession();held[0]!.reject(new DOMException('Interrupted','AbortError'));await first;expect(h.state?.etat).toBe('vide');expect(h.state?.tours).toHaveLength(0);expect(h.state?.etapeEnCours).toBeNull();}finally{h.stop();}
});
it('an old conversation-creation response cannot overwrite the new turn identity',async()=>{
 let resolveOld!:(value:string)=>void;boundary.ensure.mockReset().mockImplementationOnce(()=>new Promise<string>(done=>{resolveOld=done;})).mockResolvedValue('b1000000-0000-4000-8000-000000000001');const held=heldTurns(),h=await setup();try{const first=h.api.envoyer('Ancienne création');await flush();h.api.purgerContexteSession();const second=h.api.envoyer('Nouvelle création');await flush();held[0]!.callbacks.onStage?.('analysis');resolveOld('a1000000-0000-4000-8000-000000000001');await flush();expect(boundary.turn).toHaveBeenCalledTimes(1);held[0]!.callbacks.onStage?.('analysis');expect(h.state?.conversationId).toBe('b1000000-0000-4000-8000-000000000001');expect(h.state?.etat).toBe('envoi');held[0]!.resolve(completed('Nouvelle réponse'));await Promise.all([first,second]);}finally{held.forEach(turn=>turn.resolve(completed('Fin du test')));h.stop();}
});

it('does not append a late failed proposal from the purged turn into a new conversation',async()=>{
 let failProposal!:(value:unknown)=>void;boundary.propose.mockReset().mockImplementation(()=>new Promise(done=>{failProposal=done;}));const held=heldTurns(),h=await setup();try{const first=h.api.envoyer('Prépare un rendez-vous A');await flush();held[0]!.resolve({...completed('Proposition A'),proposal:{tool:'create_appointment',args:{patientId:'a1000000-0000-4000-8000-000000000001',startsAt:'2026-10-17T09:00:00+01:00',durationMinutes:30},actionId:'c1000000-0000-4000-8000-000000000001'}});await vi.waitFor(()=>expect(boundary.propose).toHaveBeenCalledOnce());h.api.purgerContexteSession();const second=h.api.envoyer('Demande B');await flush();held[1]!.callbacks.onStage?.('analysis');failProposal({ok:false,error:{code:'indisponible',message:'Échec ancien de proposition A'}});await first;held[1]!.callbacks.onStage?.('analysis');expect(h.state?.etat).toBe('envoi');expect(h.state?.tours.some(t=>t.texte.includes('Échec ancien'))).toBe(false);expect(h.state?.carteEcriture).toBeNull();held[1]!.resolve(completed('Réponse B'));await second;}finally{held.forEach(turn=>turn.resolve(completed('Fin du test')));h.stop();}
});

it('finishes a user-cancelled current turn even when the stream resolves instead of rejecting',async()=>{
 const held=heldTurns(),h=await setup();try{const sending=h.api.envoyer('Demande annulée');await flush();h.api.interrompre();held[0]!.resolve(completed('Ne doit pas être affiché'));await sending;expect(h.state?.etat).toBe('composition');expect(h.state?.tours.at(-1)?.interrompu).toBe(true);expect(h.state?.tours.at(-1)?.texte).not.toContain('Ne doit pas');}finally{h.stop();}
});
it('finishes a current cancellation during conversation creation without dispatching its stream',async()=>{
 let ready!:(id:string)=>void;boundary.ensure.mockReset().mockImplementation(()=>new Promise<string>(done=>{ready=done;}));const h=await setup();try{const sending=h.api.envoyer('Annule avant le démarrage');await flush();h.api.interrompre();ready('a1000000-0000-4000-8000-000000000001');await sending;expect(h.state?.etat).toBe('composition');expect(h.state?.tours.at(-1)?.interrompu).toBe(true);expect(boundary.turn).not.toHaveBeenCalled();}finally{h.stop();}
});
