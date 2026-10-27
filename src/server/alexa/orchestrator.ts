import { runAgentLoop, type AgentLoopDependencies } from "./agent-loop";
import { agentExecutor } from "./agent-tools";
import type { DbPort } from "@/services/db/port";
import type { AlexaEvent, AlexaNavigation, TurnInput } from "@/shared/alexa/turn";
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
import { planRequest, requestsPatientScope } from "./request-plan";
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

export interface OrchestratorDependencies {
  db: Pick<DbPort, "rpc">;
  knowledge: ClientSql;
  actor: string;
  native?: boolean;
  agentInfer?: AgentLoopDependencies["infer"];
  agentObserve?: AgentLoopDependencies["observeCall"];
  agentObserveResult?: AgentLoopDependencies["observeResult"];
  agentAsOf?:string;
  build?: typeof buildClinicalContext;
  infer?: typeof inferAlexa;
  general?: typeof inferGeneralAlexa;
}

/** Native tool selection remains subject to server validation, identity and scope gates. */
export async function runAlexa(input: TurnInput, dependencies: OrchestratorDependencies, emit: (event: AlexaEvent) => void, signal: AbortSignal): Promise<void> {
  if (dependencies.native) {
    // Courtesies use the same closed dialogue grammar as the established UI.
    // A greeting never needs patient lookup or a model inference slot.
    if (planRequest(input.text, null).intent === 'dialogue') return runAlexaSingle(input, dependencies, emit, signal);
    // Explicit document and internal-message requests remain reachable without
    // the local model. The model path still handles paraphrases and compounds.
    if (deterministicActionRequest(input.text)) return runAlexaSingle(input, dependencies, emit, signal, undefined, { plan: { intent: "proposal", count: 1, language: "fr" } });
    const lease=conversationState.begin(dependencies.actor,input.conversationId,input.appContext.patientId,input.appContext.page);
    const result=await runAgentLoop(input,{actor:dependencies.actor,...(dependencies.agentAsOf?{asOf:dependencies.agentAsOf}:{}),...(dependencies.agentInfer?{infer:dependencies.agentInfer}:{}),...(dependencies.agentObserve?{observeCall:dependencies.agentObserve}:{}),...(dependencies.agentObserveResult?{observeResult:dependencies.agentObserveResult}:{}),execute:agentExecutor(input,dependencies.db,dependencies.knowledge),onStage:()=>emit({type:"stage",stage:"analysis"})},signal);
    if(!conversationState.isCurrent(lease)) {emit({type:"error",code:"stale",message:dialogue("fr").stale});return;}
    const responses=result.results.filter(r=>r.text);
    if(!validAlexaSources(result.sources)||result.results.some(r=>!validAlexaSources(r.evidence)||r.links!==undefined&&!validAnswerLinks(r.text,r.links)))throw new Error('AlexaSourceEvidenceInvalid');
    const unresolved=new Set(result.parts.filter(p=>!p.resultRefs.length&&p.reason).map(p=>`${p.goal} — ${p.reason}`));
    for(const [index,text] of result.sentences.entries()){
      const response=responses[index]?.text===text?responses[index]:undefined;
      const synthesis=!response&&text.startsWith(agentCopy.fr.synthesis+"\n");
      emit({type:"sentence",text,kind:response?.presentation==="inference"||synthesis||(!response&&!unresolved.has(text)&&result.results.some(r=>r.presentation==="inference"))?"inference":"fact",sources:response?response.evidence:!unresolved.has(text)?result.sources:[],...(response?.links?.length?{links:response.links}:{})});
    }
    if(result.proposal)emit({type:"proposal",...result.proposal});
    emit({type:"done",patientId:result.patientId,patientScope:result.patientId?"replace":"preserve",sourceRevision:null,coverage:null,limited:result.status!=="completed",status:result.status,parts:result.parts,tokensIn:result.tokensIn,tokensOut:result.tokensOut,speechAllowed: result.status === "completed",...(result.navigation?{navigation:result.navigation}:{})});
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
  const wholePlan = planRequest(input.text, previous);
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
    && questions?.some(text => planRequest(text, null).intent === "clarify" && agendaSelection(text) === null)
    && questions?.some(text => planRequest(text, null).intent === "agenda");
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
    const plan = planRequest(text, conversationState.read(dependencies.actor, input.conversationId, selected, input.appContext.page));
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
  const plan = semantic?.plan ?? planRequest(input.text, previous);
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
      sentence(new Intl.DateTimeFormat(plan.language==="fr"?"fr-DZ":"ar-DZ",{timeZone:"Africa/Algiers",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date())); limited=false;
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
      const result = await readKnowledge(dependencies.knowledge, plan.knowledgeQuery??input.text, signal);
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
        const knowledge = await readKnowledge(dependencies.knowledge, input.text, signal);
        active();
        output.push(...knowledgeResponseEvents(knowledge, plan.language, true, resolution.identityTokens));
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
