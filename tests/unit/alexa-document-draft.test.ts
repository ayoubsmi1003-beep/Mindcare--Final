import {describe,expect,it} from "vitest";
import type {DbPort} from "@/services/db/port";
import type {Result} from "@/services/result";
import {resolveDocumentDraftInputs} from "@/server/alexa/document-draft";

const patientId="11111111-1111-4111-8111-111111111111";
const now=new Date("2026-10-22T10:00:00+01:00");

const field=(name:string,value="")=>({type:"field" as const,attrs:{name,value}});
const paragraph=(child?:unknown)=>({type:"paragraph" as const,content:child?[child]:[]});
const bullet=()=>({type:"bulletList" as const,content:[{type:"listItem" as const,content:[paragraph(field("vars_traitement_1"))]}]});
const doc=(content:readonly unknown[])=>({type:"doc" as const,content});

const patient={
 id:patientId,first_name:"Nadia",last_name:"Belkacem",birth_date:"1995-11-10",
 id_document_number:"113255751",id_document_issuer:"Mairie d'Alger",
};
const workspace={
 identite:{birth_date:"1995-11-10"},
 identification:{id_document_number:"113255751",id_document_issuer:"Mairie d'Alger"},
 traitements_v2:{actifs:[
  {status:"active",medication_id:"22222222-2222-4222-8222-222222222222",medication_raw:"ZOLOFT 50 mg",brand_name:null,inn:"sertraline",dose:"50",dose_unit:"mg",frequency:"1 fois par jour"},
  {status:"active",medication_id:"33333333-3333-4333-8333-333333333333",medication_raw:"XANAX 0,5 mg",brand_name:null,inn:"alprazolam",dose:"0,5",dose_unit:"mg",frequency:"2 fois par jour"},
 ]},
 traitements:{derniere_prescription:{lignes:[{designation:"ZOLOFT 50 mg",brand_name:null,frequency_per_day:1}]}},
};
const consultation={id:"44444444-4444-4444-8444-444444444444",patient_id:patientId,started_at:"2026-10-20T09:30:00+01:00"};

function port(kindContent:unknown,overrides:{patient?:unknown;workspace?:unknown;consultation?:unknown}={}):Pick<DbPort,"rpc">{
 return {rpc:async <T>(name:string):Promise<Result<readonly T[]>>=>{
  if(name==="get_patient"){const payload:unknown=[overrides.patient??patient];return {ok:true,data:payload as readonly T[]};}
  if(name==="get_patient_workspace"){const payload:unknown=[overrides.workspace??workspace];return {ok:true,data:payload as readonly T[]};}
  if(name==="get_active_document_template"){const payload:unknown=[{content_json:kindContent,title_fr:"Document",version:5}];return {ok:true,data:payload as readonly T[]};}
  if(name==="get_consultation"){const payload:unknown=[overrides.consultation??consultation];return {ok:true,data:payload as readonly T[]};}
  return {ok:false,error:{code:"introuvable",message:"unexpected"}};
 }};
}

const signal=new AbortController().signal;

describe("resolveDocumentDraftInputs",()=>{
 it("reprend le numéro et la mairie déjà stockés pour le certificat de bonne santé",async()=>{
  const result=await resolveDocumentDraftInputs(port(doc([paragraph()])),patientId,"bonne_sante_mentale","", "/documents",signal,now);
  expect(result.state).toBe("ready");
  if(result.state!=="ready")return;
  expect(result.variables).toMatchObject({id_document_number:"113255751",mairie:"Mairie d'Alger"});
  expect(result.patientName).toBe("Nadia Belkacem");
 });

 it("ne fabrique pas un numéro d'identité absent",async()=>{
  const result=await resolveDocumentDraftInputs(port(doc([paragraph()]),{patient:{...patient,id_document_number:null},workspace:{...workspace,identification:{id_document_number:null,id_document_issuer:null}}}),patientId,"bonne_sante_mentale","", "/documents",signal,now);
  expect(result.state).toBe("missing");
  if(result.state==="missing")expect(result.field).toBe("id_document_number");
 });

 it("reprend la date de naissance et les traitements actifs du certificat médical",async()=>{
  const result=await resolveDocumentDraftInputs(port(doc([bullet()])),patientId,"certificat_medical","", "/documents",signal,now);
  expect(result.state).toBe("ready");
  if(result.state!=="ready")return;
  expect(result.variables["date_naissance"]).toBe("10/11/1995");
  expect(result.variables["traitement_1"]).toContain("ZOLOFT 50 mg");
  expect(result.variables["traitement_2"]).toContain("XANAX 0,5 mg");
  const bullets=(result.content.content[0] as {content?:readonly unknown[]}).content??[];
  expect(bullets).toHaveLength(2);
 });

 it("compose les lignes de l'ordonnance depuis le traitement actif",async()=>{
  const result=await resolveDocumentDraftInputs(port(doc([paragraph()])),patientId,"ordonnance","", "/documents",signal,now);
  expect(result.state).toBe("ready");
  if(result.state!=="ready")return;
  const medications=result.content.content.filter(node=>node.type==="medication");
  expect(medications).toHaveLength(2);
  expect(medications[0]?.attrs?.["designation"]).toBe("ZOLOFT 50 mg");
  expect(medications[0]?.attrs?.["posology"]).toBe("1 fois par jour");
  expect(medications[1]?.attrs?.["source"]).toBe("catalogue");
 });

 it("ne compose pas une ordonnance sans médicament réel",async()=>{
  const empty={...workspace,traitements_v2:{actifs:[]},traitements:{derniere_prescription:null}};
  const result=await resolveDocumentDraftInputs(port(doc([paragraph()]),{workspace:empty}),patientId,"ordonnance","", "/documents",signal,now);
  expect(result.state).toBe("missing");
  if(result.state==="missing")expect(result.field).toBe("medicament");
 });

 it("reprend la date de la consultation ouverte pour la justification",async()=>{
  const result=await resolveDocumentDraftInputs(port(doc([paragraph()])),patientId,"justification","", `/consultation/${consultation.id}`,signal,now);
  expect(result.state).toBe("ready");
  if(result.state!=="ready")return;
  expect(result.variables["date_consultation"]).toBe("20/10/2026");
 });

 it("ne reprend un nombre de jours que s'il est explicitement demandé",async()=>{
  const result=await resolveDocumentDraftInputs(port(doc([paragraph()])),patientId,"suivi_medical","arrêt de 30 jours", "/documents",signal,now);
  expect(result.state).toBe("ready");
  if(result.state!=="ready")return;
  expect(result.variables["jours"]).toBe("30");
  expect(result.variables["date_debut"]).toBe("22/10/2026");
 });

 it("refuse un dossier hors périmètre",async()=>{
  const other={...patient,id:"99999999-9999-4999-8999-999999999999"};
  const result=await resolveDocumentDraftInputs(port(doc([paragraph()])),patientId,"bonne_sante_mentale","", "/documents",signal,now);
  expect(result.state).toBe("ready");
  // A mismatched returned id is rejected, never silently accepted.
  const wrong=await resolveDocumentDraftInputs(port(doc([paragraph()]),{patient:other}),patientId,"bonne_sante_mentale","", "/documents",signal,now);
  expect(wrong.state).toBe("unavailable");
 });
});
