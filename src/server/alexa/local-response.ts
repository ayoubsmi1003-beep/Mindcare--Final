import type { ClinicalContext } from "@/shared/alexa/clinical";
import type { AlexaEvent, AlexaSource } from "@/shared/alexa/turn";
import { dialogue } from "@/i18n/alexa-dialogue";
import type { RequestPlan } from "./request-plan";
import { consultationExcerpts } from "./note-excerpts";
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
    for (const scale of [...context.scales].sort((a, b) => b.administeredAt.localeCompare(a.administeredAt) || b.id.localeCompare(a.id))) {
      const date = Number.isFinite(Date.parse(scale.administeredAt)) ? new Intl.DateTimeFormat(plan.language === "fr" ? "fr-DZ" : "ar-DZ", { timeZone: "Africa/Algiers", dateStyle: "medium" }).format(new Date(scale.administeredAt)) : copy.unspecified;
      push(copy.recordedScale(date, scale.name, scale.score, scale.interpretation), all.filter(source => source.id === scale.id));
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
      push([treatment.medication, treatment.dose, treatment.doseUnit, treatment.frequency, copy.states[treatment.status]].filter(Boolean).join(" · "), all.filter(s => s.id === treatment.id));
    }
  }
  // Older consultations outside an explicit last-N request do not make that
  // request partial. Consultation-note gaps do not weaken a treatment read.
  if ((plan.intent !== "treatments" && !context.coverage.complete) || !context.treatments.historyComplete) push(copy.partial);
  return result;
}
