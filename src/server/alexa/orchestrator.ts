import { runAgentLoop, type AgentLoopDependencies } from "./agent-loop";
import { agentExecutor } from "./agent-tools";
import type { DbPort } from "@/services/db/port";
import type { AlexaEvent, AlexaNavigation, TurnInput } from "@/shared/alexa/turn";
import { agentContinuationText, type AgentContinuationKind } from "./agent-continuation";
import {validAlexaSources} from '@/shared/alexa/turn';
import {validAnswerLinks} from '@/shared/alexa/answer-links';
import type { ClinicalContext } from "@/shared/alexa/clinical";
import { dialogue } from "@/i18n/alexa-dialogue";
import { ALEXA_GENERAL_SOURCE } from "@/i18n/alexa-general";
import { resolvePatient } from "./patient-resolver";
import { buildClinicalContext } from "./clinical-context";
import { conversationState, resolveListedReference, type TurnLease } from "./conversation-state";
import { splitAlexaQuestions } from "@/shared/alexa/questions";
import { questionCopy } from "@/i18n/alexa-questions";
import { agendaSelection } from "@/shared/alexa/agenda-plan";
import { planRequest, requestsCabinetWideScope, requestsPatientScope, type WorkingReference } from "./request-plan";
import { parsePatientMention } from "./patient-mention";
import { executeRead } from "./tool-executor";
import { contextSources, localDisplay, localResponse } from "./local-response";
import { inferGeneralAlexa, type inferAlexa } from "./model-gateway";
import { readKnowledge } from "./knowledge-adapter";
import type { ClientSql } from "@/server/jarvis/client-sql";
import { readAgenda, readAgendaDay, requestsNextPatient } from "./agenda-adapter";
import { readDailyReceipts } from "./receipts-adapter";
import { buildConsultationNoteDetails, buildStructuredSummaryNarrative } from "./case-summary";
import { knowledgeResponseEvents } from "./knowledge-response";
import { synthesizeKnowledge } from "./knowledge-synthesis";
import type { SemanticPlan } from "./semantic-planner";
import { planLocalSemantic } from "./local-semantic-planner";
import { readPatientPage } from "./patient-search";
import { semanticCopy, appHelp } from "@/i18n/alexa-semantic";
import { readPatientRecords } from "./patient-records";
import { deterministicActionRequest, prepareActionProposal } from "./action-proposal";
import {readPatientFinance,patientFinanceSentence} from "./patient-finance";
import {agentCopy} from "@/i18n/alexa-agent";
import {alexaActions} from "@/i18n/alexa-actions";
import { explicitFrenchCurrentMonthRange, frenchRequestAdmission } from "@/shared/alexa/request-contract";
import { z } from "zod";

export interface OrchestratorDependencies {
  db: Pick<DbPort, "rpc">;
  knowledge: ClientSql;
  actor: string;
  native?: boolean;
  agentInfer?: AgentLoopDependencies["infer"];
  agentObserve?: AgentLoopDependencies["observeCall"];
  agentObserveResult?: AgentLoopDependencies["observeResult"];
  agentObserveData?: AgentLoopDependencies["observeData"];
  agentAsOf?:string;
  contextKey?:string;
  resumeCursor?:{cursorId:string;kind:AgentContinuationKind;patientId:string|null};
  build?: typeof buildClinicalContext;
  infer?: typeof inferAlexa;
  general?: typeof inferGeneralAlexa;
}

