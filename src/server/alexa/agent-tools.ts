import {isDeepStrictEqual} from "node:util";
import {appendLinkedAnswerLine} from '@/shared/alexa/answer-links';
import {randomUUID} from "node:crypto";
import {resolveDocumentDraftInputs} from "./document-draft";
import {prepareInternalMessage} from "./internal-message";
import {alexaActions} from "@/i18n/alexa-actions";
import {knowledgeSynthesisCopy} from "@/i18n/alexa-knowledge";
import {applicationReadCopy} from "@/i18n/alexa-application";
import {profileCopy} from "@/i18n/alexa-profile";
import {readMessageDraft} from "./message-draft";
import {patientProfileSchema,profileAnswer,profileNeedsClarification} from "./profile-answer";
import { extractRecurringClinicalTheme, summarizeClinicalConsultations, summarizeClinicalContext, summarizeClinicalCaseContext, relativeClinicalDate } from "./clinical-narrative";
import { narrativeCopy } from "@/i18n/alexa-narrative";
import {requestedConsultationCount,requestsOldestConsultations,requestsPatientScope} from "@/shared/alexa/request-plan";
import {frenchRequestAdmission,frenchRequestedOutputs,hasExplicitClockRestriction,frenchFinanceRecordState,requestedCountRead} from "@/shared/alexa/request-contract";
import {readConsultation} from "./consultation-reads";
import {inferNativeGeneralAlexa,canAnswerGeneralAlexa} from "./model-gateway";
import {readApplication,readFinanceView,readAppointment} from "./application-reads";
import {notePageResult} from "./note-pages";
import {noteReadQuerySchema,noteCursorSchema,noteContinuation,noteQueryGrounded,documentBodySearchRequested} from "@/shared/alexa/note-query";
import {measureChanges} from '@/shared/alexa/session-details';
import {clinicalSectionComplete} from "./clinical-coverage";
import {alexaRecordCopy,frenchAgendaCopy} from "@/i18n/alexa-records";
import {documentText,issuedDocumentText} from './document-excerpt';
import {documentPage} from './document-page';
import { z } from "zod";
import type { DbPort, RpcArgs } from "@/services/db/port";
import type { ClientSql } from "@/server/jarvis/client-sql";
import type { TurnInput, AlexaSource, AlexaProposal } from "@/shared/alexa/turn";
import { ALEXA_AGENT_LANGUAGE,applicationQuerySchema,timelineQuerySchema,timelineCursorSchema,cabinetFinanceModes,AgentReadError,patientListContinuation,patientMetricConditions,agentSchemas, conditionKey, type AgentCall, type AgentResult } from "@/shared/alexa/agent";
import { agentCopy, missingPatientFieldParagraph, patientListParagraph, patientListPageParagraph } from "@/i18n/alexa-agent";
import { resolvePatient } from "./patient-resolver";
import { buildClinicalContext } from "./clinical-context";
import type { ClinicalContext } from "@/shared/alexa/clinical";
import { localResponse } from "./local-response";
import {planKnowledgeQuery} from "./knowledge-query";
import { readKnowledge } from "./knowledge-adapter";
import {synthesizeKnowledge} from './knowledge-synthesis';
import {knowledgeSource} from './knowledge-response';
import {patientQueryContract,patientQueryPeriod} from '@/shared/alexa/patient-query-contract';
import { resolveAgentPeriod,explicitAgentPeriod,explicitAgendaClockWindow } from "./agent-period";
import {parsePatientMention} from "./patient-mention";
import {resolveListedReference} from "./conversation-state";
import {nativeAgendaStatusContract,agendaIdentityText} from '@/shared/alexa/agenda-plan';

const count = z.number().int().nonnegative().safe();
const patientRow = z.object({id:z.uuid(),first_name:z.string().max(200),last_name:z.string().max(200),missing:z.array(z.enum(["phone","identity_card","birth_date","sex"])),completed_consultations:count.nullable(),outstanding_balance:count.nullable()}).strict();
const patientResult = z.object({total:count,rows:z.array(patientRow).max(20),metrics:z.record(z.string(),count),unknownAge:count,revision:z.string().regex(/^[a-f0-9]{32}$/),asOf:z.string(),conditions:z.array(agentSchemas.declare_request.shape.parts.element.shape.conditions.element),complete:z.literal(true),offset:count,appliedSpec:z.record(z.string(),z.unknown()).optional()}).strict();
const recordRow = z.object({id:z.uuid(),patientId:z.uuid().nullable(),label:z.string().max(500),at:z.string().nullable(),status:z.string().max(50),amount:count.nullable()}).strict();
const recordResult = z.object({total:count,rows:z.array(recordRow).max(20),totals:z.record(z.string(),count),complete:z.literal(true),offset:count}).strict();

