import { createHash } from "node:crypto";

import type { ClinicalContext, ClinicalConsultation, ClinicalTreatment } from "@/shared/alexa/clinical";
import { localDisplay } from "./local-response";

export const CASE_SYNTHESIS_VERSION = "case-synthesis-fr-v1";
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
  const notes = typeof record["resumeNotes"] === "string" ? clean(record["resumeNotes"]) : "";
  if (notes !== "") return notes;
  return typeof record["resume"] === "string" && clean(record["resume"]) !== "" ? clean(record["resume"]) : null;
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
  const dose = [treatment.dose, treatment.doseUnit].filter((part): part is string => part !== null && part !== "").join(" ");
  const frequency = treatment.frequency === null ? "" : clean(treatment.frequency);
  const state = treatment.status === "active" ? "actif" : treatment.status === "paused" ? "en pause" : "arrêté";
  return [treatment.medication, dose, frequency, state].filter((part) => part !== "").join(" · ");
}

function activeDiagnoses(context: ClinicalContext): CaseItem[] {
  return context.diagnoses
    .filter((diagnosis) => diagnosis.resolvedAt === null)
    .map((diagnosis) => ({ texte: diagnosis.label, sources: [{ t: "diagnostic", id: diagnosis.id }] }));
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

function scaleSentence(group: ScaleGroup): string | null {
  const score = group.latest.total;
  if (score === null) return null;
  const max = maxScore(group);
  const value = max === null ? `${String(score)}` : `${String(score)}/${String(max)}`;
  const interpretation = group.latest.interpretation === null ? "" : ` (${group.latest.interpretation})`;
  const previousScore = group.previous?.total ?? null;
  const previous = previousScore === null ? "" : `, contre ${String(previousScore)}${max === null ? "" : `/${String(max)}`} à la mesure précédente`;
  return `${group.name} : ${value}${interpretation}${previous}.`;
}

function treatmentChange(context: ClinicalContext): CaseItem | null {
  const change = [...context.treatments.history]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id))[0];
  if (change === undefined) return null;
  const treatment = context.treatments.current.find((item) => item.id === change.treatmentId);
  const medication = treatment?.medication ?? "le traitement documenté";
  const beforeDose = [change.previous?.dose, change.previous?.doseUnit].filter((part): part is string => part !== null && part !== undefined && part !== "").join(" ");
  const afterDose = [change.next?.dose, change.next?.doseUnit].filter((part): part is string => part !== null && part !== undefined && part !== "").join(" ");
  if (beforeDose !== "" && afterDose !== "" && beforeDose !== afterDose) {
    return { texte: `La dose de ${medication} est passée de ${beforeDose} à ${afterDose}.`, sources: [{ t: "treatment", id: change.treatmentId }] };
  }
  const beforeState = change.previous?.status ?? null;
  const afterState = change.next?.status ?? null;
  if (beforeState !== null && afterState !== null && beforeState !== afterState) {
    const label = (state: string): string => state === "active" ? "actif" : state === "paused" ? "en pause" : "arrêté";
    return { texte: `Le traitement ${medication} est passé de « ${label(beforeState)} » à « ${label(afterState)} ».`, sources: [{ t: "treatment", id: change.treatmentId }] };
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

export function buildCaseSynthesis(input: CaseSynthesisInput): CaseSynthesis {
  const identities = input.identities ?? [];
  const item = (texte: string, sources: readonly CaseSource[]): CaseItem => ({
    texte: localDisplay(texte, identities),
    sources,
  });
  const diagnostics = activeDiagnoses(input.context).map((entry) => item(entry.texte, entry.sources));
  const treatments = currentTreatments(input.context).map((entry) => item(entry.texte, entry.sources));
  const groups = scaleGroups(input);
  const risk = groups.map((group) => ({ group, finding: riskFor(group) })).find((entry) => entry.finding !== null) ?? null;

  const situation: string[] = [];
  const situationSources: CaseSource[] = [];
  if (diagnostics.length > 0) {
    const labels = diagnostics.map((entry) => entry.texte);
    const principal = input.context.diagnoses.find((entry) => entry.resolvedAt === null && entry.primary);
    situation.push(`Le suivi est documenté pour ${labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} et ${labels.at(-1)}`}${principal === undefined ? "" : ", diagnostic principal"}.`);
    situationSources.push(...diagnostics.flatMap((entry) => entry.sources));
  }
  if (treatments.length > 0) {
    situation.push(`Le traitement actuel associe ${treatments.map((entry) => entry.texte).join(" ; ")}.`);
    situationSources.push(...treatments.flatMap((entry) => entry.sources));
  }
  const latest = latestCompleted(input.context);
  if (latest !== undefined) {
    const saved = savedSessionResume(latest);
    const excerpt = saved ?? noteExcerpt(latest);
    if (excerpt !== null) {
      const documented = saved === null ? "" : firstSentences(saved);
      situation.push(saved === null
        ? `La dernière note consignée rapporte : ${quote(excerpt)}`
        : `La dernière consultation documente : ${documented.charAt(0).toLocaleLowerCase("fr")}${documented.slice(1)}`);
      situationSources.push({ t: "consultation", id: latest.id });
    }
  }

  const trajectory: string[] = [];
  const trajectorySources: CaseSource[] = [];
  const scaleSentences = groups.map(scaleSentence).filter((value): value is string => value !== null);
  if (scaleSentences.length > 0) {
    trajectory.push(`${scaleSentences.length === 1 ? "L'évaluation disponible montre" : "Les évaluations disponibles montrent"} ${scaleSentences.join(" ")}`);
    for (const group of groups) {
      if (group.latest.total !== null) trajectorySources.push({ t: "echelle", id: group.latest.id });
    }
  }
  const change = treatmentChange(input.context);
  if (change !== null) {
    trajectory.push(change.texte);
    trajectorySources.push(...change.sources);
  }
  const focus = recurringFocus(input.context);
  if (focus !== null) {
    trajectory.push(focus.texte);
    trajectorySources.push(...focus.sources);
  }

  const plan: string[] = [];
  const planSources: CaseSource[] = [];
  if (latest !== undefined && latest.notes[0]?.plan !== null && latest.notes[0]?.plan !== undefined) {
    const planText = clean(latest.notes[0].plan);
    const alreadyInSummary = savedSessionResume(latest)?.toLocaleLowerCase("fr").includes(planText.toLocaleLowerCase("fr").slice(0, 40)) ?? false;
    if (planText !== "" && !alreadyInSummary) {
      plan.push(`Le plan consigné prévoit : ${quote(planText)}`);
      planSources.push({ t: "consultation", id: latest.id });
    }
  }

  const paragraphes: CaseItem[] = [];
  if (situation.length > 0) paragraphes.push(item(situation.join(" "), situationSources));
  if (trajectory.length > 0) paragraphes.push(item(trajectory.join(" "), trajectorySources));
  if (plan.length > 0) paragraphes.push(item(plan.join(" "), planSources));

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
  if (!input.context.coverage.complete || input.context.coverage.hasMore) {
    vigilance.push(item(
      "Certaines séances ne comportent pas de note exploitable ; la synthèse porte sur les éléments disponibles.",
      [],
    ));
  }

  return { paragraphes, diagnostics, traitements: treatments, vigilance };
}
