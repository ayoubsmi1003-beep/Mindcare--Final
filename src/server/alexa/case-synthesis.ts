import { createHash } from "node:crypto";

import type { ClinicalContext, ClinicalConsultation, ClinicalTreatment } from "@/shared/alexa/clinical";
import { localDisplay } from "./local-response";

export const CASE_SYNTHESIS_VERSION = "case-synthesis-fr-v5";
export const CASE_SYNTHESIS_HASH = createHash("sha256").update(CASE_SYNTHESIS_VERSION).digest("hex");

/**
 * Deterministic longitudinal case synthesis.
 *
 * The local 1B model is contractually limited to selecting one or two dated
 * sentences. That cannot produce a longitudinal account, and the scale
 * contract forbids sending responses to a model. This module therefore writes
 * the case summary from recorded facts only: no network, no model, no
 * inference. Every paragraph carries the source ids the SQL gate revalidates.
 */

export type CaseSource =
  | { readonly t: "consultation"; readonly id: string }
  | { readonly t: "diagnostic"; readonly id: string }
  | { readonly t: "treatment"; readonly id: string }
  | { readonly t: "echelle"; readonly id: string };

export interface CaseItem {
  readonly texte: string;
  readonly sources: readonly CaseSource[];
}

export interface ScaleAdministrationLite {
  readonly id: string;
  readonly scaleCode: string;
  readonly scaleName: string;
  readonly consultationId: string | null;
  readonly total: number | null;
  readonly interpretation: string | null;
  readonly administeredAt: string;
  readonly responses: Readonly<Record<string, unknown>>;
}

export interface ScaleDefinitionLite {
  readonly code: string;
  readonly nom: string;
  readonly items: readonly {
    readonly id: string;
    readonly texte: string;
    readonly risque?: boolean | undefined;
    readonly alerte?: string | undefined;
  }[];
  readonly scoring: { readonly max: number };
}

export interface CaseSynthesis {
  readonly paragraphes: readonly CaseItem[];
  readonly diagnostics: readonly CaseItem[];
  readonly traitements: readonly CaseItem[];
  readonly vigilance: readonly CaseItem[];
}

export interface CaseSynthesisInput {
  readonly context: ClinicalContext;
  readonly histories: readonly ScaleAdministrationLite[];
  readonly definitions: readonly ScaleDefinitionLite[];
  readonly identities?: readonly string[];
  readonly scaleHistoryUnavailable?: boolean;
  readonly scaleDefinitionsUnavailable?: boolean;
}

function clean(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function sentence(value: string): string {
  const text = clean(value);
  if (text === "") return "";
  return /[.!?…]$/u.test(text) ? text : `${text}.`;
}

function firstSentences(value: string, maxCharacters = 420, maxSentences = 2): string {
  const pieces = value.split(/(?<=[.!?…])\s+/u).map(clean).filter(Boolean);
  const selected: string[] = [];
  let length = 0;
  for (const piece of pieces.slice(0, maxSentences)) {
    if (length + piece.length > maxCharacters && selected.length > 0) break;
    selected.push(sentence(piece));
    length += piece.length;
  }
  return selected.join(" ");
}

function quote(value: string, maxCharacters = 320): string {
  const text = clean(value);
  const cut = text.length <= maxCharacters ? text : `${text.slice(0, maxCharacters).replace(/[;,:\s]+$/u, "")}…`;
  return `« ${cut}${/[.!?…]$/u.test(cut) ? "" : "."} »`;
}

function latestCompleted(context: ClinicalContext): ClinicalConsultation | undefined {
  return [...context.consultations]
    .filter((consultation) => consultation.endedAt !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))[0];
}

function savedSessionResume(consultation: ClinicalConsultation): string | null {
  const content = consultation.analysis?.content;
  if (typeof content !== "object" || content === null) return null;
  const record = content as Record<string, unknown>;
  const resume = typeof record["resume"] === "string" ? clean(record["resume"]) : "";
  if (resume !== "") return resume;
  return typeof record["resumeNotes"] === "string" && clean(record["resumeNotes"]) !== "" ? clean(record["resumeNotes"]) : null;
}

function noteExcerpt(consultation: ClinicalConsultation): string | null {
  const note = consultation.notes[0];
  if (note === undefined) return null;
  for (const value of [note.subjective, note.assessment, note.plan, note.objective]) {
    const text = value === null ? "" : clean(value);
    if (text !== "") return text;
  }
  return null;
}

