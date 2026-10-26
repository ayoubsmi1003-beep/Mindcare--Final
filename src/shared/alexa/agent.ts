import { z } from "zod";
import { noteQuerySchema } from "./note-query";
import type { AlexaSource, AlexaProposal, AlexaNavigation } from "./turn";

/** Current native Alexa qualification language, independent of names in source records. */
export const ALEXA_AGENT_LANGUAGE = "fr" as const;
/** Default rounds for actions/dependencies; independent reads share these unchanged call/time caps. */
export const ALEXA_NATIVE_BUDGET = { rounds:3, calls:6, parallel:2, inferenceMs:120000, marginMs:20000 } as const;
export const ALEXA_NATIVE_DEADLINE_MS = (1+ALEXA_NATIVE_BUDGET.rounds)*ALEXA_NATIVE_BUDGET.inferenceMs+ALEXA_NATIVE_BUDGET.marginMs;

export const applicationQuerySchema=z.object({view:z.literal('reception'),day:z.iso.date(),queue:z.enum(['all','waiting','requests','payments'])}).strict();
export const timelineQuerySchema=z.object({patientId:z.uuid(),count:z.number().int().min(1).max(20)}).strict();
export const timelineCursorSchema=z.object({beforeAt:z.iso.datetime({offset:true}),beforeId:z.uuid()}).strict();

export const conditionSchema = z.object({
  field: z.enum(["phone", "identity_card", "birth_date", "sex", "age", "completed_consultations", "outstanding_balance", "no_completed_days", "no_completed_months", "administrative_incomplete"]),
  op: z.enum(["missing", "present", "eq", "gte", "gt", "lt", "lte"]), value: z.union([z.number().int().min(0).max(1000000), z.boolean(), z.enum(['M','F']), z.null()]),
}).strict().superRefine((c, ctx) => {
  const valid = ["phone", "identity_card", "birth_date", "sex"].includes(c.field) ? ((c.op === "missing" || c.op === "present") && c.value === null) || (c.field==='sex'&&c.op==='eq'&&(c.value==='M'||c.value==='F'))
    : c.field === "administrative_incomplete" ? c.op === "eq" && c.value === true
    : ["no_completed_days", "no_completed_months"].includes(c.field) ? c.op === "eq" && typeof c.value === "number" && c.value > 0 && c.value <= (c.field === "no_completed_days" ? 3650 : 120)
    : typeof c.value === "number" && ["gte", "gt", "lt", "lte", "eq"].includes(c.op) && (c.field !== "age" || c.value <= 120);
  if (!valid) ctx.addIssue({ code: "custom", message: "UnsupportedCondition" });
});
export type SupportedCondition = z.infer<typeof conditionSchema>;
export const conditionKey = (c: SupportedCondition): string => `${c.field}:${c.op}:${JSON.stringify(c.value)}`;
export const queryPeriodSchema=z.object({from:z.iso.datetime({offset:true}),to:z.iso.datetime({offset:true})}).strict().refine(p=>Date.parse(p.from)<Date.parse(p.to),'InvalidPeriod');
export const consultationPeriodSchema=queryPeriodSchema.safeExtend({axis:z.enum(['started_at','ended_at'])});
export const constraintLedgerSchema=z.array(z.object({key:z.string().max(500),kind:z.enum(['filter','period','population','output','unsupported']),span:z.string().min(1).max(500),supported:z.boolean()}).strict()).max(32);
export const partSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/), goal: z.string().trim().min(1).max(300),
  population:z.enum(["active","archived","all"]).optional(),literalQuery:z.string().min(1).max(160).optional(),
  tools:z.array(z.enum(["query_patients","get_patient_context","query_consultations","query_agenda","query_documents","query_finance","search_knowledge","answer_general","query_app","prepare_action","navigate","ask_doctor"])).max(3).optional(),
  unsupportedConditions:z.array(z.string().min(1).max(200)).max(5).optional(),
  constraintLedger:constraintLedgerSchema.optional(),
  conditions: z.array(conditionSchema).max(12), dependsOn: z.array(z.string().max(32)).max(8) }).strict();
