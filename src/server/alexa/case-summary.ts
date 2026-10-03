import { createHash } from "node:crypto";
import type { ClinicalContext } from "@/shared/alexa/clinical";
import type { AlexaLanguage } from "@/shared/alexa/request-plan";
import { dialogue } from "@/i18n/alexa-dialogue";
import { localDisplay } from "./local-response";
import { alexaSummary, summaryDialogue } from "@/i18n/alexa-summary";
import { consultationExcerpts } from "./note-excerpts";

export interface SummaryItem { texte: string; sources: { t: "consultation" | "diagnostic" | "treatment"; id: string }[] }

/** All five local note areas, with current drafts separate from completed visits. */
export function buildConsultationNoteDetails(context: ClinicalContext, identities: readonly string[], language: AlexaLanguage = "fr"): SummaryItem[] {
  const copy = summaryDialogue(language);
  const latest = [...context.consultations].filter(c => c.endedAt !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))[0];
  const consultations = [...(context.currentConsultation ? [context.currentConsultation] : []), ...(latest ? [latest] : [])];
  const items: SummaryItem[] = [];
  for (const consultation of consultations) {
    const date = new Intl.DateTimeFormat(language === "fr" ? "fr-DZ" : "ar-DZ", { timeZone: "Africa/Algiers", dateStyle: "medium" }).format(new Date(consultation.startedAt));
    const selected = consultationExcerpts(consultation, undefined, 20000, 20, 4000);
    for (const excerpt of selected.excerpts) {
      const detail = excerpt.amendmentAt ? dialogue(language).addendum(excerpt.amendmentAt, excerpt.text)
        : copy.noteProvenance(excerpt.area ? copy.noteAreas[excerpt.area] : copy.noteDetails, excerpt.text, !!excerpt.unsigned);
      items.push({ texte: localDisplay(copy.noteDetail(date, detail, consultation.endedAt === null), identities), sources: [{ t: "consultation", id: consultation.id }] });
    }
    if (selected.omitted) items.push({ texte: copy.noteLimits, sources: [{ t: "consultation", id: consultation.id }] });
  }
  return items;
}

function recordedDose(treatment: ClinicalContext["treatments"]["current"][number], copy: ReturnType<typeof summaryDialogue>): string {
  if (treatment.dose === null) return copy.missingDose;
  // Free recorded dose text can already contain a unit. Keep the separate
  // recorded unit visible rather than merging potentially conflicting values.
  if (!/^[\d\s,.]+$/.test(treatment.dose)) {
    return copy.doseWithSeparateUnit(treatment.dose, treatment.doseUnit ?? copy.missingUnit);
  }
  return [treatment.dose, treatment.doseUnit ?? copy.missingUnit].join(" ");
}

/** Four sourced items from recorded fields and one local quotation; no inferred trend. */
export function buildStructuredSummaryNarrative(context: ClinicalContext, identities: readonly string[], language: AlexaLanguage = "fr"): SummaryItem[] {
  const copy = dialogue(language);
  const summary = summaryDialogue(language);
  const item = (texte: string, sources: SummaryItem["sources"]): SummaryItem => ({ texte: localDisplay(texte, identities), sources });
  const diagnoses = context.diagnoses.filter(d => !d.resolvedAt);
  const treatments = context.treatments.current;
  const completed = context.consultations.filter(c => c.endedAt !== null);
  const latest = completed.reduce<(typeof completed)[number] | undefined>((previous, consultation) => {
    if (!previous) return consultation;
    const difference = Date.parse(consultation.startedAt) - Date.parse(previous.startedAt);
    return difference > 0 || (difference === 0 && consultation.id > previous.id) ? consultation : previous;
  }, undefined);
  const excerpt = latest ? consultationExcerpts(latest, undefined, 400, 1).excerpts[0] : undefined;
  const latestDate = latest ? new Intl.DateTimeFormat(language === "fr" ? "fr-DZ" : "ar-DZ", { timeZone: "Africa/Algiers", day: "numeric", month: "long", year: "numeric" }).format(new Date(latest.startedAt)) : "";
  return [
    item(diagnoses.length ? summary.recordedDiagnoses(diagnoses.map(d => d.label).join(" ; ")) : summary.noDiagnoses,
      diagnoses.map(d => ({ t: "diagnostic", id: d.id }))),
    item(treatments.length ? summary.recordedTreatments(treatments.map(t => summary.recordedTreatment(
      t.medication, recordedDose(t, summary), t.frequency ?? summary.missingFrequency, copy.states[t.status])).join(" ; ")) : summary.noTreatments,
      treatments.map(t => ({ t: "treatment", id: t.id }))),
    item(latest ? excerpt ? summary.lastExcerpt(latestDate, excerpt.text, !!excerpt.amendmentAt,
      excerpt.area ? summary.noteAreas[excerpt.area] : undefined, !!excerpt.unsigned) : summary.lastCompleted(latestDate, latest.notes.length) : summary.noCompleted,
      latest ? [{ t: "consultation", id: latest.id }] : []),
    item(summary.narrativeLimits(completed.length, context.coverage.requested,
      !context.coverage.complete || context.coverage.hasMore, context.treatments.historyComplete),
      completed.map(c => ({ t: "consultation", id: c.id }))),
  ];
}

export function buildCaseSummary(context: ClinicalContext, identities: readonly string[]) {
  const copy = dialogue("fr");
  const item = (texte: string, sources: SummaryItem["sources"]): SummaryItem => ({ texte: localDisplay(texte, identities), sources });
  const narrative = buildStructuredSummaryNarrative(context, identities);
  const diagnostics = context.diagnoses.filter(d => !d.resolvedAt).map(d => item(d.label, [{ t: "diagnostic", id: d.id }]));
  const treatments = context.treatments.current.map(t => item([t.medication, t.dose, t.doseUnit, t.frequency, copy.states[t.status]].filter(Boolean).join(" · "), [{ t: "treatment", id: t.id }]));
  const byYear = new Map<string, SummaryItem[]>();
  for (const consultation of context.consultations) {
    const year = new Intl.DateTimeFormat("fr-DZ", { timeZone: "Africa/Algiers", year: "numeric" }).format(new Date(consultation.startedAt));
    const date = new Intl.DateTimeFormat("fr-DZ", { timeZone: "Africa/Algiers", dateStyle: "medium" }).format(new Date(consultation.startedAt));
    const rows = byYear.get(year) ?? [];
    rows.push(item(alexaSummary.consultation(date, consultation.notes.length), [{ t: "consultation", id: consultation.id }]));
    byYear.set(year, rows);
  }
  return { schema: 2 as const, apercu: { nom: alexaSummary.dossier, age: null, residence: null, diagnostics, traitements: treatments, contexte: narrative },
    chronologie: [...byYear].map(([periode, entrees]) => ({ periode, entrees })), anterieur: [], etat_actuel: buildConsultationNoteDetails(context, identities) };
}
export const SUMMARY_PROMPT_VERSION = "alexa-context-summary-v4";
export const SUMMARY_PROMPT_HASH = createHash("sha256").update(SUMMARY_PROMPT_VERSION).digest("hex");