function treatmentLine(treatment: ClinicalTreatment): string {
  const recordedDose = treatment.dose === null ? "" : clean(treatment.dose);
  const recordedUnit = treatment.doseUnit === null ? "" : clean(treatment.doseUnit);
  const dose = recordedDose === "" ? "" : !/^[\d\s,.]+$/u.test(recordedDose)
    ? recordedUnit === "" ? recordedDose : `${recordedDose} (unité enregistrée séparément : ${recordedUnit})`
    : [recordedDose, recordedUnit].filter(Boolean).join(" ");
  const frequency = treatment.frequency === null ? "" : clean(treatment.frequency);
  const state = treatment.status === "active" ? "actif" : treatment.status === "paused" ? "en pause" : "arrêté";
  const details = [dose ? `dose consignée : ${dose}` : "", frequency ? `fréquence consignée : « ${frequency} »` : ""].filter(Boolean);
  return `Le traitement par « ${clean(treatment.medication)} » est ${state}${details.length ? ` (${details.join(" ; ")})` : ""}.`;
}

function quotedLabel(value: string): string {
  return `« ${clean(value)} »`;
}

function joinFrench(values: readonly string[]): string {
  if (values.length < 2) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} et ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} et ${values.at(-1)}`;
}

function activeDiagnoses(context: ClinicalContext): CaseItem[] {
  return context.diagnoses
    .filter((diagnosis) => diagnosis.resolvedAt === null)
    .map((diagnosis) => ({ texte: diagnosis.label, sources: [{ t: "diagnostic", id: diagnosis.id }] }));
}

function diagnosisDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function documentedDiagnoses(context: ClinicalContext): CaseItem[] {
  return context.diagnoses.map((diagnosis) => {
    const status = diagnosis.resolvedAt !== null
      ? `résolu le ${diagnosisDate(diagnosis.resolvedAt)}`
      : diagnosis.onsetDate !== null ? `actif depuis le ${diagnosisDate(diagnosis.onsetDate)}` : "actif";
    return { texte: `${diagnosis.label} (${status})`, sources: [{ t: "diagnostic", id: diagnosis.id }] };
  });
}

function currentTreatments(context: ClinicalContext): CaseItem[] {
  return context.treatments.current.map((treatment) => ({
    texte: treatmentLine(treatment),
    sources: [{ t: "treatment", id: treatment.id }],
  }));
}

interface ScaleGroup {
  readonly code: string;
  readonly name: string;
  readonly latest: ScaleAdministrationLite;
  readonly previous: ScaleAdministrationLite | null;
  readonly definition: ScaleDefinitionLite | undefined;
}

function scaleGroups(input: CaseSynthesisInput): ScaleGroup[] {
  const definitionByCode = new Map(input.definitions.map((definition) => [definition.code, definition]));
  const definitionByName = new Map(input.definitions.map((definition) => [definition.nom, definition]));
  const grouped = new Map<string, ScaleAdministrationLite[]>();
  for (const administration of input.histories) {
    const list = grouped.get(administration.scaleCode) ?? [];
    list.push(administration);
    grouped.set(administration.scaleCode, list);
  }
  const groups: ScaleGroup[] = [];
  for (const [code, list] of grouped) {
    const ordered = [...list].sort((a, b) => b.administeredAt.localeCompare(a.administeredAt) || b.id.localeCompare(a.id));
    const latest = ordered[0];
    if (latest === undefined) continue;
    groups.push({
      code,
      name: latest.scaleName,
      latest,
      previous: ordered[1] ?? null,
      definition: definitionByCode.get(code) ?? definitionByName.get(latest.scaleName),
    });
  }
  // Legacy summaries without history still get honest scores, never a risk claim.
  if (groups.length === 0 && input.context.scales.length > 0) {
    const byName = new Map<string, ClinicalContext["scales"]>();
    for (const scale of input.context.scales) {
      const list = byName.get(scale.name) ?? [];
      list.push(scale);
      byName.set(scale.name, list);
    }
    for (const [name, list] of byName) {
      const ordered = [...list].sort((a, b) => b.administeredAt.localeCompare(a.administeredAt) || b.id.localeCompare(a.id));
      const latest = ordered[0];
      if (latest === undefined) continue;
      groups.push({
        code: name,
        name,
        latest: {
          id: latest.id,
          scaleCode: name,
          scaleName: latest.name,
          administeredAt: latest.administeredAt,
          total: latest.score,
          interpretation: latest.interpretation,
          consultationId: null,
          responses: {},
        },
        previous: ordered[1] === undefined ? null : {
          id: ordered[1].id,
          scaleCode: name,
          scaleName: ordered[1].name,
          consultationId: null,
          total: ordered[1].score,
          interpretation: ordered[1].interpretation,
          administeredAt: ordered[1].administeredAt,
          responses: {},
        },
        definition: definitionByName.get(name),
      });
    }
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

function maxScore(group: ScaleGroup): number | null {
  return group.definition?.scoring.max ?? null;
}

function riskFor(group: ScaleGroup): { readonly itemId: string; readonly itemText: string; readonly value: number; readonly message: string } | null {
  const definition = group.definition;
  if (definition === undefined) return null;
  for (const item of definition.items) {
    if (item.risque !== true) continue;
    const value = group.latest.responses[item.id];
    if (typeof value === "number" && value > 0) {
      return {
        itemId: item.id,
        itemText: item.texte,
        value,
        message: item.alerte ?? `Réponse positive à « ${item.texte} » — à explorer cliniquement.`,
      };
    }
  }
  return null;
}

function recurringFocus(context: ClinicalContext): CaseItem | null {
  const ignored = new Set(["traitement", "événement récent", "evenement recent"]);
  const counts = new Map<string, { readonly label: string; readonly ids: Set<string> }>();
  for (const consultation of [...(context.currentConsultation === undefined ? [] : [context.currentConsultation]), ...context.consultations]) {
    for (const focus of consultation.sessionDetails?.focus ?? []) {
      const label = clean(focus);
      if (label === "" || ignored.has(label.toLocaleLowerCase("fr"))) continue;
      const entry = counts.get(label.toLocaleLowerCase("fr")) ?? { label, ids: new Set<string>() };
      entry.ids.add(consultation.id);
      counts.set(label.toLocaleLowerCase("fr"), entry);
    }
  }
  const recurring = [...counts.values()].filter((entry) => entry.ids.size >= 2).sort((a, b) => b.ids.size - a.ids.size);
  if (recurring.length === 0) return null;
  return {
    texte: `Les séances ont porté à plusieurs reprises sur ${recurring.slice(0, 3).map((entry) => entry.label.toLocaleLowerCase("fr")).join(", ")}.`,
    sources: [...recurring.slice(0, 3).flatMap((entry) => [...entry.ids].map((id) => ({ t: "consultation" as const, id })))],
  };
}

function longDate(value: string): string {
  return new Intl.DateTimeFormat("fr-DZ", { timeZone: "Africa/Algiers", day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
}

function monthOf(value: string): string {
  return new Intl.DateTimeFormat("fr-DZ", { timeZone: "Africa/Algiers", month: "long", year: "numeric" }).format(new Date(value));
}

function lowerFirst(value: string): string {
  return value === "" ? value : value.charAt(0).toLocaleLowerCase("fr") + value.slice(1);
}

/** What a visit was about: its saved sub-summary, else the first recorded sentence of its note. */
function visitStory(consultation: ClinicalConsultation): string {
  const saved = savedSessionResume(consultation);
  if (saved !== null) return firstSentences(saved);
  const excerpt = noteExcerpt(consultation);
  return excerpt === null ? "" : `la note rapporte ${quote(excerpt)}`;
}

function treatmentEvent(context: ClinicalContext, change: ClinicalContext["treatments"]["history"][number]): string | null {
  const medication = context.treatments.current.find((entry) => entry.id === change.treatmentId)?.medication ?? "le traitement documenté";
  const when = `En ${monthOf(change.occurredAt)}`;
  const dose = (state: typeof change.previous) => [state?.dose, state?.doseUnit].filter((part): part is string => part !== null && part !== undefined && part !== "").join(" ");
  if (change.previous === null) return `${when}, ${medication} a été introduit${dose(change.next) ? ` à ${dose(change.next)}` : ""}.`;
  if (dose(change.previous) !== "" && dose(change.next) !== "" && dose(change.previous) !== dose(change.next)) return `${when}, la dose de ${medication} est passée de ${dose(change.previous)} à ${dose(change.next)}.`;
  const before = change.previous?.status ?? null, after = change.next?.status ?? null;
  if (before !== after && after !== null) return `${when}, ${medication} a été ${after === "active" ? "repris" : after === "paused" ? "mis en pause" : "arrêté"}.`;
  return null;
}

function scaleTrajectory(group: ScaleGroup): string | null {
  const score = group.latest.total;
  if (score === null) return null;
  const max = maxScore(group);
  const value = (total: number, interpretation: string | null) => `${String(total)}${max === null ? "" : `/${String(max)}`}${interpretation === null ? "" : ` (${interpretation})`}`;
  const previous = group.previous?.total ?? null;
  return previous === null
    ? `Le ${group.name} est à ${value(score, group.latest.interpretation)}.`
    : `Le ${group.name} est passé de ${value(previous, group.previous!.interpretation)} à ${value(score, group.latest.interpretation)}.`;
}

function currentTreatmentSentence(context: ClinicalContext): string | null {
  const told = (treatment: ClinicalTreatment) => {
    const dose = [treatment.dose, treatment.doseUnit].filter((part): part is string => part !== null && clean(part) !== "").map(clean).join(" ");
    const frequency = treatment.frequency === null ? "" : clean(treatment.frequency);
    return `${clean(treatment.medication)}${dose ? ` ${dose}` : ""}${frequency ? `, ${frequency}` : ""}`;
  };
  const active = context.treatments.current.filter((treatment) => treatment.status === "active").map(told);
  const paused = context.treatments.current.filter((treatment) => treatment.status === "paused").map((treatment) => clean(treatment.medication));
  const parts = [active.length ? `Le traitement actuel comprend ${joinFrench(active)}.` : "", paused.length ? `${joinFrench(paused)} ${paused.length === 1 ? "est" : "sont"} en pause.` : ""].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

export function buildCaseSynthesis(input: CaseSynthesisInput): CaseSynthesis {
  const identities = input.identities ?? [];
  const item = (texte: string, sources: readonly CaseSource[]): CaseItem => ({
    texte: localDisplay(texte, identities),
    sources,
  });
  const diagnostics = documentedDiagnoses(input.context).map((entry) => item(entry.texte, entry.sources));
  const active = activeDiagnoses(input.context).map((entry) => item(entry.texte, entry.sources));
  const treatments = currentTreatments(input.context).map((entry) => item(entry.texte, entry.sources));
  const groups = scaleGroups(input);
  const risk = groups.map((group) => ({ group, finding: riskFor(group) })).find((entry) => entry.finding !== null) ?? null;

  // The patient's story in up to four paragraphs: how the follow-up began, how it evolved, where it stands, what comes next.
  const completed = [...input.context.consultations].filter((consultation) => consultation.endedAt !== null)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  const first = completed[0];
  const latest = completed.at(-1);
  const paragraphes: CaseItem[] = [];
  const paragraph = (parts: readonly string[], sources: readonly CaseSource[]) => {
    const texte = parts.filter(Boolean).join(" ").trim();
    if (texte === "") return;
    const unique = new Map(sources.map((source) => [`${source.t}:${source.id}`, source]));
    paragraphes.push(item(texte, [...unique.values()]));
  };

  const beginning: string[] = [];
  const beginningSources: CaseSource[] = [];
  if (active.length > 0) {
    const principal = input.context.diagnoses.find((entry) => entry.resolvedAt === null && entry.primary);
    const labels = active.map((entry) => quotedLabel(entry.texte));
    if (labels.length === 1) {
      beginning.push(principal === undefined ? `Le suivi concerne le diagnostic actif ${labels[0]}.` : `Le suivi concerne le diagnostic principal ${labels[0]}.`);
    } else {
      beginning.push(`Le suivi concerne les diagnostics actifs ${joinFrench(labels)}.`);
      if (principal !== undefined) beginning.push(`Le diagnostic principal est ${quotedLabel(principal.label)}.`);
    }
    beginningSources.push(...active.flatMap((entry) => entry.sources));
  }
  if (first !== undefined && completed.length > 1) {
    const story = visitStory(first);
    beginning.push(`Le suivi a commencé le ${longDate(first.startedAt)}.`);
    if (story !== "") beginning.push(`Lors de cette première consultation, ${lowerFirst(story)}`);
    beginningSources.push({ t: "consultation", id: first.id });
  }
  paragraph(beginning, beginningSources);

  const evolution: string[] = [];
  const evolutionSources: CaseSource[] = [];
  if (completed.length > 2) evolution.push(`Depuis, ${completed.length - 1} consultations ont eu lieu.`);
  const events = [...input.context.treatments.history].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id))
    .map((change) => ({ change, texte: treatmentEvent(input.context, change) })).filter((entry) => entry.texte !== null);
  if (events.length > 5) evolution.push("Plusieurs ajustements de traitement plus anciens figurent au dossier.");
  for (const entry of events.slice(-5)) {
    evolution.push(entry.texte!);
    evolutionSources.push({ t: "treatment", id: entry.change.treatmentId });
  }
  for (const group of groups) {
    const told = scaleTrajectory(group);
    if (told === null) continue;
    evolution.push(told);
    evolutionSources.push({ t: "echelle", id: group.latest.id });
  }
  const focus = recurringFocus(input.context);
  if (focus !== null) {
    evolution.push(focus.texte);
    evolutionSources.push(...focus.sources);
  }
  paragraph(evolution, evolutionSources);

  const current: string[] = [];
  const currentSources: CaseSource[] = [];
  if (latest !== undefined) {
    const story = visitStory(latest);
    const when = completed.length === 1 ? `Lors de la seule consultation terminée, le ${longDate(latest.startedAt)}` : `Lors de la dernière consultation, le ${longDate(latest.startedAt)}`;
    current.push(story !== "" ? `${when}, ${lowerFirst(story)}` : `${when}, aucune note exploitable n’a été rédigée.`);
    currentSources.push({ t: "consultation", id: latest.id });
  }
  const treatmentSentence = currentTreatmentSentence(input.context);
  if (treatmentSentence === null && latest !== undefined) current.push("Aucun traitement en cours n’est enregistré.");
  if (treatmentSentence !== null) {
    current.push(treatmentSentence);
    currentSources.push(...input.context.treatments.current.filter((entry) => entry.status !== "stopped").map((entry) => ({ t: "treatment" as const, id: entry.id })));
  }
  paragraph(current, currentSources);

  if (latest !== undefined && latest.notes[0]?.plan !== null && latest.notes[0]?.plan !== undefined) {
    const planText = clean(latest.notes[0].plan);
    const alreadyTold = visitStory(latest).toLocaleLowerCase("fr").includes(planText.toLocaleLowerCase("fr").slice(0, 40));
    if (planText !== "" && !alreadyTold) paragraph([`Pour la suite, ${lowerFirst(firstSentences(planText, 400, 3))}`], [{ t: "consultation", id: latest.id }]);
  }

  const vigilance: CaseItem[] = [];
  if (risk !== null && risk.finding !== null) {
    const itemNumber = risk.finding.itemId.replace(/^q/iu, "");
    vigilance.push(item(
      `Item de risque positif au ${risk.group.name} (item ${itemNumber} : ${risk.finding.itemText.toLocaleLowerCase("fr")}) — appelle une exploration clinique.`,
      [{ t: "echelle", id: risk.group.latest.id }],
    ));
  }
  if (input.scaleHistoryUnavailable === true) {
    vigilance.push(item(
      "Les évaluations n'ont pas pu être relues ; les scores du dossier restent consultables dans l'onglet Clinique.",
      [],
    ));
  }
  if (input.scaleDefinitionsUnavailable === true) {
    vigilance.push(item(
      "La définition des échelles n'a pas pu être relue ; l'item de risque doit être vérifié dans le dossier.",
      [],
    ));
  }
  // Points noticed in the record itself, never a clinical judgement.
  if (latest?.notes[0]?.status === "draft") {
    vigilance.push(item("La note de la dernière consultation n’est pas encore signée.", [{ t: "consultation", id: latest.id }]));
  }
  for (const treatment of input.context.treatments.current.filter((entry) => entry.status === "active" && (entry.dose === null || clean(entry.dose) === ""))) {
    vigilance.push(item(`Aucune dose n’est renseignée pour ${clean(treatment.medication)}.`, [{ t: "treatment", id: treatment.id }]));
  }
  if (!input.context.coverage.complete || input.context.coverage.hasMore) {
    vigilance.push(item(
      "Certaines séances ne comportent pas de note exploitable ; la synthèse porte sur les éléments disponibles.",
      [],
    ));
  }

  return { paragraphes, diagnostics, traitements: treatments, vigilance };
}