export type PartStatus = "pending" | "answered" | "proposed" | "needs_input" | "unsupported" | "failed" | "budget_limited" | "cancelled";
export type RequestPart = z.infer<typeof partSchema> & { status: PartStatus; resultRefs: string[]; reason?: string };
export function validateLedger(raw: unknown): RequestPart[] {
  const parts = z.array(partSchema).min(1).max(12).parse(raw), seen = new Set<string>();
  for (const p of parts) { if (seen.has(p.id) || p.dependsOn.some(id => !seen.has(id))) throw new Error("InvalidLedger"); seen.add(p.id); }
  return parts.map(p => ({ ...p, status: "pending", resultRefs: [] }));
}
const domainNames=["query_patients","get_patient_context","query_consultations","query_agenda","query_documents","query_finance","search_knowledge","answer_general","query_app","prepare_action","navigate","ask_doctor"] as const;
/** Compact native metadata is expanded to the same strictly typed ledger before any dispatch. */
export const compactDeclarationSchema=z.object({parts:z.array(z.object({id:z.string().max(32),goal:z.string().min(1).max(300),tool:z.enum([...domainNames,"none"]),unsupportedConditions:z.array(z.string().min(1).max(200)).max(5).optional(),population:z.enum(["active","archived","all"]).optional(),literalQuery:z.string().min(1).max(160).optional(),conditions:z.array(z.string().max(200)).max(12),dependsOn:z.array(z.string().max(32)).max(8)}).strict()).min(1).max(12)}).strict();
export function parseDeclaration(raw:unknown):RequestPart[]{
 const compact=compactDeclarationSchema.safeParse(raw);
 if(!compact.success)return validateLedger(agentSchemas.declare_request.parse(raw).parts);
 // Model labels are references inside metadata, never business IDs or dispatch authority.
 const aliases=new Map<string,string>(),reserved=new Set(compact.data.parts.filter(p=>/^[a-zA-Z0-9_-]{1,32}$/.test(p.id)).map(p=>p.id));
 for(const [index,p]of compact.data.parts.entries()){
  if(aliases.has(p.id))throw new Error("InvalidLedger");
  let id=p.id;if(!/^[a-zA-Z0-9_-]{1,32}$/.test(id)){let next=index+1;do{id="p"+next++;}while(reserved.has(id));reserved.add(id);}aliases.set(p.id,id);
 }
 return validateLedger(compact.data.parts.map(p=>{
  const conditions:SupportedCondition[]=[],unsupported:string[]=[...(p.unsupportedConditions??[])];
  for(const text of p.conditions){const match=/^([a-z_]+):(missing|present|eq|gte|gt|lt|lte)(?::(\d+|true|M|F))?$/.exec(text);
   let structured:unknown;try{if(text.startsWith("{"))structured=JSON.parse(text);}catch{/* A malformed condition stays unresolved. */}
   const c=structured?conditionSchema.safeParse(structured):match?conditionSchema.safeParse({field:match[1],op:match[2],value:['missing','present'].includes(match[2]!)?null:match[3]==="true"?true:['M','F'].includes(match[3]??'')?match[3]:match[3]===undefined?undefined:Number(match[3])}):null;
   if(c?.success)conditions.push(c.data);else unsupported.push(text);
  }
  return {id:aliases.get(p.id)!,goal:p.goal,tools:p.tool==="none"?[]:[p.tool],conditions,dependsOn:p.dependsOn.map(id=>aliases.get(id)??id),...(p.population?{population:p.population}:{}),...(p.literalQuery?{literalQuery:p.literalQuery}:{}),...(unsupported.length?{unsupportedConditions:unsupported}:{})};
 }));
}
const partIds = z.array(z.string().max(32)).min(1).max(12);
const patient = { patientId: z.uuid().optional(), patientName: z.string().trim().min(2).max(160).optional() };
const period = { period: z.string().trim().min(1).max(80).optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() };
export const metricSchema = z.enum(["active", "missing_identity_card", "missing_phone", "children", "unknown_age", "not_seen_6m", "never_seen"]);
export const patientMetricConditions:Record<z.infer<typeof metricSchema>,SupportedCondition[]>={active:[],missing_identity_card:[{field:"identity_card",op:"missing",value:null}],missing_phone:[{field:"phone",op:"missing",value:null}],children:[{field:"age",op:"lt",value:18}],unknown_age:[{field:"birth_date",op:"missing",value:null}],not_seen_6m:[{field:"no_completed_months",op:"eq",value:6}],never_seen:[{field:"completed_consultations",op:"eq",value:0}]};
/** A short continuation resumes an already authorized query; it cannot introduce a new filter. */
export function patientListContinuation(text:string):boolean{return /^(?:lesquels|lesquelles|et lesquels|la suite|suite|suivant|continue|affiche[- ]les|montre[- ]les|liste[- ]les|من هم|من هن|أي مرضى|اي مرضى|أرني القائمة|ارني القائمة|القائمة|تابع)[?!.؟\s]*$/iu.test(text.trim());}
export const queryPatientsSchema = z.object({ partIds, mode: z.enum(["count", "list", "metrics", "review"]), query: z.string().trim().max(160).optional(),
  population: z.enum(["active", "archived", "all"]).optional(), filters: z.array(conditionSchema).max(12).optional(), metrics: z.array(metricSchema).min(1).max(7).optional(),
  filterGroups:z.array(z.array(conditionSchema).min(1).max(12)).min(1).max(4).refine(groups=>groups.flat().length<=12,'TooManyConditions').optional(),
  consultationPeriod:consultationPeriodSchema.optional(),createdPeriod:queryPeriodSchema.optional(),
  patientIds: z.array(z.uuid()).max(100).optional(), sort: z.enum(["name", "outstanding_desc"]).optional(),
  reusePrevious:z.boolean().optional(),limit: z.number().int().min(1).max(20).optional(), offset: z.number().int().min(0).max(10000).optional(), revision: z.string().max(64).optional(),
}).strict().refine(v => v.mode !== "metrics" || !!v.metrics?.length, "MetricsRequired")
 .refine(v=>v.mode==="metrics"||v.metrics===undefined,"MetricsOnlyForMetricsMode")
 .refine(v=>!v.filterGroups||v.filters===undefined,'OnePredicateRepresentation')
 .refine(v=>v.mode!=='metrics'||[v.filterGroups,v.consultationPeriod,v.createdPeriod].every(x=>x===undefined),'MetricsCannotIgnoreQueryConstraints')
 .refine(v=>!v.consultationPeriod||(v.filters??v.filterGroups?.flat()??[]).some(c=>c.field==='completed_consultations'),'ConsultationPeriodRequiresCount');
