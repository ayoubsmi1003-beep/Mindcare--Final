import {expect,it} from "vitest";
import type {DbPort,RpcArgs} from "@/services/db/port";
import {deterministicActionRequest,explicitAlgerianClockTime,prepareIssuedDocumentPrint} from "@/server/alexa/action-proposal";

const patientId="11111111-1111-4111-8111-111111111111";
const selectedId="22222222-2222-4222-8222-222222222222";
const otherId="33333333-3333-4333-8333-333333333333";

function documentRow(documentId:string,number:string){return {document_id:documentId,doc_type:"ordonnance",doc_number:number,status:"issued"};}

function fakeDatabase(documents:readonly ReturnType<typeof documentRow>[],currentRevision="rev-selected"){
 const calls:{name:string;args:Readonly<Record<string,string|number|boolean|null>>}[]=[];
 const rpc:Pick<DbPort,"rpc">["rpc"]=async <T>(name:string,args:RpcArgs)=>{
  calls.push({name,args});
  let rows:unknown;
  if(name==="list_patient_documents")rows=documents;
  else if(name==="get_document")rows=[{document_id:selectedId,patient_id:patientId,doc_type:"ordonnance",doc_number:"ORD-2026-0001",content_hash:currentRevision}];
  else throw new Error("UnexpectedRpc:"+name);
  return {ok:true as const,data:rows as readonly T[]};
 };
 return {db:{rpc},calls};
}

it("admits a pronoun print command only when a selected document is in context",()=>{
 expect(deterministicActionRequest("Imprime-le.",selectedId)).toBe(true);
 expect(deterministicActionRequest("Imprime-le.")).toBe(false);
});

it.each([["15 h","15:00"],["15h30","15:30"],["9 heures 05","09:05"],["15:30","15:30"]])("parses the exact Algiers appointment time from %s",(text,expected)=>{
 expect(explicitAlgerianClockTime(text)).toBe(expected);
});

it("requires one unambiguous clock time",()=>{
 expect(explicitAlgerianClockTime("demain à 15 h ou 16 h")).toBeNull();
 expect(explicitAlgerianClockTime("demain après-midi")).toBeNull();
});

it("prints the exact selected issued document when several documents share its kind",async()=>{
  const {db,calls}=fakeDatabase([documentRow(otherId,"ORD-2026-0002"),documentRow(selectedId,"ORD-2026-0001")]);
  const result=await prepareIssuedDocumentPrint(db,patientId,"ordonnance",new AbortController().signal,selectedId,"rev-selected");
 expect(result).toMatchObject({state:"print",documentId:selectedId,label:"Ordonnance ORD-2026-0001"});
  expect(calls).toContainEqual({name:"get_document",args:{p_id:selectedId}});
});

it("rejects a selected document whose revision changed since the UI selection",async()=>{
  const {db}=fakeDatabase([documentRow(selectedId,"ORD-2026-0001")],"rev-current");
  const result=await prepareIssuedDocumentPrint(db,patientId,"ordonnance",new AbortController().signal,selectedId,"rev-stale");
 expect(result.state).toBe("missing");
});
