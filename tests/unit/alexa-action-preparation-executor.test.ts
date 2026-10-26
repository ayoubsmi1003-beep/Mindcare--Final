import {expect,it,vi} from "vitest";
import {scriptedAlexaRpc} from "../helpers/alexa-rpc";
import {agentExecutor} from "@/server/alexa/agent-tools";
import type {TurnInput} from "@/shared/alexa/turn";
import {frenchRequestAdmission} from "@/shared/alexa/request-contract";

const patient="22222222-2222-4222-8222-222222222222";
const draftId="33333333-3333-4333-8333-333333333333";
const treatmentId="44444444-4444-4444-8444-444444444444";
const issuedDocumentId="88888888-8888-4888-8888-888888888888";
const snapshot={status:"active" as const,dose:"25",doseUnit:"mg",frequency:"une fois par jour",timing:["matin"],instructions:null,startDate:"2026-10-01",endDate:null};
const treatment={...snapshot,id:treatmentId,medication:"Sertraline",version:4};
const context=(current=[treatment])=>({patientId:patient,consultations:[],treatments:{current,history:[],historyComplete:true},diagnoses:[],scales:[],sourceRevision:"a".repeat(64),coverage:{requested:1,returned:0,complete:true,hasMore:false}});
const draft={id:draftId,patientId:patient,kind:"certificat_medical",templateId:"55555555-5555-4555-8555-555555555555",templateVersion:2,content:{type:"doc" as const,content:[{type:"paragraph" as const,content:[{type:"field" as const,attrs:{name:"motif",value:"ancien motif"}},{type:"text" as const,text:" conservé"}]}]},variables:{motif:"ancien motif",jours:"14"},revision:3,documentDate:"2026-10-01",rendererVersion:"v2",issuedDocumentId:null,archivedAt:null,title:"Certificat médical",patientName:"Nadia Test"};
const input=(text:string,page="/jarvis"):TurnInput=>({text,conversationId:"conversation",clientTurnId:"11111111-1111-4111-8111-111111111111",appContext:{patientId:patient,page}});

function executor(text:string,options:{treatments?:typeof treatment[];drafts?:typeof draft[];documents?:readonly unknown[];page?:string}={}){
 const rpc=scriptedAlexaRpc(async(name)=>{
  if(name==="get_patient")return {ok:true as const,data:[{id:patient,first_name:"Nadia",last_name:"Test"}]};
  if(name==="get_alexa_clinical_context")return {ok:true as const,data:[context(options.treatments??[treatment])]};
  if(name==="list_editable_document_drafts")return {ok:true as const,data:options.drafts??[draft]};
  if(name==="list_patient_documents")return {ok:true as const,data:options.documents??[{document_id:issuedDocumentId,doc_type:"ordonnance",doc_number:"DOC-2026-00067",status:"issued"}]};
  throw Error("Unexpected gate: "+name);
 });
 return {rpc,run:agentExecutor(input(text,options.page),{rpc},{rpc:vi.fn()})};
}

it("routes a polite print request through the model tool and opens only the exact issued document",async()=>{
 const text="Peux-tu imprimer l'ordonnance du dossier courant ?";
 expect(frenchRequestAdmission(text,false)).toMatchObject({tools:["prepare_action"],preparationAction:"print_issued_document",preparationDocumentType:"ordonnance"});
 const f=executor(text);
 const result=await f.run({id:"print",name:"prepare_action",args:{partIds:["p"],action:"print_issued_document",documentType:"ordonnance"}},"2026-10-26T10:00:00+01:00",[],new AbortController().signal);
 expect(result).toMatchObject({status:"ok",patientId:patient,navigation:{target:"document",patientId:patient,documentId:issuedDocumentId,print:true}});
 expect(result.evidence).toEqual(expect.arrayContaining([expect.objectContaining({id:issuedDocumentId,type:"document"})]));
});

