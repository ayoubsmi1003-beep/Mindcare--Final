import {beforeEach,expect,it,vi} from "vitest";
import type {EtatConversationPublique} from "@/services/conversation";
import type {AlexaTurnResult,envoyerTourAlexa} from "@/services/alexa-turn";

const boundary=vi.hoisted(()=>({
 ensure:vi.fn(),
 turn:vi.fn(),
 adopt:vi.fn(),
 clear:vi.fn(),
 propose:vi.fn(),
 confirm:vi.fn(),
 reject:vi.fn(),
 execute:vi.fn(),
}));

vi.mock("@/services/alexa-turn",()=>({
 ensureAlexaConversation:boundary.ensure,
 envoyerTourAlexa:boundary.turn,
 adoptAlexaConversation:boundary.adopt,
 clearAlexaConversation:boundary.clear,
 AlexaTurnError:class extends Error{partial=false;},
}));
vi.mock("@/services/alexa-local",()=>({
 abonnerPropositionVoixLocale:()=>()=>{},
 abonnerTourVoixLocale:()=>()=>{},
 arreterVoixLocale:()=>{},
}));
vi.mock("@/services/alexa-proposal",()=>({alexaProposalLabels:async()=>new Map()}));
vi.mock("@/services/jarvis-ecritures",()=>({
 capaciteEcriture:()=>({
  preparer:async(args:unknown)=>({ok:true,data:{args,titre:"Action prête",champs:[]}}),
  critique:false,
 }),
}));
vi.mock("@/services/jarvis-tools",async original=>({
 ...await original<typeof import("@/services/jarvis-tools")>(),
 proposerAction:boundary.propose,
 confirmerAction:boundary.confirm,
 refuserAction:boundary.reject,
}));
vi.mock("@/services/jarvis-execution",()=>({executerEcritureConfirmee:boundary.execute}));

type Callbacks=NonNullable<Parameters<typeof envoyerTourAlexa>[2]>;
const PATIENT_ID="22222222-2222-4222-8222-222222222222";
const ACTION_ID="c1000000-0000-4000-8000-000000000001";
const APPOINTMENT_ID="a1000000-0000-4000-8000-000000000001";
const completed=(proposal:NonNullable<AlexaTurnResult["proposal"]>):AlexaTurnResult=>({
 texte:"Je m’en occupe.",
 sources:[],
 patientId:PATIENT_ID,
 limited:false,
 persiste:true,
 status:"needs_confirmation",
 proposal,
});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
beforeEach(()=>{
 vi.resetModules();
 vi.clearAllMocks();
 boundary.ensure.mockResolvedValue("b1000000-0000-4000-8000-000000000001");
 boundary.turn.mockReset();
 boundary.propose.mockResolvedValue({ok:true,data:ACTION_ID});
 boundary.confirm.mockResolvedValue({ok:true,data:"2026-10-27T12:00:00.000Z"});
 boundary.execute.mockResolvedValue({ok:true,issue:"ok",affecteId:APPOINTMENT_ID,dureeMs:12,tentatives:0});
});
async function setup(){
 const api=await import("@/services/conversation");
 let state:EtatConversationPublique|undefined;
 const stop=api.abonnerConversation(value=>{state=value;});
 return {api,get state(){return state;},stop};
}
function heldTurn(result:AlexaTurnResult){
 let finish!:(value:AlexaTurnResult)=>void;
 boundary.turn.mockImplementation((_text:string,_signal:AbortSignal,_callbacks:Callbacks)=>new Promise<AlexaTurnResult>(resolve=>{finish=resolve;}));
 return {finish:()=>finish(result)};
}

it("confirme puis exécute un rendez-vous demandé sans afficher de carte de confirmation",async()=>{
 const held=heldTurn(completed({
  tool:"create_appointment",
  args:{patientId:PATIENT_ID,startsAt:"2026-10-28T10:30:00+01:00",durationMinutes:45},
  actionId:ACTION_ID,
 }));
 const h=await setup();
 try{
  const sending=h.api.envoyer("Planifie un rendez-vous pour Ayoub Salmi demain à 10 h 30.");
  await flush();
  held.finish();
  await sending;
  expect(boundary.confirm).toHaveBeenCalledWith(ACTION_ID);
  expect(boundary.execute).toHaveBeenCalledWith(expect.objectContaining({actionId:ACTION_ID,outil:"create_appointment"}));
  expect(h.state?.carteEcriture).toBeNull();
  expect(h.state?.tours.at(-1)?.role).toBe("jarvis");
 }finally{h.stop();}
});

it("garde la confirmation clinique pour un changement de médicament",async()=>{
 const held=heldTurn(completed({
  tool:"update_treatment",
  args:{patientId:PATIENT_ID,treatmentId:"d1000000-0000-4000-8000-000000000001",expectedVersion:2,changes:"{\"dose\":\"50 mg\"}"},
  actionId:ACTION_ID,
 }));
 const h=await setup();
 try{
  const sending=h.api.envoyer("Pour Ayoub Salmi, passe la dose de sertraline à 50 mg.");
  await flush();
  held.finish();
  await sending;
  expect(boundary.confirm).not.toHaveBeenCalled();
  expect(boundary.execute).not.toHaveBeenCalled();
  expect(h.state?.carteEcriture).toMatchObject({actionId:ACTION_ID,outil:"update_treatment"});
 }finally{h.stop();}
});
