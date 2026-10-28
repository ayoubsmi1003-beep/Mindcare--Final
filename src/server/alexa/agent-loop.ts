import {applicationReadCopy} from "@/i18n/alexa-application";
import {explicitAgentPeriod,explicitAgendaClockWindow} from "./agent-period";
import {requestsCabinetWideScope,requestsPatientScope,withoutCabinetWideScope} from '@/shared/alexa/request-plan';
import {patientQueryContract,patientQueryPeriod} from '@/shared/alexa/patient-query-contract';
import {agendaIdentityText,nativeAgendaStatusContract} from '@/shared/alexa/agenda-plan';
import {presentAgentResults} from './answer-presentation';
import {canAnswerGeneralAlexa,isFrenchQuotedInstructionPolicyQuestion} from "./model-gateway";
import {parsePatientMention} from "@/shared/alexa/patient-mention";
import {explicitFrenchComparedMonthRanges,explicitFrenchDateRange,explicitFrenchDayRange,explicitCombinedPatientPopulationCount,frenchReadArgumentBindings,requestedCountRead,isAdministrativeReview,requestedReadTool,frenchRequestedOutputs,constrainRequestedOutputs,frenchPatientCompoundContract,constrainCompoundDeclaration,compoundContractParts,compoundContractHints,frenchPatientCountContract,frenchRequestAdmission,countContractHints,countContractParts,constrainCountDeclaration,patientConditionsGrounded,explicitPatientCountFilterGroups,isFrenchNamedLatestConsultationComparison} from "@/shared/alexa/request-contract";
import {noteReadQuerySchema,noteCursorSchema,noteContinuation,noteSearchRequested,noteQueryGrounded} from "@/shared/alexa/note-query";
import { z } from "zod";
import { ALEXA_AGENT_LANGUAGE,applicationQuerySchema,timelineQuerySchema,timelineCursorSchema,ALEXA_NATIVE_BUDGET,ALEXA_NATIVE_DEADLINE_MS,AgentReadError,patientListContinuation,patientMetricConditions,conditionSchema,partSchema,queryPatientsSchema,compactDeclarationSchema,parseDeclaration,agentSchemas, conditionKey, type AgentCall, type AgentResult, type AgentTerminal, type RequestPart } from "@/shared/alexa/agent";
import type { TurnInput, AlexaSource, AlexaProposal, AlexaNavigation } from "@/shared/alexa/turn";
import type { AgentContinuationKind } from "./agent-continuation";
import { agentCopy, agentPrompt, agentDescriptions,agentMetadataPrompt,agentDeclarationRecovery,agentActionDescriptions } from "@/i18n/alexa-agent";
import {profileCopy} from '@/i18n/alexa-profile';
import {actionArgumentKeys} from '@/shared/alexa/agent';
import { inferLocalCompletion } from "./local-model";
import {relativeClinicalDate} from './clinical-narrative';
import { localModelFailureCode, type LocalCompletion, type LocalMessage, type LocalTool } from "./local-model-protocol";

export const AGENT_LIMITS = { rounds:ALEXA_NATIVE_BUDGET.rounds, calls:ALEXA_NATIVE_BUDGET.calls, parallel:ALEXA_NATIVE_BUDGET.parallel, deadlineMs:ALEXA_NATIVE_DEADLINE_MS, ttlMs: 900000 } as const;
function unsupportedClinicalTimelineRestriction(text:string):boolean {
 const normalized=text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
 const timeline=/\b(?:chronologie|evenements? (?:cliniques?|du dossier)|historique (?:clinique|du dossier))\b/u.test(normalized);
 const period=/\b(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|depuis|avant|apres|entre|hier|semaine|mois|annee)\b|\b(?:19|20)\d{2}\b|\b\d{1,2}[/-]\d{1,2}\b/u.test(normalized);
 return timeline&&period;
}
function unresolvedConsultationPeriod(text:string,asOf:string):boolean{
 const scope=frenchRequestAdmission(text,false,asOf);
 return scope.tools?.length===1&&scope.tools[0]==='query_consultations'&&scope.unboundedPeriod===false&&!(scope.from&&scope.to)&&!explicitFrenchComparedMonthRanges(text,asOf);
}
export interface AgentTask { original: string; parts: RequestPart[]; results: AgentResult[]; at: number; patientId: string | null; page: string; }
const tasks = new Map<string, AgentTask>();
export function clearAgentTask(actor: string, conversation: string): void { tasks.delete(JSON.stringify([actor, conversation])); }
export function savedAgentTask(actor:string,conversation:string):AgentTask|null {
  const task=tasks.get(JSON.stringify([actor,conversation]));
  if(!task)return null;
  // Persist query definitions/references and outcomes, never a second clinical chart.
  return {...task,results:task.results.slice(-6).map(r=>({...r,evidence:r.evidence.slice(0,24),text:r.text.slice(0,1200),data:r.data&&typeof r.data==="object"?"patientQuery" in r.data?Object.fromEntries(Object.entries(r.data).filter(([k])=>["patientQuery","asOf","revision","offset","rows"].includes(k))):"noteQuery" in r.data?Object.fromEntries(Object.entries(r.data).filter(([k])=>["noteQuery","asOf","revision","next"].includes(k))):"consultationQuery" in r.data?Object.fromEntries(Object.entries(r.data).filter(([k])=>["consultationQuery","asOf","revision","nextTextOffset"].includes(k))):"documentQuery" in r.data?Object.fromEntries(Object.entries(r.data).filter(([k])=>["documentQuery","asOf","revision","nextTextOffset"].includes(k))):"financeQuery" in r.data?Object.fromEntries(Object.entries(r.data).filter(([k])=>["financeQuery","asOf","revision","nextOffset"].includes(k))):"applicationQuery" in r.data?Object.fromEntries(Object.entries(r.data).filter(([k])=>["applicationQuery","nextOffset","revision"].includes(k))):"timelineQuery" in r.data?Object.fromEntries(Object.entries(r.data).filter(([k])=>["timelineQuery","timelineNext","revision"].includes(k))):"candidates" in r.data?{candidates:r.data.candidates}:undefined:undefined}))};
}
const storedPart=partSchema.extend({goal:z.string().min(1).max(4000),status:z.enum(["pending","answered","proposed","needs_input","unsupported","failed","budget_limited","cancelled"]),resultRefs:z.array(z.string().max(200)).max(6),reason:z.string().max(3000).optional()});
const storedSource=z.object({id:z.string().max(200),type:z.enum(["patient","consultation","diagnostic","scale","treatment","knowledge","appointment","document","query"]),label:z.string().max(500),version:z.string().max(100).optional(),excerpt:z.string().max(30000).optional(),provenance:z.record(z.string(),z.union([z.string().max(500),z.number(),z.null()])).optional()}).strict();
const storedResult=z.object({callId:z.string().max(200),status:z.enum(["ok","empty","partial","needs_input","error","unsupported"]),complete:z.boolean(),text:z.string().max(1200),conditionKeys:z.array(z.string().max(200)).max(12),evidence:z.array(storedSource).max(24),patientId:z.uuid().optional(),error:z.object({code:z.string().max(100),retryable:z.boolean()}).optional(),data:z.unknown().optional()});
export function restoreAgentTask(actor:string,conversation:string,value:unknown):void {
 const parsed=z.object({original:z.string().max(4000),parts:z.array(storedPart).min(1).max(12),results:z.array(storedResult).max(6),at:z.number().finite(),patientId:z.uuid().nullable(),page:z.string().max(200)}).strict().safeParse(value);
 if(!parsed.success||Date.now()-parsed.data.at>=AGENT_LIMITS.ttlMs||parsed.data.at>Date.now()+1000)return;
 const seen=new Set<string>();
 for(const part of parsed.data.parts){if(seen.has(part.id)||part.dependsOn.some(id=>!seen.has(id)))return;seen.add(part.id);}
 for(const result of parsed.data.results){
  if(result.data===undefined)continue;
  const data=z.object({applicationQuery:applicationQuerySchema.optional(),timelineQuery:timelineQuerySchema.optional(),timelineNext:timelineCursorSchema.optional(),documentQuery:z.unknown().optional(),financeQuery:z.unknown().optional(),nextOffset:z.number().int().min(0).max(10000).optional(),noteQuery:z.unknown().optional(),next:noteCursorSchema.optional(),consultationQuery:z.unknown().optional(),nextTextOffset:z.number().int().min(0).max(1000000).optional(),patientQuery:z.unknown().optional(),asOf:z.iso.datetime({offset:true}).optional(),revision:z.string().regex(/^[a-f0-9]{32}(?:[a-f0-9]{32})?$/).optional(),offset:z.number().int().min(0).max(10000).optional(),rows:z.array(z.unknown()).max(20).optional(),candidates:z.array(z.object({patientId:z.uuid(),label:z.string().max(500)}).strict()).max(20).optional()}).safeParse(result.data);
  if(!data.success)return;
  if(data.data.applicationQuery&&(!data.data.nextOffset||!data.data.revision))return;
  if(!!data.data.timelineQuery!==!!data.data.timelineNext||data.data.timelineNext&&!data.data.revision)return;
  if(data.data.timelineQuery&&!timelineQuerySchema.safeParse(data.data.timelineQuery).success)return;
  if(data.data.patientQuery){const query=queryPatientsSchema.safeParse({...data.data.patientQuery,partIds:["restore"]});if(!query.success)return;}
  if(data.data.noteQuery){if(!noteReadQuerySchema.safeParse(data.data.noteQuery).success||!data.data.asOf||!data.data.revision)return;}
  if(data.data.consultationQuery){const query=agentSchemas.query_consultations.safeParse({...data.data.consultationQuery,partIds:["restore"]});if(!query.success||query.data.view!=="analysis"||!query.data.consultationId||!data.data.asOf||!data.data.revision)return;}
  if(data.data.financeQuery){const query=agentSchemas.query_finance.safeParse({...data.data.financeQuery,partIds:["restore"]});if(!query.success||query.data.mode!=="calendar"||!query.data.from||!query.data.to||!data.data.asOf||!data.data.revision)return;}
  if(data.data.documentQuery){const query=agentSchemas.query_documents.safeParse({...data.data.documentQuery,partIds:["restore"]});if(!query.success||!(query.data.documentId||query.data.draftId)||!data.data.asOf||!data.data.revision)return;}
  result.data=data.data;
 }
 tasks.set(JSON.stringify([actor,conversation]),parsed.data as AgentTask);
}
export interface AgentToolResultObservation { callId:string; name:string; status:AgentResult['status']; errorCode?:string }
export interface AgentLoopDependencies { actor: string; infer?: (messages: readonly LocalMessage[], options: Parameters<typeof inferLocalCompletion>[1]) => Promise<LocalCompletion>;
  execute: (call: AgentCall, asOf: string, prior: readonly AgentResult[], signal: AbortSignal,original?:string,requestedGoal?:string) => Promise<AgentResult>; asOf?:string; onStage?: () => void; observeCall?: (call: AgentCall) => void; observeResult?: (observation:AgentToolResultObservation) => void;
  resumeCursor?: { cursorId: string; kind: AgentContinuationKind; patientId: string | null };
}
export interface AgentOutcome { status: AgentTerminal; parts: RequestPart[]; results: AgentResult[]; sentences: string[]; sources: AlexaSource[];
  patientId: string | null; proposal?: AlexaProposal; navigation?: AlexaNavigation; tokensIn: number; tokensOut: number; }