/** Only this closed catalogue reaches server-side, actor-bound SQL doors. No browser service imports. */
export function agentExecutor(input:TurnInput, db:Pick<DbPort,"rpc">, knowledge:ClientSql) {
 const language=ALEXA_AGENT_LANGUAGE, copy=agentCopy[language],recordsCopy=alexaRecordCopy[language];
 const labels:Readonly<Record<string,string>>=recordsCopy.labels;
 const label=(value:string)=>labels[value]??value;
 const patientSource=(patientId:string):AlexaSource=>({id:patientId,type:"patient",label:"Dossier patient"});
 const failure=(call:AgentCall,status:AgentResult["status"],text:string,code:string):AgentResult=>({callId:call.id,status,complete:false,text,evidence:[],conditionKeys:[],error:{code,retryable:false}});
 async function rpc(name:string,args:RpcArgs,signal:AbortSignal,allowEmpty=false,rows=false):Promise<unknown>{
  signal.throwIfAborted(); let result=await db.rpc<unknown>(name,args); signal.throwIfAborted();
  if(!result.ok&&["40001","40P01","08006","08003"].includes(result.error.technical??"")&&!signal.aborted){result=await db.rpc<unknown>(name,args);signal.throwIfAborted();}
  if(!result.ok)throw new AgentReadError(result.error.technical==="42501"?"permission":result.error.technical==="57014"?"timeout":result.error.technical==="40001"?"changed":"database");
  if(rows)return result.data;
  if(allowEmpty&&result.data.length===0)return null;
  if(result.data.length!==1)throw new AgentReadError("malformed");
  return result.data[0];
 }
 return async function execute(call:AgentCall,asOf:string,prior:readonly AgentResult[],signal:AbortSignal,original?:string,requestedGoal?:string):Promise<AgentResult>{
  const schema=agentSchemas[call.name as keyof typeof agentSchemas];
  if(!schema||!schema.safeParse(call.args).success)return failure(call,"error",copy.unavailable,"invalid");
  const a={...call.args};
  const requestText=requestedGoal??original??input.text;
  if(call.name==='query_finance'&&!cabinetFinanceModes.some(mode=>mode===a['mode'])){
   const state=frenchFinanceRecordState(requestText);
   if(!state)return failure(call,'needs_input',copy.unsupported,'unresolved-payment-state');
   if(a['state']!==undefined&&a['state']!==state)return failure(call,'needs_input',copy.unsupported,'unrequested-payment-state');
   if(state!=='all')a['state']=state;
  }
  if(call.name==='query_consultations'&&!a['consultationId']){
   const text=requestText.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
   const lifecycle=/\b(?:termine\w*|clos\w*|cloture\w*|acheve\w*|ferme\w*|ouvert\w*|en cours)\b/u.test(text);
   if(lifecycle&&/\b(?:non signe\w*|sans signature)\b/u.test(text)||/\b(?:non|pas|sans)\s+(?:encore\s+)?(?:termine\w*|clos\w*|cloture\w*|acheve\w*|ferme\w*|ouvert\w*|en cours)\b/u.test(text))return failure(call,'unsupported',copy.unsupported,'unsupported-consultation-status-combination');
  }
  if(call.name==='query_agenda'&&/\b(?:dernier|deuxieme|second|troisieme|2e|3e)\s+rendez[- ]vous\b/u.test(requestText.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()))return failure(call,'unsupported',frenchAgendaCopy.orderUnavailable,'unsupported-agenda-order');
  const agendaFirst=call.name==='query_agenda'&&/\b(?:premier|1er)\s+rendez[- ]vous\b/u.test(requestText.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase());
  if(agendaFirst&&a['appointmentId'])return failure(call,'unsupported',frenchAgendaCopy.orderUnavailable,'unrequested-first-appointment-reference');
  if(agendaFirst&&a['offset']!==undefined&&a['offset']!==0)return failure(call,'unsupported',frenchAgendaCopy.orderUnavailable,'unrequested-first-appointment-offset');
  if(call.name==='query_agenda'&&!a['appointmentId']){
   if(/\b(?:se termine\w*|finissent|(?:date|heure) (?:de )?fin)\b/u.test(requestText.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()))return failure(call,'unsupported',frenchAgendaCopy.endAxisUnavailable,'unsupported-agenda-end-axis');
   const contract=nativeAgendaStatusContract(requestText),proposed=a['statuses'];
   if(!contract.complete)return failure(call,'needs_input',frenchAgendaCopy.statusClarification,'unresolved-agenda-status');
   if(proposed!==undefined&&(!contract.statuses||!isDeepStrictEqual([...new Set(proposed as string[])].sort(),[...contract.statuses].sort())))return failure(call,'needs_input',frenchAgendaCopy.statusClarification,'unrequested-agenda-status');
   if(contract.statuses)a['statuses']=contract.statuses;
   if(hasExplicitClockRestriction(requestText)){
    const clockWindow=explicitAgendaClockWindow(requestText,asOf);
    if(!clockWindow)return failure(call,'needs_input',copy.date,'unresolved-agenda-clock');
    if((typeof a['from']==='string'&&Date.parse(a['from'])!==Date.parse(clockWindow.from))||(typeof a['to']==='string'&&Date.parse(a['to'])!==Date.parse(clockWindow.to))||a['period']!==undefined)return failure(call,'needs_input',recordsCopy.periodConflict,'requested-period-mismatch');
    a['from']=clockWindow.from;a['to']=clockWindow.to;
   }
  }
  // A multi-part task must not leak a name-like word from a sibling question into this read.
  // Each registered sub-question owns its identity scope; absent a goal, retain the original turn.
  const identityText=call.name==='query_agenda'?agendaIdentityText(requestedGoal??input.text):requestedGoal??input.text;
  if((call.name==='query_consultations'||(call.name==='get_patient_context'&&['summary','history'].includes(String(a["section"]))))&&requestsOldestConsultations(requestText))return failure(call,"unsupported",narrativeCopy.oldestUnavailable,"oldest-consultations-unsupported");
  if(call.name==='get_patient_context'&&a["section"]==='notes'&&typeof a["query"]==='string'&&!a["reusePrevious"]&&!noteContinuation(input.text)&&!noteQueryGrounded(requestText,a["query"]))return failure(call,"error",copy.unavailable,"unrequested-note-content-filter");
  if(call.name==='get_patient_context'&&a["section"]==='profile'){
   if(/\b(?:e[- ]?mail|courriel|adresse electronique)\b/u.test(requestText.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()))return failure(call,'unsupported',profileCopy.emailUnavailable,'patient-email-unsupported');
   if(profileNeedsClarification(requestText))return failure(call,'needs_input',profileCopy.askField,'administrative-field-missing');
  }
  if(call.name==='query_documents'&&!a['documentId']&&!a['draftId']&&!a['reusePrevious']&&documentBodySearchRequested(requestText))return failure(call,'unsupported',applicationReadCopy.documentSearchUnsupported,'document-body-search-unsupported');
  if(call.name==='query_documents'&&typeof a['query']==='string'&&!a['reusePrevious']&&!noteQueryGrounded(requestText,a['query']))return failure(call,'error',copy.unavailable,'unrequested-document-filter');
  const requestedCounts=(frenchRequestedOutputs(requestText)??[requestText]).map(requestedConsultationCount).filter((n):n is number=>n!==null);
  if(call.name==='get_patient_context'&&a["section"]==='summary'&&a["count"]!==undefined&&!requestedCounts.includes(Number(a["count"])))return failure(call,"error",copy.unavailable,"unrequested-summary-count");
  if(call.name==='get_patient_context'&&a['section']==='timeline'){
   const timelineText=requestText.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
   if(!a['reusePrevious']&&/\b(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|depuis|avant|apres|entre|hier|demain|aujourd.hui|semaine|mois|annee|ancien\w*|croissant\w*|chronologique)\b|\b(?:19|20)\d{2}\b|\b\d{1,2}[/-]\d{1,2}\b/u.test(timelineText))return failure(call,'unsupported',applicationReadCopy.timelineRestriction,'unsupported-timeline-restriction');
   if(a['beforeAt']!==undefined||a['beforeId']!==undefined)return failure(call,'unsupported',copy.unsupported,'unrequested-timeline-cursor');
   if(a['reusePrevious']){
    const previous=[...prior].reverse().find(r=>r.status==='partial'&&r.data&&typeof r.data==='object'&&'timelineNext' in r.data)?.data;
    const stored=z.object({timelineQuery:timelineQuerySchema,timelineNext:timelineCursorSchema}).safeParse(previous);
    if(!stored.success)return failure(call,'needs_input',copy.noContinuation,'timeline-cursor-unavailable');
    if(input.appContext.patientId&&input.appContext.patientId!==stored.data.timelineQuery.patientId)return failure(call,'needs_input',copy.patient,'timeline-patient-changed');
    Object.assign(a,stored.data.timelineQuery,stored.data.timelineNext);
   }
  }
  const result:AgentResult={callId:call.id,status:"ok",complete:true,text:"",evidence:[],conditionKeys:[]};
  if(call.name==="query_patients"){
   const parsed=agentSchemas.query_patients.parse(a),{partIds:_ids,reusePrevious,...spec}=parsed;
   // Follow-up retains the exact filter, time anchor and revision, never an unfiltered page.
   const previous=[...prior].reverse().find(r=>["ok","empty"].includes(r.status)&&r.data&&typeof r.data==="object"&&"patientQuery" in r.data)?.data as {patientQuery?:typeof spec;asOf?:string;revision?:string;offset?:number;rows?:unknown[]}|undefined;
   const implicitList=patientListContinuation(input.text)&&!!previous?.patientQuery;
   if(reusePrevious&&!previous?.patientQuery)return failure(call,"needs_input",copy.missing,"previous-query-unavailable");
   if((reusePrevious||implicitList)&&previous?.patientQuery){
    if(previous.patientQuery.mode==="metrics"&&(previous.patientQuery.metrics?.length??0)>1 )return failure(call,"needs_input",copy.missing,"ambiguous-metric");
    const mode=implicitList?"list":parsed.mode;
    const nextPage=mode==="list"&&previous.patientQuery.mode==="list"?(previous.offset??0)+(previous.rows?.length??0):0;
    const nextOffset=implicitList?nextPage:parsed.offset??nextPage;
    for(const key of Object.keys(spec))delete (spec as Record<string,unknown>)[key];
    Object.assign(spec,previous.patientQuery,{mode,offset:nextOffset,...(previous.revision?{revision:previous.revision}:{})});
    if(mode!=="metrics"){
      if(!previous.patientQuery.filterGroups)spec.filters=[...(previous.patientQuery.filters??[]),...(previous.patientQuery.mode==="metrics"?patientMetricConditions[previous.patientQuery.metrics![0]!]:[])];delete spec.metrics;
    }
    asOf=previous.asOf??asOf;
   }
   // Review of an agenda result is explicitly scoped to the returned patient references.
   if(parsed.mode==="review"&&!parsed.patientIds){
    const agenda=[...prior].reverse().find(r=>r.data&&typeof r.data==="object"&&"agendaPatientIds" in r.data)?.data as {agendaPatientIds:string[];hasMore:boolean;offset?:number}|undefined;
    if(!agenda||agenda.hasMore||(agenda.offset??0)!==0)return failure(call,"needs_input",recordsCopy.agendaCoverage,"agenda-coverage");
    spec.patientIds=agenda.agendaPatientIds; spec.filters=[...(spec.filters??[]).filter(condition=>condition.field!=="administrative_incomplete"),{field:"administrative_incomplete",op:"eq",value:true}];
   }
   const contract=patientQueryContract(requestText,asOf);
   if(!reusePrevious&&!implicitList){
    if(spec.population&&spec.population!==contract.population)return failure(call,'unsupported',copy.unsupported,'unrequested-patient-population');
    spec.population=contract.population;
    if(contract.unsupported.length)return failure(call,'unsupported',copy.unsupported,'unresolved-patient-constraint');
    if(contract.extended){
     if(spec.mode==='metrics'||spec.mode==='review')return failure(call,'unsupported',copy.unsupported,'compound-query-mode');
     delete spec.filters;delete spec.filterGroups;delete spec.consultationPeriod;delete spec.createdPeriod;
     if(contract.filterGroups.some(group=>group.length))spec.filterGroups=contract.filterGroups;
     if(contract.consultationPeriod)spec.consultationPeriod=contract.consultationPeriod;
     if(contract.createdPeriod)spec.createdPeriod=contract.createdPeriod;
    }else if(spec.filterGroups||spec.consultationPeriod||spec.createdPeriod)return failure(call,'unsupported',copy.unsupported,'unrequested-query-constraint');
   }
   const raw=await rpc("search_patients",{p_spec:JSON.stringify(spec),p_as_of:asOf},signal);
   const value=patientResult.parse(raw);
   if(spec.filterGroups||spec.consultationPeriod||spec.createdPeriod){
    for(const key of ['filterGroups','consultationPeriod','createdPeriod'] as const)if(!isDeepStrictEqual(value.appliedSpec?.[key],spec[key]))return failure(call,'unsupported',copy.unsupported,'query-constraint-not-applied');
   }
   if(spec.metrics?.some(metric=>value.metrics[metric]===undefined))throw new AgentReadError("malformed");
   if(value.rows.length>value.total||new Set(value.rows.map(r=>r.id)).size!==value.rows.length)throw new Error("InvalidResult");
   result.data={...value,patientQuery:spec,hasMore:spec.mode!=="count"&&spec.mode!=="metrics"&&value.offset+value.rows.length<value.total};
   result.conditionKeys=[...value.conditions.map(conditionKey),...(spec.metrics??[]).flatMap(m=>patientMetricConditions[m].map(conditionKey))];
   result.evidence=value.rows.map(p=>({id:p.id,type:"patient",label:`${p.first_name} ${p.last_name}`}));
   result.evidence.unshift({id:call.id,type:"query",label:recordsCopy.populations[spec.population??"active"]+" "+value.asOf,version:value.revision,provenance:{gate:"search_patients",asOf:value.asOf,total:value.total}});
   const labels:Record<string,string>={phone:recordsCopy.phone,identity_card:recordsCopy.id_document_number,birth_date:recordsCopy.birth_date,sex:recordsCopy.sex};
   const simpleActiveCount=spec.mode==="count"&&(spec.population??"active")==="active"&&!(spec.filters?.length)&&!spec.filterGroups&&!spec.consultationPeriod&&!spec.createdPeriod&&!spec.patientIds;
   result.text=spec.mode==="metrics"?Object.entries(value.metrics).map(([k,n])=>`${copy.metrics[k as keyof typeof copy.metrics]??k} : ${n}`).join("\n"):simpleActiveCount
    ?value.total===0?"Le cabinet ne compte aucun patient actif.":`Le cabinet compte ${new Intl.NumberFormat("fr-DZ").format(value.total)} patient${value.total===1?"":"s"} actif${value.total===1?"":"s"}.`
    :`${value.total} ${copy.count}`;
   const missingField=(spec.mode==='count'||spec.mode==='list')&&spec.filters?.length===1&&spec.filters[0]!.op==='missing'?spec.filters[0]!.field:null;
   const paragraphCount=spec.mode==='count'&&(missingField==='phone'||missingField==='identity_card');
   if(paragraphCount)result.text=missingPatientFieldParagraph(value.total,spec.population??'active',missingField);
   if(spec.mode==='list')result.text=patientListParagraph(value.total,value.rows.length,spec.population??'active',missingField==='phone'||missingField==='identity_card'?missingField:undefined);
   for(const p of value.rows)appendLinkedAnswerLine(result,`${p.first_name} ${p.last_name}`,`${p.outstanding_balance!==null?` — ${p.outstanding_balance} DZD`:""}${spec.mode==="review"?` — ${p.missing.map(f=>labels[f]).join(", ")}`:""}`,{kind:'patient',id:p.id});
   if(spec.mode==="review")result.text+=`\n${copy.fields}`;
   if(!paragraphCount&&!simpleActiveCount&&spec.mode!=="list")result.text+=`\n${recordsCopy.populations[spec.population??"active"]} ${copy.definition.replace(/^Actifs visibles ; |^المرضى النشطون المتاحون؛ /u,"")}`;
   if(spec.filters?.some(f=>f.field==="age"))result.text+=`\n${copy.unknownAge} : ${value.unknownAge}`;
   if(spec.mode==='list'&&value.rows.length)result.text+=`\n${patientListPageParagraph(value.offset+1,value.offset+value.rows.length,value.total,value.offset+value.rows.length<value.total)}`;
   if(!value.total)result.status="empty";
   return result;
  }
  if(call.name==="answer_general"){
   const question=String(a["question"]),normalize=(v:string)=>v.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu," ");
   if(!normalize(input.text+" "+(original??"")).includes(normalize(question))||!canAnswerGeneralAlexa(question))return failure(call,"unsupported",copy.generalRestricted,"general-question-not-admitted");
   const answer=await inferNativeGeneralAlexa(question,signal);
   if(!answer.ok)return failure(call,"error",copy.modelUnavailable,"general-"+answer.code);
   const provenance=answer.reference?{gate:"local_public_fact",provider:"local",sourceId:answer.reference.id,sourceUrl:answer.reference.sourceUrl,...(answer.reference.secondarySourceUrl?{secondarySourceUrl:answer.reference.secondarySourceUrl}:{})}:{gate:"local_model",provider:"local",model:answer.model};
   return {callId:call.id,status:"ok",complete:true,text:answer.text,data:{answer:answer.text},conditionKeys:[],evidence:[{id:call.id,type:"query",label:answer.reference?.label??copy.generalSource,provenance}]};
  }
  if(call.name==="query_app"&&a["view"]!=="message_draft"){
   if(a['view']==='reception'){
    if(a['reusePrevious']){
     const previous=[...prior].reverse().find(r=>r.status==='partial'&&r.data&&typeof r.data==='object'&&'applicationQuery' in r.data)?.data;
     const saved=z.object({applicationQuery:applicationQuerySchema,nextOffset:z.number().int().min(1).max(10000),revision:z.string().regex(/^[a-f0-9]{32}$/)}).safeParse(previous);
     if(!saved.success)return failure(call,'needs_input',copy.noContinuation,'reception-cursor-unavailable');
     Object.assign(a,saved.data.applicationQuery,{offset:saved.data.nextOffset,revision:saved.data.revision});
    }else{
     const period=patientQueryPeriod(requestText,asOf)??explicitAgentPeriod(requestText,asOf),day=period?.from.slice(0,10)??new Date(Date.parse(asOf)+3600000).toISOString().slice(0,10);
     if(!period&&/\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|semaine|mois|annee|depuis|avant|apres|entre|\d{4})\b/u.test(requestText.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()))return failure(call,'needs_input',copy.missing,'unresolved-reception-period');
     if(period&&Date.parse(period.to)-Date.parse(period.from)!==86400000)return failure(call,'unsupported',copy.unsupported,'reception-requires-single-day');
     const queue=/demandes?/iu.test(requestText)?'requests':/paiements?/iu.test(requestText)?'payments':/attente/iu.test(requestText)?'waiting':'all';
     if((a['day']!==undefined&&a['day']!==day)||(a['queue']!==undefined&&a['queue']!==queue))return failure(call,'needs_input',copy.missing,'reception-scope-mismatch');
     if(a['offset']!==undefined||a['revision']!==undefined)return failure(call,'unsupported',copy.unsupported,'unrequested-reception-cursor');
     a['day']=day;a['queue']=queue;
    }
   }

   if(a['view']==='medication_catalog'&&typeof a['query']==='string'&&!requestText.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().includes(a['query'].normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()))return failure(call,'unsupported',copy.unsupported,'unrequested-catalogue-query');
   return readApplication(call.id,String(a["view"]),(name,args,signal)=>rpc(name,args,signal,false,name==='search_medications'),signal,{asOf,...(typeof a["offset"]==='number'?{offset:a["offset"]}:{}),...(typeof a["revision"]==='string'?{revision:a["revision"]}:{}),...(typeof a['query']==='string'?{query:a['query']}:{}),...(typeof a['day']==='string'?{day:a['day']}:{}),...(typeof a['queue']==='string'?{queue:a['queue']}:{})});
  }
  let patientId:string|undefined;
  const humanMention=parsePatientMention(identityText),humanPatient=!!input.patientName||humanMention.status!=='none';
  const namedRecordScope=(humanPatient||requestsPatientScope(identityText))&&['query_consultations','query_documents','query_agenda','query_finance'].includes(call.name);
  if(call.name==='query_finance'&&namedRecordScope&&cabinetFinanceModes.some(mode=>mode===a['mode']))return failure(call,'unsupported',copy.unsupported,'CabinetOverviewCannotIgnoreNamedPatient');
  if(namedRecordScope||a["patientId"]||a["patientName"]||call.name==="get_patient_context"||(call.name==="prepare_action"&&a["action"]!=="send_internal_message")||(call.name==="query_app"&&a["view"]==="message_draft")||(call.name==="navigate"&&a["target"]==="patient")){
   const mention=parsePatientMention(identityText);
   if(mention.status==="ambiguous")return failure(call,"needs_input",copy.patient,"patient-ambiguous");
   const explicitName=mention.status==="named"?mention.name:input.patientName;
   const proposedName=explicitName??(typeof a["patientName"]==="string"?a["patientName"]:undefined);
   const normalize=(text:string)=>text.normalize("NFKD").replace(/\p{M}/gu,"").toLocaleLowerCase();
   if(proposedName&&!explicitName&&!normalize(input.text+" "+(original??"")).includes(normalize(proposedName)))return failure(call,"needs_input",copy.patient,"patient-reference-not-supplied");
   const candidates=prior.flatMap(r=>r.data&&typeof r.data==="object"&&"candidates" in r.data?z.array(z.object({patientId:z.uuid(),label:z.string()})).safeParse(r.data.candidates).data??[]:[]);
   const selected=resolveListedReference(input.text,candidates);
   const proposedId=selected??(typeof a["patientId"]==="string"?a["patientId"]:input.appContext.patientId??undefined);
   const known=proposedId&&(proposedId===input.appContext.patientId||proposedId===selected||input.text.includes(proposedId)||prior.some(r=>r.patientId===proposedId||r.evidence.some(e=>e.type==="patient"&&e.id===proposedId)));
   if(!proposedName&&proposedId&&!known)return failure(call,"needs_input",copy.patient,"patient-reference-not-verified");
   let resolutionFailure:AgentReadError|undefined;
   const resolutionDb:Pick<DbPort,"rpc">={rpc:async<T>(name:string,args:RpcArgs)=>{
    try{const response=await db.rpc<T>(name,args);if(!response.ok)resolutionFailure=new AgentReadError(response.error.technical==="42501"?"permission":response.error.technical==="57014"?"timeout":response.error.technical==="40001"?"changed":"database");return response;}
    catch(error){resolutionFailure=new AgentReadError("database");throw error;}
   }};
   const resolved=await resolvePatient(resolutionDb,proposedName?{name:proposedName}:proposedId?{patientId:proposedId}:{},signal,asOf);
   signal.throwIfAborted();if(resolutionFailure)throw resolutionFailure;
   if(resolved.status!=="resolved"){
    const missing=failure(call,"needs_input",copy.patient,"patient-unresolved");
    if(resolved.status==="ambiguous") {missing.text+="\n"+resolved.candidates.map(p=>p.label).join("\n");missing.data={candidates:resolved.candidates};}
    return missing;
   }
   patientId=resolved.patientId; result.patientId=patientId;
  }
  if(call.name==="query_app"&&a["view"]==="message_draft")return readMessageDraft(call.id,patientId!,String(a["motif"]),asOf,rpc,signal);
  if(call.name==="get_patient_context"){
   if(a['section']==='timeline'){
    const schema=z.array(z.object({occurred_at:z.string(),event_id:z.string().max(200),event_type:z.string(),label_key:z.string(),practitioner_name:z.string().nullable(),detail:z.record(z.string(),z.unknown())})).max(21);
    const limit=typeof a['count']==='number'?a['count']:20;
    const rows=schema.parse(await rpc('list_patient_timeline',{p_id:patientId!,p_before_at:typeof a['beforeAt']==='string'?a['beforeAt']:null,p_before_id:typeof a['beforeId']==='string'?a['beforeId']:null,p_limit:limit+1},signal,false,true));
    const page=rows.slice(0,limit),more=rows.length>limit,last=page.at(-1);
    result.data={rows:page,hasMore:more,timelineQuery:{patientId:patientId!,count:limit},...(more&&last?{timelineNext:{beforeAt:last.occurred_at,beforeId:last.event_id}}:{})};
    result.evidence=[patientSource(patientId!),{id:call.id,type:'query',label:applicationReadCopy.extended.timeline,provenance:{gate:'list_patient_timeline',patientId:patientId!}}];
    result.text=page.map(row=>`${new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Algiers'}).format(new Date(row.occurred_at))} — ${applicationReadCopy.extended.events[row.event_type]??applicationReadCopy.extended.timeline}`).join('\n')||applicationReadCopy.extended.empty;
    if(more)result.text+='\n'+applicationReadCopy.extended.timelineLimit;
    result.complete=!more;result.status=more?'partial':page.length?'ok':'empty';return result;
   }
   if(a["section"]==="notes"){
    const {partIds:_parts,patientName:_name,patientId:_patient,count:_count,section:_section,reusePrevious,...query}=agentSchemas.get_patient_context.parse(a);
    let spec=noteReadQuerySchema.parse({...query,patientId});
    const previous=[...prior].reverse().find(r=>r.data&&typeof r.data==="object"&&"noteQuery" in r.data&&"next" in r.data&&r.data.next)?.data as {noteQuery?:unknown;next?:unknown;revision?:string;asOf?:string}|undefined;
    if(reusePrevious||noteContinuation(input.text)){
     if(!previous?.noteQuery||!previous.next)return failure(call,"needs_input",copy.noContinuation,"note-continuation-unavailable");
     const saved=noteReadQuerySchema.parse(previous.noteQuery);if(saved.patientId!==patientId)throw new AgentReadError("permission");
     spec=noteReadQuerySchema.parse({...saved,...noteCursorSchema.parse(previous.next),revision:previous.revision});asOf=z.iso.datetime({offset:true}).parse(previous.asOf);
    }
    if(spec.consultationId&&!input.text.includes(spec.consultationId)&&!input.appContext.page.includes(spec.consultationId)&&!prior.some(r=>r.evidence.some(e=>e.type==="consultation"&&e.id===spec.consultationId)))return failure(call,"needs_input",copy.missing,"consultation-reference-not-verified");
    const requested=requestText.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
    if(spec.area==='structured'&&!spec.from&&!spec.to&&!spec.consultationId&&frenchRequestAdmission(requestText,false).unboundedPeriod===true&&/\bmesures\b[^.!?]*\bevolu\w*/u.test(requested)){
     const context=await buildClinicalContext(db,{patientId:patientId!},{count:100,all:true},signal);
     const visits=[...new Map([...context.consultations,...(context.currentConsultation?[context.currentConsultation]:[])].map(v=>[v.id,v])).values()].sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.id.localeCompare(b.id));
     const date=(at:string)=>new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Algiers'}).format(new Date(at));
     const lines=visits.slice(1).flatMap((v,index)=>{const before=visits[index]!,changes=measureChanges(before.sessionDetails,v.sessionDetails);return changes.length?[narrativeCopy.comparisonDates(date(before.startedAt),date(v.startedAt))+' '+changes.map(c=>narrativeCopy.measureChange(narrativeCopy.measureLabels[c.key],c.previous,c.current,c.delta)).join(' ')]:[];});
     const complete=context.coverage.complete&&visits.length>1&&visits.every(v=>v.sessionDetails&&Object.values(v.sessionDetails.mesures).every(value=>value!==null));
     return {...result,status:complete?'ok':'partial',complete,text:lines.length?narrativeCopy.measuresHistory(visits.length)+' '+lines.join(' '):narrativeCopy.comparisonMissing,
      evidence:[patientSource(patientId!),{id:call.id,type:'query',label:copy.clinicalRead,version:context.sourceRevision,provenance:{gate:'get_alexa_clinical_context',section:'sessionDetails',consultations:visits.length}},...visits.map(v=>({id:v.id,type:'consultation' as const,label:date(v.startedAt)}))],
      data:{patientId,sourceRevision:context.sourceRevision,coverage:context.coverage,measureEvolution:visits.map(v=>({consultationId:v.id,startedAt:v.startedAt,sessionDetails:v.sessionDetails??null}))}};
    }
    const olderDifficulty=/\bdifficulte\w*\b[^.!?]*\bune ancienne consultation\b/u.test(requested),followUp=spec.area==='plan'&&/\b(?:suivi|suite)(?:\s+\w+){0,2}\s+prevu\w*\b/u.test(requested);
    if(!spec.consultationId&&!spec.from&&!spec.to&&(olderDifficulty||followUp)){
     const context=await buildClinicalContext(db,{patientId:patientId!},{count:2},signal);
     const visits=[...context.consultations,...(context.currentConsultation?[context.currentConsultation]:[])].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)||b.id.localeCompare(a.id));
     const selected=visits[olderDifficulty?1:0];
     if(!selected)return {...result,status:'empty',complete:true,text:narrativeCopy.olderSessionMissing,evidence:[patientSource(patientId!),{id:call.id,type:'query',label:copy.clinicalRead,version:context.sourceRevision,provenance:{gate:'get_alexa_clinical_context'}}]};
     spec={...spec,consultationId:selected.id};
    }
    const page=await notePageResult(await rpc("query_alexa_note_sections",{p_spec:JSON.stringify(spec),p_as_of:asOf},signal),call.id,spec,asOf,requestText);
    page.evidence.unshift(patientSource(patientId!));return page;
   }
   if(a["section"]==="profile"){
    const row=await rpc("get_patient",{p_id:patientId!},signal);
    const p=patientProfileSchema.parse(row);
    result.data=p;result.text=profileAnswer(p,requestText,asOf);
    result.evidence=[{id:p.id,type:"patient",label:`${p.first_name} ${p.last_name}`}];return result;
   }
   const section=typeof a["section"]==="string"?a["section"]:"history",rangedSummary=section==="summary"&&typeof a["from"]==="string"&&typeof a["to"]==="string";
   const authorizedContext=await buildClinicalContext(db,{patientId:patientId!},{count:typeof a["count"]==="number"?a["count"]:section==="summary"?100:5,all:section==='summary'&&!rangedSummary&&!requestedCounts.includes(Number(a['count'])),...(rangedSummary?{from:a["from"] as string,to:a["to"] as string}:{})},signal);
   // These complete recorded arrays are already authorized by the clinical gate. This projection changes no permissions.
   const {currentConsultation:_currentConsultation,...withoutCurrent}=authorizedContext;
   const context:ClinicalContext=rangedSummary?{...withoutCurrent,diagnoses:[],scales:[],treatments:{current:[],history:[],historyComplete:true}}:{...authorizedContext,diagnoses:authorizedContext.diagnoses.filter(d=>(a['diagnosisState']!=='active'||d.resolvedAt===null)&&(a['diagnosisState']!=='resolved'||d.resolvedAt!==null)&&(a['diagnosisRole']!=='primary'||d.primary)&&(a['diagnosisRole']!=='secondary'||!d.primary)),treatments:{...authorizedContext.treatments,current:authorizedContext.treatments.current.filter(t=>!a['treatmentState']||a['treatmentState']==='all'||t.status===a['treatmentState'])}};
   if(a['treatmentState']&&a['treatmentState']!=='all'){const ids=new Set(context.treatments.current.map(t=>t.id));context.treatments.history=context.treatments.history.filter(h=>ids.has(h.treatmentId));}
   const intent=section==="treatments"?"treatments":section==="diagnoses"?"diagnoses":section==="scales"?"scales":section==="current"?"current_consultation":"history";
   const intents=section==="summary"?["diagnoses","treatments","scales","current_consultation","history"] as const:[intent] as const;
   const sentences=intents.flatMap(selected=>localResponse(context,{intent:selected,count:context.consultations.length||1,language},[]));
   if(section==='treatments'&&/\b(?:chang\w*|modifi\w*|historique)\b/u.test(requestText.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase())){
    const histories=context.treatments.history.length?context.treatments.history.map(h=>[h]):[[]];
    for(const history of histories)sentences.push(...localResponse({...context,treatments:{...context.treatments,history}},{intent:'treatment_changes',count:1,language},[]));
   }
   const common={patientId:context.patientId,sourceRevision:context.sourceRevision};
   result.data=section==="summary"?{...common,summary:{diagnoses:context.diagnoses,treatments:context.treatments,scales:context.scales,currentConsultation:context.currentConsultation??null,consultations:context.consultations,coverage:context.coverage}}:section==="diagnoses"?{...common,diagnoses:context.diagnoses}:section==="scales"?{...common,scales:context.scales}:section==="treatments"?{...common,treatments:context.treatments}:section==="current"?{...common,currentConsultation:context.currentConsultation??null}:{...common,consultations:context.consultations,coverage:context.coverage};
   const evidence=new Map(sentences.flatMap(s=>s.sources).map(source=>[JSON.stringify([source.type,source.id,source.version]),source]));
   result.evidence=[patientSource(patientId!),{id:call.id,type:"query",label:copy.clinicalRead,version:context.sourceRevision,provenance:{gate:"get_alexa_clinical_context",section,...(typeof a['diagnosisState']==='string'?{diagnosisState:a['diagnosisState']}:{}),...(typeof a['diagnosisRole']==='string'?{diagnosisRole:a['diagnosisRole']}:{}),...(typeof a['treatmentState']==='string'?{treatmentState:a['treatmentState']}:{})}},...evidence.values()];
   result.text=sentences.map(s=>s.text).join("\n");
   let summaryComplete=false;
   if(section === "summary") {
    if(rangedSummary&&typeof a["count"]==="number"&&context.coverage.complete&&context.consultations.length!==a["count"]){
     result.text=`La période contient ${context.consultations.length} consultations terminées, alors que la demande en indique ${a["count"]}. Je ne peux pas confirmer qu’il s’agit du même ensemble.`;
     result.status="partial";result.complete=false;result.error={code:"requested-period-count-mismatch",retryable:false};return result;
    }
    const normalizedRequest=requestText.normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase();
    const recurringThemeRequest=/\b(?:theme|motif|element) recurrent\b/u.test(normalizedRequest);
    const narrative = (recurringThemeRequest ? extractRecurringClinicalTheme(context) : null)
      ?? (rangedSummary?await summarizeClinicalConsultations(context,signal):!requestedCounts.includes(Number(a["count"]))?await summarizeClinicalCaseContext(context,signal):await summarizeClinicalContext(context,signal,false));
    summaryComplete=narrative.complete;
    if (!narrative.generated && narrative.complete) return {...result,status:"empty",complete:true,text:narrative.text};
    if (!narrative.generated) return {...result,status:"error",complete:false,text:narrative.text,error:{code:"clinical-synthesis-unavailable",retryable:false}};
    result.text = narrative.text + (narrative.method === "source_selection" ? " " + narrativeCopy.selected : "") + (narrative.complete ? "" : " " + narrativeCopy.limited);
    const latest = context.consultations[0];
    if (latest && !rangedSummary && narrative.method !== "structured" && !/\b(?:date|quand|exact)\b/iu.test(input.text)) result.text += " " + narrativeCopy.lastVisit(relativeClinicalDate(latest.startedAt, asOf));
    result.presentation = "inference";
    if (!narrative.complete) { result.complete=false; result.status="partial"; return result; }
   }
   result.complete=section==="summary"?(rangedSummary?summaryComplete:["history","treatments","current"].every(selected=>clinicalSectionComplete(context,selected))):clinicalSectionComplete(context,section);result.status=result.complete?"ok":"partial";return result;
  }
  if(call.name==="navigate"){
   const target=a["target"] as "patient"|"agenda"|"patients"|"dashboard"|"documents"|"finances"|"parametres"|"jarvis";
   result.navigation=target==="patient"?{target,patientId:patientId!}:{target};result.text=copy.navigationReady;return result;
  }
  if(call.name==="search_knowledge"){
   const sourceQuestion=original??input.text,sourceParts=frenchRequestedOutputs(sourceQuestion);
   const medicalQuestion=requestedGoal&&sourceParts?.includes(requestedGoal)?requestedGoal:sourceQuestion;
   if(/\bstahl\b/iu.test(medicalQuestion))return failure(call,'unsupported',knowledgeSynthesisCopy.fr.unfinishedStahl,'unfinished-knowledge-source');
   const required=planKnowledgeQuery(medicalQuestion),proposed=planKnowledgeQuery(String(a['query']));
   if(!required||!proposed)return failure(call,'unsupported',knowledgeSynthesisCopy.fr.unsupportedSource,'unresolved-knowledge-source');
   if(proposed.sourceTitle&&proposed.sourceTitle!==required.sourceTitle)return failure(call,'unsupported',knowledgeSynthesisCopy.fr.unsupportedSource,'unrequested-knowledge-source');
   const retrieval=required.sourceTitle&&!proposed.sourceTitle?(required.language==='fr'?'DSM-5 ':'Taylor ')+String(a['query']):String(a['query']);
   if(retrieval.length>500)return failure(call,'needs_input',copy.missing,'knowledge-query-budget');
   const found=await readKnowledge(knowledge,retrieval,signal);
   result.complete=found.etat==="ok";result.status=found.etat==="panne"?"error":found.etat==="sans-preuve"?"empty":found.etat==="faible"?"partial":"ok";
   result.data=found;result.evidence=found.preuves.map(p=>knowledgeSource(p));
   let synthesisComplete=false;
   const events=await synthesizeKnowledge(found,medicalQuestion,'fr',signal,{compact:true,onCoverage:coverage=>{synthesisComplete=coverage==='supported';}});
   const sentences=events.filter((e):e is Extract<import('@/shared/alexa/turn').AlexaEvent,{type:'sentence'}>=>e.type==='sentence');
   result.text=sentences.map(e=>e.text).join(' ');result.evidence=sentences.flatMap(e=>e.sources);
   const generated=sentences.some(e=>e.kind==='inference');
   if(generated){result.presentation='inference';result.complete=result.complete&&synthesisComplete;result.status=result.complete?'ok':'partial';}
   else if(found.etat==='ok'){result.complete=false;result.status='partial';}
   return result;
  }
  if(call.name==="prepare_action"){
   const {action,...slots}=agentSchemas.prepare_action.parse(a); const args:AlexaProposal["args"]={};
   if(action==="create_appointment") {if(!slots.startsAt||!slots.durationMinutes)return failure(call,"needs_input",copy.date,"slots");Object.assign(args,{patientId:patientId!,startsAt:slots.startsAt,durationMinutes:slots.durationMinutes});}
   else if(action==="create_editable_document_draft") {
    if(!slots.documentType)return failure(call,"needs_input",copy.type,"slots");
    const resolved=await resolveDocumentDraftInputs(db,patientId!,slots.documentType,input.text,input.appContext.page,signal);
    if(resolved.state==="missing")return failure(call,"needs_input",resolved.question,"document-field");
    if(resolved.state==="unavailable")return failure(call,"error",copy.unavailable,"document-inputs-unavailable");
    Object.assign(args,{patientId:patientId!,documentType:resolved.kind,variables:JSON.stringify(resolved.variables),content:JSON.stringify(resolved.content)});
   }
   else if(action==="send_internal_message") {
    if(!slots.body)return failure(call,"needs_input",alexaActions.internalMessageMissing,"slots");
    let guardPatient:{first_name:string;last_name:string;record_number:string|null;id_document_number:string|null}|null=null;
    if(patientId){const p=z.object({first_name:z.string().min(1),last_name:z.string().min(1),record_number:z.string().nullable().optional(),id_document_number:z.string().nullable().optional()}).parse(await rpc("get_patient",{p_id:patientId},signal));guardPatient={first_name:p.first_name,last_name:p.last_name,record_number:p.record_number??null,id_document_number:p.id_document_number??null};}
    const message=prepareInternalMessage(slots.body,{firstName:guardPatient?.first_name??"",lastName:guardPatient?.last_name??"",recordNumber:guardPatient?.record_number??null,idDocumentNumber:guardPatient?.id_document_number??null});
    if(!message.ok)return failure(call,"unsupported",alexaActions.internalMessageRestricted,"internal-message-"+message.reason);
    Object.assign(args,{clientMsgId:randomUUID(),body:message.body});
   }
   else if(["reschedule_appointment","cancel_appointment","mark_patient_arrived"].includes(action)){
    if(!slots.appointmentId)return failure(call,"needs_input",copy.missing,"slots");
    const p=z.object({id:z.uuid(),patient_id:z.uuid()}).parse(await rpc("get_appointment",{p_id:slots.appointmentId},signal));
    if(p.patient_id!==patientId)throw new Error("ScopeChanged"); args["appointmentId"]=p.id;
    if(action==="reschedule_appointment"){if(!slots.startsAt)return failure(call,"needs_input",copy.date,"slots");args["nouveauDebut"]=slots.startsAt;if(slots.durationMinutes)args["nouvelleDureeMinutes"]=slots.durationMinutes;}
    if(action==="cancel_appointment"){if(!slots.reason)return failure(call,"needs_input",copy.missing,"slots");args["motif"]=slots.reason;}
   }else if(action==="close_consultation"){
    if(!slots.consultationId)return failure(call,"needs_input",copy.missing,"slots");
    const c=z.object({id:z.uuid(),patient_id:z.uuid(),status:z.string()}).parse(await rpc("get_consultation",{p_id:slots.consultationId},signal));
    if(c.patient_id!==patientId)throw new Error("ScopeChanged");args["consultationId"]=c.id;
   }else{
    if(!slots.consultationId)return failure(call,"needs_input",copy.missing,"slots");
    const c=z.object({id:z.uuid(),patient_id:z.uuid()}).parse(await rpc("get_consultation",{p_id:slots.consultationId},signal));
    if(c.patient_id!==patientId)throw new Error("ScopeChanged");args["consultationId"]=c.id;
    if(action==="set_consultation_price"){if(slots.amountDzd===undefined)return failure(call,"needs_input",copy.missing,"slots");args["amountDzd"]=slots.amountDzd;}
    else{const p=z.object({payment_id:z.uuid()}).parse(await rpc("get_consultation_payment",{p_consultation_id:c.id},signal));if(slots.paymentId&&slots.paymentId!==p.payment_id)throw new Error("ScopeChanged");args["paymentId"]=p.payment_id;}
   }
   result.proposal={tool:action,args,actionId:input.clientTurnId};if(patientId)result.patientId=patientId;result.text=copy.confirmation;return result;
  }
  if(call.name==="query_consultations"&&a["view"]){
   const spec=agentSchemas.query_consultations.parse(a);
   if(spec.reusePrevious){
    const saved=[...prior].reverse().find(r=>r.data&&typeof r.data==="object"&&"consultationQuery" in r.data&&"nextTextOffset" in r.data&&typeof r.data.nextTextOffset==="number")?.data as {consultationQuery?:unknown;asOf?:string;nextTextOffset?:number;revision?:string}|undefined;
    if(!saved||saved.nextTextOffset===undefined)return failure(call,"needs_input",copy.missing,"analysis-continuation-unavailable");
    const query=agentSchemas.query_consultations.parse({...saved.consultationQuery as object,partIds:["continuation"]});
    if(query.view!=="analysis"||!query.consultationId)throw new AgentReadError("malformed");
    Object.assign(spec,query,{textOffset:saved.nextTextOffset,revision:saved.revision});asOf=z.iso.datetime({offset:true}).parse(saved.asOf);
   }
   if(!spec.consultationId)return failure(call,"needs_input",copy.missing,"consultation-reference-not-verified");
   const id=spec.consultationId;
   if(!input.text.includes(id)&&!input.appContext.page.includes(id)&&!prior.some(r=>r.evidence.some(e=>e.type==="consultation"&&e.id===id)))return failure(call,"needs_input",copy.missing,"consultation-reference-not-verified");
   const result=await readConsultation(call.id,id,spec.view!,patientId??input.appContext.patientId??undefined,spec.textOffset??0,spec.revision,rpc,signal);
   if(result.data&&typeof result.data==="object")result.data={...result.data,asOf};return result;
  }
  if(call.name==='query_agenda'&&patientId&&!a['appointmentId']&&!a['from']&&!a['to']&&!a['period']&&/\bprochain rendez[- ]vous\b/u.test(requestText.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase())&&!/\b(?:demain|aujourd.hui|hier|avant|apres|depuis|entre|pendant|semaine|mois|annee)\b|\d{1,2}[-/]\d{1,2}|\b(?:19|20)\d{2}\b/u.test(requestText.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase())){
   const workspace=z.object({identite:z.object({id:z.uuid()}),agenda:z.object({prochain_rendez_vous:z.object({id:z.uuid()}).nullable()})}).parse(await rpc('get_patient_workspace',{p_id:patientId},signal));
   if(workspace.identite.id!==patientId)throw new AgentReadError('permission');
   const source:AlexaSource={id:call.id,type:'query',label:copy.clinicalRead,provenance:{gate:'get_patient_workspace',field:'agenda.prochain_rendez_vous'}};
   if(!workspace.agenda.prochain_rendez_vous)return {...result,status:'empty',complete:true,text:narrativeCopy.nextAppointmentMissing,evidence:[patientSource(patientId),source],data:{patientId,nextAppointment:null}};
   const upcoming=await readAppointment(call.id,workspace.agenda.prochain_rendez_vous.id,patientId,rpc,signal);upcoming.evidence.push(source);return upcoming;
  }
  if(call.name==="query_agenda"&&typeof a["appointmentId"]==="string"){
   const id=a["appointmentId"];if(!input.text.includes(id)&&!prior.some(r=>r.evidence.some(e=>e.type==="appointment"&&e.id===id)))return failure(call,"needs_input",copy.missing,"appointment-reference-not-verified");
   return readAppointment(call.id,id,patientId,rpc,signal);
  }
  if(["query_agenda","query_consultations","query_finance","query_documents"].includes(call.name)){
   const {partIds:_parts,patientName:_name,patientId:_patient,...spec}=a;
   const absolutePeriod=patientQueryPeriod(requestText,asOf);
   if(absolutePeriod&&!spec['reusePrevious']&&!spec['consultationId']&&!spec['documentId']&&!spec['draftId']){
    if((typeof spec['from']==='string'&&Date.parse(spec['from'])!==Date.parse(absolutePeriod.from))||(typeof spec['to']==='string'&&Date.parse(spec['to'])!==Date.parse(absolutePeriod.to)))return failure(call,'needs_input',recordsCopy.periodConflict,'requested-period-mismatch');
    spec['from']=absolutePeriod.from;spec['to']=absolutePeriod.to;delete spec['period'];
   }
   if(call.name==='query_consultations'){
    const closure=/\bdate (?:de )?(?:cloture|fin)\b/u.test(requestText.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase());
    if(spec['dateAxis']==='ended_at'&&!closure)return failure(call,'needs_input',recordsCopy.periodConflict,'unrequested-date-axis');
    if(closure)spec['dateAxis']='ended_at';
   }
   if(call.name==='query_finance'&&spec['reusePrevious']){
    const saved=[...prior].reverse().find(r=>r.data&&typeof r.data==='object'&&'financeQuery' in r.data&&'nextOffset' in r.data)?.data as {financeQuery?:unknown;nextOffset?:number;revision?:string;asOf?:string}|undefined;
    if(!saved||saved.nextOffset===undefined)return failure(call,'needs_input',copy.noContinuation,'finance-continuation-unavailable');
    const query=agentSchemas.query_finance.parse({...saved.financeQuery as object,partIds:['continuation'],offset:saved.nextOffset,revision:saved.revision});
    if(query.mode!=='calendar'||!query.from||!query.to||!saved.asOf||!saved.revision)throw new AgentReadError('malformed');
    for(const key of Object.keys(spec))delete spec[key];
    Object.assign(spec,{mode:query.mode,from:query.from,to:query.to,offset:query.offset,revision:query.revision});asOf=z.iso.datetime({offset:true}).parse(saved.asOf);
   }
   if(call.name==='query_documents'&&spec['reusePrevious']){
    const saved=[...prior].reverse().find(r=>r.data&&typeof r.data==='object'&&'documentQuery' in r.data&&'nextTextOffset' in r.data)?.data as {documentQuery?:unknown;nextTextOffset?:number;revision?:string;asOf?:string}|undefined;
    if(!saved||saved.nextTextOffset===undefined)return failure(call,'needs_input',copy.noContinuation,'document-continuation-unavailable');
    const query=agentSchemas.query_documents.parse({...saved.documentQuery as object,partIds:['continuation'],textOffset:saved.nextTextOffset,revision:saved.revision});
    if(!(query.documentId||query.draftId)||!saved.asOf||!saved.revision)throw new AgentReadError('malformed');
    for(const key of Object.keys(spec))delete spec[key];
    const {partIds:_ids,...savedSpec}=query;Object.assign(spec,savedSpec);asOf=z.iso.datetime({offset:true}).parse(saved.asOf);
   }
   const textOffset=typeof spec['textOffset']==='number'?spec['textOffset']:0,documentRevision=typeof spec['revision']==='string'?spec['revision']:undefined;
   if(call.name==='query_documents')for(const key of ['textOffset','revision','reusePrevious'])delete spec[key];
   const documentId=typeof spec['draftId']==='string'?spec['draftId']:typeof spec['documentId']==='string'?spec['documentId']:undefined;
   if(documentId&&!input.text.includes(documentId)&&!prior.some(r=>r.evidence.some(e=>e.type==='document'&&(e.id===documentId||e.provenance?.['draftId']===documentId))))return failure(call,'needs_input',copy.missing,'document-reference-not-verified');
   if(spec['draftId'])spec['status']='draft';
   if(patientId)spec["patientId"]=patientId;
   if((!!spec["from"])!==(!!spec["to"]))return failure(call,"needs_input",copy.date,"period");
   if(typeof spec["period"]==="string"){
    const period=resolveAgentPeriod(spec["period"],asOf);
    if(!period||!["jour","plage"].includes(period.type))return failure(call,"needs_input",copy.date,"period");
    const first=period.type==="jour"?period.jour:period.type==="plage"?period.du:"";
    const last=period.type==="jour"?period.jour:period.type==="plage"?period.au:"";
    const next=new Date(`${last}T12:00:00Z`);next.setUTCDate(next.getUTCDate()+1);
    const from=`${first}T00:00:00+01:00`,to=`${next.toISOString().slice(0,10)}T00:00:00+01:00`;
    if(typeof spec["from"]==="string"&&typeof spec["to"]==="string"&&(Date.parse(spec["from"])!==Date.parse(from)||Date.parse(spec["to"])!==Date.parse(to)))return failure(call,"needs_input",recordsCopy.periodConflict,"period-conflict");
    spec["from"]=from;spec["to"]=to;
   }
   delete spec["period"];
   const requestedPeriod=explicitAgentPeriod(input.text,asOf);
   const groundedDomain=call.name==='query_agenda'||(call.name==='query_finance'&&frenchRequestAdmission(input.text,false).tools?.includes('query_finance'));
   if(requestedPeriod&&groundedDomain&&typeof spec['from']==='string'&&typeof spec['to']==='string'&&(Date.parse(spec['from'])!==Date.parse(requestedPeriod.from)||Date.parse(spec['to'])!==Date.parse(requestedPeriod.to)))return failure(call,'needs_input',recordsCopy.periodConflict,'requested-period-mismatch');
   if((!!spec["from"])!==(!!spec["to"]))return failure(call,"needs_input",copy.date,"period");
   if(call.name==="query_agenda"&&!spec["from"])return failure(call,"needs_input",copy.date,"period");
   if(call.name==="query_finance"&&cabinetFinanceModes.some(mode=>mode===spec["mode"])){
    if(typeof spec["from"]!=="string"||typeof spec["to"]!=="string")return failure(call,"needs_input",copy.date,"period");
    const value=await readFinanceView(call.id,String(spec["mode"]),spec["from"],spec["to"],typeof spec["offset"]==="number"?spec["offset"]:0,(name,args,signal)=>rpc(name,args,signal,true),signal,typeof spec['revision']==='string'?spec['revision']:undefined);
    if(spec['mode']==='calendar'&&value.data&&typeof value.data==='object')value.data={...value.data,financeQuery:{mode:'calendar',from:spec['from'],to:spec['to']},asOf};return value;
   }
   const value=recordResult.parse(await rpc("query_alexa_records",{p_domain:call.name.slice(6),p_spec:JSON.stringify(spec),p_as_of:asOf},signal));
   if(agendaFirst&&(value.offset!==0||(value.total>0?value.rows.length===0:value.rows.length!==0)))throw new AgentReadError('malformed');
   const visibleRows=agendaFirst?value.rows.slice(0,1):value.rows;
   result.data={...value,...(call.name==="query_agenda"?{rows:visibleRows,agendaPatientIds:[...new Set(visibleRows.flatMap(r=>r.patientId?[r.patientId]:[]))],hasMore:!agendaFirst&&value.offset+value.rows.length<value.total}:{})};
   result.evidence=visibleRows.map((r):AlexaSource=>({id:call.name==="query_finance"&&r.patientId?r.patientId:r.id,type:call.name==="query_agenda"?"appointment":call.name==="query_documents"?"document":call.name==="query_finance"?"patient":"consultation",label:r.label,...(r.status==="draft"?{provenance:{draftId:r.id}}:call.name==="query_finance"?{provenance:{paymentId:r.id}}:{})}));
   const agendaCount=call.name==='query_agenda'&&requestedCountRead(requestText);
   if(agendaCount)result.evidence=[];
   if(call.name==='query_agenda'){
    result.text=agendaCount?frenchAgendaCopy.countOnly(value.total,!!patientId):agendaFirst&&value.total?frenchAgendaCopy.first:frenchAgendaCopy.count(value.total);
    if(!agendaCount)for(const r of visibleRows){
     const when=r.at?frenchAgendaCopy.when(relativeClinicalDate(r.at,asOf),new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Algiers',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(r.at))):'';
     const name=label(r.label),row=frenchAgendaCopy.row(name,when,label(r.status));
     appendLinkedAnswerLine(result,name,row.slice(name.length),r.patientId?{kind:'patient',id:r.patientId}:undefined);
    }
   }else{
    result.text=call.name==='query_consultations'&&spec['mode']==='count'?applicationReadCopy.consultationCount(value.total,spec['status'],!!patientId):`${value.total} ${recordsCopy.count}`;
    for(const r of value.rows)appendLinkedAnswerLine(result,label(r.label),` — ${r.at?new Date(r.at).toLocaleString(language==="fr"?"fr-DZ":"ar-DZ",{timeZone:"Africa/Algiers"}):""} — ${label(r.status)}${r.amount!==null?` — ${r.amount} DZD`:""}`,call.name==='query_documents'?{kind:r.status==='draft'?'draft':'document',id:r.id}:call.name==='query_consultations'?{kind:'consultation',id:r.id}:r.patientId?{kind:'patient',id:r.patientId}:undefined);
   }
   result.evidence.unshift({id:call.id,type:"query",label:recordsCopy.count+" : "+value.total,provenance:{gate:"query_alexa_records",domain:call.name.slice(6),asOf}});
   if(Object.keys(value.totals).length)result.text+="\n"+Object.entries(value.totals).map(([k,n])=>`${label(k)} : ${n}`).join("\n");
   if(call.name==="query_finance"&&(spec["from"]||spec["to"]))result.text+="\n"+(spec["state"]==="collected"?recordsCopy.dateCollected:recordsCopy.dateCreated);
   if(!agendaCount&&!agendaFirst&&!['count','totals'].includes(String(spec['mode']))&&value.rows.length&&value.offset+value.rows.length<value.total)result.text+=`\n${value.offset+1}–${value.offset+value.rows.length} / ${value.total}`;
   result.status=value.total?"ok":"empty";
   if(call.name==='query_documents'&&documentId&&value.rows.some(r=>r.id===documentId)){
    let text:string,sourceRevision:string|number;
    if(spec['draftId']){
     const draft=z.object({id:z.uuid(),patientId:z.uuid(),content:z.unknown(),revision:count}).parse(await rpc('get_editable_document_draft',{p_id:documentId},signal));
     if(draft.id!==documentId||(spec['patientId']&&draft.patientId!==spec['patientId']))throw new AgentReadError('permission');
     text=documentText(draft.content);sourceRevision=draft.revision;
    }else{
     const doc=z.object({document_id:z.uuid(),patient_id:z.uuid(),rendered_html:z.string().max(200000).nullable().optional()}).parse(await rpc('get_document',{p_id:documentId},signal));
     if(doc.document_id!==documentId||(spec['patientId']&&doc.patient_id!==spec['patientId']))throw new AgentReadError('permission');
     text=issuedDocumentText(doc.rendered_html??'');sourceRevision=doc.rendered_html??'';
    }
    if(!text)return failure(call,'unsupported',copy.unsupported,'document-content-unavailable');
    const page=documentPage(documentId,text,sourceRevision,spec,textOffset,documentRevision);
    result.data={...value,...page,asOf};result.text+='\n« '+page.document.excerpt+' »\n'+page.coverage;result.complete=page.complete;
    result.evidence=result.evidence.map(e=>e.type==='document'?{...e,version:page.revision}:e);
    if(!result.complete)result.status='partial';
   }
   return result;
  }
  return failure(call,"unsupported",copy.unsupported,"unsupported");
 };
}