function continuesPatientReference(text:string,previous:WorkingReference|null):boolean {
  if(!previous?.selectedPatientId||parsePatientMention(text).status!=='none'||requestsCabinetWideScope(text))return false;
  const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').replace(/[’‘]/gu,"'").trim();
  return requestsPatientScope(text)
    || /^(?:et\s+)?(?:celle|celui|ceux|celles|avant|le\s+precedent|la\s+precedente|le\s+deuxieme|la\s+deuxieme|le\s+second|la\s+seconde|idem|pareil|pareille|la\s+meme\s+chose|imprime[- ]le|ouvre[- ]le|montre[- ]le\s+deuxieme)\b/u.test(plain)
    || previous.intent==='agenda'&&/^combien\s+(?:sont|sont-ils|restent)\b/u.test(plain)
    || ['treatments','treatment_changes'].includes(previous.intent)&&/\b(?:frequence|dose|horaire|moment|consigne|pause|reprends?|arrete)\b/u.test(plain);
}
function agendaStatusFollowup(text:string,previous:WorkingReference|null):string|null {
 if(previous?.intent!=='agenda'||!previous.agendaDay||requestsCabinetWideScope(text)||parsePatientMention(text).status!=='none')return null;
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').replace(/['']/gu,"'").trim();
 const direct=/^(?:et\s+)?combien\s+(?:(?:sont|restent)\s+)?(?:sont-ils\s+)?(?:confirmes?|en attente|annules?|arrives?|termines?)\s*[?!.]*$/u.test(plain);
 const grouped=/^(?:et\s+)?parmi\s+(?:eux|ces rendez-vous|cette liste)\s*,?\s*combien\s+(?:(?:en\s+)?(?:sont|restent)\s+)?(?:confirmes?|en attente|annules?|arrives?|termines?)\s*[?!.]*$/u.test(plain);
 if(!direct&&!grouped)return null;
 if(direct)return `${text.trim().replace(/[?!.]+$/u,'')} pour les rendez-vous du ${previous.agendaDay}.`;
 const status=plain.match(/\b(confirmes?|en attente|annules?|arrives?|termines?)\b/u)?.[1];
 if(!status)return null;
 const prior=previous.lastRequest?.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr')??'';
 const period=prior.match(/\b(?:demain|apres-demain|aujourd'hui|cette semaine|la semaine prochaine|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/u)?.[0];
 const parts=previous.agendaDay.split('-').map(Number);
 const day=parts.length===3&&parts.every(Number.isInteger)?`${parts[2]} ${FRENCH_MONTHS[parts[1]!-1]} ${parts[0]}`:null;
 if(!period&&!day)return null;
 return `Combien de rendez-vous sont ${status} ${period??day} ?`;
}
function treatmentPauseFollowup(text:string,previous:WorkingReference|null):string|null {
 if(!previous?.selectedPatientId||!['treatments','treatment_changes'].includes(previous.intent))return null;
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').replace(/[’‘]/gu,"'").trim();
 if(!/^(?:(?:et|alors)\s+)?(?:quels?\s+sont\s+(?:ceux|celles)(?:\s+qui)?|lesquels|lesquelles)\s+(?:sont\s+)?en pause\s*[?!.]*$/u.test(plain))return null;
 return 'Quels traitements sont en pause pour le patient sélectionné ?';
}
function previousMonthFollowup(text:string,previous:WorkingReference|null,asOf:string):string|null {
 if(!previous?.lastRequest)return null;
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').replace(/[’‘]/gu,"'").trim();
 if(!/^(?:(?:et\s+)?(?:le\s+)?mois\s+(?:precedent|dernier)|(?:et\s+)?(?:celui|celle)\s+d['’]avant)\s*[?!.]*$/u.test(plain))return null;
 const admission=frenchRequestAdmission(previous.lastRequest,false,asOf);
 if(admission.tools?.length!==1||admission.tools[0]!=='query_finance'||!explicitFrenchCurrentMonthRange(previous.lastRequest,asOf))return null;
 const start=explicitFrenchCurrentMonthRange(previous.lastRequest,asOf)!.from,parts=/^(\d{4})-(\d{2})-01/u.exec(start);
 if(!parts)return null;
 const priorMonth=new Date(Date.UTC(Number(parts[1]),Number(parts[2])-2,15,12));
 const month=new Intl.DateTimeFormat('fr-FR',{month:'long',timeZone:'UTC'}).format(priorMonth),year=priorMonth.getUTCFullYear();
 return previous.lastRequest.replace(/\b(?:ce mois(?:-ci)?|mois courant|mois en cours)\b/iu,`en ${month} ${year}`);
}
function replacedPatientCountFollowup(text:string,previous:WorkingReference|null,asOf:string):string|null {
 if(!previous?.lastRequest)return null;
 const admission=frenchRequestAdmission(previous.lastRequest,false,asOf);
 if(admission.tools?.length!==1||admission.tools[0]!=='query_consultations'||admission.consultationMode!=='count')return null;
 const priorMention=parsePatientMention(previous.lastRequest);if(priorMention.status!=='named')return null;
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').trim();
 if(!/^(?:et\s+|combien\b)/u.test(plain)||/[;!?].*\S/u.test(plain.replace(/[?.!]+$/u,'')))return null;
 const nextMention=parsePatientMention(text);
 const leadName=text.match(/^\s*et\s+([\p{L}][\p{L}\p{M}'’-]*(?:\s+[\p{L}][\p{L}\p{M}'’-]*){1,2})\s*,/iu)?.[1]?.trim();
 const nextName=nextMention.status==='named'?nextMention.name:leadName;
 if(!nextName||nextName===priorMention.name)return null;
 return previous.lastRequest.replace(priorMention.name,nextName);
}
const FRENCH_MONTHS=["janvier","fevrier","mars","avril","mai","juin","juillet","aout","septembre","octobre","novembre","decembre"];
function agendaDayFollowup(text:string,previous:WorkingReference|null):string|null{
 if(!previous?.agendaDay)return null;
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').trim();
 if(/^(?:et\s+)?(?:celui|celle)\s+du\s+(?:jour\s+suivant|lendemain)\b/u.test(plain)){
  const parts=previous.agendaDay.split('-').map(Number);
  if(parts.length!==3||!parts.every(Number.isInteger))return null;
  const next=new Date(Date.UTC(parts[0]!,parts[1]!-1,parts[2]!+1));
  return `Quels rendez-vous du ${next.getUTCDate()} ${FRENCH_MONTHS[next.getUTCMonth()]} ${next.getUTCFullYear()} ?`;
 }
 if(/^correction\b[^.!?]{0,40}\baujourd/iu.test(plain))return "Quels rendez-vous aujourd'hui ?";
 return null;
}
function patientCorrectionFollowup(text:string,previous:WorkingReference|null):string|null {
 if(!previous?.lastRequest)return null;
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').replace(/[’‘]/gu,"'").trim();
 if(!/^(?:pardon|non|excusez?[- ]moi|je me suis tromp[ée]e?)\b[^.!?]{0,40}\b(?:c'est|je voulais|plut[oô]t|remplace(?:r)?\s+par)\b/u.test(plain))return null;
 const priorMention=parsePatientMention(previous.lastRequest),nextMention=parsePatientMention(text);
 if(priorMention.status!=='named'||nextMention.status!=='named'||!nextMention.name.includes(' '))return null;
 const admission=frenchRequestAdmission(previous.lastRequest,false);
 if(!admission.tools?.length)return null;
 return previous.lastRequest.replace(priorMention.name,nextMention.name);
}
function previousConsultationFollowup(text:string,previous:WorkingReference|null,asOf:string):string|null {
 if(!previous?.selectedPatientId||!previous.lastRequest)return null;
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').replace(/[\u2019']/gu,"'").trim();
 if(!/^(?:et\s+)?(?:de\s+)?(?:celle\s+d[\u2019']avant|celle\s+qui\s+la\s+precede|la\s+consultation\s+precedente|la\s+precedente)(?:\s*,\s*separement)?\s*[?!.]*$/u.test(plain))return null;
 const prior=previous.lastRequest.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr');
 if(!/\b(?:resum\w*|synthes\w*)\b/u.test(prior)||! /\b(?:derniere|plus recente)\s+(?:consultation|seance)\b/u.test(prior))return null;
 const admission=frenchRequestAdmission(previous.lastRequest,false,asOf);
 if(admission.tools?.length!==1||admission.tools[0]!=='get_patient_context'||admission.patientSection!=='summary')return null;
 return /celle\s+qui\s+la\s+precede/u.test(plain) ? 'Fais la synthèse des deux visites les plus récentes du patient sélectionné, séparément.' : 'Résume l\u2019avant-dernière consultation du patient sélectionné.';
}
function diagnosisStateFollowup(text:string,previous:WorkingReference|null,asOf:string):string|null {
 if(!previous?.lastRequest)return null;
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').trim();
 if(!/^(?:et\s+)?lesquels?\s+sont\s+(resolus?|actifs?)\s*[?!.]*$/u.test(plain))return null;
 const admission=frenchRequestAdmission(previous.lastRequest,false,asOf);
 if(admission.tools?.length!==1||admission.tools[0]!=='get_patient_context'||admission.patientSection!=='diagnoses')return null;
 const state=/resolu/u.test(plain)?'résolus':'actifs';
 return 'Quels diagnostics '+state+' pour le patient sélectionné ?';
}
function consultationStatusFollowup(text:string,previous:WorkingReference|null,asOf:string):string|null {
 if(!previous?.lastRequest)return null;
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').replace(/['']/gu,"'").trim();
 const statusMatch=plain.match(/^(?:et\s+)?combien\s+(?:(?:en\s+)?(?:sont|restent)\s+)?(terminees?|closes?|ouvertes?|en cours)\s*[?!.]*$/u);
 if(!statusMatch)return null;
 const admission=frenchRequestAdmission(previous.lastRequest,false,asOf);
 if(admission.tools?.length!==1||admission.tools[0]!=='query_consultations'||!admission.from)return null;
 const parts=/^(\d{4})-(\d{2})-/u.exec(admission.from);if(!parts)return null;
 const month=FRENCH_MONTHS[Number(parts[2])-1];if(!month)return null;
 const mention=parsePatientMention(previous.lastRequest),status=/^(?:terminees?|closes?)$/u.test(statusMatch[1]!)?'terminees':'ouvertes';
 return `Combien de consultations ${status}${mention.status==='named'?` de ${mention.name}`:''} en ${month} ${parts[1]} ?`;
}
function groupedMinorFollowup(text:string,previous:WorkingReference|null,asOf:string):string|null {
 if(!previous?.lastRequest)return null;
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').trim();
 if(!/^(?:et\s+)?(?:combien\s+(?:de|des)\s+)?mineurs?\s+dans\s+(?:ce|cette)\s+(?:groupe|liste)\s*[?!.]*$/u.test(plain))return null;
 const admission=frenchRequestAdmission(previous.lastRequest,false,asOf);
 if(admission.tools?.length!==1||admission.tools[0]!=='query_patients')return null;
 const prior=previous.lastRequest.trim().replace(/[.!?]+$/u,'');
 const question=prior.replace(/^(?:compte|comptez|compter|montre|affiche|liste|donne)\s+(?:les\s+|le\s+nombre\s+de\s+)?/iu,'Combien de ');
 if(question===prior)return null;
 return `${question} sont mineurs ?`;
}
function monthlyChargesFollowup(text:string,previous:WorkingReference|null):string|null {
 if(!previous?.lastRequest)return null;
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').trim();
 const prior=previous.lastRequest.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr');
 if(/\bquelles?\s+charges?\b[^.!?]{0,40}\b(?:entrent|composent?|constituent?)\b/u.test(plain)&&/\b(?:resultat|benefice|net)\b/u.test(prior))return 'Quelles charges sont mensuelles ?';
 if(!/^(?:et\s+)?(?:calcule|calculer|quel\s+est|donne)\b[^.!?]{0,40}\b(?:total|somme)\b[^.!?]{0,20}\b(?:mensuel|charge)/u.test(plain))return null;
 if(!/\bcharges?\b/u.test(prior)||!/\b(?:mensuel\w*|recurrent\w*)\b/u.test(prior))return null;
 return 'Quel est le total des charges mensuelles ?';
}
function ordinalPhoneFollowup(text:string,previous:WorkingReference|null):string|null {
 if(!previous?.lastRequest)return null;
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').trim();
 if(!/^(?:le|la)?\s*(?:premier|deuxieme|second)\b[^.!?]{0,30}\bnumero\b[^.!?]{0,30}\bappartient\b/u.test(plain))return null;
 const match=previous.lastRequest.match(/t[ée]l[ée]phone de (.+?)(?:,)?\s+puis (?:celui|celle) de (.+?)[.!?]*$/iu);
 if(!match?.[1])return null;
 return `Affiche le profil de ${match[1].trim()}.`;
}
function treatmentFrequencyFollowup(text:string,previous:WorkingReference|null,asOf:string):string|null {
 if(!previous?.lastRequest)return null;
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr');
 if(!/\bfrequence\b/u.test(plain)||!/\btraitement\b/u.test(plain))return null;
 const admission=frenchRequestAdmission(previous.lastRequest,false,asOf);
 if(admission.tools?.length!==1||admission.tools[0]!=='get_patient_context'||admission.patientSection!=='treatments')return null;
 return 'Quels traitements sont en cours pour le patient sélectionné ?';
}
function latestScaleFollowup(text:string,previous:WorkingReference|null,asOf:string):string|null {
 if(!previous?.lastRequest)return null;
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr');
 if(!/\b(?:score|resultat)\b[^.!?]{0,30}\b(?:plus recent|dernier)\b/u.test(plain))return null;
 const admission=frenchRequestAdmission(previous.lastRequest,false,asOf);
 if(admission.tools?.length!==1||admission.tools[0]!=='get_patient_context'||admission.patientSection!=='scales')return null;
 return 'Montre les résultats d’échelles pour le patient sélectionné.';
}
function patientPaymentsTotalFollowup(text:string,previous:WorkingReference|null):string|null {
 if(!previous?.lastRequest)return null;
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr');
 if(!/\b(?:total|montant|somme)\b[^.!?]{0,20}\b(?:du|a payer|restant|impaye)/u.test(plain))return null;
 const prior=previous.lastRequest.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr');
 if(!/\b(?:reglements?|paiements?)\b/u.test(prior)||!/\b(?:attente|impaye|du)\b/u.test(prior))return null;
 return 'Quel est le solde à encaisser pour le patient sélectionné ?';
}
const patientListResultSchema=z.object({
 patientQuery:z.object({mode:z.literal('list')}).passthrough(),
 rows:z.array(z.object({id:z.uuid(),first_name:z.string().min(1).max(100),last_name:z.string().min(1).max(100)}).passthrough()).max(20),
}).passthrough();
function listedPatients(results:readonly {status:string;data?:unknown}[]):{patientId:string;label:string}[]|null {
 for(const result of [...results].reverse()){
  if(result.status!=='ok')continue;
  const parsed=patientListResultSchema.safeParse(result.data);if(!parsed.success)continue;
  return parsed.data.rows.map(row=>({patientId:row.id,label:`${row.first_name} ${row.last_name}`}));
 }
 return null;
}
function uniqueExactPatientSearchResult(results:readonly {status:string;data?:unknown}[],text:string):string|null {
 const mention=parsePatientMention(text);
 if(mention.status!=='named'||!/^\s*(?:alexa[, :]+)?(?:cherche|recherche|trouve|retrouve)\s+(?:plut[oô]t\s+)?(?:(?:le|la)\s+)?(?:(?:patient|patiente)\s+)?[\p{L}][\p{L}\p{M}'’-]*(?:\s+[\p{L}][\p{L}\p{M}'’-]*){1,2}\s*[.!?]*\s*$/iu.test(text))return null;
 const normalize=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').replace(/[’‘]/gu,"'").replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const schema=z.object({patientQuery:z.object({mode:z.literal('list'),query:z.string().min(2).max(160)}).passthrough(),total:z.number().int().min(0),rows:z.array(z.object({id:z.uuid(),first_name:z.string().min(1).max(100),last_name:z.string().min(1).max(100)}).passthrough()).max(20)}).passthrough();
 for(const result of [...results].reverse()){
  if(result.status!=='ok')continue;
  const parsed=schema.safeParse(result.data);if(!parsed.success)continue;
  if(parsed.data.total!==1||parsed.data.rows.length!==1||normalize(parsed.data.patientQuery.query)!==normalize(mention.name))return null;
  const row=parsed.data.rows[0]!;
  return normalize(`${row.first_name} ${row.last_name}`)===normalize(mention.name)?row.id:null;
 }
 return null;
}

/** Native tool selection remains subject to server validation, identity and scope gates. */
export async function runAlexa(input: TurnInput, dependencies: OrchestratorDependencies, emit: (event: AlexaEvent) => void, signal: AbortSignal): Promise<void> {
  if (dependencies.native) {
    // Courtesies use the same closed dialogue grammar as the established UI.
    // A greeting never needs patient lookup or a model inference slot.
    const plannedIntent=planRequest(input.text, null);
    if (!dependencies.resumeCursor&&plannedIntent.intent === 'dialogue') return runAlexaSingle(input, dependencies, emit, signal);
    if (!dependencies.resumeCursor&&plannedIntent.intent === 'clock') return runAlexaSingle(input, dependencies, emit, signal, undefined, { plan: plannedIntent });
    // Explicit document and internal-message requests remain reachable without
    // the local model. The model path still handles paraphrases and compounds.
    if (!dependencies.resumeCursor&&deterministicActionRequest(input.text,input.appContext.documentId)) return runAlexaSingle(input, dependencies, emit, signal, undefined, { plan: { intent: "proposal", count: 1, language: "fr" } });
    const contextKey=dependencies.contextKey??JSON.stringify(input.appContext),asOf=dependencies.agentAsOf??new Date().toISOString();
    const previous=conversationState.read(dependencies.actor,input.conversationId,input.appContext.patientId,input.appContext.page,Date.now(),contextKey);
    const agentInput=dependencies.resumeCursor?{...input,text:agentContinuationText(dependencies.resumeCursor.kind)}:input;
    const listedReferenceText=agentInput.text.replace(/^\s*(?:montre|affiche|ouvre|présente|presente|sélectionne|selectionne)\s+/iu,'');
    const selectedListedPatient=previous?.patients?resolveListedReference(listedReferenceText,previous.patients):null;
    const inheritedAgendaNextDayText=dependencies.resumeCursor?null:agendaDayFollowup(agentInput.text,previous),inheritedAgendaText=inheritedAgendaNextDayText??(dependencies.resumeCursor?null:agendaStatusFollowup(agentInput.text,previous)),inheritedTreatmentText=inheritedAgendaText||dependencies.resumeCursor?null:treatmentPauseFollowup(agentInput.text,previous),inheritedFinanceText=inheritedAgendaText||inheritedTreatmentText||dependencies.resumeCursor?null:previousMonthFollowup(agentInput.text,previous,asOf),inheritedPatientCountText=inheritedAgendaText||inheritedTreatmentText||inheritedFinanceText||dependencies.resumeCursor?null:replacedPatientCountFollowup(agentInput.text,previous,asOf),inheritedPatientCorrectionText=inheritedAgendaText||inheritedTreatmentText||inheritedFinanceText||inheritedPatientCountText||dependencies.resumeCursor?null:patientCorrectionFollowup(agentInput.text,previous),inheritedPreviousConsultationText=inheritedAgendaText||inheritedTreatmentText||inheritedFinanceText||inheritedPatientCountText||inheritedPatientCorrectionText||dependencies.resumeCursor?null:previousConsultationFollowup(agentInput.text,previous,asOf),inheritedConsultationStatusText=inheritedAgendaText||inheritedTreatmentText||inheritedFinanceText||inheritedPatientCountText||inheritedPatientCorrectionText||inheritedPreviousConsultationText||dependencies.resumeCursor?null:consultationStatusFollowup(agentInput.text,previous,asOf),inheritedGroupedMinorText=inheritedAgendaText||inheritedTreatmentText||inheritedFinanceText||inheritedPatientCountText||inheritedPatientCorrectionText||inheritedPreviousConsultationText||inheritedConsultationStatusText||dependencies.resumeCursor?null:groupedMinorFollowup(agentInput.text,previous,asOf),inheritedMonthlyChargesText=inheritedAgendaText||inheritedTreatmentText||inheritedFinanceText||inheritedPatientCountText||inheritedPatientCorrectionText||inheritedPreviousConsultationText||inheritedConsultationStatusText||inheritedGroupedMinorText||dependencies.resumeCursor?null:monthlyChargesFollowup(agentInput.text,previous),inheritedOrdinalPhoneText=inheritedAgendaText||inheritedTreatmentText||inheritedFinanceText||inheritedPatientCountText||inheritedPatientCorrectionText||inheritedPreviousConsultationText||inheritedConsultationStatusText||inheritedGroupedMinorText||inheritedMonthlyChargesText||dependencies.resumeCursor?null:ordinalPhoneFollowup(agentInput.text,previous),inheritedTreatmentFrequencyText=inheritedAgendaText||inheritedTreatmentText||inheritedFinanceText||inheritedPatientCountText||inheritedPatientCorrectionText||inheritedPreviousConsultationText||inheritedConsultationStatusText||inheritedGroupedMinorText||inheritedMonthlyChargesText||inheritedOrdinalPhoneText||dependencies.resumeCursor?null:treatmentFrequencyFollowup(agentInput.text,previous,asOf),inheritedLatestScaleText=inheritedAgendaText||inheritedTreatmentText||inheritedFinanceText||inheritedPatientCountText||inheritedPatientCorrectionText||inheritedPreviousConsultationText||inheritedConsultationStatusText||inheritedGroupedMinorText||inheritedMonthlyChargesText||inheritedOrdinalPhoneText||inheritedTreatmentFrequencyText||dependencies.resumeCursor?null:latestScaleFollowup(agentInput.text,previous,asOf),inheritedDiagnosisStateText=dependencies.resumeCursor?null:diagnosisStateFollowup(agentInput.text,previous,asOf),inheritedPaymentsTotalText=inheritedAgendaText||inheritedTreatmentText||inheritedFinanceText||inheritedPatientCountText||inheritedPatientCorrectionText||inheritedPreviousConsultationText||inheritedConsultationStatusText||inheritedGroupedMinorText||inheritedMonthlyChargesText||inheritedOrdinalPhoneText||inheritedTreatmentFrequencyText||inheritedLatestScaleText||dependencies.resumeCursor?null:patientPaymentsTotalFollowup(agentInput.text,previous),inheritedText=inheritedAgendaText??inheritedTreatmentText??inheritedFinanceText??inheritedPatientCountText??inheritedPatientCorrectionText??inheritedPreviousConsultationText??inheritedConsultationStatusText??inheritedGroupedMinorText??inheritedMonthlyChargesText??inheritedOrdinalPhoneText??inheritedTreatmentFrequencyText??inheritedLatestScaleText??inheritedDiagnosisStateText??inheritedPaymentsTotalText;
    const turnInput=dependencies.resumeCursor?agentInput:selectedListedPatient?{...agentInput,text:'Affiche le profil du patient sélectionné.'}:inheritedText?{...agentInput,text:inheritedText}:agentInput;
    const reusePatient=continuesPatientReference(turnInput.text,previous);
    const scopedInput=selectedListedPatient?{...turnInput,appContext:{...turnInput.appContext,patientId:selectedListedPatient}}:reusePatient&&previous?.selectedPatientId?{...turnInput,appContext:{...turnInput.appContext,patientId:previous.selectedPatientId}}:turnInput;
    const lease=conversationState.begin(dependencies.actor,input.conversationId,input.appContext.patientId,input.appContext.page,Date.now(),contextKey);
    const result=await runAgentLoop(scopedInput,{actor:dependencies.actor,...(dependencies.agentAsOf?{asOf:dependencies.agentAsOf}:{}),...(dependencies.agentInfer?{infer:dependencies.agentInfer}:{}),...(dependencies.agentObserve?{observeCall:dependencies.agentObserve}:{}),...(dependencies.agentObserveResult?{observeResult:dependencies.agentObserveResult}:{}),...(dependencies.agentObserveData?{observeData:dependencies.agentObserveData}:{}),...(dependencies.resumeCursor?{resumeCursor:dependencies.resumeCursor}:{}),execute:agentExecutor(scopedInput,dependencies.db,dependencies.knowledge),onStage:()=>emit({type:"stage",stage:"analysis"})},signal);
    if(!conversationState.isCurrent(lease)) {emit({type:"error",code:"stale",message:dialogue("fr").stale});return;}
    const responses=result.results.filter(r=>r.text);
    if(!validAlexaSources(result.sources)||result.results.some(r=>!validAlexaSources(r.evidence)||r.links!==undefined&&!validAnswerLinks(r.text,r.links)))throw new Error('AlexaSourceEvidenceInvalid');
    const unresolved=new Set(result.parts.filter(p=>!p.resultRefs.length&&p.reason).map(p=>`${p.goal} — ${p.reason}`));
    for(const [index,text] of result.sentences.entries()){
      const response=responses[index]?.text===text?responses[index]:undefined;
      const synthesis=!response&&text.startsWith(agentCopy.fr.synthesis+"\n");
      const kind=response?.presentation==="knowledge"?"knowledge":response?.presentation==="inference"||synthesis||(!response&&!unresolved.has(text)&&result.results.some(r=>r.presentation==="inference"))?"inference":"fact";
      emit({type:"sentence",text,kind,sources:response?response.evidence:!unresolved.has(text)?result.sources:[],...(response?.links?.length?{links:response.links}:{})});
    }
    if(result.proposal)emit({type:"proposal",...result.proposal});
    const nextPlan=dependencies.resumeCursor&&previous?previous:inheritedAgendaText&&previous?.agendaDay?{intent:'agenda' as const,count:previous.count,agendaDay:previous.agendaDay,...(previous.agendaRequestedOnly!==undefined?{agendaRequestedOnly:previous.agendaRequestedOnly}:{})}:planRequest(turnInput.text,previous,asOf);
    const explicitMention=parsePatientMention(input.text);
    const exactSearchPatientId=uniqueExactPatientSearchResult(result.results,input.text);
    const selectedPatientId=result.patientId??exactSearchPatientId??(explicitMention.status==='none'&&!requestsCabinetWideScope(input.text)?(reusePatient?previous?.selectedPatientId:input.appContext.patientId):undefined);
    const reference:WorkingReference={...(previous??{}),...nextPlan,lastRequest:dependencies.resumeCursor?previous?.lastRequest??input.text:turnInput.text};
    const newPatients=listedPatients(result.results);
    if(newPatients)reference.patients=newPatients;else if(selectedListedPatient&&previous?.patients)reference.patients=previous.patients;else if(!inheritedText)delete reference.patients;
    if(selectedPatientId)reference.selectedPatientId=selectedPatientId;else delete reference.selectedPatientId;
    conversationState.finish(lease,reference);
    emit({type:"done",patientId:result.patientId,patientScope:result.patientId?"replace":"preserve",sourceRevision:null,coverage:null,limited:result.status!=="completed",status:result.status,parts:result.parts,tokensIn:result.tokensIn,tokensOut:result.tokensOut,speechAllowed:result.speechAllowed??result.status==="completed",...(result.navigation?{navigation:result.navigation}:{})});
    return;
  }
  if (signal.aborted) { emit({ type: "error", code: "cancelled", message: dialogue(planRequest(input.text, null).language).stale }); return; }
  const previous=conversationState.read(dependencies.actor,input.conversationId,input.appContext.patientId,input.appContext.page);
  const listed=previous?.patients?resolveListedReference(input.text,previous.patients):null;
  if(listed) {
    const plan={...(previous?.pendingPlan??{intent:"profile" as const,count:1,language:"fr" as const}),patients:previous!.patients!,selectedPatientId:listed};
    const selected={...input,appContext:{...input.appContext,patientId:listed}};
    delete selected.patientName;
    return runAlexaSingle(selected,dependencies,emit,signal,undefined,{plan});
  }
  const questions = splitAlexaQuestions(input.text);
  const wholePlan = planRequest(input.text, previous, dependencies.agentAsOf);
  const mention = parsePatientMention(input.text);
  const lease = conversationState.begin(dependencies.actor, input.conversationId, input.appContext.patientId, input.appContext.page);
  if (["clarify", "knowledge", "proposal"].includes(wholePlan.intent)) {
    const semantic = await planLocalSemantic(input.text, wholePlan,
      conversationState.read(dependencies.actor,input.conversationId,input.appContext.patientId,input.appContext.page), signal).catch(()=>null);
    if (signal.aborted || !conversationState.isCurrent(lease)) {
      emit({ type: "error", code: signal.aborted ? "cancelled" : "stale", message: dialogue(wholePlan.language).stale });
      return;
    }
    // One coherent model-selected public/administrative request precedes
    // lexical clause splitting; tool inputs and permissions stay local.
    if (semantic) {
      let selected=input.appContext.patientId;
      const reference=semantic.plan.patientReference;
      if(reference&&!semantic.patientName) {
        if(reference.kind==="ordinal")selected=previous?.patients?resolveListedReference(reference.value,previous.patients):null;
        else if(reference.kind!=="current") {
          const index=previous?.patients?.findIndex(p=>p.patientId===(previous.selectedPatientId??input.appContext.patientId))??-1;
          selected=index<0?null:previous?.patients?.[index+(reference.kind==="next"?1:-1)]?.patientId??null;
        }
        if(!selected)semantic.plan={...semantic.plan,intent:"clarify",clarification:"patient"};
        else if(previous?.patients)semantic.plan={...semantic.plan,patients:previous.patients,selectedPatientId:selected};
      }
      return runAlexaSingle({...input,appContext:{...input.appContext,patientId:selected},...(semantic.patientName?{patientName:semantic.patientName}:{})}, dependencies, emit, signal, lease, semantic);
    }
    // Delivery: an unclassified question with no patient scope is answered by the
    // LLM (open general admission, all content guards still run) instead of
    // failing on the dormant local semantic planner. Patient-scoped ambiguity
    // still asks for clarification — the local-unavailable dead end is gone.
    if(questions?.length === 1 && wholePlan.intent==="clarify"&&!wholePlan.clarification){
      if (mention.status === "none" && !input.patientName && !requestsPatientScope(input.text))
        return runAlexaSingle(input,dependencies,emit,signal,lease,{plan:{...wholePlan,intent:"general"},openGeneral:true});
      return runAlexaSingle(input,dependencies,emit,signal,lease,{plan:{...wholePlan}});
    }
  }
  // A rejected date applies to the compound agenda scope too. Do not let a
  // later date-less clause silently become a read of today's appointments.
  const invalidCompoundAgenda = wholePlan.intent === "clarify" && agendaSelection(input.text) === null
    && questions?.some(text => planRequest(text, null, dependencies.agentAsOf).intent === "clarify" && agendaSelection(text) === null)
    && questions?.some(text => planRequest(text, null, dependencies.agentAsOf).intent === "agenda")
    && !questions?.some(text => planRequest(text, null, dependencies.agentAsOf).intent === "clock");
  if (questions?.length === 1 || invalidCompoundAgenda || wholePlan.intent === "proposal" || wholePlan.intent === "navigation" || mention.status === "ambiguous") {
    return runAlexaSingle(input, dependencies, emit, signal, lease);
  }
  if (signal.aborted) { emit({ type: "error", code: "cancelled", message: dialogue(wholePlan.language).stale }); return; }
  const copy = questionCopy(wholePlan.language);
  if (!questions) {
    emit({ type: "sentence", text: copy.limit, kind: "fact", sources: [] });
    emit({ type: "done", patientId: null, patientScope: "preserve", sourceRevision: null, coverage: null, limited: true });
    return;
  }

  let selected = input.appContext.patientId;
  let limited = false, replaced = false, failed = false, published = false;
  let completion: Extract<AlexaEvent, { type: "done" }> | undefined;
  for (const [index, text] of questions.entries()) {
    if (signal.aborted || !conversationState.isCurrent(lease)) {
      if (!failed) emit({ type: "error", code: signal.aborted ? "cancelled" : "stale", message: dialogue(wholePlan.language).stale, partial: index > 0 });
      return;
    }
    const plan = planRequest(text, conversationState.read(dependencies.actor, input.conversationId, selected, input.appContext.page), dependencies.agentAsOf);
    const localScope = !["dialogue", "general", "knowledge", "agenda", "receipts", "clarify", "app_help", "clock", "patient_search"].includes(plan.intent);
    const name = input.patientName ?? (mention.status === "named" ? mention.name : undefined);
    emit({ type: "sentence", text: copy.heading(index + 1), kind: "fact", sources: [] });
    const part: TurnInput = { ...input, text, appContext: { ...input.appContext, patientId: selected } };
    delete part.patientName;
    if (localScope && name) part.patientName = name;
    await runAlexaSingle(part, dependencies, event => {
      if (event.type === "done") {
        completion = event;
        limited ||= event.limited;
        if (event.patientScope !== "preserve") { selected = event.patientId; replaced = true; }
      } else {
        if (event.type === "error") { failed = true; emit({ ...event, ...(published ? { partial: true } : {}) }); }
        else { if (event.type === "sentence") published = true; emit(event); }
      }
    }, signal, lease);
    if (failed) return;
    // A rejected identity clears the lease; do not reuse an older dossier.
    if (!conversationState.isCurrent(lease)) break;
  }
  if (completion && !signal.aborted) emit({ ...completion, ...(replaced ? { patientId: selected, patientScope: "replace" as const } : {}), limited });
}

async function runAlexaSingle(input: TurnInput, dependencies: OrchestratorDependencies, emit: (event: AlexaEvent) => void, signal: AbortSignal, sharedLease?: TurnLease, semantic?: SemanticPlan): Promise<void> {
  const { actor, db } = dependencies;
  const previous = conversationState.read(actor, input.conversationId, input.appContext.patientId, input.appContext.page);
  const plan = semantic?.plan ?? planRequest(input.text, previous, dependencies.agentAsOf);
  const mention = parsePatientMention(input.text);
  const copy = dialogue(plan.language);
  const lease = sharedLease ?? conversationState.begin(actor, input.conversationId, input.appContext.patientId, input.appContext.page);
  const active = () => {
    signal.throwIfAborted();
    if (!conversationState.isCurrent(lease)) throw new Error("ScopeChanged");
  };
  const sentence = (text: string) => { active(); emit({ type: "sentence", text, kind: "fact", sources: [] }); };
  let patientId: string | null = null;
  let context: ClinicalContext | null = null;
  let limited = true;
  let terminalStatus: Extract<AlexaEvent, { type: "done" }>["status"];
  let publishedClinical = 0;
  let navigation: AlexaNavigation | undefined;
  let resultReference: import("./request-plan").WorkingReference|undefined;
  const rejectPatientSelection = (text: string) => {
    active();
    conversationState.clear(actor, input.conversationId);
    emit({ type: "sentence", text, kind: "fact", sources: [] });
    emit({ type: "done", patientId: null, patientScope: "replace", sourceRevision: null, coverage: null, limited: true });
  };
  try {
    active();
    if (plan.intent === "dialogue") { sentence(copy[plan.dialogueAct ?? "help"]); limited = false; }
    else if (plan.intent === "clock") {
      const at=new Date(dependencies.agentAsOf??Date.now());
      const asksDate=/\b(?:date|jour)\b/u.test(input.text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase());
      sentence(asksDate
        ?new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Algiers",year:"numeric",month:"2-digit",day:"2-digit"}).format(at)
        :new Intl.DateTimeFormat(plan.language==="fr"?"fr-DZ":"ar-DZ",{timeZone:"Africa/Algiers",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(at)); limited=false;
    }
    else if (plan.intent === "app_help") {
      const key=plan.helpTopic as keyof typeof appHelp;
      sentence(Object.hasOwn(appHelp,key)?appHelp[key]:appHelp.current_section); limited=key==="current_section"||!Object.hasOwn(appHelp,key);
    }
    else if (plan.intent === "general") {
      if (input.patientName || mention.status !== "none" || requestsPatientScope(input.text)) { rejectPatientSelection(copy.clarify); return; }
      emit({ type: "stage", stage: "analysis" });
      const answer = await (dependencies.general ?? inferGeneralAlexa)(input.text, { signal, caller: actor,
        ...(semantic?.publicAdmission ? { publicAdmission: semantic.publicAdmission } : {}),
        ...(semantic?.openGeneral ? { openGeneral: true as const } : {}) });
      active();
      if (answer.ok) {
        sentence(ALEXA_GENERAL_SOURCE[plan.language === "fr" ? "fr" : "ar"]);
        emit({ type: "sentence", text: answer.text, kind: "inference", sources: [] });
        limited = false;
      } else sentence(answer.code === "privacy" ? questionCopy(plan.language).generalRestricted : answer.code === "quota-exhausted" ? questionCopy(plan.language).generalQuotaExhausted : answer.code === "rate-limited" ? questionCopy(plan.language).generalRateLimited : questionCopy(plan.language).generalUnavailable);
    }
    else if (plan.intent === "patient_search") {
      emit({ type: "stage", stage: "context" });
      const follow=/^(?:lesquels|et lesquels|la suite|suite|suivant|شكون|كمل)[?!.؟\s]*$/iu.test(input.text);
      const offset=follow&&previous?.listOffset!==undefined?previous.listOffset:0;
      const result = await readPatientPage(db, plan.patientFilter ?? previous?.patientFilter ?? "all",plan.outputShape==="count"?"count":"list",offset, signal);
      active();
      const searchCopy = semanticCopy[plan.language === "fr" ? "fr" : "ar"];
      if (result.state !== "complete") sentence(result.state==="unsupported"?searchCopy.unsupportedEmail:copy.stale);
      else {
        sentence(searchCopy.count(result.total,plan.patientFilter??"all"));
        for (const [index, patient] of result.patients.entries()) emit({ type: "sentence", text: `${index + 1}. ${patient.label}`, kind: "fact",
          sources: [{ id: patient.id, type: "patient", label: patient.label }] });
        if(result.hasMore)sentence(searchCopy.more);
        resultReference={intent:"patient_search",count:plan.count,patientFilter:plan.patientFilter??previous?.patientFilter??"all",outputShape:plan.outputShape??"list",
          patients:result.patients.map(p=>({patientId:p.id,label:p.label})),listTotal:result.total,listOffset:result.offset+result.patients.length};
        limited = false;
      }
    }
    else if (plan.intent === "clarify") {
      const slotCopy=semanticCopy[plan.language==="fr"?"fr":"ar"];
      sentence(plan.clarification === "agenda-period" ? copy.agendaClarify : plan.clarification === "next-patient-period" ? copy.nextPatientClarify : plan.clarification === "local-unavailable" ? slotCopy.localUnavailable : plan.clarification ? slotCopy[plan.clarification] : copy.clarify);
    }
    else if (plan.intent === "proposal") {
      const result=await prepareActionProposal(input,db,dependencies.knowledge,signal);active();
      if(result.state==="ready") {patientId=result.patientId;terminalStatus="needs_confirmation";limited=false;emit({type:"proposal",...result.proposal});sentence(copy.proposal);}
      else if(result.state==="print"){patientId=result.patientId;navigation={target:"document",patientId:result.patientId,documentId:result.documentId,print:true};terminalStatus="completed";limited=false;sentence(alexaActions.printOpening(result.label));}
      else {terminalStatus=result.state==="unavailable"?"failed":"needs_input";sentence(result.state==="unavailable"?copy.unavailable:result.message??semanticCopy[plan.language==="fr"?"fr":"ar"][result.slot]);}
    }
    else if (plan.intent === "navigation" && plan.navigationTarget !== "patient") {
      if (input.patientName || mention.status !== "none" || requestsPatientScope(input.text)) { rejectPatientSelection(copy.clarify); return; }
      if (!plan.navigationTarget) sentence(copy.clarify);
      else { navigation = { target: plan.navigationTarget }; sentence(copy.opening[plan.navigationTarget]); limited = false; }
    }
    else if (plan.intent === "receipts") {
      if (input.patientName) sentence(copy.clarify);
      else {
        emit({ type: "stage", stage: "context" });
        const receipts = await readDailyReceipts(dependencies.knowledge, signal);
        active();
        const locale = plan.language === "fr" ? "fr-DZ" : "ar-DZ";
        const date = new Intl.DateTimeFormat(locale, { timeZone: "Africa/Algiers", dateStyle: "short" }).format(new Date(`${receipts.day}T12:00:00+01:00`));
        sentence(copy.receipts(date, new Intl.NumberFormat(locale).format(receipts.montant_dzd), receipts.seances, receipts.perimetre));
        limited = false;
      }
    }
    else if (plan.intent === "agenda") {
      const next = requestsNextPatient(input.text);
      const name = input.patientName ?? (mention.status === "named" ? mention.name : undefined);
      if (mention.status === "ambiguous" || (next && name)) { rejectPatientSelection(copy.patient); return; }
      const patientSpecific = !!name || requestsPatientScope(input.text);
      if (!next && patientSpecific) {
        emit({ type: "stage", stage: "identity" });
        const resolution = await resolvePatient(db, name ? { name } : input.appContext.patientId ? { patientId: input.appContext.patientId } : {}, signal);
        active();
        if (resolution.status !== "resolved") { rejectPatientSelection(copy.patient); return; }
        patientId = resolution.patientId;
        if (patientId !== input.appContext.patientId) Object.assign(lease, conversationState.begin(actor, input.conversationId, patientId, input.appContext.page));
      }
      emit({ type: "stage", stage: "context" });
      const agenda = next ? await readAgenda(dependencies.knowledge, signal)
        : { suivant: null, journee: await readAgendaDay(dependencies.knowledge, plan.agendaDay!, plan.agendaRequestedOnly === true, signal) };
      active();
      const appointments = next ? (agenda.suivant ? [agenda.suivant] : []) : patientId ? agenda.journee.filter(appointment => appointment.patient_id === patientId) : agenda.journee;
      if (!next) {
        const date = new Intl.DateTimeFormat(plan.language === "fr" ? "fr-DZ" : "ar-DZ", { timeZone: "Africa/Algiers", dateStyle: "short" }).format(new Date(`${plan.agendaDay}T12:00:00+01:00`));
        sentence(copy.agendaPeriod(date, plan.agendaRequestedOnly === true));
      }
      if (next && agenda.suivant?.patient_id) {
        const resolution = await resolvePatient(db, { patientId: agenda.suivant.patient_id }, signal);
        active();
        if (resolution.status === "resolved") { patientId = resolution.patientId; navigation = { target: "patient", patientId }; }
        else { sentence(copy.patient); emit({ type: "done", patientId: null, patientScope: "replace", sourceRevision: null, coverage: null, limited: true }); return; }
      }
      if (!appointments.length) sentence(copy.emptyAgenda);
      for (const appointment of appointments) {
        active();
        const time = new Intl.DateTimeFormat(plan.language === "fr" ? "fr-DZ" : "ar-DZ", { timeZone: "Africa/Algiers", hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(new Date(appointment.starts_at));
        const name = "first_name" in appointment ? [appointment.first_name, appointment.last_name].filter(Boolean).join(" ") || null : null;
        emit({ type: "sentence", text: next ? copy.appointment(time, appointment.status as "confirmed" | "arrived" | "in_session" | "completed" | "no_show") : copy.agendaEntry(name, time, appointment.status), kind: "fact", sources: [{ id: appointment.id, type: "appointment", label: time }] });
      }
      limited = false;
    }
    else if (plan.intent === "knowledge") {
      emit({ type: "stage", stage: "knowledge" });
      const result = await readKnowledge(dependencies.knowledge, plan.knowledgeQuery??input.text, signal, undefined, { traceOrigin: "direct" });
      active();
      const events = await synthesizeKnowledge(result, input.text, plan.language, signal);
      active();
      for (const event of events) { active(); emit(event); }
    } else {
      emit({ type: "stage", stage: "identity" });
      if (mention.status === "ambiguous") {
        rejectPatientSelection(copy.patient);
        return;
      }
      const name = input.patientName ?? (mention.status === "named" ? mention.name : undefined);
      const resolution = await resolvePatient(db, name ? { name } : input.appContext.patientId ? { patientId: input.appContext.patientId } : {}, signal);
      active();
      if(resolution.status==="ambiguous"&&resolution.candidates.length>0) {
        const wording=semanticCopy[plan.language==="fr"?"fr":"ar"];
        sentence(wording.choose);
        for(const [index,candidate] of resolution.candidates.entries())sentence(`${index+1}. ${candidate.label}`);
        conversationState.clear(actor,input.conversationId);
        const pending=conversationState.begin(actor,input.conversationId,null,input.appContext.page);
        conversationState.finish(pending,{intent:plan.intent,count:plan.count,patients:resolution.candidates,pendingPlan:{...plan}});
        emit({type:"done",patientId:null,patientScope:"replace",sourceRevision:null,coverage:null,limited:true});return;
      }
      if (resolution.status !== "resolved") {
        rejectPatientSelection(resolution.status==="absent"?semanticCopy[plan.language==="fr"?"fr":"ar"].absent:name?copy.unavailable:copy.patient);
        return;
      }
      patientId = resolution.patientId;
      if (plan.intent === "navigation") {
        sentence(copy.opening.patient);
        conversationState.clear(actor, input.conversationId);
        emit({ type: "done", patientId, patientScope: "replace", sourceRevision: null, coverage: null, limited: false, navigation: { target: "patient", patientId } });
        return;
      }
      // A name resolving to a different dossier gets a new lease and no old cursor.
      if (patientId !== lease.patientId) {
        const replacement = conversationState.begin(actor, input.conversationId, patientId, input.appContext.page);
        Object.assign(lease, replacement);
        delete plan.before;
      }
      if (plan.intent === "profile" || plan.intent === "documents") {
        const events = await readPatientRecords(db, patientId, plan.intent, plan.language, signal);
        active();
        const freshEvents=await readPatientRecords(db,patientId,plan.intent,plan.language,signal);active();
        if(JSON.stringify(events)!==JSON.stringify(freshEvents))throw new Error("StaleContext");
        const revalidated = await resolvePatient(db, { patientId }, signal);
        active();
        if (revalidated.status !== "resolved") throw new Error("StaleContext");
        events.forEach(event => emit(event));
        conversationState.finish(lease, { intent: plan.intent, count: plan.count, ...(plan.patients?{patients:plan.patients,selectedPatientId:patientId}:{}) });
        emit({ type: "done", patientId, patientScope: "replace", sourceRevision: null, coverage: null, limited: plan.intent === "documents" });
        return;
      }
      if (plan.intent === "patient_finance") {
        const summary=await readPatientFinance(db,patientId,signal);active();
        const fresh=await readPatientFinance(db,patientId,signal);active();
        if(JSON.stringify(summary)!==JSON.stringify(fresh))throw new Error("StaleContext");
        emit(patientFinanceSentence(summary,plan.language));
        conversationState.finish(lease,{intent:plan.intent,count:10});
        emit({type:"done",patientId,patientScope:"replace",sourceRevision:null,coverage:null,limited:!summary.complete});return;
      }
      emit({ type: "stage", stage: "context" });
      const build = dependencies.build ?? buildClinicalContext;
      context = await executeRead("clinical_context", { patientId, count: plan.count, ...(plan.before ? { before: plan.before } : {}) }, patientId,
        (args, readSignal) => build(db, { patientId: args.patientId }, { count: args.count, ...(args.before ? { before: args.before } : {}), purpose: plan.intent === "longitudinal" ? "longitudinal" : plan.intent === "preparation" ? "preparation" : plan.intent === "history" ? "history" : "summary" }, readSignal), signal);
      active();
      const fresh = async () => {
        active();
        const latest = await build(db, { patientId: patientId! }, { count: 1 }, signal);
        active();
        if (latest.sourceRevision !== context!.sourceRevision) throw new Error("StaleContext");
      };
      const publishedSentences = new Set<string>();

      let output = localResponse(context, plan, resolution.identityTokens);
      const structuredSummary = plan.intent === "summary" || plan.intent === "preparation";
      if (structuredSummary) {
        const sources = contextSources(context);
        if (context.currentConsultation) sources.push({ id: context.currentConsultation.id, type: "consultation", label: copy.currentConsultation });
        const items = [...buildStructuredSummaryNarrative(context, resolution.identityTokens, plan.language), ...buildConsultationNoteDetails(context, resolution.identityTokens, plan.language)];
        output = items.map(item => ({
          type: "sentence", text: item.texte, kind: "fact", sources: item.sources.flatMap(ref => sources.filter(source => source.id === ref.id)),
        }));
      }
      if (plan.includeKnowledge) {
        emit({ type: "stage", stage: "knowledge" });
        const knowledge = await readKnowledge(dependencies.knowledge, input.text, signal, undefined, { traceOrigin: "patient_context" });
        active();
        output.push(...knowledgeResponseEvents(knowledge, plan.language, true, resolution.identityTokens, input.text));
        limited ||= knowledge.etat !== "ok";
      }
      emit({ type: "stage", stage: "validation" });
      await fresh();
      for (const event of output) {
        active();
        const key=JSON.stringify([event.text,event.kind,event.sources]);
        if(publishedSentences.has(key))continue;
        if (event.text) { publishedSentences.add(key);emit(event); if (event.kind !== "knowledge" && event.sources.length) publishedClinical++; }
      }
      const last = context.consultations.at(-1);
      const cursor = context.coverage.next ?? (last ? { startedAt: last.startedAt, id: last.id } : plan.before);
      conversationState.finish(lease, { intent: plan.intent, count: plan.count, ...(plan.patients?{patients:plan.patients,selectedPatientId:patientId}:{}), ...(cursor ? { cursor } : {}), ...(plan.before ? { selectionBefore: plan.before } : {}), ...(plan.operation ? { operation: plan.operation } : {}), ...(plan.focus ? { focus: plan.focus } : {}) });
    }
    active();
    if (context === null) conversationState.finish(lease, resultReference??{ intent: plan.intent, count: plan.count,
      ...(previous?.patients && !input.patientName && mention.status==="none" ? {patients:previous.patients,...(previous.patientFilter?{patientFilter:previous.patientFilter}:{}),...(previous.listOffset!==undefined?{listOffset:previous.listOffset}:{}),...(previous.listTotal!==undefined?{listTotal:previous.listTotal}:{}),...(previous.pendingPlan?{pendingPlan:previous.pendingPlan}:{}),...(previous.selectedPatientId?{selectedPatientId:previous.selectedPatientId}:{})}:{}),
      ...(plan.agendaDay ? { agendaDay: plan.agendaDay, agendaRequestedOnly: plan.agendaRequestedOnly } : {}) });
    // No patient used by a global answer does not mean the working dossier was
    // rejected. Explicit identity failures and next-patient reads replace scope.
    const patientScope = plan.intent === "dialogue" || (context === null && patientId === null && !input.patientName && !requestsNextPatient(input.text)) ? "preserve" : "replace";
    emit({ type: "done", patientId, patientScope, sourceRevision: context?.sourceRevision ?? null, coverage: context?.coverage ?? null, limited, ...(terminalStatus ? { status: terminalStatus } : {}), ...(navigation ? { navigation } : {}) });
  } catch (error) {
    const stale = error instanceof Error && ["ScopeChanged", "StaleContext"].includes(error.message);
    const partial = publishedClinical > 0;
    emit({ type: "error", code: signal.aborted ? "cancelled" : stale ? "stale" : "unavailable",
      message: stale ? copy.stale : partial ? copy.partialInterrupted : plan.intent === "receipts" ? copy.receiptsUnavailable : copy.unavailable, ...(partial ? { partial: true } : {}) });
  }
}