function partAllowsTool(part:RequestPart,name:string):boolean {
  return part.tools===undefined?name==="query_patients"&&part.conditions.length>0:part.tools.some(tool=>tool===name);
}
function noteCursor(result:AgentResult):{remainingPages:number}|null {
 if(!result.data||typeof result.data!=="object")return null;
 const data=result.data as Record<string,unknown>,cursor=noteCursorSchema.safeParse(data["next"]),total=data["total"];
 if(!("noteQuery" in data)||!cursor.success||typeof total!=="number"||!Number.isSafeInteger(total)||total<0)return null;
 return {remainingPages:Math.min(8,Math.max(0,Math.ceil((total-cursor.data.offset)/5)))};
}
const patientQueryDescriptors=new Set(["actif","actifs","active","actives","adulte","adultes","enfant","enfants","mineur","mineurs","majeur","majeurs","archive","archives","inactif","inactifs","incomplete","incomplets","complete","complets","sans","avec","identite","carte","telephone","visite","consultation","consultations","patient","patients","dossier","dossiers"]);
const normalizedPatientQuery=(value:string)=>value.normalize("NFKD").replace(/\p{M}/gu,"").toLocaleLowerCase().trim().replace(/\s+/gu," ");
function explicitPatientQueryName(text:string):string|undefined {
  const mention=parsePatientMention(text);
  if(mention.status!=="named")return undefined;
  const words=normalizedPatientQuery(mention.name).split(" ");
  return words.length&&words.every(word=>patientQueryDescriptors.has(word))?undefined:mention.name;
}
function explicitPatientClarificationName(text:string):string|undefined {
 const answer=text.trim().replace(/[.!?؟]+$/u,'').trim();
 if(!/^[\p{L}][\p{L}\p{M}'’\-]*(?:\s+[\p{L}][\p{L}\p{M}'’\-]*){1,2}$/u.test(answer))return undefined;
 const mention=parsePatientMention(`patient ${answer}`);
 return mention.status==='named'&&normalizedPatientQuery(mention.name)===normalizedPatientQuery(answer)?mention.name:undefined;
}
function directRecurringThemeCountCalls(outputs:readonly string[]|null, original:string, clientTurnId:string):{part:RequestPart;call:AgentCall}[]|null {
 if(!outputs||outputs.length<2||outputs.length>AGENT_LIMITS.calls)return null;
 let hasTheme=false,hasCompletedCount=false;
 const prepared=outputs.map((goal,index)=>{
  const tool=requestedReadTool(goal,original),scope=frenchRequestAdmission(goal,false);
  if(!tool||scope.tools?.length!==1||scope.tools[0]!==tool)return null;
  if(tool==='get_patient_context'){
   const plain=goal.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
   if(scope.patientSection!=='summary'||!/\b(?:theme|motif|element)\s+recurrent\b/u.test(plain))return null;
   hasTheme=true;
  }else if(tool==='query_consultations'){
   if(scope.consultationMode!=='count'||scope.consultationStatus!=='closed'||!scope.unboundedPeriod)return null;
   hasCompletedCount=true;
  }else return null;
  const id=`requested_${index+1}`,args={partIds:[id],...frenchReadArgumentBindings(scope,tool)};
  if(!agentSchemas[tool].safeParse(args).success)return null;
  return {part:{id,goal,tools:[tool],conditions:[],dependsOn:[],status:'pending' as const,resultRefs:[]},call:{id:`direct-${clientTurnId}-${id}`,name:tool,args}};
 });
 return hasTheme&&hasCompletedCount&&prepared.every((entry):entry is NonNullable<typeof entry>=>entry!==null)?prepared:null;
}
function directSinglePatientReadCall(text:string,clientTurnId:string,selectedPatientId:string|null,asOf:string):{part:RequestPart;call:AgentCall}|null {
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
 const scope=frenchRequestAdmission(text,false,asOf),tool=scope.tools?.length===1?scope.tools[0]:requestedReadTool(text,text);
 const singleScaleInventory=scope.patientSection==='scales'&&/\b(?:dans quelles? consultations?|pour chaque consultation)\b/u.test(plain);
 if((/\b(?:et|puis|ainsi que)\b|[;\n]/u.test(plain)&&!singleScaleInventory))return null;
 const mention=parsePatientMention(text);
 if(mention.status==='ambiguous')return null;
 const latestVisit=/\b(?:derniere|plus recente)\s+(?:consultation|seance)\b|\b(?:consultation|seance)\s+(?:la\s+)?(?:plus\s+)?recente\b/u.test(plain);
 const noteScopeKnown=scope.unboundedPeriod===true||!!scope.from&&!!scope.to;
 const explicitNoteRead=!!scope.noteQuery&&noteSearchRequested(text)||(!!scope.noteArea||/\b(?:cinq|5)\s+(?:parties|notes|rubriques)\b/u.test(plain))&&!!scope.from&&!!scope.to||/\bmesures\b[^.!?]*\bevolu\w*|\bdifficulte\w*\b[^.!?]*\bune ancienne consultation\b/u.test(plain);
 const patientContextRead=tool==='get_patient_context'&&!!scope.patientSection&&(!!selectedPatientId||mention.status==='named')&&(scope.patientSection!=='notes'||latestVisit||noteScopeKnown&&explicitNoteRead);
 const consultationCount=tool==='query_consultations'&&scope.consultationMode==='count'&&['all','closed','open','unsigned'].includes(scope.consultationStatus??'')&&scope.unboundedPeriod===true&&(!!selectedPatientId||mention.status==='named');
 if(scope.tools?.length!==1||scope.tools[0]!==tool||(!patientContextRead&&!consultationCount))return null;
 const id='requested_1',args={partIds:[id],...frenchReadArgumentBindings(scope,tool),...(mention.status==='named'?{patientName:mention.name}:selectedPatientId?{patientId:selectedPatientId}:{})};
 if(!agentSchemas[tool].safeParse(args).success)return null;
 return {part:{id,goal:text,tools:[tool],conditions:[],dependsOn:[],status:'pending',resultRefs:[]},call:{id:`direct-${clientTurnId}-${id}`,name:tool,args}};
}
function nonExecutableLatestComparison(text:string):boolean{
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
 const latestPair=/\b(?:les?\s+)?(?:deux|2)\s+dernieres?\s+(?:consultations?|seances?)\b/u.test(plain),comparison=/\b(?:compar\w*|differenc\w*|chang\w*|evolu\w*)\b/u.test(plain);
 if(!latestPair||!comparison)return false;
 return /^\s*(?:[«“"'`]|si\b|imaginons?\b|supposons?\b|hypothetiquement\b|a titre d.exemple\b|je cite\b)/u.test(plain)
  ||/\b(?:ne|n['’])\s*(?:me\s+)?(?:compar\w*|chang\w*)\b[^.!?]{0,60}\b(?:pas|plus|jamais)\b/u.test(plain)
  ||/[«“"][^»”"]{0,400}\b(?:compar\w*|chang\w*|differenc\w*)\b[^»”"]*[»”"]/u.test(plain);
}
function directNamedLatestConsultationComparisonCall(text:string,clientTurnId:string,asOf:string):{part:RequestPart;call:AgentCall}|null{
 if(!isFrenchNamedLatestConsultationComparison(text))return null;
 const scope=frenchRequestAdmission(text,false,asOf),mention=parsePatientMention(text);
 if(scope.tools?.length!==1||scope.tools[0]!=='get_patient_context'||scope.patientSection!=='summary'||scope.consultationCount!==2||mention.status!=='named')return null;
 const id='requested_1',args={partIds:[id],section:'summary' as const,count:2,patientName:mention.name};
 if(!agentSchemas.get_patient_context.safeParse(args).success)return null;
 return {part:{id,goal:text,tools:['get_patient_context'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]},call:{id:`direct-${clientTurnId}-latest-comparison`,name:'get_patient_context',args}};
}
function directPatientNoteReadCall(text:string,clientTurnId:string,asOf:string):{part:RequestPart;call:AgentCall}|null {
 const scope=frenchRequestAdmission(text,false,asOf);
 const explicitAreaRead=!!scope.noteArea&&scope.unboundedPeriod===true&&!scope.from&&!scope.to;
 const explicitTextSearch=!!scope.noteQuery&&noteSearchRequested(text)&&scope.unboundedPeriod===true&&!scope.from&&!scope.to;
 if(scope.tools?.length!==1||scope.tools[0]!=='get_patient_context'||scope.patientSection!=='notes'||(!explicitAreaRead&&!explicitTextSearch))return null;
 const id='requested_1',args={partIds:[id],...frenchReadArgumentBindings(scope,'get_patient_context')};
 if(!agentSchemas.get_patient_context.safeParse(args).success)return null;
 return {part:{id,goal:text,tools:['get_patient_context'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]},call:{id:`direct-${clientTurnId}-${id}`,name:'get_patient_context',args}};
}
function directPatientMetricReadCall(contract:NonNullable<ReturnType<typeof frenchPatientCountContract>>,clientTurnId:string):{part:RequestPart;parts:RequestPart[];call:AgentCall}|null {
 const parts=countContractParts(contract),populations=new Set(parts.map(part=>part.population??'active'));
 const metricForPart=(part:RequestPart)=>Object.entries(patientMetricConditions).find(([,conditions])=>JSON.stringify(conditions.map(conditionKey).sort())===JSON.stringify(part.conditions.map(conditionKey).sort()))?.[0];
 const metrics=parts.map(metricForPart);
 const filterGroups=parts.length===1?explicitPatientCountFilterGroups(contract.clauses[0]!):null;
 const groupedConditions=filterGroups?.flat().map(conditionKey).sort(),partConditions=parts[0]?.conditions.map(conditionKey).sort();
 const groupedCount=!!groupedConditions&&!!partConditions&&groupedConditions.length===partConditions.length&&groupedConditions.every((condition,index)=>condition===partConditions[index]);
 if(parts.length===1){
  const part=parts[0]!,plain=isClosedPlainPatientCount(contract.clauses[0]!);
  const countPlain=contract.clauses[0]!.normalize('NFKD').replace(/\p{M}/gu,'').replace(/[’‘]/gu,"'").toLowerCase();
  const explicitAllCount=explicitCombinedPatientPopulationCount(countPlain);
  const exactPlainCount=part.conditions.length===0&&(plain||explicitAllCount);
  if((/\bou\b/u.test(countPlain)&&!groupedCount)||(part.conditions.length!==1&&!exactPlainCount&&!groupedCount)||constrainCountDeclaration(parts,contract).some(candidate=>candidate.unsupportedConditions?.length))return null;
 }
 const population=parts.length===1?parts[0]!.population??'active':'active';
 const validPopulation=parts.length===1?['active','archived','all'].includes(population):populations.size===1&&[...populations].every(value=>value==='active');
 const singleFilterCount=parts.length===1&&(parts[0]!.conditions.length===1||groupedCount);
 if(parts.length<1||parts.length>7||!validPopulation||metrics.some(metric=>!metric&&!singleFilterCount)||new Set(metrics).size!==parts.length||parts.some(part=>part.tools?.length!==1||part.tools[0]!=='query_patients'||part.dependsOn.length||part.literalQuery||part.unsupportedConditions?.length))return null;
 const args=parts.length===1?{partIds:[parts[0]!.id],mode:'count' as const,...(groupedCount?{filterGroups}:{filters:parts[0]!.conditions}),population}:{partIds:parts.map(part=>part.id),mode:'metrics' as const,metrics,population:'active' as const};
 if(!queryPatientsSchema.safeParse(args).success)return null;
 const call:AgentCall={id:`direct-${clientTurnId}-metrics`,name:'query_patients',args};
 return {part:parts[0]!,parts,call};
}
function isClosedPlainPatientCount(text:string):boolean {
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').replace(/[’‘]/gu,"'").toLowerCase().replace(/\s+/gu,' ').trim().replace(/[.!?]+$/gu,'').trim();
 const active=/^(?:combien de patients? actifs?(?: sont enregistres(?: au cabinet)?| avons[- ]nous| figurent dans le cabinet)?|quel est le nombre de patients? actifs?(?: enregistres(?: au cabinet)?| figurent dans le cabinet)?)$/u;
 const archived=/^(?:combien de (?:dossiers?|patients?) archives?(?: figurent dans le cabinet)?|quel est le nombre de (?:dossiers?|patients?) archives?(?: figurent dans le cabinet)?)$/u;
 return active.test(plain)||archived.test(plain);
}
function directPatientCompoundReadCall(contract:NonNullable<ReturnType<typeof frenchPatientCompoundContract>>,clientTurnId:string):{part:RequestPart;parts:RequestPart[];call:AgentCall}|null {
 const parts=compoundContractParts(contract);
 if(parts.length!==(contract.count?2:1)||parts.some(part=>part.tools?.length!==1||part.tools[0]!=='query_patients'||part.dependsOn.length||part.unsupportedConditions?.length||JSON.stringify(part.conditions.map(conditionKey).sort())!==JSON.stringify(contract.conditions.map(conditionKey).sort())))return null;
 const args={partIds:parts.map(part=>part.id),mode:'list' as const,population:'active' as const,filters:contract.conditions,limit:20,...(contract.sort?{sort:contract.sort}:{})};
 if(!queryPatientsSchema.safeParse(args).success)return null;
 const call:AgentCall={id:`direct-${clientTurnId}-compound`,name:'query_patients',args};
 return {part:parts[0]!,parts,call};
}
function directMixedMetricAgendaCalls(text:string,clientTurnId:string,selectedPatientId:string|null,asOf:string):{part:RequestPart;parts?:RequestPart[];call:AgentCall}[]|null {
 const boundaries=[...text.matchAll(/\s+et\s+(?=(?:quels?|quelles?)\b[^.!?]*(?:rendez[- ]?vous|\brdv\b|agenda))/giu)];
 if(boundaries.length!==1)return null;
 const boundary=boundaries[0]!,patientText=text.slice(0,boundary.index).trim().replace(/[,;\s]+$/u,''),agendaText=text.slice(boundary.index+boundary[0].length).trim();
 const contract=frenchPatientCountContract(patientText),metrics=contract?directPatientMetricReadCall(contract,clientTurnId):null,agenda=directAgendaReadCall(agendaText,clientTurnId,selectedPatientId,asOf);
 if(!metrics||!agenda||metrics.parts.length<2)return null;
 const agendaId=`requested_${metrics.parts.length+1}`,agendaPart={...agenda.part,id:agendaId,goal:agendaText};
 const agendaCall={...agenda.call,id:`direct-${clientTurnId}-${agendaId}`,args:{...agenda.call.args,partIds:[agendaId]}};
 if(!agentSchemas.query_agenda.safeParse(agendaCall.args).success)return null;
 return [metrics,{part:agendaPart,call:agendaCall}];
}
interface DirectNamedReadPlan {parts:RequestPart[];calls:{part:RequestPart;parts?:RequestPart[];call:AgentCall;latestNoteReference?:boolean}[]}
function directNamedApplicationReads(text:string,clientTurnId:string,selectedPatientId:string|null,asOf:string):DirectNamedReadPlan|null {
 const outputs=frenchRequestedOutputs(text);
 if(!outputs||outputs.length<2||outputs.length>7)return null;
 const globalMention=parsePatientMention(text),parts:RequestPart[]=[],calls:DirectNamedReadPlan['calls']=[],profileGroups=new Map<string,{patientName?:string;patientId?:string;parts:RequestPart[]}>();
 const identityFor=(goal:string):{patientName?:string;patientId?:string}|null=>{
  const local=parsePatientMention(goal);if(local.status==='ambiguous')return null;
  const patientName=local.status==='named'?local.name:globalMention.status==='named'?globalMention.name:undefined;
  if(patientName)return {patientName};
  if(globalMention.status==='ambiguous'||!selectedPatientId)return null;
  return {patientId:selectedPatientId};
 };
 for(const [index,goal] of outputs.entries()){
  const id=`requested_${index+1}`,tool=requestedReadTool(goal,text),scope=frenchRequestAdmission(goal,false,asOf);
  if(!tool||scope.tools?.length!==1||scope.tools[0]!==tool)return null;
  const normalized=goal.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
  if(tool==='get_patient_context'&&scope.patientSection==='profile'&&/\b(?:e[- ]?mail|courriel|adresse electronique)\b/u.test(normalized)){
   parts.push({id,goal,tools:[],conditions:[],dependsOn:[],status:'unsupported',resultRefs:[],reason:profileCopy.emailUnavailable});continue;
  }
  if(tool==='get_patient_context'&&scope.patientSection==='profile'){
   const identity=identityFor(goal);if(!identity)return null;
   const part:RequestPart={id,goal,tools:[tool],conditions:[],dependsOn:[],status:'pending',resultRefs:[]};parts.push(part);
   const key=identity.patientName?`name:${identity.patientName.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()}`:`id:${identity.patientId}`;
   const group=profileGroups.get(key)??{...identity,parts:[]};group.parts.push(part);profileGroups.set(key,group);continue;
  }
  if(tool==='query_consultations'&&scope.consultationMode==='count'&&scope.unboundedPeriod){
   const identity=identityFor(goal);if(!identity)return null;
   const args={partIds:[id],...frenchReadArgumentBindings(scope,tool),...identity};if(!agentSchemas.query_consultations.safeParse(args).success)return null;
   const part:RequestPart={id,goal,tools:[tool],conditions:[],dependsOn:[],status:'pending',resultRefs:[]};parts.push(part);calls.push({part,call:{id:`direct-${clientTurnId}-${id}`,name:tool,args}});continue;
  }
  if(tool==='query_agenda'){
   const agenda=directAgendaReadCall(goal,clientTurnId,selectedPatientId,asOf);if(!agenda)return null;
   const part={...agenda.part,id,goal};parts.push(part);calls.push({part,call:{...agenda.call,id:`direct-${clientTurnId}-${id}`,args:{...agenda.call.args,partIds:[id]}}});continue;
  }
  if(tool==='get_patient_context'&&scope.patientSection==='notes'&&/\b(?:repere|reference)\b[^.!?]*\b(?:derniere|plus recente)\b/u.test(normalized)){
   const identity=identityFor(goal);if(!identity)return null;
   const args={partIds:[id],section:'notes' as const,...identity};if(!agentSchemas.get_patient_context.safeParse(args).success)return null;
   const part:RequestPart={id,goal,tools:[tool],conditions:[],dependsOn:[],status:'pending',resultRefs:[]};parts.push(part);calls.push({part,call:{id:`direct-${clientTurnId}-${id}`,name:tool,args},latestNoteReference:true});continue;
  }
  if(tool==='get_patient_context'&&scope.patientSection==='notes'&&(scope.noteQuery&&noteSearchRequested(goal)||scope.noteArea==='plan')&&(scope.unboundedPeriod===true||!!scope.from&&!!scope.to)){
   const identity=identityFor(goal);if(!identity)return null;
   const args={partIds:[id],...frenchReadArgumentBindings(scope,tool),...identity};if(!agentSchemas.get_patient_context.safeParse(args).success)return null;
   const part:RequestPart={id,goal,tools:[tool],conditions:[],dependsOn:[],status:'pending',resultRefs:[]};parts.push(part);calls.push({part,call:{id:`direct-${clientTurnId}-${id}`,name:tool,args}});continue;
  }
  return null;
 }
 for(const group of profileGroups.values()){
  const groupParts=group.parts,requestGoal=groupParts.map(part=>part.goal).join(' ; ');
  const args={partIds:groupParts.map(part=>part.id),section:'profile',...(group.patientName?{patientName:group.patientName}:{}),...(group.patientId?{patientId:group.patientId}:{})};
  if(!agentSchemas.get_patient_context.safeParse(args).success)return null;
  calls.push({part:{...groupParts[0]!,goal:requestGoal},parts:groupParts,call:{id:`direct-${clientTurnId}-profile-${calls.length+1}`,name:'get_patient_context',args}});
 }
  const partOrder=new Map(parts.map((part,index)=>[part.id,index]));
  calls.sort((left,right)=>(partOrder.get(left.part.id)??Number.MAX_SAFE_INTEGER)-(partOrder.get(right.part.id)??Number.MAX_SAFE_INTEGER));
  return {parts,calls};
}
function answerLatestNoteReference(result:AgentResult,asOf:string):AgentResult {
 if(!['ok','partial'].includes(result.status))return result;
 const page=z.object({total:z.number().int().nonnegative().safe(),rows:z.array(z.object({consultationId:z.uuid(),startedAt:z.iso.datetime({offset:true}),area:z.string(),text:z.string().max(2400)}).passthrough()).max(5),noteQuery:z.object({offset:z.number().int().min(0).optional()}).passthrough().optional()}).passthrough().safeParse(result.data);
 if(!page.success||!page.data.total||!page.data.rows.length||page.data.rows[0]!.area!=='working'||(page.data.noteQuery?.offset??0)!==0)return result;
 const latest=page.data.rows[0]!;
 if(page.data.rows.some(row=>Date.parse(row.startedAt)>Date.parse(latest.startedAt)))return result;
 const source=result.evidence.find(evidence=>evidence.type==='consultation'&&evidence.id===latest.consultationId),gate=result.evidence.find(evidence=>evidence.type==='query'&&evidence.provenance?.gate==='query_alexa_note_sections'&&evidence.provenance.total===page.data.total);
 if(!source||!gate)return result;
 const reference=latest.text.match(/\bREP[EÈ]RE[-_ ]+[A-Z0-9]+(?:[-_][A-Z0-9]+)*\b/iu)?.[0],date=relativeClinicalDate(latest.startedAt,asOf);
 // The authorized note gate sorts newest first; older pages do not block a question about only the latest note.
 return {...result,status:'ok',complete:true,text:reference?`La dernière note, datée ${date}, porte le repère « ${reference} ».`:`La dernière note, datée ${date}, ne contient pas de repère explicite.`,evidence:result.evidence.filter(evidence=>evidence.type==='patient'||evidence.type==='query'||evidence===source)};
}
function directPublicAnswerCall(text:string,clientTurnId:string):{part:RequestPart;call:AgentCall}|null {
 const scope=frenchRequestAdmission(text,canAnswerGeneralAlexa(text));
 if(!isFrenchQuotedInstructionPolicyQuestion(text)&&(scope.tools?.length!==1||scope.tools[0]!=='answer_general'))return null;
 const id='requested_1',args={partIds:[id],question:text};
 if(!agentSchemas.answer_general.safeParse(args).success)return null;
 return {part:{id,goal:text,tools:['answer_general'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]},call:{id:`direct-${clientTurnId}-${id}`,name:'answer_general',args}};
}
function directFinanceReadCall(text:string,clientTurnId:string,selectedPatientId:string|null,asOf:string):{part:RequestPart;call:AgentCall}|null{
 const scope=frenchRequestAdmission(text,false,asOf);
 if(scope.tools?.length!==1||scope.tools[0]!=='query_finance')return null;
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
 const recurringCharges=scope.financeMode==='charges'&&/\bcharges?\b/u.test(plain)&&/\brecurrent\w*\b/u.test(plain);
 const balanceAllTime=scope.financeMode==='totals'&&scope.financeState==='all';
 const calendar=scope.financeMode==='calendar';
 const cabinetView=!!scope.financeMode&&['overview','charges','composition','evolution','attention','calendar'].includes(scope.financeMode);
 const unpriced=scope.financeMode==='totals'&&scope.financeState==='all'&&scope.financeConsultationStatus==='closed';
 const outstandingBalance=balanceAllTime&&/\b(?:solde|reste a encaisser|impayes?)\b/u.test(plain);
 const paymentList=!scope.financeMode&&!!scope.financeState&&!!scope.from&&!!scope.to&&/\b(?:liste\w*|affich\w*|montre\w*|quels?|quelles?)\b/u.test(plain)&&/\bpaiements?\b/u.test(plain);
 const paymentTotals=scope.financeMode==='totals'&&scope.financeState==='collected'&&!!scope.from&&!!scope.to&&!unpriced;
 if(!recurringCharges&&!balanceAllTime&&!calendar&&!cabinetView&&!paymentList&&!paymentTotals)return null;
 const mention=parsePatientMention(text);if(mention.status==='ambiguous')return null;
 if(cabinetView&&mention.status!=='none')return null;
 const id='requested_1',mode=scope.financeMode??'list';
 let from=scope.from,to=scope.to;
 if(recurringCharges&&!from&&!to){const match=/^((?:19|20)\d{2})-(\d{2})-\d{2}/u.exec(asOf);if(!match)return null;const year=Number(match[1]),month=Number(match[2]);if(month<1||month>12)return null;const nextYear=month===12?year+1:year,nextMonth=month===12?1:month+1;from=`${year}-${String(month).padStart(2,'0')}-01T00:00:00+01:00`;to=`${nextYear}-${String(nextMonth).padStart(2,'0')}-01T00:00:00+01:00`;}
 if((calendar||cabinetView||recurringCharges)&&(!from||!to))return null;
 const args:Record<string,unknown>={partIds:[id],...frenchReadArgumentBindings(scope,'query_finance'),mode,...(from&&to?{from,to}:{}),...(balanceAllTime?{state:unpriced?'all' as const:outstandingBalance?'pending' as const:'all' as const}:{}),...(unpriced?{consultationStatus:'closed' as const}:{})};
 const patientScoped=!cabinetView&&(/\b(?:patient(?:e)?|dossier|son|sa|ses|ce dossier)\b/u.test(plain)||mention.status==='named');
 if(patientScoped&&mention.status==='named')args['patientName']=mention.name;else if(patientScoped&&selectedPatientId&&!args['patientId'])args['patientId']=selectedPatientId;
 if(!agentSchemas.query_finance.safeParse(args).success)return null;
 return {part:{id,goal:text,tools:['query_finance'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]},call:{id:`direct-${clientTurnId}-finance-read`,name:'query_finance',args}};
}
function directGlobalNavigationCall(text:string,clientTurnId:string):{part:RequestPart;call:AgentCall}|null {
 const scope=frenchRequestAdmission(text,false),target=scope.navigationTarget;
 if(scope.tools?.length!==1||scope.tools[0]!=='navigate'||!target||target==='patient'||parsePatientMention(text).status!=='none')return null;
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/^alexa[, :]+/u,'');
 const command=plain.replace(/^(?:(?:peux[- ]tu|tu peux)\s+)?(?:ouvre|ouvrir|va|aller)\s+/u,'').replace(/[.!?]+$/u,'').trim();
 const accepted:Partial<Record<NonNullable<typeof target>,RegExp>>={
  agenda:/^(?:l['’]agenda|agenda)$/u,
  dashboard:/^(?:le tableau de bord|au tableau de bord|tableau de bord|dashboard)$/u,
  patients:/^(?:la liste des patients|liste des patients)$/u,
  documents:/^(?:les documents|documents)$/u,
  finances:/^(?:les finances|aux finances|finances)$/u,
  parametres:/^(?:les parametres(?: du cabinet)?|parametres(?: du cabinet)?|les reglages(?: du cabinet)?|reglages(?: du cabinet)?)$/u,
  jarvis:/^(?:alexa|jarvis)$/u,
 };
 if(!accepted[target]?.test(command))return null;
 const id='requested_1',args={partIds:[id],target};
 if(!agentSchemas.navigate.safeParse(args).success)return null;
 return {part:{id,goal:text,tools:['navigate'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]},call:{id:`direct-${clientTurnId}-${id}`,name:'navigate',args}};
}
function directOfficeReadCall(text:string,clientTurnId:string,requestedOutputs:readonly string[]|null):{part:RequestPart;call:AgentCall}|null {
 if(requestedOutputs&&requestedOutputs.length>1)return null;
 if(/\b(?:et|puis|ensuite|ou|mais)\b|[;\n]/iu.test(text))return null;
 const scope=frenchRequestAdmission(text,false);
 if(scope.tools?.length!==1||scope.tools[0]!=='query_app'||!['cabinet','practitioner','notifications','system'].includes(scope.applicationView??''))return null;
 const id='requested_1',args={partIds:[id],...frenchReadArgumentBindings(scope,'query_app')};
 if(!agentSchemas.query_app.safeParse(args).success)return null;
 return {part:{id,goal:text,tools:['query_app'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]},call:{id:`direct-${clientTurnId}-${id}`,name:'query_app',args}};
}
function directAgendaReadCall(text:string,clientTurnId:string,selectedPatientId:string|null,asOf:string):{part:RequestPart;call:AgentCall}|null{
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
 const clockWindow=explicitAgendaClockWindow(text,asOf),dateRange=explicitFrenchDateRange(text,asOf),requestShape=agendaIdentityText(clockWindow?plain.replace(clockWindow.matchedText,''):plain),coordination=requestShape.replace(/\bet\s+quels?\s+sont\s+(?:leurs?|les)\s+statuts?\b/u,''),conjunctions=[...coordination.matchAll(/\b(?:et|puis|ainsi que)\b/gu)],rangeConjunction=!!dateRange&&/\b(?:du|entre)\b[^.!?]*\bet\s+(?:le\s+)?(?:\d{1,2}(?:er)?|premier|premiere|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|dix[- ]sept|dix[- ]huit|dix[- ]neuf|vingt|trente)\b/u.test(coordination);
 if(conjunctions.length&&!(conjunctions.length===1&&rangeConjunction)||/[;\n]/u.test(coordination))return null;
 const scope=frenchRequestAdmission(text,false,asOf),window=clockWindow??patientQueryPeriod(text,asOf)??dateRange??explicitFrenchDayRange(text,asOf)??explicitAgentPeriod(text,asOf),identityText=agendaIdentityText(text),mention=parsePatientMention(identityText),statusContract=nativeAgendaStatusContract(text);
 const nextAppointment=/\bprochain rendez[- ]vous\b/u.test(plain);
 if(scope.tools?.length!==1||scope.tools[0]!=='query_agenda'||(!window&&!nextAppointment)||mention.status==='ambiguous'||!statusContract.complete)return null;
 const needsPatient=/\b(?:patient(?:e)?|dossier|son|sa|ses)\b/u.test(identityText.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase());
 if(needsPatient&&mention.status!=='named'&&!selectedPatientId)return null;
 if(nextAppointment&&mention.status!=='named'&&!selectedPatientId)return null;
 const id='requested_1',args={partIds:[id],...(window?{from:window.from,to:window.to}:{}),...(statusContract.statuses?{statuses:statusContract.statuses}:{}),...(mention.status==='named'?{patientName:mention.name}:(needsPatient||nextAppointment)&&selectedPatientId?{patientId:selectedPatientId}:{})};
 if(!agentSchemas.query_agenda.safeParse(args).success)return null;
 return {part:{id,goal:text,tools:['query_agenda'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]},call:{id:`direct-${clientTurnId}-${id}`,name:'query_agenda',args}};
}
function directConsultationCountCall(text:string,clientTurnId:string,selectedPatientId:string|null,asOf:string):{part:RequestPart;call:AgentCall}|null{
 const scope=frenchRequestAdmission(text,false,asOf),plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase(),mention=parsePatientMention(text);
 const boundedPeriod=!!scope.from&&!!scope.to;
 if(scope.tools?.length!==1||scope.tools[0]!=='query_consultations'||scope.consultationMode!=='count'||(!boundedPeriod&&scope.unboundedPeriod!==true)||mention.status==='ambiguous')return null;
 const patientScoped=mention.status==='named'||/\b(?:patient(?:e)?(?:\s+selectionn\w*)?|dossier(?:\s+(?:courant|selectionn\w*))?|son|sa|ses)\b/u.test(plain);
 if(patientScoped&&!selectedPatientId&&mention.status!=='named')return null;
 const identity=mention.status==='named'?{patientName:mention.name}:patientScoped&&selectedPatientId?{patientId:selectedPatientId}:{};
 const id='requested_1',args={partIds:[id],...frenchReadArgumentBindings(scope,'query_consultations'),...identity,mode:'count' as const,status:scope.consultationStatus??'all' as const};
 if(!agentSchemas.query_consultations.safeParse(args).success)return null;
 return {part:{id,goal:text,tools:['query_consultations'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]},call:{id:`direct-${clientTurnId}-${id}`,name:'query_consultations',args}};
}
function directConsultationDayListCall(text:string,clientTurnId:string,selectedPatientId:string|null,asOf:string):{part:RequestPart;call:AgentCall}|null{
 const scope=frenchRequestAdmission(text,false,asOf),mention=parsePatientMention(text),plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
 if(scope.tools?.length!==1||scope.tools[0]!=='query_consultations'||scope.consultationMode==='count'||!scope.from||!scope.to||Date.parse(scope.to)<=Date.parse(scope.from)||/\b(?:details?|analys\w*)\b/u.test(plain)||mention.status==='ambiguous')return null;
 const patientScoped=/\b(?:patient(?:e)?(?:\s+selectionn\w*)?|dossier(?:\s+(?:courant|selectionn\w*))?|son|sa|ses)\b/u.test(plain)||mention.status==='named';
 if(patientScoped&&mention.status!=='named'&&!selectedPatientId)return null;
 const identity=mention.status==='named'?{patientName:mention.name}:patientScoped&&selectedPatientId?{patientId:selectedPatientId}:{};
 const id='requested_1',args={partIds:[id],...frenchReadArgumentBindings(scope,'query_consultations'),...identity,mode:'list' as const,status:scope.consultationStatus??'all' as const};
 if(!agentSchemas.query_consultations.safeParse(args).success)return null;
 return {part:{id,goal:text,tools:['query_consultations'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]},call:{id:`direct-${clientTurnId}-${id}`,name:'query_consultations',args}};
}
function directNamedPatientSearchCall(text:string,clientTurnId:string):{part:RequestPart;call:AgentCall}|null {
 const mention=parsePatientMention(text);
 if(mention.status!=='named'||!/^\s*(?:alexa[, :]+)?(?:cherche|recherche|trouve|retrouve)\s+(?:plut[oô]t\s+)?(?:(?:le|la)\s+)?(?:(?:patient|patiente)\s+)?[\p{L}][\p{L}\p{M}'’-]*(?:\s+[\p{L}][\p{L}\p{M}'’-]*){1,2}\s*[.!?]*\s*$/iu.test(text))return null;
 const scope=frenchRequestAdmission(text,false);
 if(scope.tools?.length!==1||scope.tools[0]!=='query_patients')return null;
 const id='requested_1',args={partIds:[id],mode:'list' as const,population:'all' as const,query:mention.name};
 if(!agentSchemas.query_patients.safeParse(args).success)return null;
 return {part:{id,goal:text,tools:['query_patients'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]},call:{id:`direct-${clientTurnId}-${id}`,name:'query_patients',args}};
}
function directDocumentReadCall(text:string,clientTurnId:string,selectedPatientId:string|null,asOf:string):{part:RequestPart;call:AgentCall}|null{
 const scope=frenchRequestAdmission(text,false,asOf),plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase(),cabinetWideScope=requestsCabinetWideScope(text),mention=parsePatientMention(cabinetWideScope?withoutCabinetWideScope(text):text);
 const listIntent=/\b(?:quel(?:le)?s?\s+(?:documents?|certificats?|ordonnances?|justificatifs?)|combien|liste\w*|affich\w*|montre\w*|donne\w*|indique\w*|trouve\w*|cherche\w*|recherche\w*|enumere\w*|y a-t-il|existe\w*)\b/u.test(plain);
 const explicitContentIntent=/\b(?:lis(?:ez|ons|ent)?|lire|contenu|texte integral|details?|pages?)\b/u.test(plain)||/\b[a-f0-9]{8}-[a-f0-9-]{27,}\b/u.test(plain);
 const patientWorkspaceRequest=!!scope.documentKind&&!explicitContentIntent&&!cabinetWideScope&&(mention.status==='named'||!!selectedPatientId);
 if(scope.tools?.length!==1||scope.tools[0]!=='query_documents'||(!listIntent&&!patientWorkspaceRequest)||explicitContentIntent||mention.status==='ambiguous')return null;
 const patientScoped=mention.status==='named'||/\b(?:patient(?:e)?|dossier|son|sa|ses)\b/u.test(plain)||!!selectedPatientId&&!cabinetWideScope;
 if(patientScoped&&mention.status!=='named'&&!selectedPatientId)return null;
 const identity=mention.status==='named'?{patientName:mention.name}:patientScoped&&selectedPatientId?{patientId:selectedPatientId}:{};
 const id='requested_1',args={partIds:[id],...frenchReadArgumentBindings(scope,'query_documents'),...identity};
 if(!agentSchemas.query_documents.safeParse(args).success)return null;
 return {part:{id,goal:text,tools:['query_documents'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]},call:{id:`direct-${clientTurnId}-${id}`,name:'query_documents',args}};
}
function directConsultationMonthComparison(text:string,clientTurnId:string,selectedPatientId:string|null,asOf:string):DirectWorkflow|null{
 const periods=explicitFrenchComparedMonthRanges(text,asOf),mention=parsePatientMention(text);
 if(!periods||mention.status==='ambiguous')return null;
 const normalized=text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase(),dateAxis=/\bdate (?:de )?(?:cloture|fin)\b/u.test(normalized)?'ended_at' as const:'started_at' as const;
 const status=/\b(?:termine\w*|clos\w*|cloture\w*|acheve\w*|ferme\w*)\b/u.test(normalized)?'closed' as const:/\b(?:ouvert\w*|en cours)\b/u.test(normalized)?'open' as const:'all' as const;
 const identity=mention.status==='named'?{patientName:mention.name}:selectedPatientId?{patientId:selectedPatientId}:{};
 const parts:RequestPart[]=periods.map((period,index)=>({id:`requested_${index+1}`,goal:`Consultations ${status==='closed'?'terminées':status==='open'?'ouvertes':''} en ${period.month} ${period.year}`.replace(/\s+/gu,' ').trim(),tools:['query_consultations'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]}));
 const monthLabels:Record<typeof periods[number]['month'],string>={janvier:'Janvier',fevrier:'Février',mars:'Mars',avril:'Avril',mai:'Mai',juin:'Juin',juillet:'Juillet',aout:'Août',septembre:'Septembre',octobre:'Octobre',novembre:'Novembre',decembre:'Décembre'};
 const plans=periods.map((period,index)=>{const part=parts[index]!;return {part,comparisonLabel:`${monthLabels[period.month]} ${period.year}`,args:{partIds:[part.id],...identity,from:period.from,to:period.to,dateAxis,status,mode:'count'}};});
 if(plans.some(plan=>!agentSchemas.query_consultations.safeParse(plan.args).success))return null;
 const steps:DirectWorkflowStep[]=plans.map(({part,comparisonLabel,args})=>({partIds:[part.id],goal:part.goal,comparisonLabel,call:{id:`direct-${clientTurnId}-${part.id}`,name:'query_consultations',args}}));
 return {parts,steps};
}
interface DirectWorkflowStep {call:AgentCall;partIds:string[];goal:string;after?:string;reviewDisclaimer?:boolean;comparisonLabel?:string}
interface DirectWorkflow {parts:RequestPart[];steps:DirectWorkflowStep[];presentation?:{kind:'created-collected-difference';from:string}}
function directFinanceComparisonWorkflow(text:string,clientTurnId:string,asOf:string):DirectWorkflow|null{
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase(),scope=frenchRequestAdmission(text,false,asOf);
 if(!/\b(?:difference|compar\w*)\b/u.test(plain)||!/\brecettes? encaisse\w*\b/u.test(plain)||!/\bpaiements? cree\w*\b/u.test(plain)||scope.tools?.length!==1||scope.tools[0]!=='query_finance'||scope.financeMode!=='totals'||!scope.from||!scope.to)return null;
 const month=new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric',timeZone:'Africa/Algiers'}).format(new Date(scope.from));
 const parts:RequestPart[]=[
  {id:'requested_1',goal:`Paiements créés en ${month}`,tools:['query_finance'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]},
  {id:'requested_2',goal:`Recettes encaissées en ${month}`,tools:['query_finance'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]},
 ];
 const steps:DirectWorkflowStep[]=parts.map((part,index)=>({partIds:[part.id],goal:part.goal,call:{id:`direct-${clientTurnId}-finance-${index===0?'created':'collected'}`,name:'query_finance',args:{partIds:[part.id],mode:'totals',state:index===0?'all':'collected',from:scope.from,to:scope.to}}}));
 if(steps.some(step=>!agentSchemas.query_finance.safeParse(step.call.args).success))return null;
 return {parts,steps,presentation:{kind:'created-collected-difference',from:scope.from}};
}
function directMixedReadWorkflow(text:string,clientTurnId:string,selectedPatientId:string|null,asOf:string):DirectWorkflow|null{
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
 const periodMatch=/\b(demain|aujourd'hui|aujourd’hui)\b/u.exec(plain),period=periodMatch?.[1];
 if(!period)return null;
 const hasAgenda=/\b(?:rendez[- ]?vous|rdv)\b/u.test(plain),hasFinance=/\b(?:encaisse\w*|recettes? encaisse\w*)\b/u.test(plain),hasPatientCount=/\b(?:nombre de|combien de|compte\w*)\s+patients?\b/u.test(plain);
 const topNames=/\b(\d{1,2}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s+premier(?:s|es)?\b/u.exec(plain);
 const agendaStatusCount=hasAgenda&&!hasFinance&&!hasPatientCount&&/\bconfirm\w*\b/u.test(plain)&&/\b(?:nombre|total)\b/u.test(plain);
 const simpleAgendaPage=hasAgenda&&!hasFinance&&!hasPatientCount&&!!topNames&&/\b(?:total|nombre)\b/u.test(plain);
 if(!(hasFinance&&hasAgenda||agendaStatusCount||simpleAgendaPage))return null;
 const parts:RequestPart[]=[],steps:DirectWorkflowStep[]=[];
 const append=(entry:{part:RequestPart;parts?:RequestPart[];call:AgentCall},goal:string)=>{
  const sourceParts=entry.parts??[entry.part],ids=sourceParts.map((_,index)=>`requested_${parts.length+index+1}`);
  const mapped=sourceParts.map((part,index)=>({...part,id:ids[index]!,goal:sourceParts.length===1?goal:part.goal}));
  parts.push(...mapped);
  const partIds=mapped.map(part=>part.id),call={...entry.call,id:`direct-${clientTurnId}-mixed-${partIds[0]}`,args:{...entry.call.args,partIds}};
  steps.push({call,partIds,goal:sourceParts.length===1?goal:mapped.map(part=>part.goal).join(' ; ')});
 };
 const periodText=period==='aujourd’hui'?"aujourd’hui":period;
 if(simpleAgendaPage){
  const matchedPhrase=topNames[0],pageToken=topNames[1];if(!matchedPhrase||!pageToken)return null;
  const phrase=matchedPhrase.replace(/\s+/gu,' '),query=`Montre les ${phrase} rendez-vous ${periodText}.`,baseQuery=`Montre les rendez-vous ${periodText}.`,agenda=directAgendaReadCall(baseQuery,clientTurnId,selectedPatientId,asOf);
  const limit=/^\d+$/u.test(pageToken)?Number(pageToken):({un:1,une:1,deux:2,trois:3,quatre:4,cinq:5,six:6,sept:7,huit:8,neuf:9,dix:10} as const)[pageToken as 'un'|'une'|'deux'|'trois'|'quatre'|'cinq'|'six'|'sept'|'huit'|'neuf'|'dix'];
  if(!agenda||!limit)return null;agenda.part={...agenda.part,goal:query};agenda.call.args={...agenda.call.args,limit};append(agenda,query);return {parts,steps};
 }
 if(agendaStatusCount){
  const statusQuery=`Montre les rendez-vous confirmés ${periodText}.`,countQuery=`Combien de rendez-vous sont prévus ${periodText}?`;
  const status=directAgendaReadCall(statusQuery,clientTurnId,selectedPatientId,asOf),countRead=directAgendaReadCall(countQuery,clientTurnId,selectedPatientId,asOf);
  if(!status||!countRead)return null;append(status,statusQuery);append(countRead,countQuery);return {parts,steps};
 }
 let patient:ReturnType<typeof directPatientMetricReadCall>|null=null;
 if(hasPatientCount){
  const fragment=/\b(?:le\s+nombre\s+de|combien\s+de|compte\w*)\s+patients?\b[^,;.!?]*/iu.exec(text)?.[0];
  if(!fragment)return null;
  const patientQuestion=fragment.replace(/^\s*le\s+nombre\s+de\s+/iu,'Combien de ').replace(/[?!.]+$/u,'')+' ?';
  const contract=frenchPatientCountContract(patientQuestion);if(!contract)return null;
  patient=directPatientMetricReadCall(contract,clientTurnId);if(!patient)return null;
 }
 if(patient)append(patient,patient.part.goal);
 if(hasFinance){
  const monthMatch=/\bce mois\b|\b(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+20\d{2}\b/u.exec(plain)?.[0];
  if(!monthMatch)return null;
  const monthNames=['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'],named=monthMatch.match(/^(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(20\d{2})$/u);
  const year=named?Number(named[2]):Number(asOf.slice(0,4)),monthIndex=named?monthNames.indexOf(named[1]!):Number(asOf.slice(5,7))-1;
  if(!Number.isInteger(year)||monthIndex<0)return null;
  const lastDay=new Date(Date.UTC(year,monthIndex+1,0)).getUTCDate(),monthLabel=monthNames[monthIndex]!;
  const financeQuestion=`Quel montant représentent les paiements encaissés du 1 ${monthLabel} ${year} au ${lastDay} ${monthLabel} ${year} ?`;
  const finance=directFinanceReadCall(financeQuestion,clientTurnId,null,asOf);if(!finance)return null;append(finance,financeQuestion);
 }
 const agendaQuestion=`Combien de rendez-vous sont prévus ${periodText}?`,agenda=directAgendaReadCall(agendaQuestion,clientTurnId,selectedPatientId,asOf);
 if(!agenda)return null;append(agenda,agendaQuestion);
 return parts.length>=2&&parts.length<=AGENT_LIMITS.calls?{parts,steps}:null;
}
function directExtendedCounts(contract:NonNullable<ReturnType<typeof frenchPatientCountContract>>,clientTurnId:string,asOf:string):DirectWorkflow|null {
 if(contract.clauses.length<1||contract.clauses.length>AGENT_LIMITS.calls)return null;
 const queries=contract.clauses.map(clause=>patientQueryContract(clause,asOf));
 const separateMissingIdentityAndPhone=contract.clauses.length===2&&queries.every(query=>query.filterGroups.length===1&&query.filterGroups[0]?.length===1)&&queries.flatMap(query=>query.filterGroups.flat().map(condition=>`${condition.field}:${condition.op}`)).sort().join('|')==='identity_card:missing|phone:missing';
 if(!queries.some(query=>query.extended||query.unsupported.length)&&!separateMissingIdentityAndPhone)return null;
 const parts=countContractParts(contract).map((part,index):RequestPart=>({...part,conditions:queries[index]!.filterGroups.length===1?queries[index]!.filterGroups[0]!:[],constraintLedger:queries[index]!.ledger,...(queries[index]!.unsupported.length?{status:'unsupported',reason:agentCopy.fr.unsupported+' '+queries[index]!.unsupported.join(' ; ')}:{})}));
 const steps:DirectWorkflowStep[]=parts.flatMap((part,index)=>{
  if(part.status==='unsupported')return [];
  const query=queries[index]!,predicates=query.filterGroups.length>1?{filterGroups:query.filterGroups}:{filters:query.filterGroups[0]??[]};
  const args={partIds:[part.id],mode:'count',population:query.population,...predicates,...(query.consultationPeriod?{consultationPeriod:query.consultationPeriod}:{}),...(query.createdPeriod?{createdPeriod:query.createdPeriod}:{})};
  return [{partIds:[part.id],goal:contract.clauses[index]!,call:{id:`direct-${clientTurnId}-${part.id}`,name:'query_patients',args}}];
 });
 return {parts,steps};
}
function directAgendaAdministrativeReview(text:string,clientTurnId:string,asOf:string):DirectWorkflow|null {
 const outputs=frenchRequestedOutputs(text);
 if(!outputs||outputs.length<3||outputs.length>7)return null;
 const agendaIndexes=outputs.flatMap((goal,index)=>requestedReadTool(goal,text)==='query_agenda'?[index]:[]);
 if(agendaIndexes.length!==1)return null;
 const agendaIndex=agendaIndexes[0]!,agendaGoal=outputs[agendaIndex]!,agenda=directAgendaReadCall(agendaGoal,clientTurnId,null,asOf);
 if(!agenda)return null;
 const adminCondition={field:'administrative_incomplete' as const,op:'eq' as const,value:true};
 const correctionRequest=/\b(?:prepar\w*|etabl\w*|dress\w*|liste\w*)\b[^.!?]*\bcorrections?\b[^.!?]*\b(?:verifi\w*|control\w*|revoir|valider)\b/u.test(text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase());
 const hasGapRead=outputs.some((goal,index)=>index!==agendaIndex&&isAdministrativeReview(goal,text));
 const hasFieldRead=outputs.some((goal,index)=>index!==agendaIndex&&/\bchamps?\s+manquants?\b/u.test(goal.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()));
 const reviewIndexes=outputs.flatMap((goal,index)=>index!==agendaIndex&&(
   isAdministrativeReview(goal,text)||/\bchamps?\s+manquants?\b/u.test(goal.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase())||
   (/\bcorrections?\b/u.test(goal.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase())&&correctionRequest)
 )?[index]:[]);
 const hasActualWrite=/\b(?:modifi\w*|enregistr\w*|corrig\w*|sauvegard\w*|appliqu\w*|supprim\w*|annul\w*|sign\w*|encaisser)\b/u.test(text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase());
 if(!hasGapRead||!hasFieldRead||!correctionRequest||hasActualWrite||reviewIndexes.length!==outputs.length-1)return null;
 const agendaId=`requested_${agendaIndex+1}`;
 const parts:RequestPart[]=outputs.map((goal,index)=>index===agendaIndex?{...agenda.part,id:agendaId,goal,status:'pending' as const,resultRefs:[]}:{id:`requested_${index+1}`,goal,tools:['query_patients'],conditions:[adminCondition],dependsOn:[agendaId],status:'pending' as const,resultRefs:[]});
 agenda.call.args={...agenda.call.args,partIds:[agendaId]};
 const reviewPartIds=reviewIndexes.map(index=>`requested_${index+1}`);
 const reviewArgs={partIds:reviewPartIds,mode:'review' as const,population:'active' as const,filters:[adminCondition],limit:20};
 if(!agentSchemas.query_agenda.safeParse(agenda.call.args).success||!agentSchemas.query_patients.safeParse(reviewArgs).success)return null;
 const reviewCall:AgentCall={id:`direct-${clientTurnId}-administrative-review`,name:'query_patients',args:reviewArgs};
 return {parts,steps:[{call:agenda.call,partIds:[agendaId],goal:agendaGoal},{call:reviewCall,partIds:reviewPartIds,goal:outputs[reviewIndexes[0]!]!,after:agendaId,reviewDisclaimer:true}]};
}
function compact(value:unknown):unknown {
  if(Array.isArray(value))return value.map(compact);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([k])=>!["$schema","minLength","maxLength","minimum","maximum","pattern","format","minItems","maxItems","additionalProperties"].includes(k)).map(([k,v])=>[k,compact(v)]));
  return value;
}
const declarationSchema=compactDeclarationSchema;
const tools: LocalTool[] = Object.entries(agentSchemas).map(([name, schema]) => ({ type: "function", function: { name, description: agentDescriptions[name as keyof typeof agentDescriptions], parameters: compact(z.toJSONSchema(name==="declare_request"?declarationSchema:schema)) as Record<string,unknown> } }));
export async function runAgentLoop(input: TurnInput, deps: AgentLoopDependencies, externalSignal: AbortSignal): Promise<AgentOutcome> {
  const observeResult=(observation:AgentToolResultObservation)=>{try{deps.observeResult?.(observation);}catch{/* Evaluation telemetry cannot change the turn result. */}};
  const now=Date.now(),asOf=deps.asOf?z.iso.datetime({offset:true}).parse(deps.asOf):new Date(now).toISOString();
  const key=JSON.stringify([deps.actor,input.conversationId]),pendingTask=tasks.get(key);
  const pendingPatientScopeClarification=!!pendingTask&&now-pendingTask.at<=AGENT_LIMITS.ttlMs&&pendingTask.patientId===null&&pendingTask.page===input.appContext.page&&pendingTask.parts.some(part=>part.status==='needs_input')&&pendingTask.results.some(result=>result.status==='needs_input'&&result.callId.startsWith('patient-scope-'));
  const pendingClarification=!!pendingTask&&now-pendingTask.at<=AGENT_LIMITS.ttlMs&&(pendingTask.patientId===(input.appContext.patientId??null)||pendingPatientScopeClarification)&&pendingTask.page===input.appContext.page&&pendingTask.parts.some(part=>part.status==='needs_input');
  if(unsupportedClinicalTimelineRestriction(input.text)){
    const id=`restriction-${input.clientTurnId}`,text=applicationReadCopy.timelineRestriction;
    const result:AgentResult={callId:id,status:'unsupported',complete:false,text,evidence:[],conditionKeys:[],error:{code:'unsupported-timeline-restriction',retryable:false}};
    const part:RequestPart={id:'requested_1',goal:input.text,tools:[],conditions:[],dependsOn:[],status:'unsupported',resultRefs:[id],reason:text};
    return {status:'partial',parts:[part],results:[result],sentences:[text],sources:[],patientId:null,tokensIn:0,tokensOut:0};
  }
  const language = ALEXA_AGENT_LANGUAGE, copy = agentCopy[language];
  if(pendingPatientScopeClarification&&pendingTask){
    if(!input.appContext.patientId){
      const patientName=explicitPatientClarificationName(input.text);
      if(!patientName){
        const id=`patient-scope-${input.clientTurnId}`,message=copy.patient;
        const part:RequestPart={id:'requested_1',goal:pendingTask.original,tools:[],conditions:[],dependsOn:[],status:'needs_input',resultRefs:[id],reason:message};
        const result:AgentResult={callId:id,status:'needs_input',complete:false,text:message,evidence:[],conditionKeys:[]};
        tasks.set(key,{original:pendingTask.original,parts:[part],results:[result],at:now,patientId:null,page:input.appContext.page});
        return {status:'needs_input',parts:[part],results:[result],sentences:[message],sources:[],patientId:null,tokensIn:0,tokensOut:0};
      }
      input={...input,text:`patient ${patientName}`};
    }
  }
  const requestText=pendingClarification&&pendingTask?`${pendingTask.original} ${input.text}`:input.text;
  const quotedInstructionPolicy=isFrenchQuotedInstructionPolicyQuestion(requestText),countContract=quotedInstructionPolicy?null:frenchPatientCountContract(requestText);
  const compoundContract=quotedInstructionPolicy?null:frenchPatientCompoundContract(requestText);
  const requestedOutputText=pendingClarification&&pendingTask?pendingTask.original:requestText;
  const requestedOutputs=!quotedInstructionPolicy&&!countContract&&!compoundContract?frenchRequestedOutputs(requestedOutputText):null;
  const requestedTools=requestedOutputs?.map(goal=>requestedReadTool(goal,requestText));
  const knownReadTools=requestedTools?.every((tool):tool is NonNullable<typeof tool>=>!!tool)?[...new Set(requestedTools)]:null;
  const textAdmission=frenchRequestAdmission(requestText,canAnswerGeneralAlexa(requestText),asOf,input.appContext.documentId);
  const admission=quotedInstructionPolicy?{tools:['answer_general'],profileOnly:false}:compoundContract?{tools:['query_patients'],profileOnly:false}:textAdmission.tools?.includes('prepare_action')?textAdmission:knownReadTools?knownReadTools.length===1&&knownReadTools[0]==='prepare_action'?textAdmission:{tools:knownReadTools,profileOnly:false}:textAdmission;
  const action=admission.preparationAction??'';
  const patientTargetActions=['create_appointment','reschedule_appointment','cancel_appointment','mark_patient_arrived','create_editable_document_draft','update_editable_document_draft','print_issued_document','update_treatment','pause_treatment','resume_treatment','stop_treatment'];
  const requestFolded=requestText.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
  const missingSelectedPatient=!input.appContext.patientId&&!input.patientName&&/\b(?:patient|patiente|dossier)\s+(?:selectionne|courant|actuel|choisie?)\b/u.test(requestFolded);
  if(!pendingClarification&&missingSelectedPatient&&patientTargetActions.includes(action)){
    const id=`patient-scope-${input.clientTurnId}`,message=copy.patient;
    const part:RequestPart={id:'requested_1',goal:requestText,tools:[],conditions:[],dependsOn:[],status:'needs_input',resultRefs:[id],reason:message};
    const result:AgentResult={callId:id,status:'needs_input',complete:false,text:message,evidence:[],conditionKeys:[]};
    tasks.set(key,{original:requestText,parts:[part],results:[result],at:now,patientId:null,page:input.appContext.page});
    return {status:'needs_input',parts:[part],results:[result],sentences:[message],sources:[],patientId:null,tokensIn:0,tokensOut:0};
  }
  const directTreatmentAction=!pendingClarification&&!/\b(?:et|puis|ensuite|ou|mais)\b|[;\n]/iu.test(requestText)&&admission.tools?.length===1&&admission.tools[0]==='prepare_action'&&!(patientTargetActions.includes(action)&&missingSelectedPatient)&&['create_appointment','reschedule_appointment','cancel_appointment','mark_patient_arrived','set_consultation_price','record_payment_collected','close_consultation','create_editable_document_draft','update_editable_document_draft','print_issued_document','update_treatment','pause_treatment','resume_treatment','stop_treatment','create_charge','update_charge','deactivate_charge','send_internal_message'].includes(action);
  const completePublic=admission.tools?.length===1&&admission.tools[0]==="answer_general";
  // A known read gate owns missing-slot checks; population predicates belong to patient queries, never to answer topics.
  const plainReadDeclaration=admission.tools?.length===1&&['get_patient_context','query_consultations','query_agenda','query_documents','query_finance','query_app','search_knowledge','prepare_action','navigate'].includes(admission.tools[0]!)&&!countContractHints({clauses:[requestText]})[0]!.conditions.length;
  for (const [k, task] of tasks) if (now - task.at > AGENT_LIMITS.ttlMs) tasks.delete(k);
  while (tasks.size >= 256) tasks.delete(tasks.keys().next().value!);
  const old = tasks.get(key), prior = old && (old.patientId === input.appContext.patientId||pendingPatientScopeClarification||!!deps.resumeCursor&&old.patientId===deps.resumeCursor.patientId) && old.page === input.appContext.page ? old : undefined;
  const patientReadTools=['query_patients','get_patient_context','query_consultations','query_agenda','query_documents','query_finance'];
  const patientScopeText=input.text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
  const patientObjectMention=/\b(?:dossier|patient(?:e)?|consultations?|seances?|notes?|traitements?|diagnostics?|echelles?|telephones?|numeros?|coordonnees|adresses?|documents?)\b/u.test(patientScopeText);
  const explicitPatientObject=requestsPatientScope(input.text)&&patientObjectMention;
  const patientScopedRead=explicitPatientObject||!completePublic&&(admission.tools?.some(tool=>patientReadTools.includes(tool))||patientReadTools.includes(requestedReadTool(input.text,input.text)??''));
  if(patientScopedRead&&!input.appContext.patientId&&!prior?.patientId&&!requestsCabinetWideScope(input.text)&&parsePatientMention(input.text).status==='none'&&requestsPatientScope(input.text)){
    const id=`patient-scope-${input.clientTurnId}`,message=copy.patient;
    const part:RequestPart={id:'requested_1',goal:input.text,tools:[],conditions:[],dependsOn:[],status:'needs_input',resultRefs:[id],reason:message};
    const result:AgentResult={callId:id,status:'needs_input',complete:false,text:message,evidence:[],conditionKeys:[]};
    tasks.set(key,{original:input.text,parts:[part],results:[result],at:now,patientId:null,page:input.appContext.page});
    return {status:'needs_input',parts:[part],results:[result],sentences:[message],sources:[],patientId:null,tokensIn:0,tokensOut:0};
  }
  if(prior&&/^(?:annule cette demande|annuler|ألغ هذا الطلب|إلغاء)[.!؟]?$/u.test(input.text.trim().toLowerCase())){
    tasks.delete(key);return {status:"cancelled",parts:prior.parts.map(p=>({...p,status:"cancelled",reason:copy.cancelled})),results:[],sentences:[copy.cancelled],sources:[],patientId:null,tokensIn:0,tokensOut:0};
  }
  const signal = AbortSignal.any([externalSignal, AbortSignal.timeout(AGENT_LIMITS.deadlineMs)]);
  const fullPrompt=agentPrompt(language,asOf)+"\nSi un résultat indique continuation.available=true, reprends cette même lecture avec le même partId, section notes et reusePrevious=true. Continue tant que le budget le permet ; ne présente jamais une page partielle comme un dossier complet.";
  const continuingClarification=prior?.parts.some(p=>p.status==="needs_input");
  if(unresolvedConsultationPeriod(input.text,asOf)){
    const message=applicationReadCopy.periodClarification,id=`period-${input.clientTurnId}`;
    const part:RequestPart={id:'requested_1',goal:input.text,tools:[],conditions:[],dependsOn:[],status:'needs_input',resultRefs:[id],reason:message};
    const result:AgentResult={callId:id,status:'needs_input',complete:false,text:message,evidence:[],conditionKeys:[]};
    tasks.set(key,{original:continuingClarification&&prior?`${prior.original} ${input.text}`:input.text,parts:[part],results:[result],at:Date.now(),patientId:prior?.patientId??input.appContext.patientId,page:input.appContext.page});
    return {status:'needs_input',parts:[part],results:[result],sentences:[message],sources:[],patientId:prior?.patientId??input.appContext.patientId,tokensIn:0,tokensOut:0};
  }
  const previousContext=prior?{...(continuingClarification?{original:prior.original,pending:prior.parts.filter(p=>p.status!=="answered")}:{}),lastResults:prior.results.slice(-2).map(r=>({data:r.data&&typeof r.data==="object"&&"patientQuery" in r.data?{patientQuery:r.data.patientQuery}:undefined}))}:null;
  const admittedTools=admission.tools??(countContract?['query_patients']:undefined);
  const requestedOutputTools=requestedOutputs?.map(goal=>requestedReadTool(goal,input.text)).filter((tool):tool is NonNullable<typeof tool>=>tool!==undefined);
  const promptTools=requestedOutputTools?.length?requestedOutputTools:admittedTools?.length===1&&(admittedTools[0]==='answer_general'||directTreatmentAction)?admittedTools:undefined;
  const messages: LocalMessage[] = [{role:"system",content:agentMetadataPrompt(promptTools)+(admittedTools?"\nOutils de domaine admis pour cette demande : "+admittedTools.join(", ")+". Déclare uniquement l’un de ces outils.":"")+(countContract?"\nSorties et conditions explicites à conserver, sans donnée ni permission supplémentaire : "+JSON.stringify(countContractHints(countContract)):"")+(compoundContract?"\nSorties et conditions explicites de la population à conserver, sans donnée ni permission supplémentaire : "+JSON.stringify(compoundContractHints(compoundContract)):"")+(requestedOutputs?"\nSorties explicites : chaque goal doit reprendre exactement une clause, une fois : "+JSON.stringify(requestedOutputs):"")},{role:"user",content:requestText+"\nPatient sélectionné : "+(input.appContext.patientId?"oui":"non")+(prior?"\nDemande précédente : "+JSON.stringify(previousContext):"")}];
  let parts: RequestPart[] = directTreatmentAction?[{id:'requested_1',goal:input.text,tools:['prepare_action','ask_doctor'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]}]:[], results: AgentResult[] = [], declared = directTreatmentAction, calls = 0, rounds = 0, steps = 0, tokensIn = 0, tokensOut = 0, finalText = "",inferenceFailed=false,resumingPatientQuery=false,resumingTimelineQuery=false,resumingApplicationQuery=false,resumingNoteQuery=false,resumingConsultationQuery=false,resumingFinanceQuery=false,resumingDocumentQuery=false,plainRecovery=0,noteContinuationBudget=0;
  const focus=input.text.normalize('NFKD').replace(/\p{M}/gu,'').replace(/[’‘]/gu,"'").toLowerCase().trim().replace(/[?!.]+$/gu,'');
   const proposalDispositionRequest=/\b(?:refuse|rejette|repete|rejoue|relance|annule)\b[^.!?]{0,160}\bproposition\b|\bproposition\b[^.!?]{0,160}\b(?:refuse|rejette|repete|rejoue|relance|annule)\b/u.test(focus);
   if(proposalDispositionRequest){
    const hasPendingProposal=prior?.parts.some(part=>part.status==='proposed')??false;
    const message=hasPendingProposal?copy.proposalUseConfirmation:copy.proposalStateMissing;
    const part:RequestPart={id:'proposal-state',goal:input.text,tools:[],conditions:[],dependsOn:[],status:'needs_input',resultRefs:[],reason:message};
    return {status:'needs_input',parts:[part],results:[],sentences:[message],sources:[],patientId:prior?.patientId??input.appContext.patientId,tokensIn:0,tokensOut:0};
   }
  const continuationKind=deps.resumeCursor?.kind??(noteContinuation(input.text)?'any':/^(?:(?:la suite|suite)(?: de l[’'])?\s+)?(?:l[’'])?accueil$/u.test(focus)?'application':/^(?:(?:la suite|suite)(?: de la)?\s+)?(?:la\s+)?chronologie$/u.test(focus)?'timeline':/^(?:(?:la suite|suite)(?: du)?\s+)?(?:le\s+)?(?:document|brouillon)$/u.test(focus)?'document':/^(?:(?:la suite|suite)(?: du)?\s+)?(?:le\s+)?calendrier(?: financier)?$/u.test(focus)?'calendar':/^(?:(?:la suite|suite)(?: de)?\s+)?(?:l'|la\s+)?analyse$/u.test(focus)?'analysis':/^(?:(?:la suite|suite)(?: des?| de la)?\s+)?(?:les?\s+)?notes$/u.test(focus)?'notes':null);
  const unfinished=continuationKind?prior?.results.flatMap(r=>{
   if(!r.data||typeof r.data!=="object"||r.complete)return [];
   const data=r.data as Record<string,unknown>;
   const kind="applicationQuery" in data&&typeof data["nextOffset"]==='number'?'application':"timelineQuery" in data&&data["timelineNext"]?'timeline':"documentQuery" in data&&typeof data["nextTextOffset"]==='number'?'document':"noteQuery" in data&&data["next"]?'notes':"consultationQuery" in data&&typeof data["nextTextOffset"]==="number"?'analysis':"financeQuery" in data&&typeof data["nextOffset"]==='number'?'calendar':null;
   return kind?[{kind,data,callId:r.callId,label:r.evidence.find(e=>e.type==="consultation")?.label}]:[];
  })??[]:[];
  const matching=unfinished.filter(cursor=>(continuationKind==='any'||cursor.kind===continuationKind)&&(!deps.resumeCursor||cursor.callId===deps.resumeCursor.cursorId));
  const noCursor=continuationKind&&prior&&!matching.length&&prior.results.some(r=>r.data&&typeof r.data==="object"&&("applicationQuery" in r.data||"timelineQuery" in r.data||"noteQuery" in r.data||"consultationQuery" in r.data||"financeQuery" in r.data||"documentQuery" in r.data))&&!prior.results.some(r=>r.data&&typeof r.data==="object"&&"patientQuery" in r.data);
  if(deps.resumeCursor&&matching.length!==1){
   const message=copy.noContinuation,part:RequestPart={id:"continuation",goal:input.text,tools:[],conditions:[],dependsOn:[],status:"failed",resultRefs:[],reason:message};
   tasks.delete(key);
   return {status:"failed",parts:[part],results:[],sentences:[message],sources:[],patientId:input.appContext.patientId,tokensIn:0,tokensOut:0};
  }
  if(prior&&(matching.length>1||noCursor)){
   const question=matching.length>1?copy.continuationChoice(matching.map(cursor=>(cursor.kind==='application'?applicationReadCopy.extended.receptionName:cursor.kind==='timeline'?applicationReadCopy.extended.timeline:cursor.kind==='document'?copy.document:cursor.kind==='notes'?copy.notes:cursor.kind==='analysis'?copy.analysis:copy.calendar)+(cursor.label?' — '+cursor.label:'')).join(' ; ')):copy.noContinuation;
   const part:RequestPart={id:"continuation",goal:input.text,tools:[],conditions:[],dependsOn:[],status:"needs_input",resultRefs:[],reason:question};
   tasks.set(key,{...prior,parts:[part],at:Date.now()});
   return {status:"needs_input",parts:[part],results:[],sentences:[question],sources:[],patientId:prior.patientId,tokensIn:0,tokensOut:0};
  }
  if(matching.length===1&&matching[0]!.kind==='application'){parts=[{id:'continuation',goal:input.text,tools:['query_app'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]}];declared=true;resumingApplicationQuery=true;}
  if(matching.length===1&&matching[0]!.kind==='timeline'){parts=[{id:'continuation',goal:input.text,tools:['get_patient_context'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]}];declared=true;resumingTimelineQuery=true;}
  const lastNotes=matching.length===1&&matching[0]!.kind==='notes'?matching[0]!.data:undefined;
  if(lastNotes){parts=[{id:"continuation",goal:input.text,tools:["get_patient_context"],conditions:[],dependsOn:[],status:"pending",resultRefs:[]}];declared=true;resumingNoteQuery=true;}
  const lastAnalysis=matching.length===1&&matching[0]!.kind==='analysis'?matching[0]!.data:undefined;
  if(lastAnalysis){parts=[{id:"continuation",goal:input.text,tools:["query_consultations"],conditions:[],dependsOn:[],status:"pending",resultRefs:[]}];declared=true;resumingConsultationQuery=true;}
  const lastFinance=matching.length===1&&matching[0]!.kind==='calendar'?matching[0]!.data:undefined;
  if(lastFinance){parts=[{id:"continuation",goal:input.text,tools:["query_finance"],conditions:[],dependsOn:[],status:"pending",resultRefs:[]}];declared=true;resumingFinanceQuery=true;}
  const lastDocument=matching.length===1&&matching[0]!.kind==='document'?matching[0]!.data:undefined;
  if(lastDocument){parts=[{id:"continuation",goal:input.text,tools:["query_documents"],conditions:[],dependsOn:[],status:"pending",resultRefs:[]}];declared=true;resumingDocumentQuery=true;}
  const lastQuery=!resumingApplicationQuery&&!resumingTimelineQuery&&!resumingDocumentQuery&&!resumingNoteQuery&&!resumingConsultationQuery&&!resumingFinanceQuery&&patientListContinuation(input.text)?[...(prior?.results??[])].reverse().find(r=>["ok","empty"].includes(r.status)&&r.data&&typeof r.data==="object"&&"patientQuery" in r.data)?.data:undefined;
  if(lastQuery&&typeof lastQuery==="object"&&"patientQuery" in lastQuery&&lastQuery.patientQuery&&typeof lastQuery.patientQuery==="object"){
    const parsed=queryPatientsSchema.safeParse({...lastQuery.patientQuery,partIds:["continuation"]});
    if(parsed.success&&(parsed.data.mode!=="metrics"||parsed.data.metrics?.length===1)){
      const query=parsed.data,conditions=[...(query.filters??[]),...(query.mode==="metrics"?patientMetricConditions[query.metrics![0]!]:[])];
      parts=[{id:"continuation",goal:input.text,tools:["query_patients"],conditions,dependsOn:[],status:"pending",resultRefs:[],...(query.population?{population:query.population}:{}),...(query.query?{literalQuery:query.query}:{})}];declared=true;resumingPatientQuery=true;
    }
  }
  const freshRead=!prior||prior.parts.every(part=>['answered','unsupported','failed','budget_limited','cancelled'].includes(part.status))||pendingPatientScopeClarification;
  const nonExecutableComparison=nonExecutableLatestComparison(input.text);
  const directNamedComparisonCall=!declared&&freshRead?directNamedLatestConsultationComparisonCall(input.text,input.clientTurnId,asOf):null;
  const directMetricRead=!declared&&freshRead&&countContract&&!compoundContract?directPatientMetricReadCall(countContract,input.clientTurnId):null;
  const directCompoundRead=!declared&&freshRead&&compoundContract?directPatientCompoundReadCall(compoundContract,input.clientTurnId):null;
  const directMixedMetricAgenda=!declared&&freshRead&&!compoundContract?directMixedMetricAgendaCalls(input.text,input.clientTurnId,input.appContext.patientId,asOf):null;
  const directPublicAnswer=!declared&&freshRead&&!requestedOutputs&&!countContract&&!compoundContract&&completePublic?directPublicAnswerCall(input.text,input.clientTurnId):null;
  const directDocumentRead=!declared&&freshRead&&!requestedOutputs&&!countContract&&!compoundContract?directDocumentReadCall(input.text,input.clientTurnId,input.appContext.patientId,asOf):null;
  const directNoteRead=!declared&&freshRead&&!requestedOutputs&&!countContract&&!compoundContract?directPatientNoteReadCall(input.text,input.clientTurnId,asOf):null;
  const directSummaryCall=!declared&&freshRead&&!nonExecutableComparison&&!requestedOutputs&&!countContract&&!compoundContract?directSinglePatientReadCall(pendingClarification&&pendingTask?requestText:input.text,input.clientTurnId,input.appContext.patientId,asOf):null;
  const directNamedPatientSearch=!declared&&freshRead&&!requestedOutputs&&!countContract&&!compoundContract?directNamedPatientSearchCall(input.text,input.clientTurnId):null;
  const directReadCalls=!declared&&freshRead?directRecurringThemeCountCalls(requestedOutputs,input.text,input.clientTurnId):null;
  const directOfficeRead=!declared&&freshRead?directOfficeReadCall(input.text,input.clientTurnId,requestedOutputs):null;
  const directAgendaCall=!declared&&freshRead&&!requestedOutputs&&!countContract&&!compoundContract?directAgendaReadCall(input.text,input.clientTurnId,input.appContext.patientId,asOf):null;
  const directConsultationCountRead=!declared&&freshRead&&!requestedOutputs&&!countContract&&!compoundContract?directConsultationCountCall(input.text,input.clientTurnId,input.appContext.patientId,asOf):null;
  const directConsultationDayListRead=!declared&&freshRead&&!requestedOutputs&&!countContract&&!compoundContract?directConsultationDayListCall(input.text,input.clientTurnId,input.appContext.patientId,asOf):null;
  const directNavigationCall=!declared&&freshRead&&!requestedOutputs?directGlobalNavigationCall(input.text,input.clientTurnId):null;
   const directFinanceRead=!declared&&freshRead&&!requestedOutputs?directFinanceReadCall(input.text,input.clientTurnId,input.appContext.patientId,asOf):null;
  const directFinanceComparison=!declared&&freshRead&&!requestedOutputs?directFinanceComparisonWorkflow(input.text,input.clientTurnId,asOf):null;
  const directMonthlyComparison=!declared&&freshRead&&!countContract&&!compoundContract?directConsultationMonthComparison(input.text,input.clientTurnId,input.appContext.patientId,asOf):null;
   const directMixedWorkflow=!declared&&freshRead?directMixedReadWorkflow(input.text,input.clientTurnId,input.appContext.patientId,asOf):null;
   const directWorkflow=!declared&&freshRead?(directFinanceComparison??directMixedWorkflow??(!compoundContract?(countContract?directExtendedCounts(countContract,input.clientTurnId,asOf):directMonthlyComparison??directAgendaAdministrativeReview(input.text,input.clientTurnId,asOf)):null)):null;
  const directNamedReads=!declared&&freshRead&&!nonExecutableComparison&&!directNamedComparisonCall&&!countContract&&!compoundContract?directNamedApplicationReads(input.text,input.clientTurnId,input.appContext.patientId,asOf):null;
  const queryContract=patientQueryContract(input.text,asOf);
  const medicalOnly=admission.tools?.length===1&&admission.tools[0]==='search_knowledge';
  const medicalPart:RequestPart={id:'requested_1',goal:input.text,tools:['search_knowledge'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]};
  const directKnowledgeRead=!declared&&freshRead&&!requestedOutputs&&!countContract&&!compoundContract&&medicalOnly&&input.text.length<=500?{part:medicalPart,call:{id:`direct-${input.clientTurnId}-knowledge`,name:'search_knowledge',args:{partIds:[medicalPart.id],query:input.text}}}:null;
  const extraApp=admission.applicationView==='reception'||admission.applicationView==='medication_catalog'?admission.applicationView:null;
  const catalogueLiteral=extraApp==='medication_catalog'?input.text.match(/(?:cherche|recherche|trouve|affiche)\s+(.+?)\s+dans le catalogue/iu)?.[1]?.trim():undefined;
  const appPart:RequestPart={id:'requested_1',goal:input.text,tools:['query_app'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]};
  const directExtraApp=!declared&&freshRead&&!requestedOutputs&&extraApp&&(extraApp==='reception'||catalogueLiteral)?{part:appPart,call:{id:`direct-${input.clientTurnId}-application`,name:'query_app',args:{partIds:[appPart.id],view:extraApp,...(catalogueLiteral?{query:catalogueLiteral}:{}),...(extraApp==='reception'?{queue:/demandes?/iu.test(input.text)?'requests':/paiements?/iu.test(input.text)?'payments':/attente/iu.test(input.text)?'waiting':'all'}:{})}}}:null;

  const patientListVerbs=[...input.text.matchAll(/\b(?:liste\w*|affich\w*|montr\w*|donne\w*|indique\w*|enumere\w*|quels?|quelles?|qui|lesquels|lesquelles|trouv\w*)\b/giu)];
  const nameFollowup=patientListVerbs.length===2&&/^(?:donne|indique|affiche|montre|liste|enumere)/iu.test(patientListVerbs[1]![0])&&/\b(?:leurs?|les)\s+noms?\b/iu.test(input.text.slice(patientListVerbs[1]!.index));
  const listNoun=patientListVerbs.length===2&&patientListVerbs[1]![0].toLocaleLowerCase('fr')==='liste'&&/\b(?:la|une)\s+$/iu.test(input.text.slice(0,patientListVerbs[1]!.index));
  const singlePatientListRequest=/^\s*(?:alexa[, :]+)?(?:liste\w*|affich\w*|montr\w*|donne\w*|indique\w*|enumere\w*|quels?|quelles?|qui|lesquels|lesquelles|trouv\w*)\b/iu.test(input.text)&&/\b(?:patients?|patientes?|dossiers?|patientèle)\b/iu.test(input.text)&&!/\b(?:combien|nombre|total|compt\w*)\b/iu.test(input.text)&&(patientListVerbs.length===1||nameFollowup||listNoun);
  const explicitListPopulation=queryContract.population!=='active'||/\bactifs?\b/iu.test(input.text);
   const structuredPatientQuery=!declared&&freshRead&&!requestedOutputs&&!medicalOnly&&!countContract&&!compoundContract&&singlePatientListRequest&&(!admission.tools?.length||admission.tools.includes('query_patients'))&&(explicitListPopulation||queryContract.extended||queryContract.unsupported.length>0||queryContract.filterGroups.some(group=>group.length>0)||!!queryContract.consultationPeriod||!!queryContract.createdPeriod);
  const extendedPart:RequestPart={id:'requested_1',goal:input.text,tools:['query_patients'],conditions:queryContract.filterGroups.length===1?queryContract.filterGroups[0]!:[],constraintLedger:queryContract.ledger,dependsOn:[],status:'pending',resultRefs:[]};
  const simplePatientFilters=!queryContract.extended&&queryContract.filterGroups.length===1&&queryContract.filterGroups[0]!.length>0?{filters:queryContract.filterGroups[0]}:{};
  const extendedCall:AgentCall={id:`direct-${input.clientTurnId}-patient-query`,name:'query_patients',args:{partIds:[extendedPart.id],mode:requestedCountRead(input.text)?'count':'list',population:queryContract.population,...(queryContract.filterGroups.length>1?{filterGroups:queryContract.filterGroups}:queryContract.filterGroups[0]?.length?{filters:queryContract.filterGroups[0]}:simplePatientFilters),...(queryContract.consultationPeriod?{consultationPeriod:queryContract.consultationPeriod}:{}),...(queryContract.createdPeriod?{createdPeriod:queryContract.createdPeriod}:{})}};
   const directCalls:{part:RequestPart;call:AgentCall;parts?:RequestPart[];latestNoteReference?:boolean }[]|null=directWorkflow?null:directNamedComparisonCall?[directNamedComparisonCall]:directExtraApp?[directExtraApp]:directNamedReads?.calls??directMixedMetricAgenda??(directMetricRead?[directMetricRead]:directCompoundRead?[directCompoundRead]:directKnowledgeRead?[directKnowledgeRead]:directPublicAnswer?[directPublicAnswer]:directReadCalls??(directFinanceRead?[directFinanceRead]:directDocumentRead?[directDocumentRead]:directNoteRead?[directNoteRead]:directSummaryCall?[directSummaryCall]:directNamedPatientSearch?[directNamedPatientSearch]:directOfficeRead?[directOfficeRead]:directConsultationCountRead?[directConsultationCountRead]:directConsultationDayListRead?[directConsultationDayListRead]:directAgendaCall?[directAgendaCall]:directNavigationCall?[directNavigationCall]:structuredPatientQuery?(queryContract.unsupported.length?[]:[{part:extendedPart,call:extendedCall}]):null));
  const directDocumentModelRequest=!declared&&freshRead&&!directWorkflow&&!directCalls&&!countContract&&!compoundContract&&!quotedInstructionPolicy&&(!requestedOutputs||requestedOutputs.length===1)&&admission.tools?.length===1&&admission.tools[0]==='query_documents';
  if(directWorkflow){parts=directWorkflow.parts;declared=true;}else if(directNamedReads){parts=directNamedReads.parts;declared=true;}else if(directCalls){parts=directCalls.flatMap(entry=>entry.parts??[entry.part]);declared=true;}
  else if(directDocumentModelRequest){parts=[{id:'requested_1',goal:input.text,tools:['query_documents'],conditions:[],dependsOn:[],status:'pending',resultRefs:[]}];declared=true;}
  if(structuredPatientQuery&&queryContract.unsupported.length&&!directCalls?.length){parts=[{...extendedPart,tools:[],status:'unsupported',reason:copy.unsupported+' '+queryContract.unsupported.join(' ; ')}];declared=true;}
  const infer = deps.infer ?? inferLocalCompletion;
  const readTools=new Set(['query_patients','get_patient_context','query_consultations','query_agenda','query_documents','query_finance','query_app','search_knowledge']);
  // A small model may emit independent calls one at a time. Finish declared human
  // outputs within the same six-call/deadline caps; dependencies and actions keep three rounds.
  const roundLimit=()=>{
    const base=declared&&requestedOutputs?.length===parts.length&&parts.every(p=>!p.dependsOn.length&&p.tools?.length===1&&readTools.has(p.tools[0]!))
      ?Math.min(AGENT_LIMITS.calls,Math.max(AGENT_LIMITS.rounds,parts.length)):AGENT_LIMITS.rounds;
    return base+noteContinuationBudget;
  };
  try {
    if(directWorkflow){
      for(const step of directWorkflow.steps){
        signal.throwIfAborted();deps.onStage?.();
        const targets=parts.filter(part=>step.partIds.includes(part.id));
        if(step.after&&parts.find(part=>part.id===step.after)?.status!=='answered'){
          for(const part of targets){part.status='failed';part.reason='La lecture préalable de l’agenda n’a pas abouti ; la revue dépendante n’a pas été exécutée.';}
          continue;
        }
        deps.observeCall?.(structuredClone(step.call));
        let result:AgentResult;
        try{result=await deps.execute(step.call,asOf,results,signal,input.text,step.goal);}
        catch(error){const failureCode=error instanceof AgentReadError?error.code:error instanceof z.ZodError?'malformed':'database';result={callId:step.call.id,status:'error',complete:false,evidence:[],text:copy.errors[failureCode],conditionKeys:[],error:{code:failureCode,retryable:false}};}
        if(step.comparisonLabel&&result.text)result={...result,text:`${step.comparisonLabel} : ${result.text}`};
        const missingCondition=targets.some(part=>part.conditions.some(condition=>!result.conditionKeys.includes(conditionKey(condition))));
        if(missingCondition&&['ok','empty','partial'].includes(result.status))result={callId:step.call.id,status:'unsupported',complete:false,evidence:[],text:copy.unsupported,conditionKeys:[],error:{code:'condition-not-applied',retryable:false}};
        if(step.reviewDisclaimer&&result.complete&&['ok','empty'].includes(result.status)){const priorText=result.text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase(),savedState=/aucune correction n[’']a ete enregistree/iu.test(priorText)?'':"Aucune correction n'a été enregistrée. ";result={...result,text:result.text+`\n${savedState}Cette liste est à vérifier dans chaque dossier.`};}
        results.push(result);observeResult({callId:step.call.id,name:step.call.name,status:result.status,...(result.error?{errorCode:result.error.code}:{})});
        for(const part of targets){part.resultRefs.push(step.call.id);part.status=result.proposal?'proposed':result.status==='needs_input'?'needs_input':result.status==='unsupported'?'unsupported':result.status==='error'?'failed':result.complete?'answered':'budget_limited';if(!['answered','proposed'].includes(part.status))part.reason=result.text;}
      }
      if(directWorkflow.presentation?.kind==='created-collected-difference'){
        const created=results.find(result=>result.callId.endsWith('-finance-created'));
        const collected=results.find(result=>result.callId.endsWith('-finance-collected'));
        const totals=(result:AgentResult|undefined):Record<string,unknown>|null=>result?.data&&typeof result.data==='object'&&'totals' in result.data&&result.data.totals&&typeof result.data.totals==='object'?result.data.totals as Record<string,unknown>:null;
        const createdTotals=totals(created),collectedTotals=totals(collected);
        const createdAmount=createdTotals?.amount??(typeof createdTotals?.pendingDzd==='number'&&typeof createdTotals?.collectedDzd==='number'?createdTotals.pendingDzd+createdTotals.collectedDzd:undefined);
        const collectedAmount=collectedTotals?.amount??collectedTotals?.collectedDzd;
        if(created&&collected&&['ok','empty'].includes(created.status)&&['ok','empty'].includes(collected.status)&&Number.isSafeInteger(createdAmount)&&Number.isSafeInteger(collectedAmount)){
          const month=new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric',timeZone:'Africa/Algiers'}).format(new Date(directWorkflow.presentation.from)),number=new Intl.NumberFormat('fr-FR');
          created.text='';collected.text=`En ${month}, ${number.format(createdAmount as number)} DZD de paiements ont été créés et ${number.format(collectedAmount as number)} DZD encaissés. L’écart est de ${number.format((createdAmount as number)-(collectedAmount as number))} DZD, calculé comme les paiements créés moins les encaissements.`;
        }
      }
    }else if(directCalls){
      for(let offset=0;offset<directCalls.length;offset+=AGENT_LIMITS.parallel){
        signal.throwIfAborted();deps.onStage?.();
        const batch=directCalls.slice(offset,offset+AGENT_LIMITS.parallel);
        const settled=await Promise.allSettled(batch.map(({call,part})=>Promise.resolve().then(()=>{
          deps.observeCall?.(structuredClone(call));
          return deps.execute(call,asOf,[...(prior?.results??[]),...results],signal,input.text,part.goal);
        })));
        settled.forEach((entry,index)=>{
          const scheduled=batch[index]!,targets=scheduled.parts??[parts.find(candidate=>candidate.id===scheduled.part.id)!];
          if(entry.status==='rejected'){
            const userStopped=externalSignal.aborted&&!(externalSignal.reason instanceof Error&&/Timeout/i.test(externalSignal.reason.name+externalSignal.reason.message));
            const failureCode=entry.reason instanceof AgentReadError?entry.reason.code:entry.reason instanceof z.ZodError?'malformed':'database';
            observeResult({callId:scheduled.call.id,name:scheduled.call.name,status:'error',errorCode:failureCode});
            for(const part of targets){part.status=userStopped?'cancelled':signal.aborted?'budget_limited':'failed';part.reason=userStopped?copy.cancelled:signal.aborted?copy.budget:copy.errors[failureCode];}
            return;
          }
          const result=scheduled.latestNoteReference?answerLatestNoteReference({...entry.value,callId:scheduled.call.id},asOf):{...entry.value,callId:scheduled.call.id};results.push(result);
          observeResult({callId:scheduled.call.id,name:scheduled.call.name,status:result.status,...(result.error?{errorCode:result.error.code}:{})});
          for(const part of targets){part.resultRefs.push(scheduled.call.id);part.status=result.proposal?'proposed':result.status==='needs_input'?'needs_input':result.status==='unsupported'?'unsupported':result.status==='error'?'failed':result.complete?'answered':'budget_limited';if(!['answered','proposed'].includes(part.status))part.reason=result.text;}
        });
      }
    }
    while (!directCalls&&!directWorkflow && rounds < roundLimit() && steps++ < Math.max(5,roundLimit()+1)) {
      signal.throwIfAborted(); deps.onStage?.();
      const remaining = AGENT_LIMITS.deadlineMs - (Date.now() - now);
      if (remaining < 500) break;
      if(declared){
        const actionPrompt=directTreatmentAction?"Tu es Alexa, assistante du medecin. Appelle immédiatement prepare_action pour la seule action explicitement reconnue : "+String(admission.preparationAction??"")+". Transmets uniquement les valeurs explicitement demandees. La commande authentifiee du medecin autorise cette action apres validation et relecture; une suggestion du modele ne donne jamais cette autorisation. Si une cible ou une valeur manque ou est ambigue, appelle ask_doctor avec une question courte. Ne suppose rien et ne reponds pas en prose.":directDocumentModelRequest?"Tu es Alexa, assistante du médecin. Comprends la demande en français et appelle immédiatement une seule fois query_documents. Si le médecin demande de créer, préparer ou ouvrir un type de document sans fournir de contenu clinique précis, ouvre l’espace Documents filtré par le patient nommé et le type demandé, puis lis les brouillons et documents réellement enregistrés. Conserve l’identité et les filtres explicitement demandés. N’invente ni patient ni document, ne crée ni ne modifie rien et ne réponds pas en prose. Ne fournis pas de contenu clinique sauf si un document précis est explicitement demandé. En cas d’absence ou d’ambiguïté, laisse le résultat vérifié déterminer la réponse.":`Appelle les fonctions natives pour répondre avec les données réelles et les partIds enregistrés. ${fullPrompt}`;
        messages[0]={role:"system",content:`${actionPrompt}\nSorties demandées : ${JSON.stringify(parts)}\nContexte précédent : ${JSON.stringify(previousContext)}`};
        messages[1]={role:"user",content:requestText+`\nPatient sélectionné : ${input.appContext.patientId?"oui":"non"}\nIdentifiant du patient fourni par l’application : ${input.appContext.patientId??"aucun"}`};
      }
      const selectedTools=new Set<string>(parts.filter(p=>p.status==="pending").flatMap(p=>p.tools??[]));
      if(!selectedTools.size&&!input.appContext.patientId&&parts.some(p=>p.conditions.length)&&parts.every(p=>!p.dependsOn.length))selectedTools.add("query_patients");
      const pendingCounts=parts.filter(p=>p.status==='pending');
      const metricForPart=(p:RequestPart)=>Object.entries(patientMetricConditions).find(([,conditions])=>JSON.stringify(conditions.map(conditionKey).sort())===JSON.stringify(p.conditions.map(conditionKey).sort()))?.[0];
      const batchedMetrics=countContract&&pendingCounts.length>1&&pendingCounts.every(p=>p.tools?.length===1&&p.tools[0]==='query_patients'&&!p.dependsOn.length&&!p.literalQuery&&(p.population??'active')==='active'&&metricForPart(p))?[...new Set(pendingCounts.map(p=>metricForPart(p)!))]:null;
      const catalogue=declared?tools.filter(t=>t.function.name!=="declare_request"&&(!selectedTools.size||selectedTools.has(t.function.name)||(!completePublic&&!plainReadDeclaration&&t.function.name==="ask_doctor"))).map(t=>{
        if(t.function.name!=="query_patients")return t;
        const parameters=structuredClone(t.function.parameters),properties=parameters["properties"] as Record<string,unknown>;
        for(const key of ['filterGroups','consultationPeriod','createdPeriod'])delete properties[key];
        const patientParts=parts.filter(p=>p.status==="pending"&&p.tools?.includes("query_patients"));
        const queryText=input.text+(resumingPatientQuery&&prior?" "+prior.original:"");
        const explicitName=explicitPatientQueryName(queryText);
        const populations=new Set(patientParts.map(p=>JSON.stringify([p.population??"active",p.literalQuery??null,p.conditions.map(conditionKey).sort()])));
        if(populations.size<=1){delete properties["metrics"];properties["mode"]={type:"string",enum:["count","list","review"]};}
        if(patientParts.length&&patientParts.every(p=>isAdministrativeReview(p.goal,input.text)))properties['mode']={type:'string',enum:['review']};
        if(patientParts.length&&patientParts.every(p=>requestedCountRead(p.goal)))properties['mode']={type:'string',enum:['count']};
        if(compoundContract){properties['mode']={type:'string',enum:['list']};if(compoundContract.sort)properties['sort']={type:'string',enum:[compoundContract.sort]};}
        if(countContract){properties["mode"]={type:"string",enum:populations.size<=1?["count"]:["count","metrics"]};}
        if(batchedMetrics){
         properties['mode']={type:'string',enum:['metrics']};
         properties['metrics']={type:'array',items:{type:'string',enum:batchedMetrics},minItems:batchedMetrics.length,maxItems:batchedMetrics.length,uniqueItems:true};
         parameters['required']=[...new Set([...(parameters['required'] as string[]??[]),'metrics'])];
        }
        const registeredFilters=patientParts.some(p=>p.conditions.length);
        const patientPopulations=new Set(patientParts.map(p=>p.population??'active'));
        if(patientParts.length&&patientPopulations.size===1)properties['population']={...properties['population'] as object,enum:[...patientPopulations]};
        if(registeredFilters)for(const key of ["query","population","filters"])delete properties[key];
        // Continuation owns its saved cursor and revision; the model selects the operation.
        for(const key of ["offset","revision"])delete properties[key];
        if(!prior?.results.some(r=>r.data&&typeof r.data==="object"&&"patientQuery" in r.data))delete properties["reusePrevious"];
        if(!/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(input.text))delete properties["patientIds"];
        if(registeredFilters&&!patientParts.some(p=>p.conditions.some(c=>c.field==="outstanding_balance")))delete properties["sort"];
        const candidateName=patientParts.length===1?patientParts[0]?.literalQuery:undefined;
        const registeredName=candidateName&&explicitName&&normalizedPatientQuery(candidateName)===normalizedPatientQuery(explicitName)?candidateName:undefined;
        const queryProperty=properties["query"];
        if(!registeredFilters&&registeredName&&queryProperty&&typeof queryProperty==="object"&&!Array.isArray(queryProperty))properties["query"]={...queryProperty,enum:[registeredName]};
        else delete properties["query"];
        return {...t,function:{...t.function,parameters}};
      }).map(t=>structuredClone(t)):tools.filter(t=>t.function.name==="declare_request").map(t=>structuredClone(t));
      if(!declared&&(admission.tools||countContract)){
       const allowed=admission.tools??['query_patients'];
       const metadata=catalogue.find(t=>t.function.name==='declare_request');
        const parameters=metadata?.function.parameters as {properties?:{parts?:{items?:{properties?:{tool?:Record<string,unknown>;conditions?:Record<string,unknown>}}}}}|undefined;
       const tool=parameters?.properties?.parts?.items?.properties?.tool;
        if(tool)tool['enum']=admission.tools?[...allowed,...(completePublic||plainReadDeclaration?[]:['ask_doctor'])]:[...allowed];
        const conditions=parameters?.properties?.parts?.items?.properties?.conditions;
        if(plainReadDeclaration&&conditions)Object.assign(conditions,{type:'array',items:{type:'string'},maxItems:0});
       const outputs=parameters?.properties?.parts;
       if(countContract&&outputs)Object.assign(outputs,{minItems:countContract.clauses.length,maxItems:countContract.clauses.length});
      }
      for(const tool of catalogue)if(tool.function.name!=="declare_request"){
        const properties=tool.function.parameters["properties"] as Record<string,unknown>|undefined;
        if(properties){
         const literal=input.text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu)??[];
         const known=[...(prior?.results??[]),...results],sources=known.flatMap(r=>r.evidence);
         const ids=(type:AlexaSource['type'])=>sources.filter(source=>source.type===type).map(source=>source.id);
         const patients=known.flatMap(r=>[...(r.patientId?[r.patientId]:[]),...(r.data&&typeof r.data==='object'&&'agendaPatientIds' in r.data&&Array.isArray(r.data.agendaPatientIds)?r.data.agendaPatientIds.filter((id):id is string=>typeof id==='string'):[])]);
         const references:Record<string,string[]>={patientId:[...literal,...(input.appContext.patientId?[input.appContext.patientId]:[]),...patients,...ids('patient')],appointmentId:[...literal,...ids('appointment')],consultationId:[...literal,...ids('consultation'),...(input.appContext.page.startsWith('/consultation/')?[input.appContext.page.split('/')[2]!]:[])],paymentId:[...literal,...sources.flatMap(source=>typeof source.provenance?.['paymentId']==='string'?[source.provenance['paymentId']]:[])],documentId:[...literal,...sources.filter(source=>source.type==='document'&&!source.provenance?.['draftId']).map(source=>source.id)],draftId:[...literal,...sources.flatMap(source=>typeof source.provenance?.['draftId']==='string'?[source.provenance['draftId']]:[])]};
         for(const [field,values]of Object.entries(references))if(properties[field]){const allowed=[...new Set(values.filter(value=>z.uuid().safeParse(value).success))];if(allowed.length)properties[field]={...properties[field],enum:allowed};else delete properties[field];}
         const patientMention=parsePatientMention(requestText);
         if(input.patientName||patientMention.status==='named'){delete properties['patientName'];delete properties['patientId'];}
         else if(properties['patientName']&&patientMention.status==='none')delete properties['patientName'];
         const toolGoals=parts.filter(p=>p.status==='pending'&&p.tools?.includes(tool.function.name as NonNullable<RequestPart['tools']>[number]));
         const goalAdmission=toolGoals.length===1?frenchRequestAdmission(toolGoals[0]!.goal,false,asOf):undefined;
         const toolAdmission=goalAdmission?.tools?.includes(tool.function.name)?goalAdmission:admission;
         if(tool.function.name==='prepare_action'){
          if(toolAdmission.preparationAction){
            if(properties['action'])properties['action']={...properties['action'],enum:[toolAdmission.preparationAction]};
           for(const field of Object.keys(properties))if(!actionArgumentKeys(toolAdmission.preparationAction).includes(field))delete properties[field];
          }
          if(properties['startsAt'])properties['startsAt']={...properties['startsAt'],description:agentActionDescriptions.startsAt};
         }
         for(const [field,value]of Object.entries(frenchReadArgumentBindings(toolAdmission,tool.function.name)))if(properties[field]){
          properties[field]={...properties[field],enum:[value]};
          tool.function.parameters['required']=[...new Set([...(tool.function.parameters['required'] as string[]??[]),field])];
         }
         if(toolAdmission.profileOnly&&tool.function.name==='get_patient_context'){
          properties['section']={type:'string',enum:['profile'],description:'Lecture des coordonnées et champs administratifs demandés.'};
          for(const field of ['count','consultationId','area','query','from','to','status','offset','textOffset','maxCharacters','revision','reusePrevious'])delete properties[field];
         }
          if(tool.function.name==='get_patient_context'){if(toolAdmission.patientSection!=='diagnoses')for(const field of ['diagnosisState','diagnosisRole'])delete properties[field];if(toolAdmission.patientSection!=='treatments')delete properties['treatmentState'];}
          if(tool.function.name==='get_patient_context'&&toolAdmission.patientSection){
           properties['section']={type:'string',enum:[toolAdmission.patientSection]};
           if(toolAdmission.patientSection==='notes'){
            delete properties['count'];if(!toolAdmission.noteQuery)delete properties['query'];
            if(toolAdmission.unboundedPeriod){delete properties['from'];delete properties['to'];}
            if(!toolAdmission.consultationStatus)delete properties['status'];
           }
           else for(const field of ['consultationId','area','query','from','to','status','offset','textOffset','maxCharacters','revision','reusePrevious'])delete properties[field];
          }
         if(tool.function.name==='query_app'&&toolAdmission.applicationView){
          properties['view']={type:'string',enum:[toolAdmission.applicationView]};
          if(toolAdmission.applicationView!=='message_draft')for(const field of ['patientId','patientName','motif'])delete properties[field];
          if(toolAdmission.applicationView!=='notifications')for(const field of ['offset','revision'])delete properties[field];
         }
          if(tool.function.name==='query_finance'&&toolAdmission.financeMode){properties['mode']={type:'string',enum:[toolAdmission.financeMode]};for(const field of ['state','patientId','patientName','reusePrevious','revision'])delete properties[field];if(toolAdmission.financeMode==='overview')delete properties['offset'];}
          if(['query_consultations','query_documents'].includes(tool.function.name)&&toolAdmission.unboundedPeriod)for(const field of ['period','from','to'])delete properties[field];
          if(tool.function.name==='query_consultations'&&toolAdmission.consultationMode){
           properties['mode']={type:'string',enum:[toolAdmission.consultationMode]};
           const readText=toolGoals.map(part=>part.goal).join(' ').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
           if(toolAdmission.consultationMode==='count'||(/\b(?:liste|consultations|seances|historique)\b/u.test(readText)&&!/\b(?:details?|duree|analys\w*)\b/u.test(readText)))for(const field of ['view','consultationId','textOffset','revision','reusePrevious'])delete properties[field];
          }
         if(tool.function.name==='query_documents'){if(!noteSearchRequested(input.text))delete properties['query'];if(toolAdmission.documentAllKinds)delete properties['kind'];if(!properties['documentId']&&!properties['draftId'])for(const field of ['textOffset','revision','reusePrevious'])delete properties[field];}
         if(tool.function.name==='query_documents'&&toolAdmission.documentKind)properties['kind']={type:'string',enum:[toolAdmission.documentKind]};
         if(tool.function.name==='query_documents'&&toolAdmission.documentStatus)properties['status']={type:'string',enum:[toolAdmission.documentStatus]};
         const goalPeriods=toolGoals.map(p=>explicitAgentPeriod(p.goal,asOf));
         const temporal=goalPeriods.length&&goalPeriods.every(p=>p&&JSON.stringify(p)===JSON.stringify(goalPeriods[0]))?goalPeriods[0]:toolAdmission.tools?.length===1?explicitAgentPeriod(input.text,asOf):null;
         if(temporal&&(tool.function.name==='query_agenda'||(tool.function.name==='query_finance'&&toolAdmission.tools?.includes('query_finance')))){
          properties['period']={...properties['period'] as object,enum:[temporal.period]};
          delete properties['from'];delete properties['to'];
          tool.function.parameters['required']=[...new Set([...(tool.function.parameters['required'] as string[]??[]),'period'])];
         }
         if(tool.function.name==='answer_general'&&admission.tools?.includes('answer_general')&&properties['question'])properties['question']={...properties['question'],enum:[input.text]};
         // Slots already grounded in the request belong to the server; the model need not repeat those constants.
         if(tool.function.name==='get_patient_context'&&toolAdmission.patientSection){
          if(toolAdmission.patientSection==='summary'&&toolAdmission.consultationCount===undefined)delete properties['count'];
          const fixed=new Set(Object.keys(frenchReadArgumentBindings(toolAdmission,tool.function.name)));
          for(const field of fixed)delete properties[field];
          tool.function.parameters['required']=(tool.function.parameters['required'] as string[]??[]).filter(field=>!fixed.has(field));
          catalogue[catalogue.indexOf(tool)]={...tool,function:{...tool.function,description:copy.boundRead}};
         }
         // Relative periods are resolved server-side; explicit bounds remain available for ranges and time windows.
         if(properties['statuses'])properties['statuses']={...properties['statuses'],minItems:1,description:'Filtre facultatif de statuts demandés. Omettre pour la liste habituelle ; jamais un tableau vide.'};
        }
        if(properties?.["partIds"])properties["partIds"]={type:"array",items:{type:"string",enum:parts.filter(p=>p.status==="pending"&&partAllowsTool(p,tool.function.name)&&p.dependsOn.every(id=>parts.find(prerequisite=>prerequisite.id===id)?.status==="answered")).map(p=>p.id)},minItems:tool.function.name==="query_patients"&&batchedMetrics?pendingCounts.length:1,maxItems:tool.function.name==="query_patients"&&batchedMetrics?pendingCounts.length:tool.function.name==="query_documents"?1:12};
      }
      for(let index=catalogue.length-1;index>=0;index--){const tool=catalogue[index]!,properties=tool.function.parameters['properties'] as {partIds?:{items?:{enum?:string[]}}}|undefined;if(tool.function.name!=='declare_request'&&properties?.partIds?.items?.enum?.length===0)catalogue.splice(index,1);}
      if(!declared&&(compoundContract||requestedOutputs)){
       const metadata=catalogue.find(t=>t.function.name==='declare_request');
       const parameters=metadata?.function.parameters as {properties?:{parts?:{minItems?:number;maxItems?:number;items?:{properties:Record<string,unknown>}}}}|undefined;
       const array=parameters?.properties?.parts;
       if(array){array.minItems=compoundContract?(compoundContract.count?2:1):requestedOutputs!.length;array.maxItems=array.minItems;
        if(array.items){
         if(compoundContract){const conditions=compoundContractHints(compoundContract)[0]!.conditions;array.items.properties['tool']={type:'string',enum:['query_patients']};array.items.properties['conditions']={type:'array',items:{type:'string',enum:conditions},minItems:conditions.length,maxItems:conditions.length,uniqueItems:true};}
         if(requestedOutputs)array.items.properties['goal']={type:'string',enum:requestedOutputs};
        }
       }
      }
      if(!declared&&(countContract||requestedOutputs||compoundContract)){
       const metadata=catalogue.find(t=>t.function.name==='declare_request'),parameters=metadata?.function.parameters as {properties?:Record<string,unknown>}|undefined;
       const array=parameters?.properties?.['parts'] as Record<string,unknown>|undefined,base=array?.['items'] as {properties?:Record<string,unknown>;required?:string[]}|undefined;
       if(array&&base?.properties){
        const outputSpecs=countContract?countContractHints(countContract):compoundContract?compoundContractHints(compoundContract):requestedOutputs!.map(goal=>({goal,conditions:isAdministrativeReview(goal,input.text)?['administrative_incomplete:eq:true']:countContractHints({clauses:[goal]})[0]!.conditions}));
        array['prefixItems']=outputSpecs.map((spec,index)=>({type:'object',properties:{...base.properties,id:{const:'p'+(index+1)},goal:{const:spec.goal.slice(0,300)},...(countContract||compoundContract||requestedReadTool(spec.goal,input.text)?{tool:{enum:[countContract||compoundContract?'query_patients':requestedReadTool(spec.goal,input.text)]}}:{}),conditions:spec.conditions.length?{type:'array',prefixItems:spec.conditions.map(value=>({const:value})),minItems:spec.conditions.length,maxItems:spec.conditions.length}:{type:'array',items:{type:'string'},maxItems:0},unsupportedConditions:{type:'array',items:{type:'string'},maxItems:5}},required:base.required,additionalProperties:false}));
        delete array['items'];
       }
      }
      const wasDeclared=declared;
      const outputCount=countContract?.clauses.length??(compoundContract?(compoundContract.count?2:1):requestedOutputs?.length??Math.max(1,parts.length));
      const completion = await infer(messages, { tools:catalogue, toolChoice:declared&&parts.some(p=>p.status==="pending"&&p.tools?.length)?"required":declared?"auto":"declare_request",signal, timeoutMs: Math.min(240000,ALEXA_NATIVE_BUDGET.inferenceMs*(steps===1?2:1), remaining), maxOutputTokens:directTreatmentAction||outputCount>1||input.text.length>300?1024:512 });
      tokensIn += completion.tokensIn; tokensOut += completion.tokensOut;
      if(process.env.ALEXA_DEBUG_TOOL_SHAPES==="1")console.info("[alexa-tool-shape]",completion.kind==="calls"?completion.calls.map(call=>({name:call.name,keys:Object.keys(call.args),action:typeof call.args["action"]==="string"?call.args["action"]:undefined,hasPartIds:Array.isArray(call.args["partIds"]),hasPatientName:typeof call.args["patientName"]==="string",hasTreatmentName:typeof call.args["treatmentName"]==="string",changeKeys:call.args["changes"]&&typeof call.args["changes"]==="object"&&!Array.isArray(call.args["changes"])?Object.keys(call.args["changes"] as Record<string,unknown>):[]})):{kind:completion.kind,characters:completion.text.length});
      if (completion.kind === "answer") {
        if((!declared||parts.some(p=>p.status==="pending"&&p.tools?.length))&&plainRecovery++<1){messages.push({role:"user",content:declared?"Aucun résultat de données ne peut être déduit de cette réponse. Termine les parties en attente avec les fonctions autorisées et leurs partIds.":agentDeclarationRecovery});continue;}
        finalText = completion.text; break;
      }
      messages.push(completion.message);
      const batch: { call: AgentCall; ids: string[] }[] = [];
      const replies=new Map<string,string>();
      // A native completion may split metadata across calls; validate the entire ledger once.
      const declarations=completion.calls.filter(call=>call.name==="declare_request");
      let declarationAccepted=false,declarationError="InvalidLedger";
      if(!declared&&declarations.length){
        try{
          const compact=declarations.map(call=>compactDeclarationSchema.safeParse(call.args));
          const structured=declarations.map(call=>agentSchemas.declare_request.safeParse(call.args));
          const batches=compact.every(r=>r.success)?compact.map(r=>r.data.parts):structured.every(r=>r.success)?structured.map(r=>r.data.parts):null;
          if(!batches)throw new Error("InvalidLedger");
          if(plainReadDeclaration&&batches.flat().some(part=>part.conditions.length)){declarationError='UnrequestedPatientPredicates';throw Error(declarationError);}
          const candidate=parseDeclaration({parts:batches.flat()});
          const outputKeys=candidate.map(p=>JSON.stringify([normalizedPatientQuery(p.goal),[...(p.tools??[])].sort(),p.conditions.map(conditionKey).sort(),p.population??'active',p.literalQuery??null,[...(p.unsupportedConditions??[])].sort(),[...p.dependsOn].sort()]));
          if(!countContract&&!compoundContract&&!requestedOutputs&&new Set(outputKeys).size!==outputKeys.length){declarationError='DuplicateRequestedOutputs';throw Error(declarationError);}
          if(admission.tools&&candidate.some(p=>!p.tools?.length||p.tools.some(tool=>!admission.tools!.includes(tool)&&(tool!=='ask_doctor'||completePublic||plainReadDeclaration)))){declarationError='RequestDomainMismatch';throw Error(declarationError);}
          parts=countContract?constrainCountDeclaration(candidate,countContract):compoundContract?constrainCompoundDeclaration(candidate,compoundContract):requestedOutputs?constrainRequestedOutputs(candidate,requestedOutputs):candidate;
          const original=requestText;
          if(parts.some(part=>part.tools?.includes("query_patients")&&!part.unsupportedConditions?.length&&!patientConditionsGrounded(part.conditions,original)))throw new Error("UngroundedPatientPredicate");
          const explicitName=explicitPatientQueryName(original);
          if(parts.some(part=>part.literalQuery&&(!explicitName||normalizedPatientQuery(part.literalQuery)!==normalizedPatientQuery(explicitName))))throw new Error("UngroundedLiteralPatientQuery");
          declared=true;declarationAccepted=true;
          if(parts.length===1)parts[0]!.goal=requestText;
          for(const part of parts)if(part.unsupportedConditions?.length){part.status="unsupported";part.reason=copy.unsupported+" "+part.unsupportedConditions.join(", ");}
        }catch{parts=[];if(requestedOutputs){parts=requestedOutputs.map((goal,i)=>({id:"requested_"+(i+1),goal,tools:[],conditions:[],dependsOn:[],status:"pending",resultRefs:[]}));declarationError="RequestedOutputsMismatch";}if(compoundContract){parts=compoundContractParts(compoundContract);declarationError="CompoundOutputsOrConditionsMismatch";}if(countContract){parts=countContractParts(countContract);declarationError="RequestedCountOutputsOrConditionsMismatch";}/* An invalid declaration grants no dispatch authority. */}
      }
      for (const call of completion.calls) {
        if (call.name === "declare_request") {
          replies.set(call.id,declarationAccepted?JSON.stringify({accepted:true,databaseRead:false,next:"Call the domain functions now. No facts or counts have been read yet.",partIds:parts.map(p=>p.id)}):JSON.stringify({error:declarationError,...(requestedOutputs?{expectedGoals:requestedOutputs}:{}),...(compoundContract?{expectedOutputs:compoundContractHints(compoundContract)}:{}),...(admission.tools?{allowedTools:admission.tools,rule:"Conserve le domaine de la question originale ; ne remplace jamais un montant ou une question générale par un nombre de patients."}:{}),...(countContract?{expectedOutputs:countContractHints(countContract),rule:"One part per output, keep its exact conditions. Do not read data before an accepted declaration."}:{})}));
          continue;
        }
        if(completePublic&&call.name==='ask_doctor'){replies.set(call.id,'{"error":"CompletePublicQuestionAlreadyProvided"}');continue;}
        if(plainReadDeclaration&&!directTreatmentAction&&call.name==='ask_doctor'){replies.set(call.id,'{"error":"ReadGateDeterminesMissingInput"}');continue;}
        const schema = agentSchemas[call.name as keyof typeof agentSchemas];
        if(!Array.isArray(call.args["partIds"])||!call.args["partIds"].length){
          const eligible=parts.filter(p=>p.status==="pending"&&partAllowsTool(p,call.name));
          if(eligible.length===1)call.args={...call.args,partIds:[eligible[0]!.id]};
        }
        // A short continuation resumes the saved operation, not a new model-selected section.
        if(resumingApplicationQuery&&call.name==="query_app")call.args={partIds:call.args["partIds"],view:"reception",reusePrevious:true};
        if(resumingTimelineQuery&&call.name==="get_patient_context")call.args={partIds:call.args["partIds"],section:"timeline",reusePrevious:true};
        if(resumingNoteQuery&&call.name==="get_patient_context")call.args={partIds:call.args["partIds"],section:"notes",reusePrevious:true};
        if(resumingConsultationQuery&&call.name==="query_consultations")call.args={partIds:call.args["partIds"],view:"analysis",reusePrevious:true};
        if(resumingDocumentQuery&&call.name==="query_documents")call.args={partIds:call.args["partIds"],reusePrevious:true};
        if(resumingFinanceQuery&&call.name==="query_finance")call.args={partIds:call.args["partIds"],mode:"calendar",reusePrevious:true};
        if(requestedOutputs&&call.name==='query_patients'){
         const review=parts.filter(p=>p.status==='pending'&&p.tools?.includes('query_patients'));
         if(review.length&&review.every(p=>isAdministrativeReview(p.goal,input.text)))call.args={...call.args,mode:'review',partIds:review.map(p=>p.id)};
        }
        if(compoundContract&&call.name==='query_patients'){
         if(call.args['sort']&&compoundContract.sort&&call.args['sort']!==compoundContract.sort){replies.set(call.id,'{"error":"RequestedSortMismatch"}');continue;}
         call.args={...call.args,mode:'list',partIds:parts.filter(p=>p.status==='pending').map(p=>p.id),...(compoundContract.sort?{sort:compoundContract.sort}:{})};
        }
        if(countContract&&call.name==="query_patients"&&["list","review"].includes(String(call.args["mode"])))call.args={...call.args,mode:"count"};
        // Counts are whole-population aggregates: a model-proposed page size is irrelevant and can exceed the gate's hard cap.
        if(call.name==="query_patients"&&call.args["mode"]==="count")delete call.args["limit"];
        // A model-selected count cannot substitute a population that the doctor never requested.
        if(call.name==='query_patients'&&['count','metrics'].includes(String(call.args['mode']))&&!countContract&&!resumingPatientQuery){
         const source=input.text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
         const population=/\b(?:patients?|patientes?|personnes?|dossiers?|adultes?|enfants?|mineurs?)\b/u.test(source)||parts.some(p=>p.conditions.length&&patientConditionsGrounded(p.conditions,source));
         if(!population||!/\b(?:combien|nombre|total|effectif|compt\w*|statistiq\w*)\b/u.test(source)){replies.set(call.id,'{"error":"PatientCountNotRequested"}');continue;}
        }
        const countParts=parts.filter(p=>Array.isArray(call.args['partIds'])&&call.args['partIds'].includes(p.id));
        if(['query_patients','query_consultations'].includes(call.name)&&call.args['mode']!=='metrics'&&countParts.length&&countParts.every(p=>requestedCountRead(p.goal))){
         if(call.args['view']){replies.set(call.id,'{"error":"CountCannotUseDetailView"}');continue;}
         call.args={...call.args,mode:'count'};
        }
        const scopedParts=parts.filter(p=>Array.isArray(call.args['partIds'])&&call.args['partIds'].includes(p.id));
        const partScope=scopedParts.length===1?frenchRequestAdmission(scopedParts[0]!.goal,false,asOf):undefined;
        const readScope=admission.profileOnly&&admission.tools?.includes(call.name)?admission:partScope?.tools?.includes(call.name)?partScope:admission;
        if(['query_consultations','query_documents'].includes(call.name)&&readScope.unboundedPeriod&&['period','from','to'].some(field=>call.args[field]!==undefined)){replies.set(call.id,'{"error":"UnrequestedConsultationPeriod"}');continue;}
        if(call.name==='query_documents'&&readScope.documentAllKinds&&call.args['kind']!==undefined){replies.set(call.id,'{"error":"UnrequestedDocumentKind"}');continue;}
        const bindings=frenchReadArgumentBindings(readScope,call.name);
        if(call.name==='query_documents'&&typeof call.args['query']==='string'&&!call.args['reusePrevious']&&!noteQueryGrounded(scopedParts.length===1?scopedParts[0]!.goal:input.text,call.args['query'])){replies.set(call.id,'{"error":"UnrequestedDocumentFilter"}');continue;}
        if(call.name==='get_patient_context'&&(readScope.patientSection==='notes'||call.args['section']==='notes')&&typeof call.args['query']==='string'&&!call.args['reusePrevious']&&!noteQueryGrounded(scopedParts.length===1?scopedParts[0]!.goal:input.text,call.args['query'])){replies.set(call.id,'{"error":"UnrequestedNoteContentFilter"}');continue;}
        if(call.name==='get_patient_context'&&readScope.patientSection==='summary'&&readScope.consultationCount===undefined&&call.args['count']!==undefined){replies.set(call.id,'{"error":"UnrequestedSummaryCount"}');continue;}
        if(Object.entries(bindings).some(([field,value])=>call.args[field]!==undefined&&call.args[field]!==value)){
         replies.set(call.id,JSON.stringify({error:'RequestedReadScopeMismatch',expected:bindings}));continue;
        }
        call.args={...bindings,...call.args};
        let parsed = schema?.safeParse(call.args);
        if(admission.profileOnly&&call.name==='get_patient_context'&&call.args['section']!=='profile'){replies.set(call.id,'{"error":"AdministrativeFieldsRequireProfileSection"}');continue;}
        const ids = Array.isArray(call.args["partIds"]) ? call.args["partIds"].filter((x): x is string => typeof x === "string") : [];
        const selected = parts.filter(p => ids.includes(p.id));
        if(call.name==="query_documents"&&ids.length>1){
          replies.set(call.id,JSON.stringify({error:"DocumentPartsMustBeReadSeparately",hint:"Lire chaque résultat de document dans un appel query_documents distinct, avec un seul partId et le kind demandé par cette partie."}));
          continue;
        }
        if(call.name==="query_patients"&&parsed?.success&&selected.length){
          const specs=new Set(selected.map(p=>JSON.stringify({population:p.population??"active",query:p.literalQuery??null,conditions:p.conditions.map(conditionKey).sort()})));
          const mode=call.args["mode"];
          if(mode!=="metrics"&&specs.size>1){replies.set(call.id,'{"error":"IndependentPartsRequireMetricsOrSeparateCalls"}');continue;}
          const required=selected[0]!.conditions;
          const provided=z.array(conditionSchema).parse(call.args["filters"]??[]),providedKeys=provided.map(conditionKey);
          if(providedKeys.some(key=>selected.some(p=>!p.conditions.some(c=>conditionKey(c)===key)))){replies.set(call.id,'{"error":"UnregisteredFilter"}');continue;}
          if(mode==="metrics"){
            const populations=new Set(selected.map(p=>JSON.stringify([p.population??"active",p.literalQuery??null])));
            const metrics=z.array(z.string()).parse(call.args["metrics"]);
            const predicates=Object.fromEntries(Object.entries(patientMetricConditions).map(([metric,conditions])=>[metric,conditions.map(conditionKey)]));
            const coherent=selected.every(p=>metrics.some(metric=>{
              const keys=predicates[metric];return !!keys&&(p.conditions.length>0||metric==="active")&&p.conditions.every(c=>providedKeys.includes(conditionKey(c))||keys.includes(conditionKey(c)));
            }));
            if(populations.size!==1||!coherent){replies.set(call.id,'{"error":"CompoundConditionsNeedOneFilteredCountOrOneCoherentMetric"}');continue;}
          }
          const known=new Map([...provided,...(mode==="metrics"?[]:required)].map(c=>[conditionKey(c),c]));
          const query=selected.length===1?selected[0]!.literalQuery:undefined;
          const suppliedQuery=call.args["query"];
          const requestText=input.text+(resumingPatientQuery&&prior?" "+prior.original:"");
          if(typeof suppliedQuery==="string"&&!query){
            if(normalizedPatientQuery(requestText).includes(normalizedPatientQuery(suppliedQuery))){replies.set(call.id,'{"error":"QueryIsLiteralPatientNameOnlyUseRegisteredFilters"}');continue;}
            delete call.args["query"];
          }
          if(query&&(!explicitPatientQueryName(requestText)||normalizedPatientQuery(query)!==normalizedPatientQuery(explicitPatientQueryName(requestText)!))){replies.set(call.id,'{"error":"QueryIsLiteralPatientNameOnlyUseRegisteredFilters"}');continue;}
          parsed=schema.safeParse({...call.args,population:selected[0]!.population??"active",...(mode==="metrics"?{}:{filters:[...known.values()]}),...(query?{query}:{})});
        }
        const blocked = !declared || !parsed?.success || !ids.length || selected.length !== ids.length || selected.some(p => p.status!=="pending"||!partAllowsTool(p,call.name)||p.dependsOn.some(id => parts.find(q => q.id === id)?.status !== "answered"));
        if (blocked || calls >= AGENT_LIMITS.calls+noteContinuationBudget) {
          if(calls>=AGENT_LIMITS.calls+noteContinuationBudget)selected.forEach(p => { p.status="budget_limited";p.reason=copy.budget; });
          replies.set(call.id,JSON.stringify({error:"InvalidArgumentsOrDependency",...(!parsed?.success&&parsed?{issues:parsed.error.issues.slice(0,6).map(issue=>({code:issue.code,path:issue.path}))}:{}),...(call.name==="query_patients"?{hint:"metrics requires mode=metrics; count/list/review omit metrics. Keep the registered partIds."}:{}),...(call.name==="query_finance"?{hint:"Choisir un mode financier explicite : overview pour chiffre d’affaires, recettes encaissées et bilan du cabinet (sans state ni patient) ; list/totals/group pour les lignes de paiement. Conserver les partIds et la période demandée."}:{}),pendingPartIds:parts.filter(p=>p.status==="pending").map(p=>p.id)})); continue;
        }
        calls++; batch.push({ call: { ...call, args: parsed.data! }, ids });
      }
      if (batch.length) rounds++;
        // Pure reads run in pairs; synthesis shares the single local inference slot.
      for (let start = 0; start < batch.length;) {
          const serial = (call?: AgentCall) => !!call && (["prepare_action","answer_general","search_knowledge"].includes(call.name) || (call.name === "get_patient_context" && call.args["section"] === "summary"));
          const size = serial(batch[start]!.call) || serial(batch[start+1]?.call) ? 1 : Math.min(2,batch.length-start);
        const group = batch.slice(start, start + size); start += size;
        const settled = await Promise.allSettled(group.map(async ({ call }) => {
          signal.throwIfAborted();
          deps.observeCall?.(structuredClone(call));
          if (call.name === "ask_doctor") return { callId: call.id, status: "needs_input" as const, complete: false, data: null, text: String(call.args["question"]), evidence: [], conditionKeys: [] };
          if (call.name === "prepare_action" && results.some(r => r.proposal)) throw new Error("OneProposalOnly");
          const selectedParts=parts.filter(p=>Array.isArray(call.args['partIds'])&&call.args['partIds'].includes(p.id));
          const exactGoal=selectedParts.length===1?requestedOutputs?.find(goal=>goal===selectedParts[0]!.goal):undefined;
          const original=prior?.parts.some(p=>p.status==="needs_input")?requestText:undefined;
          return exactGoal?deps.execute(call,asOf,[...(prior?.results??[]),...results],signal,original,exactGoal):deps.execute(call,asOf,[...(prior?.results??[]),...results],signal,original);
        }));
        for (const [i, item] of settled.entries()) {
          const { call, ids } = group[i]!;
          const failureCode=item.status==="rejected"?(item.reason instanceof AgentReadError?item.reason.code:item.reason instanceof z.ZodError?"malformed":"database"):"database";
          let result: AgentResult = item.status === "fulfilled" ? item.value : { callId: call.id, status: "error", complete: false, evidence: [], text: copy.errors[failureCode], conditionKeys: [], error: { code: failureCode, retryable: false } };
          const targets = parts.filter(p => ids.includes(p.id));
          const missingCondition = targets.some(p => p.conditions.some(c => !result.conditionKeys.includes(conditionKey(c))));
          if (missingCondition && ["ok", "empty", "partial"].includes(result.status)) result = { callId: call.id, status: "unsupported", complete: false, evidence: [], text: copy.unsupported, conditionKeys: [], error: { code: "condition-not-applied", retryable: false } };
          const nextNotePage=noteCursor(result);
          if(nextNotePage)noteContinuationBudget=Math.max(noteContinuationBudget,nextNotePage.remainingPages);
          observeResult({callId:call.id,name:call.name,status:result.status,...(result.error?{errorCode:result.error.code}:{})});
          results.push(result);
          for (const p of targets) {
            const outcomes=results.filter(r=>(r.callId===call.id||p.resultRefs.includes(r.callId))&&!noteCursor(r));
            const outcome=outcomes.find(r=>r.status==='error')??outcomes.find(r=>r.status==='unsupported')??outcomes.find(r=>r.status==='needs_input')??outcomes.find(r=>!r.complete&&!r.proposal)??outcomes.find(r=>r.proposal)??result;
            p.status = nextNotePage ? "pending" : outcome.proposal ? "proposed" : outcome.status === "needs_input" ? "needs_input" : outcome.status === "unsupported" ? "unsupported" : outcome.status === "error" ? "failed" : outcome.complete ? "answered" : "budget_limited";
            p.resultRefs.push(call.id); if(nextNotePage)delete p.reason; else if(!["answered", "proposed"].includes(p.status))p.reason = outcome.text;
          }
          const modelTextLimit=call.name==="get_patient_context"&&call.args["section"]==="notes"?900:1800;
          const modelResult={callId:result.callId,status:result.status,complete:result.complete,text:result.text.slice(0,modelTextLimit),conditionKeys:result.conditionKeys,
            evidence:result.evidence.slice(0,24).map(({id,type,label})=>({id,type,label:label.slice(0,120)})),
            ...(nextNotePage?{continuation:{available:true,tool:"get_patient_context",section:"notes",reusePrevious:true}}:{}),
            ...(result.error?{error:result.error}:{}),...(result.proposal?{proposal:result.proposal}:{}),...(result.navigation?{navigation:result.navigation}:{}),...(result.presentation?{presentation:result.presentation}:{})};
          replies.set(call.id,JSON.stringify(modelResult));
        }
      }
      for(const call of completion.calls)messages.push({role:"tool",tool_call_id:call.id,content:replies.get(call.id)??'{"error":"Unavailable"}'});
      // Metadata grants no domain authority; compact its exchange into the trusted ledger.
      // Keep every business call/result exchange for native continuation.
      if(!wasDeclared&&declared&&!batch.length&&!results.length)messages.splice(2);
      if (declared && parts.every(p => p.status!=="pending")&&!results.some(r=>r.data&&typeof r.data==="object"&&"consultations" in r.data)) break;
    }
  } catch(error) { inferenceFailed=true; if(!externalSignal.aborted)console.warn("[alexa-agent] failure",localModelFailureCode(error)); /* Verified independent results survive inference failure or cancellation. */ }
  if (!parts.length) parts = countContract?countContractParts(countContract):compoundContract?compoundContractParts(compoundContract):requestedOutputs?requestedOutputs.map((goal,i)=>({id:"requested_"+(i+1),goal,tools:[],conditions:[],dependsOn:[],status:"pending",resultRefs:[]})):[{ id: "request", goal: input.text, tools:[],conditions: [], dependsOn: [], status: "pending", resultRefs: [] }];
  const userCancelled=externalSignal.aborted&&!(externalSignal.reason instanceof Error&&/Timeout/i.test(externalSignal.reason.name+externalSignal.reason.message));
  for (const p of parts) if (p.status === "pending") { p.status = userCancelled ? "cancelled" : signal.aborted?"budget_limited":inferenceFailed||(!results.length&&finalText)?"failed":"budget_limited"; p.reason = userCancelled ? copy.cancelled : signal.aborted?copy.budget:inferenceFailed||(!results.length&&finalText)?copy.modelUnavailable:copy.budget; }
  const sentences: string[] = presentAgentResults(results,input.text);
  for (const p of parts) if (!p.resultRefs.length && p.reason) sentences.push(`${p.goal} — ${p.reason}`);
  const status: AgentTerminal = userCancelled ? "cancelled" : parts.every(p => p.status === "answered") ? "completed" : parts.some(p => p.status === "proposed") ? "needs_confirmation"
    : parts.every(p => p.status === "needs_input") ? "needs_input" : parts.some(p => p.status === "answered")||results.some(r=>["ok","empty","partial"].includes(r.status)) ? "partial" : "failed";
  const proposal = results.find(r => r.proposal)?.proposal, navigation = results.find(r => r.navigation)?.navigation;
  // Choosing one unfinished reading must not discard its siblings' resumable cursors.
  const cursorResult=(r:AgentResult)=>!r.complete&&r.data&&typeof r.data==='object'&&(('applicationQuery' in r.data&&'nextOffset' in r.data&&typeof r.data.nextOffset==='number')||('timelineQuery' in r.data&&'timelineNext' in r.data&&!!r.data.timelineNext)||('documentQuery' in r.data&&'nextTextOffset' in r.data&&typeof r.data.nextTextOffset==='number')||('noteQuery' in r.data&&'next' in r.data&&!!r.data.next)||('consultationQuery' in r.data&&'nextTextOffset' in r.data&&typeof r.data.nextTextOffset==='number')||('financeQuery' in r.data&&'nextOffset' in r.data&&typeof r.data.nextOffset==='number'));
  const selectedCursor=matching.length===1?matching[0]!.callId:undefined,readSucceeded=results.some(r=>['ok','empty','partial'].includes(r.status));
  const retained=continuationKind?(prior?.results??[]).filter(r=>cursorResult(r)&&(r.callId!==selectedCursor||!readSucceeded))
    :resumingPatientQuery&&!readSucceeded&&!userCancelled?(prior?.results??[]).filter(r=>r.data&&typeof r.data==='object'&&'patientQuery' in r.data):[];
  const pendingResults=[...retained,...results.filter(cursorResult)].slice(0,6);
  const stateResults=[...pendingResults,...results.filter(r=>!cursorResult(r)).slice(0,6-pendingResults.length)];
  const taskOriginal=continuingClarification&&pendingTask?requestText:prior&&(resumingPatientQuery||resumingApplicationQuery||resumingTimelineQuery||resumingNoteQuery||resumingConsultationQuery||resumingFinanceQuery||resumingDocumentQuery)?prior.original:input.text;
  tasks.set(key, { original: taskOriginal, parts, results:stateResults, at: Date.now(), patientId: results.find(r=>r.patientId)?.patientId??input.appContext.patientId, page: input.appContext.page });
  return { status, parts, results, sentences, sources: results.flatMap(r => r.evidence), patientId: results.find(r => r.patientId)?.patientId ?? null,
    ...(proposal ? { proposal } : {}), ...(navigation ? { navigation } : {}), tokensIn, tokensOut };
}
