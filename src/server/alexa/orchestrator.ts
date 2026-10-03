import type { DbPort } from "@/services/db/port";
import type { AlexaEvent, AlexaNavigation, TurnInput } from "@/shared/alexa/turn";
import type { ClinicalContext } from "@/shared/alexa/clinical";
import { dialogue } from "@/i18n/alexa-dialogue";
import { ALEXA_GENERAL_SOURCE } from "@/i18n/alexa-general";
import { resolvePatient } from "./patient-resolver";
import { buildClinicalContext } from "./clinical-context";
import { conversationState, type TurnLease } from "./conversation-state";
import { splitAlexaQuestions } from "@/shared/alexa/questions";
import { questionCopy } from "@/i18n/alexa-questions";
import { planRequest, requestsPatientScope } from "./request-plan";
import { parsePatientMention } from "./patient-mention";
import { executeRead } from "./tool-executor";
import { contextSources, localDisplay, localResponse } from "./local-response";
import { createSafeClinicalPayload } from "./privacy-boundary";
import { inferAlexa, inferGeneralAlexa } from "./model-gateway";
import { readKnowledge } from "./knowledge-adapter";
import type { ClientSql } from "@/server/jarvis/client-sql";
import { readAgenda, requestsNextPatient } from "./agenda-adapter";
import { readDailyReceipts } from "./receipts-adapter";
import { buildConsultationNoteDetails, buildStructuredSummaryNarrative } from "./case-summary";
import { validateAlexaResponse } from "./response-validator";
import { knowledgeResponseEvents } from "./knowledge-response";

export interface OrchestratorDependencies {
  db: Pick<DbPort, "rpc">;
  knowledge: ClientSql;
  actor: string;
  build?: typeof buildClinicalContext;
  infer?: typeof inferAlexa;
  general?: typeof inferGeneralAlexa;
}

/** A field read is local; interpretation words retain the existing limited analysis path. */
function isClearRecordRead(text: string, intent: string): boolean {
  if ((intent !== "history" && intent !== "treatments") || text.length > 2000) return false;
  const normalized = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return !/compar|resum|summar|synth|analy[sz]|interpret|expliqu|conclu|evolu|chang|amelior|aggrav|hypothes|risqu|differ|similair|pourquoi|comment|contenu|symptom|humeur|diagnost|compatib|interact|efficac|recommand|appropri|safe|secur|قارن|مقارن|لخص|ملخص|تلخيص|حلل|تحليل|تفسير|فسر|تطور|تحسن|تدهور|فرض|استنت|تغير|تبدل|تبديل|فرق|محتوى|ملاحظ|اعراض|مزاج|تشخيص|تفاعل|تداخل|فعال|مناسب|mo9aran|ta7lil|lakh[aei]|fass[ae]r|tatawor|t[ab]?bed[ae]l|\b(?:why|how|plus|moins|mieux|pire|stable)\b/u.test(normalized);
}