it("asks for clarification instead of printing when there is no issued ordonnance",async()=>{
 const f=executor("Peux-tu imprimer l'ordonnance du dossier courant ?",{documents:[]});
 const result=await f.run({id:"print",name:"prepare_action",args:{partIds:["p"],action:"print_issued_document",documentType:"ordonnance"}},"2026-10-26T10:00:00+01:00",[],new AbortController().signal);
 expect(result.status).toBe("needs_input");expect(result.navigation).toBeUndefined();
});

it("prepares only the requested, current treatment fields with its current version",async()=>{
 const f=executor("Modifie la Sertraline du dossier courant et passe la dose à 50 mg.");
 const result=await f.run({id:"change",name:"prepare_action",args:{partIds:["p"],action:"update_treatment",treatmentName:"Sertraline",changes:{dose:"50",doseUnit:"mg"}}},"2026-10-26T10:00:00+01:00",[],new AbortController().signal);
 expect(result.status).toBe("ok");expect(result.proposal?.tool).toBe("update_treatment");
 expect(result.proposal?.args).toMatchObject({treatmentId,expectedVersion:4,patientId:patient,consultationId:null,changes:JSON.stringify({dose:"50",dose_unit:"mg"})});
});

it("asks instead of choosing when multiple current treatments fit a generic request",async()=>{
 const f=executor("Modifie mon traitement du dossier courant et passe la dose à 50 mg.",{treatments:[treatment,{...treatment,id:"66666666-6666-4666-8666-666666666666",medication:"Quetiapine"}]});
 const result=await f.run({id:"change",name:"prepare_action",args:{partIds:["p"],action:"update_treatment",treatmentName:"Sertraline",changes:{dose:"50",doseUnit:"mg"}}},"2026-10-26T10:00:00+01:00",[],new AbortController().signal);
 expect(result.status).toBe("needs_input");expect(result.error?.code).toBe("treatment-target-ambiguous");expect(result.proposal).toBeUndefined();
});

it("refuses a dose copied from the old regimen instead of the requested new value",async()=>{
 const f=executor("Modifie la Sertraline du dossier courant et passe de 25 mg à 50 mg.");
 const result=await f.run({id:"change",name:"prepare_action",args:{partIds:["p"],action:"update_treatment",treatmentName:"Sertraline",changes:{dose:"25",doseUnit:"mg"}}},"2026-10-26T10:00:00+01:00",[],new AbortController().signal);
 expect(result.status).toBe("needs_input");expect(result.proposal).toBeUndefined();
});

it("opens and prepares one existing draft while preserving every untouched field",async()=>{
 const f=executor("Corrige le brouillon de certificat médical du dossier courant, remplace le motif par suivi demandé.",{page:`/documents?draft=${draftId}`});
 const result=await f.run({id:"edit",name:"prepare_action",args:{partIds:["p"],action:"update_editable_document_draft",draftId,documentType:"certificat_medical",variables:{motif:"suivi demandé"}}},"2026-10-26T10:00:00+01:00",[],new AbortController().signal);
 expect(result.proposal?.tool).toBe("update_editable_document_draft");expect(result.proposal?.args).toMatchObject({draftId,expectedRevision:3,documentType:"certificat_medical",variables:JSON.stringify({motif:"suivi demandé",jours:"14"})});
 expect(result.proposal?.args["content"]).toContain("suivi demandé");expect(result.proposal?.args["content"]).toContain("conservé");
 expect(f.rpc.mock.calls.some(([name])=>name==="save_editable_document_draft")).toBe(false);
});

it("does not let a model-selected draft disambiguate multiple drafts",async()=>{
 const other={...draft,id:"77777777-7777-4777-8777-777777777777",title:"Autre certificat"};
 const f=executor("Corrige le brouillon de certificat médical du dossier courant, remplace le motif par suivi demandé.",{drafts:[draft,other]});
 const result=await f.run({id:"edit",name:"prepare_action",args:{partIds:["p"],action:"update_editable_document_draft",draftId,documentType:"certificat_medical",variables:{motif:"suivi demandé"}}},"2026-10-26T10:00:00+01:00",[],new AbortController().signal);
 expect(result.status).toBe("needs_input");expect(result.error?.code).toBe("document-draft-ambiguous");expect(result.proposal).toBeUndefined();
});
