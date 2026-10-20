import {semanticRequestSchema,sourcePlanSchema,buildSourcePlan,type SemanticRequest} from "@/shared/alexa/semantic-request";
import type {RequestPlan,WorkingReference} from "./request-plan";
import {inferLocalSemantic,localSemanticQualified} from "./local-model";
import { agendaSelection } from "@/shared/alexa/agenda-plan";
export interface LocalSemanticPlan{plan:RequestPlan;request:SemanticRequest;patientName?:string}
export async function planLocalSemantic(text:string,baseline:RequestPlan,previous:WorkingReference|null,signal:AbortSignal,infer:typeof inferLocalSemantic=inferLocalSemantic):Promise<LocalSemanticPlan|null>{
  try{
    if(infer===inferLocalSemantic&&!await localSemanticQualified())return null;
    const parsed=semanticRequestSchema.safeParse(await infer(text,previous?{intent:previous.intent,count:previous.count,patientFilter:previous.patientFilter}:null,signal));signal.throwIfAborted();if(!parsed.success)return null;
    const request=parsed.data,sources=sourcePlanSchema.parse(buildSourcePlan(request));
    const plan:RequestPlan={intent:"clarify",count:request.count,language:baseline.language,outputShape:request.output};
    if(request.missing.length||!sources.steps.length) { if(request.missing[0])plan.clarification=request.missing[0];return {plan,request}; }
    if(request.domain==="patient"&&request.operation==="search"){plan.intent="patient_search";plan.patientFilter=request.field==="phone"?"missing_phone":request.field==="identity_card"?"missing_identity_card":request.field==="email"?"missing_email":"all";}
    else if(request.domain==="application"&&request.operation==="explain"){plan.intent="app_help";plan.helpTopic=request.query??"current_section";}
    else if(request.domain==="general"&&request.operation==="time")plan.intent="clock";
    else if(request.domain==="knowledge")plan.intent="knowledge";
    else if(request.domain==="general")plan.intent="general";
    else if(request.domain==="action")plan.intent="proposal";
    else if(request.domain==="patient"||request.domain==="hybrid"){
      const operations:Record<string,RequestPlan["intent"]>={summary:"summary",history:"history",treatments:"treatments",profile:"profile",documents:"documents",finance:"patient_finance",appointments:"agenda"};plan.intent=operations[request.operation]??"clarify";if(request.domain==="hybrid")plan.includeKnowledge=true;
    }
    if(request.query&&(plan.intent==="knowledge"||plan.includeKnowledge))plan.knowledgeQuery=request.query;
    if(plan.intent==="agenda") {
      const selection=agendaSelection(text);
      if(!selection) { plan.intent="clarify";plan.clarification="agenda-period"; }
      else { plan.agendaDay=selection.day;plan.agendaRequestedOnly=selection.requestedOnly; }
    }
    if(request.patient&&request.patient.kind!=="name")plan.patientReference={kind:request.patient.kind,value:request.patient.value};
    if(request.patient?.kind==="name"){
      if(!text.normalize("NFKC").toLocaleLowerCase().includes(request.patient.value.normalize("NFKC").toLocaleLowerCase()))return null;
      return {plan,request,patientName:request.patient.value};
    }
    return {plan,request};
  }catch{signal.throwIfAborted();return null;}
}
