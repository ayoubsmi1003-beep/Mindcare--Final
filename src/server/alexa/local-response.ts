import type { ClinicalContext } from "@/shared/alexa/clinical";
import type { AlexaEvent, AlexaSource } from "@/shared/alexa/turn";
import { dialogue } from "@/i18n/alexa-dialogue";
import type { RequestPlan } from "./request-plan";
import { consultationExcerpts } from "./note-excerpts";
import {alexaRecordCopy} from "@/i18n/alexa-records";
import { summaryDialogue } from "@/i18n/alexa-summary";

const identifier = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b(?:\+?213|0)[567]\d{8}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu;
export function localDisplay(text: string, tokens: readonly string[]): string {
  let value = text.replace(identifier, "");
  for (const token of [...tokens].sort((a, b) => b.length - a.length)) {
    if (token.length > 1) value = value.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "giu"), "");
  }
  return value.trim();
}
export function contextSources(context: ClinicalContext): AlexaSource[] {
  return [
    ...context.consultations.map(c => ({ id: c.id, type: "consultation" as const, label: new Intl.DateTimeFormat("fr-DZ", { timeZone: "Africa/Algiers", dateStyle: "medium" }).format(new Date(c.startedAt)) })),
    ...context.treatments.current.map(t => ({ id: t.id, type: "treatment" as const, label: t.medication, version: String(t.version) })),
    ...context.diagnoses.map(d => ({ id: d.id, type: "diagnostic" as const, label: d.label })),
    ...context.scales.map(s => ({ id: s.id, type: "scale" as const, label: s.name })),
  ];
}