/** Server owns identity, read plans and scope. Model output cannot select or execute tools. */
/** One lease and one final completion cover up to three independent read questions. */
export async function runAlexa(input: TurnInput, dependencies: OrchestratorDependencies, emit: (event: AlexaEvent) => void, signal: AbortSignal): Promise<void> {
  const questions = splitAlexaQuestions(input.text);
  const wholePlan = planRequest(input.text, null);
  const mention = parsePatientMention(input.text);
  if (questions?.length === 1 || wholePlan.intent === "proposal" || wholePlan.intent === "navigation" || mention.status === "ambiguous") {
    return runAlexaSingle(input, dependencies, emit, signal);
  }
  const lease = conversationState.begin(dependencies.actor, input.conversationId, input.appContext.patientId, input.appContext.page);
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
    const localScope = !["dialogue", "general", "knowledge", "agenda", "receipts", "clarify"].includes(plan.intent);
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

async function runAlexaSingle(input: TurnInput, dependencies: OrchestratorDependencies, emit: (event: AlexaEvent) => void, signal: AbortSignal, sharedLease?: TurnLease): Promise<void> {
  const { actor, db } = dependencies;
  const previous = conversationState.read(actor, input.conversationId, input.appContext.patientId, input.appContext.page);
  const plan = planRequest(input.text, previous);
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
  let publishedClinical = 0;
  let navigation: AlexaNavigation | undefined;
  const rejectPatientSelection = (text: string) => {
    active();
    conversationState.clear(actor, input.conversationId);
    emit({ type: "sentence", text, kind: "fact", sources: [] });
    emit({ type: "done", patientId: null, patientScope: "replace", sourceRevision: null, coverage: null, limited: true });
  };
  try {
    active();
    if (plan.intent === "dialogue") { sentence(copy[plan.dialogueAct ?? "help"]); limited = false; }
    else if (plan.intent === "general") {
      if (input.patientName || mention.status !== "none" || requestsPatientScope(input.text)) { rejectPatientSelection(copy.clarify); return; }
      emit({ type: "stage", stage: "analysis" });
      const answer = await (dependencies.general ?? inferGeneralAlexa)(input.text, { signal, caller: actor });
      active();
      if (answer.ok) {
        sentence(ALEXA_GENERAL_SOURCE[plan.language === "fr" ? "fr" : "ar"]);
        emit({ type: "sentence", text: answer.text, kind: "inference", sources: [] });
        limited = false;
      } else sentence(answer.code === "privacy" ? questionCopy(plan.language).generalRestricted : questionCopy(plan.language).generalUnavailable);
    }
    else if (plan.intent === "clarify") sentence(copy.clarify);
    else if (plan.intent === "proposal") sentence(copy.proposal);
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
      const agenda = await readAgenda(dependencies.knowledge, signal);
      active();
      const appointments = next ? (agenda.suivant ? [agenda.suivant] : []) : patientId ? agenda.journee.filter(appointment => appointment.patient_id === patientId) : agenda.journee;
      if (next && agenda.suivant?.patient_id) {
        const resolution = await resolvePatient(db, { patientId: agenda.suivant.patient_id }, signal);
        active();
        if (resolution.status === "resolved") { patientId = resolution.patientId; navigation = { target: "patient", patientId }; }
        else { sentence(copy.patient); emit({ type: "done", patientId: null, patientScope: "replace", sourceRevision: null, coverage: null, limited: true }); return; }
      }
      if (!appointments.length) sentence(copy.emptyAgenda);
      for (const appointment of appointments) {
        active();
        const time = new Intl.DateTimeFormat(plan.language === "fr" ? "fr-DZ" : "ar-DZ", { timeZone: "Africa/Algiers", hour: "2-digit", minute: "2-digit" }).format(new Date(appointment.starts_at));
        emit({ type: "sentence", text: copy.appointment(time, appointment.status), kind: "fact", sources: [{ id: appointment.id, type: "appointment", label: time }] });
      }
      limited = false;
    }
    else if (plan.intent === "knowledge") {
      emit({ type: "stage", stage: "knowledge" });
      const result = await readKnowledge(dependencies.knowledge, input.text, signal);
      active();
      for (const event of knowledgeResponseEvents(result, plan.language)) { active(); emit(event); }
    } else {
      emit({ type: "stage", stage: "identity" });
      if (mention.status === "ambiguous") {
        rejectPatientSelection(copy.patient);
        return;
      }
      const name = input.patientName ?? (mention.status === "named" ? mention.name : undefined);
      const resolution = await resolvePatient(db, name ? { name } : input.appContext.patientId ? { patientId: input.appContext.patientId } : {}, signal);
      active();
      if (resolution.status !== "resolved") {
        rejectPatientSelection(copy.patient);
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
      if (patientId !== input.appContext.patientId) {
        const replacement = conversationState.begin(actor, input.conversationId, patientId, input.appContext.page);
        Object.assign(lease, replacement);
        delete plan.before;
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
      const publishedSources = new Set<string>();
      const safe = createSafeClinicalPayload(context, input.text, resolution.identityTokens);
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
      const localNarrative = ["notes", "current_consultation", "diagnoses", "scales", "longitudinal"].includes(plan.intent) || (plan.intent === "history" && (plan.operation !== undefined || plan.focus !== undefined));
      if (safe.ok && !localNarrative && plan.intent !== "treatment_changes" && !structuredSummary && !isClearRecordRead(input.text, plan.intent)) {
        emit({ type: "stage", stage: "analysis" });
        const sources = contextSources(context);
        const answer = await (dependencies.infer ?? inferAlexa)(safe.payload, { signal, caller: actor,
          identityTokens: resolution.identityTokens, onSentence: async item => {
            // Validate at the publication point as well as inside the provider adapter.
            const validated = validateAlexaResponse({ sentences: [item] }, safe.payload, resolution.identityTokens);
            if (!validated.ok) throw new Error("InvalidResponse");
            await fresh();
            for (const accepted of validated.answer.sentences) {
              const ids = accepted.evidence.map(ref => safe.evidenceMap[ref]!);
              if (ids.every(id => publishedSources.has(id))) continue;
              emit({ type: "sentence", text: localDisplay(accepted.text, resolution.identityTokens), kind: "fact",
                sources: ids.flatMap(id => sources.filter(source => source.id === id)) });
              ids.forEach(id => publishedSources.add(id));
              publishedClinical++;
            }
          } });
        active();
        if (!answer.ok && (answer.partial || publishedClinical > 0)) throw new Error("PartialStream");
        const required = safe.payload.facts.filter(fact => plan.intent === "history" ? fact.kind === "consultation" : plan.intent === "treatments" ? fact.kind === "medication" : true);
        const cited = answer.ok ? new Set(answer.data.sentences.flatMap(sentence => sentence.evidence)) : new Set<string>();
        if (answer.ok && required.every(fact => cited.has(fact.evidence))) {
          output = answer.data.sentences.map(s => ({ type: "sentence" as const, text: localDisplay(s.text, resolution.identityTokens), kind: s.kind,
            sources: s.evidence.flatMap(ref => sources.filter(source => source.id === safe.evidenceMap[ref])) }));
          limited = !safe.coverage.complete;
          if (limited) output.push({ type: "sentence", text: copy.partial, kind: "fact", sources: [] });
        } else if (answer.ok && publishedClinical > 0) {
          // Complete the requested fact coverage locally without repeating streamed facts.
          output = [{ type: "sentence", text: copy.partial, kind: "fact", sources: [] }];
          for (const fact of required.filter(fact => !publishedSources.has(safe.evidenceMap[fact.evidence]!))) {
            const accepted = validateAlexaResponse({ sentences: [{ text: "recorded fact", evidence: [fact.evidence], kind: "fact" }] }, safe.payload, resolution.identityTokens);
            if (!accepted.ok) throw new Error("InvalidResponse");
            for (const item of accepted.answer.sentences) output.push({ type: "sentence", text: item.text, kind: "fact",
              sources: item.evidence.flatMap(ref => sources.filter(source => source.id === safe.evidenceMap[ref])) });
          }
        } else output.unshift({ type: "sentence", text: copy.local, kind: "fact", sources: [] });
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
        if (event.sources.length && event.kind !== "knowledge" && event.sources.every(source => publishedSources.has(source.id))) continue;
        if (event.text) { emit(event); if (event.kind !== "knowledge" && event.sources.length) publishedClinical++; }
      }
      const last = context.consultations.at(-1);
      const cursor = context.coverage.next ?? (last ? { startedAt: last.startedAt, id: last.id } : plan.before);
      conversationState.finish(lease, { intent: plan.intent, count: plan.count, ...(cursor ? { cursor } : {}), ...(plan.before ? { selectionBefore: plan.before } : {}), ...(plan.operation ? { operation: plan.operation } : {}), ...(plan.focus ? { focus: plan.focus } : {}) });
    }
    active();
    if (context === null) conversationState.finish(lease, { intent: plan.intent, count: plan.count });
    // No patient used by a global answer does not mean the working dossier was
    // rejected. Explicit identity failures and next-patient reads replace scope.
    const patientScope = plan.intent === "dialogue" || (context === null && patientId === null && !input.patientName && !requestsNextPatient(input.text)) ? "preserve" : "replace";
    emit({ type: "done", patientId, patientScope, sourceRevision: context?.sourceRevision ?? null, coverage: context?.coverage ?? null, limited, ...(navigation ? { navigation } : {}) });
  } catch (error) {
    const stale = error instanceof Error && ["ScopeChanged", "StaleContext"].includes(error.message);
    const partial = publishedClinical > 0;
    emit({ type: "error", code: signal.aborted ? "cancelled" : stale ? "stale" : "unavailable",
      message: stale ? copy.stale : partial ? copy.partialInterrupted : plan.intent === "receipts" ? copy.receiptsUnavailable : copy.unavailable, ...(partial ? { partial: true } : {}) });
  }
}
