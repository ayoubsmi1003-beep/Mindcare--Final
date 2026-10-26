import { it, expect } from "vitest";
import { deterministicActionRequest, prepareActionProposal } from "@/server/alexa/action-proposal";
import { ok } from "@/services/result";
import type { DbPort } from "@/services/db/port";
import { agendaSelection } from "@/shared/alexa/agenda-plan";
const patient="11111111-1111-4111-8111-111111111111",consultation="22222222-2222-4222-8222-222222222222",payment="33333333-3333-4333-8333-333333333333";
const input=(text:string)=>({text,conversationId:"proposals",clientTurnId:patient,appContext:{patientId:patient,page:`/consultation/${consultation}`}});
const client={rpc:async<T>()=>({data:[] as T,error:null})};
it("routes a fully specified prepared appointment to the proposal flow without MiniCPM selection",()=>{
 expect(deterministicActionRequest("Prépare un rendez-vous demain à 10 h 00 pendant 45 minutes pour le patient sélectionné.")).toBe(true);
});
function port(calls:string[]):Pick<DbPort,"rpc"> {return {rpc:async<T>(name:string)=>{calls.push(name);const value=name==="get_consultation"?{id:consultation,patient_id:patient}:name==="get_consultation_payment"?{payment_id:payment}:{id:patient,first_name:"Synthetic",last_name:"Test"};return ok([value] as T[]);}};}
it("preserves French spaced-hour notation when preparing an appointment proposal",async()=>{
 const text="Prépare un rendez-vous demain à 10 h 00 pendant 45 minutes pour le patient sélectionné.",selection=agendaSelection(text)!;
 expect(await prepareActionProposal(input(text),port([]),client,new AbortController().signal)).toMatchObject({state:"ready",proposal:{tool:"create_appointment",args:{patientId:patient,startsAt:`${selection.day}T10:00:00+01:00`,durationMinutes:45}}});
});
it("tariff proposal uses only local audited reads and never writes",async()=>{
  const calls:string[]=[];
  expect(await prepareActionProposal(input("Fixe le tarif à 3000 DZD"),port(calls),client,new AbortController().signal)).toMatchObject({state:"ready",proposal:{tool:"set_consultation_price",args:{consultationId:consultation,amountDzd:3000}}});
  expect(calls).toEqual(["get_patient","get_consultation","get_patient"]);
});
it("payment proposal retains both identifiers required by the existing registry",async()=>{
  expect(await prepareActionProposal(input("Encaisse cette séance"),port([]),client,new AbortController().signal)).toMatchObject({state:"ready",proposal:{tool:"record_payment_collected",args:{consultationId:consultation,paymentId:payment}}});
});
it("uses the selected patient's verified open consultation for a current-session price proposal",async()=>{
 const calls:string[]=[],context={patientId:patient,consultations:[],currentConsultation:{id:consultation,startedAt:"2026-10-26T09:00:00+01:00",endedAt:null,rawNotes:null,notes:[]},treatments:{current:[],history:[],historyComplete:true},diagnoses:[],scales:[],sourceRevision:"a".repeat(64),coverage:{requested:1,returned:0,complete:true,hasMore:false}};
 const db:Pick<DbPort,"rpc">={rpc:async<T>(name:string)=>{calls.push(name);const value=name==="get_alexa_clinical_context"?context:name==="get_consultation"?{id:consultation,patient_id:patient}:name==="get_patient"?{id:patient,first_name:"Synthetic",last_name:"Test"}:[];return ok((Array.isArray(value)?value:[value]) as T[]);}};
 const request={...input("Fixe le tarif de la consultation courante à 2500 DZD."),appContext:{patientId:patient,page:`/patients/${patient}`}};
 expect(await prepareActionProposal(request,db,client,new AbortController().signal)).toMatchObject({state:"ready",proposal:{tool:"set_consultation_price",args:{consultationId:consultation,amountDzd:2500}}});
 expect(calls).toContain("get_alexa_clinical_context");expect(calls).not.toContain("execute_jarvis_action");
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
