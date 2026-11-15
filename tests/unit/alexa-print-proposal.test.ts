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
const today=new Date().toISOString();
const lastMonth=new Date(Date.now()-30*86400000).toISOString();
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
  const result=await prepareActionProposal({...input,text},dbWith([{document_id:documentId,doc_type:"ordonnance",doc_number:"DOC-2026-00067",status:"issued",issued_at:today}]),unusedSql,signal);
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
  const result=await prepareActionProposal(input,dbWith([{document_id:documentId,doc_type:"ordonnance",doc_number:"DOC-2026-00067",status:"issued",issued_at:today}]),unusedSql,signal);
  expect(result).toMatchObject({state:"print",patientId,documentId});
  if(result.state==="print")expect(result.label).toContain("DOC-2026-00067");
 });

 it("tolère la coquille « ordonance » la plus fréquente",async()=>{
  const result=await prepareActionProposal({...input,text:"imprime un ordonance pour ce patient"},dbWith([{document_id:documentId,doc_type:"ordonnance",doc_number:"DOC-2026-00067",status:"issued",issued_at:today}]),unusedSql,signal);
  expect(result).toMatchObject({state:"print",patientId,documentId});
 });

 it("imprime la plus récente des ordonnances émises aujourd'hui",async()=>{
  const result=await prepareActionProposal(input,dbWith([
   {document_id:documentId,doc_type:"ordonnance",doc_number:"DOC-2026-00067",status:"issued",issued_at:today},
   {document_id:"77777777-7777-4777-8777-777777777777",doc_type:"ordonnance",doc_number:"DOC-2026-00068",status:"issued",issued_at:new Date(Date.parse(today)+60000).toISOString()},
  ]),unusedSql,signal);
  expect(result).toMatchObject({state:"print",documentId:"77777777-7777-4777-8777-777777777777"});
 });

 it("sans ordonnance émise aujourd'hui, prépare le brouillon au lieu de réimprimer une ancienne",async()=>{
  const result=await prepareActionProposal(input,dbWith([{document_id:documentId,doc_type:"ordonnance",doc_number:"DOC-2026-00012",status:"issued",issued_at:lastMonth}]),unusedSql,signal);
  expect(result.state).not.toBe("print");
 });

 it("réimprime l'ancienne ordonnance quand la dernière est demandée",async()=>{
  const result=await prepareActionProposal({...input,text:"imprime la dernière ordonnance"},dbWith([{document_id:documentId,doc_type:"ordonnance",doc_number:"DOC-2026-00012",status:"issued",issued_at:lastMonth}]),unusedSql,signal);
  expect(result).toMatchObject({state:"print",documentId});
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

describe("« Alexa, ordonnance » pendant une consultation",()=>{
 const consultationId="99999999-9999-4999-8999-999999999999";
 const otherPatient="12121212-1212-4212-8212-121212121212";
 const visitStart=new Date(Date.now()-20*60000).toISOString();
 function consultationDb(rows:readonly unknown[]):Pick<DbPort,"rpc">{
  return {rpc:async <T>(name:string):Promise<Result<readonly T[]>>=>{
   if(name==="get_consultation"){const payload:unknown=[{id:consultationId,patient_id:patientId,started_at:visitStart}];return {ok:true,data:payload as readonly T[]};}
   if(name==="get_patient"){const payload:unknown=[patient];return {ok:true,data:payload as readonly T[]};}
   if(name==="list_patient_documents"){const payload:unknown=rows;return {ok:true,data:payload as readonly T[]};}
   return {ok:false,error:{code:"introuvable",message:"unexpected"}};
  }};
 }
 const inVisit={...input,text:"Alexa, ordonnance.",appContext:{patientId:otherPatient,page:`/consultation/${consultationId}`}};

 it.each(["Alexa, ordonnance.","imprimer ordonnance","Imprime l'ordonnance."])("reconnaît %s comme la demande d'ordonnance",text=>{
  expect(deterministicActionRequest(text)).toBe(true);
 });
 it("imprime l'ordonnance émise pendant cette séance, pour le patient de la consultation et non celui de la conversation",async()=>{
  const result=await prepareActionProposal(inVisit,consultationDb([{document_id:documentId,doc_type:"ordonnance",doc_number:"DOC-2026-00090",status:"issued",issued_at:new Date().toISOString()}]),unusedSql,signal);
  expect(result).toMatchObject({state:"print",patientId,documentId});
 });
 it("n'imprime pas une ordonnance émise avant la séance",async()=>{
  const result=await prepareActionProposal(inVisit,consultationDb([{document_id:documentId,doc_type:"ordonnance",doc_number:"DOC-2026-00080",status:"issued",issued_at:new Date(Date.parse(visitStart)-3600000).toISOString()}]),unusedSql,signal);
  expect(result.state).not.toBe("print");
 });
 it("laisse l'impression vocale d'un certificat inchangée : jamais de brouillon automatique",async()=>{
  const result=await prepareActionProposal({...inVisit,text:"imprime le certificat médical"},consultationDb([]),unusedSql,signal);
  expect(result.state).toBe("missing");
 });
});

it("sans ordonnance émise pendant la séance, propose le brouillon prérempli des traitements actifs du patient de la consultation",async()=>{
 const consultationId="99999999-9999-4999-8999-999999999999";
 const workspace={identite:{birth_date:"1990-01-01"},identification:{id_document_number:null,id_document_issuer:null},
  traitements_v2:{actifs:[{status:"active",medication_id:"22222222-2222-4222-8222-222222222222",medication_raw:"ZOLOFT 50 mg",brand_name:null,inn:"sertraline",dose:"50",dose_unit:"mg",frequency:"1 fois par jour"}]},
  traitements:{derniere_prescription:null}};
 const db:Pick<DbPort,"rpc">={rpc:async <T>(name:string):Promise<Result<readonly T[]>>=>{
  const rows:Record<string,unknown>={
   get_consultation:[{id:consultationId,patient_id:patientId,started_at:new Date().toISOString()}],
   get_patient:[{...patient,birth_date:"1990-01-01",id_document_number:null,id_document_issuer:null}],
   list_patient_documents:[],get_patient_workspace:[workspace],
   get_active_document_template:[{content_json:{type:"doc",content:[{type:"paragraph",content:[]}]},title_fr:"Ordonnance",version:1}],
  };
  if(!(name in rows))return {ok:false,error:{code:"introuvable",message:"unexpected"}};
  return {ok:true,data:rows[name] as readonly T[]};
 }};
 const result=await prepareActionProposal({...input,text:"Alexa, ordonnance.",appContext:{patientId:"12121212-1212-4212-8212-121212121212",page:`/consultation/${consultationId}`}},db,unusedSql,signal);
 expect(result).toMatchObject({state:"ready",patientId,proposal:{tool:"create_editable_document_draft",args:{patientId,documentType:"ordonnance"}}});
 if(result.state==="ready")expect(String(result.proposal.args["content"])).toContain("ZOLOFT");
});