/** Locally sourced facts and verbatim note excerpts; no inferred clinical change. */
export function localResponse(context: ClinicalContext, plan: RequestPlan, tokens: readonly string[]): Extract<AlexaEvent, { type: "sentence" }>[] {
  const copy = dialogue(plan.language);
  if (plan.intent === "current_consultation") {
    if (!context.currentConsultation) return [{ type: "sentence", text: copy.emptyCurrent, kind: "fact", sources: [] }];
    const current = context.currentConsultation;
    const answer = localResponse({ ...context, consultations: [current], diagnoses: [], scales: [], treatments: { current: [], history: [], historyComplete: true }, coverage: { requested: 1, returned: 1, complete: true, hasMore: false } }, { ...plan, intent: "history" }, tokens);
    // An open consultation is never described as a completed historical visit.
    return [{ type: "sentence", text: copy.currentConsultation, kind: "fact", sources: [] }, ...answer.slice(1)];
  }
  const all = contextSources(context);
  const result: Extract<AlexaEvent, { type: "sentence" }>[] = [];
  const push = (text: string, sources: AlexaSource[] = []) => result.push({ type: "sentence", text: localDisplay(text, tokens), kind: "fact", sources });
  if (plan.intent === "diagnoses") {
    if (!context.diagnoses.length) push(copy.emptyDiagnoses);
    for (const diagnosis of context.diagnoses) push(copy.recordedDiagnosis(diagnosis.label, diagnosis.code, diagnosis.resolvedAt !== null), all.filter(source => source.id === diagnosis.id));
    return result;
  }
  if (plan.intent === "scales") {
    if (!context.scales.length) push(copy.emptyScales);
    const groups = new Map<string, { date: string; sortAt: string; linked: boolean; scales: typeof context.scales[number][] }>();
    const formatDate=(value:string)=>{
      const at=Date.parse(value);
      return Number.isFinite(at)?new Intl.DateTimeFormat(plan.language === "fr" ? "fr-DZ" : "ar-DZ", { timeZone: "Africa/Algiers", dateStyle: "medium" }).format(new Date(at)):copy.unspecified;
    };
    for (const scale of context.scales) {
      const visitAt=scale.consultationStartedAt??scale.administeredAt;
      const parsedAt = Date.parse(visitAt);
      const date = formatDate(visitAt);
      const localDay = Number.isFinite(parsedAt) ? new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(parsedAt)) : scale.id;
      const linked = !!scale.consultationId;
      const key = linked ? `consultation:${scale.consultationId}` : `date:${localDay}`;
      const group = groups.get(key) ?? { date, sortAt:visitAt, linked, scales: [] };
      group.scales.push(scale);
      if (visitAt > group.sortAt) { group.sortAt = visitAt; group.date = date; }
      groups.set(key, group);
    }
    const administrationsByScale=new Map<string,Map<string,typeof context.scales[number][]>>();
    for(const scale of context.scales){
      if(!scale.scaleId||!scale.consultationId)continue;
      const visits=administrationsByScale.get(scale.scaleId)??new Map<string,typeof context.scales[number][]>();
      const administrations=visits.get(scale.consultationId)??[];administrations.push(scale);visits.set(scale.consultationId,administrations);administrationsByScale.set(scale.scaleId,visits);
    }
    const trajectories=[...administrationsByScale.entries()].flatMap(([scaleId,visits])=>{
      if(visits.size<2||[...visits.values()].some(administrations=>administrations.length!==1))return [];
      const ordered=[...visits.values()].map(([administration])=>administration!).sort((a,b)=>(a.consultationStartedAt??a.administeredAt).localeCompare(b.consultationStartedAt??b.administeredAt));
      const name=ordered[0]!.name;
      return [{scaleId,text:copy.recordedScaleTrajectory(name,ordered.map(scale=>copy.recordedScalePoint(formatDate(scale.consultationStartedAt??scale.administeredAt),scale.score,scale.interpretation)))}];
    });
    const comparedAdministrations=new Set<string>();
    if(trajectories.length){
      const comparedScaleIds=new Set(trajectories.map(trajectory=>trajectory.scaleId));
      for(const scale of context.scales)if(scale.scaleId&&comparedScaleIds.has(scale.scaleId))comparedAdministrations.add(scale.id);
      push(copy.recordedScaleTrajectories(trajectories.map(trajectory=>trajectory.text)),all.filter(source=>source.type==="scale"&&comparedAdministrations.has(source.id)));
    }
    for (const group of [...groups.values()].sort((a, b) => b.sortAt.localeCompare(a.sortAt))) {
      const ordered = group.scales.filter(scale=>!comparedAdministrations.has(scale.id)).sort((a, b) => a.name.localeCompare(b.name, "fr") || a.administeredAt.localeCompare(b.administeredAt) || a.id.localeCompare(b.id));
      if(!ordered.length)continue;
      push(copy.recordedScaleGroup(group.date, ordered.map(scale => copy.recordedScaleEntry(scale.name, scale.score, scale.interpretation)), group.linked), all.filter(source => ordered.some(scale => scale.id === source.id)));
    }
    return result;
  }
  if (plan.intent === "treatment_changes") {
    const change = context.treatments.history[0];
    if (!change) push(copy.emptyChanges);
    else {
      const treatment = context.treatments.current.find(item => item.id === change.treatmentId);
      const snapshot = (value: typeof change.previous) => value ? [value.dose, value.doseUnit, value.frequency,
        value.status ? copy.states[value.status] : null].filter(Boolean).join(" · ") || copy.unspecified : copy.unspecified;
      const date = new Intl.DateTimeFormat(plan.language === "fr" ? "fr-DZ" : "ar-DZ", { timeZone: "Africa/Algiers", dateStyle: "medium" }).format(new Date(change.occurredAt));
      push(copy.lastChange(date, treatment?.medication ?? copy.unspecified, snapshot(change.previous), snapshot(change.next)), [{ id: change.id, type: "treatment", label: date, version: String(change.version) }]);
    }
    if (!context.treatments.historyComplete) push(copy.partial);
    return result;
  }
  if (plan.intent !== "treatments") {
    push(context.consultations.length ? copy.consultations(context.consultations.length, plan.count) : copy.empty, all.filter(s => s.type === "consultation"));
    // All requested consultations remain cited, including empty notes; never silently choose one.
    if (context.consultations.length) push(all.filter(s => s.type === "consultation").map(s => s.label).join(" · "), all.filter(s => s.type === "consultation"));
  }
  if (["history", "notes", "longitudinal"].includes(plan.intent)) {
    if (context.consultations.length) push(plan.operation === "compare" ? copy.comparison : copy.excerpts);
    let displayed = 0, characters = 0, omitted = false;
    for (const consultation of context.consultations) {
      const source = all.find(item => item.id === consultation.id)!;
      const selected = consultationExcerpts(consultation, plan.focus);
      omitted ||= selected.omitted;
      if (!selected.hasContent && !plan.focus) push(copy.noNotes(source.label), [source]);
      for (const excerpt of selected.excerpts) {
        if (characters + excerpt.text.length > 8000) { omitted = true; continue; }
        const date = excerpt.amendmentAt && Number.isFinite(Date.parse(excerpt.amendmentAt))
          ? new Intl.DateTimeFormat(plan.language === "fr" ? "fr-DZ" : "ar-DZ", { timeZone: "Africa/Algiers", dateStyle: "medium" }).format(new Date(excerpt.amendmentAt)) : source.label;
        const summary = summaryDialogue(plan.language);
        const quoted = excerpt.area && (excerpt.area === "working" || excerpt.unsigned)
          ? summary.noteDetail(date, summary.noteProvenance(summary.noteAreas[excerpt.area], excerpt.text, !!excerpt.unsigned), consultation.endedAt === null)
          : copy.excerpt(date, excerpt.text);
        push(excerpt.amendmentAt ? copy.addendum(date, excerpt.text) : quoted, [{ ...source, version: excerpt.noteVersion }]);
        displayed++; characters += excerpt.text.length;
      }
    }
    if (!displayed && plan.focus && !omitted) push(copy.noTopic(copy.focus[plan.focus]), all.filter(source => source.type === "consultation"));
    if (omitted) push(copy.excerptLimit, all.filter(source => source.type === "consultation"));
    if (!context.coverage.complete || (plan.intent === "longitudinal" && context.coverage.hasMore)) push(copy.partial);
    return result;
  }
  if (plan.intent !== "history") {
    push(copy.treatment(context.treatments.current.length));
    for (const treatment of context.treatments.current) {
      const fields=alexaRecordCopy.fr.treatmentFields;
      const details=[treatment.medication,treatment.dose,treatment.doseUnit,treatment.frequency,copy.states[treatment.status],fields.startDate+' : '+treatment.startDate,...(treatment.endDate?[fields.endDate+' : '+treatment.endDate]:[]),...(treatment.timing.length?[fields.timing+' : '+treatment.timing.join(', ')]:[]),...(treatment.instructions?[fields.instructions+' : '+treatment.instructions]:[])];
      push(details.filter(Boolean).join(" · "),all.filter(s=>s.id===treatment.id));
    }
  }
  // Older consultations outside an explicit last-N request do not make that
  // request partial. Consultation-note gaps do not weaken a treatment read.
  if ((plan.intent !== "treatments" && !context.coverage.complete) || !context.treatments.historyComplete) push(copy.partial);
  return result;
}