export const cabinetFinanceModes = ["overview","charges","composition","evolution","calendar","attention"] as const;
const actionSlots:Readonly<Record<string,readonly string[]>>={
 create_appointment:['startsAt','durationMinutes'],reschedule_appointment:['appointmentId','startsAt','durationMinutes'],
 cancel_appointment:['appointmentId','reason'],mark_patient_arrived:['appointmentId'],
 set_consultation_price:['consultationId','amountDzd'],record_payment_collected:['consultationId','paymentId'],close_consultation:['consultationId'],
 create_editable_document_draft:['documentType','variables'],print_issued_document:['documentType'],
 update_treatment:['treatmentName','changes'],stop_treatment:['treatmentName','stopReason','notes'],
 update_editable_document_draft:['draftId','documentType','variables'],
 send_internal_message:['body'],
};
export const actionArgumentKeys=(action:string):readonly string[]=>['partIds','action','patientId','patientName',...(actionSlots[action]??[])];
export const agentSchemas = {
  declare_request: z.object({ parts: z.array(partSchema).min(1).max(12) }).strict(),
  query_patients: queryPatientsSchema,
  get_patient_context: z.object({ partIds, ...patient,
    diagnosisState:z.enum(['all','active','resolved']).optional(),diagnosisRole:z.enum(['all','primary','secondary']).optional(),treatmentState:z.enum(['all','active','paused','stopped']).optional(),
    beforeAt:z.iso.datetime({offset:true}).optional(),beforeId:z.uuid().optional(),count: z.number().int().min(1).max(20).optional(), section: z.enum(["summary", "history", "treatments", "profile", "diagnoses", "scales", "current", "notes", "timeline"]).describe("profile : téléphone, coordonnées, identité et administratif ; summary : résumé clinique ; diagnoses : diagnostics ; scales : échelles ; treatments : traitements ; history : consultations passées ; current : séance en cours ; notes : texte intégral des notes par pages.").optional(), ...noteQuerySchema.shape }).strict().refine(v=>v.section==='diagnoses'||[v.diagnosisState,v.diagnosisRole].every(x=>x===undefined),'DiagnosisFiltersRequireDiagnosesSection').refine(v=>v.section==='treatments'||v.treatmentState===undefined,'TreatmentFilterRequiresTreatmentsSection').refine(v=>v.section!=="notes"||v.count===undefined,"NoteCountNotSupported").refine(v=>v.reusePrevious!==true||[v.consultationId,v.area,v.query,v.from,v.to,v.status,v.offset,v.textOffset,v.maxCharacters,v.revision].every(x=>x===undefined),"ContinuationUsesSavedNoteQuery").refine(v => !!v.from === !!v.to && (!v.from || Date.parse(v.from) < Date.parse(v.to!)), "InvalidPeriod").refine(v => v.section === "notes" || [v.consultationId,v.area,v.query,v.status,v.offset,v.textOffset,v.maxCharacters,v.revision].every(x => x === undefined), "NoteArgumentsRequireNotesSection").refine(v=>v.section==='notes'||v.section==='summary'||[v.from,v.to].every(x=>x===undefined),'PeriodRequiresSummaryOrNotesSection'),
  query_consultations: z.object({ partIds, ...patient, ...period, dateAxis:z.enum(['started_at','ended_at']).optional(), consultationId:z.uuid().optional(),view:z.enum(["details","analysis"]).optional(),textOffset:z.number().int().min(0).max(1000000).optional(),revision:z.string().regex(/^[a-f0-9]{64}$/).optional(),reusePrevious:z.boolean().optional(),status: z.enum(["all", "open", "closed", "unsigned"]).optional(), mode: z.enum(["count", "list", "group"]).optional(), offset: z.number().int().min(0).max(10000).optional() }).strict().refine(v=>!v.view||!!v.consultationId||v.reusePrevious===true,"ConsultationReferenceRequired").refine(v=>!v.consultationId||!!v.view,"ConsultationViewRequired").refine(v=>!v.view||[v.period,v.from,v.to,v.status,v.mode,v.offset].every(x=>x===undefined),"DetailCannotIgnoreFilters").refine(v=>v.view==="analysis"||[v.textOffset,v.revision,v.reusePrevious].every(x=>x===undefined),"AnalysisCursorOnly"),
  query_app: z.object({partIds,...patient,motif:z.enum(["rappel_rendez_vous","document_pret"]).optional(),view:z.enum(["cabinet","practitioner","notifications","system","message_draft","reception","medication_catalog"]),query:z.string().trim().min(2).max(160).optional(),day:z.iso.date().optional(),queue:z.enum(['all','waiting','requests','payments']).optional(),reusePrevious:z.boolean().optional(),offset:z.number().int().min(0).max(10000).optional(),revision:z.string().regex(/^[a-f0-9]{32}$/).optional()}).strict()
   .refine(v=>['notifications','reception'].includes(v.view)||[v.offset,v.revision].every(x=>x===undefined),'ViewCursorOnly')
   .refine(v=>v.view==='medication_catalog'?!!v.query:v.query===undefined,'CatalogueQueryOnly')
   .refine(v=>v.view==='reception'||[v.day,v.queue].every(x=>x===undefined),'ReceptionArgumentsOnly').refine(v=>v.view==='reception'||v.reusePrevious===undefined,'ReceptionContinuationOnly').refine(v=>!v.reusePrevious||[v.day,v.queue,v.offset,v.revision].every(x=>x===undefined),'SavedReceptionCursorOnly')
   .refine(v=>v.view==='message_draft'?!!v.motif:[v.motif,v.patientId,v.patientName].every(x=>x===undefined),'MessageDraftScopeOnly'),
  query_agenda: z.object({ partIds, appointmentId:z.uuid().optional(), ...patient, ...period, statuses: z.array(z.enum(["requested", "confirmed", "arrived", "in_session", "completed", "no_show", "cancelled"])).min(1).max(7).optional(), offset:z.number().int().min(0).max(10000).optional(), limit:z.number().int().min(1).max(20).optional() }).strict().refine(v=>!v.appointmentId||[v.from,v.to,v.period,v.statuses,v.offset,v.limit].every(x=>x===undefined),"DetailCannotIgnoreFilters"),
  query_documents: z.object({ partIds, ...patient, ...period, documentId: z.uuid().optional(), draftId: z.uuid().optional(),
    kind: z.enum(["bonne_sante_mentale", "suivi_medical", "certificat_medical", "justification", "ordonnance"]).optional(), status: z.enum(["issued", "voided", "draft"]).optional(), query: z.string().max(160).optional(), offset: z.number().int().min(0).max(10000).optional(), textOffset:z.number().int().min(0).max(1000000).optional(),revision:z.string().regex(/^[a-f0-9]{64}$/).optional(),reusePrevious:z.boolean().optional() }).strict()
    .refine(v=>!(v.documentId&&v.draftId),'OneDocumentReference')
    .refine(v=>!(v.documentId||v.draftId)||!v.offset,'DetailCannotIgnoreOffset')
    .refine(v=>(!!v.documentId||!!v.draftId)||[v.textOffset,v.revision].every(x=>x===undefined),'DocumentReferenceRequired')
    .refine(v=>!v.textOffset||!!v.revision,'DocumentRevisionRequired')
    .refine(v=>!v.reusePrevious||[v.patientId,v.patientName,v.documentId,v.draftId,v.period,v.from,v.to,v.kind,v.status,v.query,v.offset,v.textOffset,v.revision].every(x=>x===undefined),'ContinuationUsesSavedQuery'),
  query_finance: z.object({ partIds, ...patient, ...period, state: z.enum(["all", "pending", "collected"]).describe("Filtre des lignes de paiement seulement ; omettre pour overview et les autres vues du cabinet.").optional(), consultationStatus:z.enum(["closed"]).optional(), mode: z.enum([...cabinetFinanceModes, "list", "totals", "group"]).describe("overview : chiffre d’affaires, recettes encaissées et bilan du cabinet sur la période ; charges/composition/evolution/calendar/attention : panneaux financiers ; list/totals/group : lignes de paiement selon leur date et état, pas le chiffre d’affaires du cabinet."), reusePrevious:z.boolean().optional(), revision:z.string().regex(/^[a-f0-9]{64}$/).optional(), offset: z.number().int().min(0).max(10000).optional() }).strict().refine(v=>!!v.from===!!v.to&&(!v.from||Date.parse(v.from)<Date.parse(v.to!)),"InvalidPeriod").refine(v=>!v.consultationStatus||(v.mode==='totals'&&v.state==='all'),"UnpricedConsultationFilterRequiresAllTotals").refine(v=>!cabinetFinanceModes.some(mode=>mode===v.mode)||[v.patientId,v.patientName,v.state].every(x=>x===undefined),"CabinetOverviewCannotIgnorePatientOrState").refine(v=>!["composition","evolution","attention","overview"].includes(v.mode??"")||!v.offset,"ViewCannotIgnoreOffset").refine(v=>v.mode==="calendar"||[v.reusePrevious,v.revision].every(x=>x===undefined),"CalendarCursorOnly").refine(v=>!v.reusePrevious||[v.period,v.from,v.to,v.offset,v.revision].every(x=>x===undefined),"ContinuationUsesSavedQuery"),
  answer_general: z.object({partIds,question:z.string().trim().min(2).max(1000)}).strict(),
  search_knowledge: z.object({ partIds, query: z.string().trim().min(2).max(500) }).strict(),
  prepare_action: z.object({ partIds, ...patient, action: z.enum(["create_appointment", "reschedule_appointment", "cancel_appointment", "mark_patient_arrived", "set_consultation_price", "record_payment_collected", "close_consultation", "create_editable_document_draft", "print_issued_document", "update_treatment", "stop_treatment", "update_editable_document_draft", "send_internal_message"]),
    appointmentId: z.uuid().optional(), consultationId: z.uuid().optional(), paymentId: z.uuid().optional(),
    startsAt: z.iso.datetime({ offset: true }).optional(), durationMinutes: z.number().int().min(5).max(240).optional(), amountDzd: z.number().int().min(0).max(1000000).optional(),
    reason: z.string().trim().min(3).max(300).optional(), documentType: z.enum(["bonne_sante_mentale", "suivi_medical", "certificat_medical", "justification", "ordonnance"]).optional(), variables: z.record(z.string().max(80), z.string().max(300)).optional(),
    treatmentName:z.string().trim().min(2).max(160).optional(),
    changes:z.object({dose:z.string().trim().min(1).max(300).optional(),doseUnit:z.string().trim().min(1).max(80).optional(),frequency:z.string().trim().min(1).max(300).optional(),timing:z.array(z.string().trim().min(1).max(80)).max(8).optional(),instructions:z.string().trim().min(1).max(1000).optional(),startDate:z.iso.date().optional(),endDate:z.iso.date().nullable().optional()}).strict().optional(),
    draftId:z.uuid().optional(),
    stopReason:z.enum(["inefficacite","effets_indesirables","amelioration","decision_clinique","autre"]).optional(),
    notes:z.string().trim().min(3).max(300).optional(),
    body: z.string().trim().min(3).max(1000).optional(),
  }).strict().refine(v=>Object.keys(v).every(k=>actionArgumentKeys(v.action).includes(k)),'UnexpectedActionArguments')
    .refine(v=>v.action!=='update_treatment'||!!v.treatmentName&&!!v.changes&&Object.keys(v.changes).length>0,'TreatmentChangeRequired')
    .refine(v=>v.action!=='stop_treatment'||!!v.treatmentName,'TreatmentNameRequired')
    .refine(v=>v.action!=='print_issued_document'||!!v.documentType,'PrintDocumentKindRequired')
    .refine(v=>v.action!=='update_editable_document_draft'||!!v.variables&&Object.keys(v.variables).length>0,'DraftFieldsRequired'),
  navigate: z.object({ partIds, target: z.enum(["patients", "agenda", "dashboard", "patient", "documents", "finances", "parametres", "jarvis"]), ...patient }).strict(),
  ask_doctor: z.object({ partIds, question: z.string().trim().min(1).max(500) }).strict(),
} as const;
export type AgentToolName = keyof typeof agentSchemas;
export interface AgentCall { id: string; name: string; args: Record<string, unknown> }
export interface AgentResult { callId: string; status: "ok" | "empty" | "partial" | "needs_input" | "error" | "unsupported"; complete: boolean;
  presentation?: "inference"; data?: unknown; evidence: AlexaSource[]; text: string; conditionKeys: string[]; proposal?: AlexaProposal; patientId?: string;
  links?: import('./answer-links').AlexaAnswerLink[]; navigation?: AlexaNavigation; error?: { code: string; retryable: boolean }; }
export type AgentTerminal = "completed" | "partial" | "needs_input" | "needs_confirmation" | "failed" | "cancelled";
export class AgentReadError extends Error {
 constructor(readonly code:"permission"|"timeout"|"changed"|"database"|"malformed",readonly retryable=false){super(code);this.name="AgentReadError";}
}
