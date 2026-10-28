import {describe,expect,it} from "vitest";
import type {DbPort} from "@/services/db/port";
import type {Result} from "@/services/result";
import type {ClientSql} from "@/server/jarvis/client-sql";
import {deterministicActionRequest,prepareActionProposal} from "@/server/alexa/action-proposal";

const patientId="11111111-1111-4111-8111-111111111111";
const documentId="44444444-4444-4444-8444-444444444444";
const patient={id:patientId,first_name:"Nadia",last_name:"Test"};
const input={text:"imprime l'ordonnance",conversationId:"55555555-5555-4555-8555-555555555555",clientTurnId:"66666666-6666-4666-8666-666666666666",appContext:{patientId,page:`/patients/${patientId}`}};
const signal=new AbortController().signal;
const unusedSql:ClientSql={rpc:async()=>{throw Error("UnexpectedSqlCall");}};

function dbWith(rows:readonly unknown[]):Pick<DbPort,"rpc">{
 return {rpc:async <T>(name:string):Promise<Result<readonly T[]>>=>{
  if(name==="get_patient"){const payload:unknown=[patient];return {ok:true,data:payload as readonly T[]};}
  if(name==="search_patients"){const payload:unknown=[{...patient,total_count:1}];return {ok:true,data:payload as readonly T[]};}
  if(name==="list_patient_documents"){const payload:unknown=rows;return {ok:true,data:payload as readonly T[]};}
  return {ok:false,error:{code:"introuvable",message:"unexpected"}};
 }};
}

describe("impression d'un document existant",()=>{
 it.each([
  "Peux-tu imprimer l'ordonnance de Nadia Test ?",
  "Pour Nadia Test, pourrais-tu imprimer son ordonnance ?",
  "Alexa, imprime l'ordonnance pour Nadia Test.",
 ])("admet les formulations polies et centrées sur le patient: %s",async text=>{
  expect(deterministicActionRequest(text)).toBe(true);
  const result=await prepareActionProposal({...input,text},dbWith([{document_id:documentId,doc_type:"ordonnance",doc_number:"DOC-2026-00067",status:"issued"}]),unusedSql,signal);
  expect(result).toMatchObject({state:"print",patientId,documentId});
 });

 it("reconnaît les demandes d'impression explicites, y compris formulées poliment",()=>{
  expect(deterministicActionRequest("Imprime l'ordonnance de Nadia Test.")).toBe(true);
  expect(deterministicActionRequest("Peux-tu imprimer l'ordonnance de Nadia Test ?")).toBe(true);
 });

 it("ne traite pas une impression niée comme une demande d'action",()=>{
  expect(deterministicActionRequest("N'imprime pas l'ordonnance de Nadia Test.")).toBe(false);
 });

 it("ouvre l'unique ordonnance émise, sans créer de brouillon",async()=>{
  const result=await prepareActionProposal(input,dbWith([{document_id:documentId,doc_type:"ordonnance",doc_number:"DOC-2026-00067",status:"issued"}]),unusedSql,signal);
  expect(result).toMatchObject({state:"print",patientId,documentId});
  if(result.state==="print")expect(result.label).toContain("DOC-2026-00067");
 });

 it("tolère la coquille « ordonance » la plus fréquente",async()=>{
  const result=await prepareActionProposal({...input,text:"imprime un ordonance pour ce patient"},dbWith([{document_id:documentId,doc_type:"ordonnance",doc_number:"DOC-2026-00067",status:"issued"}]),unusedSql,signal);
  expect(result).toMatchObject({state:"print",patientId,documentId});
 });

 it("refuse d'inventer une cible quand plusieurs ordonnances existent",async()=>{
  const result=await prepareActionProposal(input,dbWith([
   {document_id:documentId,doc_type:"ordonnance",doc_number:"DOC-2026-00067",status:"issued"},
   {document_id:"77777777-7777-4777-8777-777777777777",doc_type:"ordonnance",doc_number:"DOC-2026-00068",status:"issued"},
  ]),unusedSql,signal);
  expect(result.state).toBe("missing");
  if(result.state==="missing")expect(result.message).toContain("Plusieurs");
 });

 it("ne propose rien quand aucune ordonnance n'est émise",async()=>{
  const result=await prepareActionProposal(input,dbWith([]),unusedSql,signal);
  expect(result.state).toBe("missing");
  if(result.state==="missing")expect(result.message).toContain("Aucun");
 });

 it("déplace le rendez-vous ouvert depuis sa fiche, sans changer de patient",async()=>{
  const appointmentId="88888888-8888-4888-8888-888888888888";
  const db:Pick<DbPort,"rpc">={rpc:async <T>(name:string):Promise<Result<readonly T[]>>=>{
   if(name==="get_patient"){const payload:unknown=[patient];return {ok:true,data:payload as readonly T[]};}
   if(name==="get_appointment"){const payload:unknown=[{id:appointmentId,patient_id:patientId}];return {ok:true,data:payload as readonly T[]};}
   return {ok:false,error:{code:"introuvable",message:"unexpected"}};
  }};
  const result=await prepareActionProposal({...input,text:"déplace le rendez-vous de demain à 15h00",appContext:{patientId,page:`/agenda/${appointmentId}`}},db,unusedSql,signal);
  expect(result).toMatchObject({state:"ready",patientId,proposal:{tool:"reschedule_appointment",args:{appointmentId}}});
  if(result.state==="ready")expect(result.proposal.args["nouveauDebut"]).toMatch(/T15:00:00\+01:00$/u);
 });
});
