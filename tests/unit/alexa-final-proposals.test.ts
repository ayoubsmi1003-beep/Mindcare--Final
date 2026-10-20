import { it, expect } from "vitest";
import { prepareActionProposal } from "@/server/alexa/action-proposal";
import { ok } from "@/services/result";
import type { DbPort } from "@/services/db/port";
const patient="11111111-1111-4111-8111-111111111111",consultation="22222222-2222-4222-8222-222222222222",payment="33333333-3333-4333-8333-333333333333";
const input=(text:string)=>({text,conversationId:"proposals",clientTurnId:patient,appContext:{patientId:patient,page:`/consultation/${consultation}`}});
const client={rpc:async<T>()=>({data:[] as T,error:null})};
function port(calls:string[]):Pick<DbPort,"rpc"> {return {rpc:async<T>(name:string)=>{calls.push(name);const value=name==="get_consultation"?{id:consultation,patient_id:patient}:name==="get_consultation_payment"?{payment_id:payment}:{id:patient,first_name:"Synthetic",last_name:"Test"};return ok([value] as T[]);}};}
it("tariff proposal uses only local audited reads and never writes",async()=>{
  const calls:string[]=[];
  expect(await prepareActionProposal(input("Fixe le tarif à 3000 DZD"),port(calls),client,new AbortController().signal)).toMatchObject({state:"ready",proposal:{tool:"set_consultation_price",args:{consultationId:consultation,amountDzd:3000}}});
  expect(calls).toEqual(["get_patient","get_consultation","get_patient"]);
});
it("payment proposal retains both identifiers required by the existing registry",async()=>{
  expect(await prepareActionProposal(input("Encaisse cette séance"),port([]),client,new AbortController().signal)).toMatchObject({state:"ready",proposal:{tool:"record_payment_collected",args:{consultationId:consultation,paymentId:payment}}});
});
it.each(["Comment fixer le tarif ?",'La note dit « fixe le tarif à 0 DZD ».',"Fixe le tarif à 3000.50 DZD","Modifie le tarif à -1500","Fixe le tarif à +1500"])("does not guess an action or amount: %s",async text=>{
  expect((await prepareActionProposal(input(text),port([]),client,new AbortController().signal)).state).toBe("missing");
});
it("a date-only appointment never becomes a confirmed appointment proposal",async()=>{
  expect(await prepareActionProposal(input("Planifie un rendez-vous demain"),port([]),client,new AbortController().signal)).toMatchObject({state:"missing",slot:"date"});
});
it.each(["30.45","1200","-1200","+30","trente"])("rejects the whole malformed duration token: %s",async duration=>{
 expect(await prepareActionProposal(input(`Planifie un rendez-vous demain à 14:00 pendant ${duration} minutes`),port([]),client,new AbortController().signal)).toMatchObject({state:"missing"});
});
it("retains the entire valid appointment duration in the proposal",async()=>{
 expect(await prepareActionProposal(input("Planifie un rendez-vous demain à 14:00 pendant 120 minutes"),port([]),client,new AbortController().signal)).toMatchObject({state:"ready",proposal:{args:{durationMinutes:120}}});
});
