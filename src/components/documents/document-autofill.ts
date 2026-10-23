import type { Patient, PatientWorkspace, PrescriptionResume, TraitementV2 } from "@/services/patients";
import { aujourdHuiCabinet } from "@/services/finance-calendrier";
import type { DocumentContent, DocumentKind, DocumentNode, Variables } from "@/shared/documents/types";

import { isoVersFr } from "./champs";

/**
 * Auto-remplissage initial des documents.
 *
 * Ce module est PUR : il ne lit aucune base et ne décide aucune clinique. Il
 * transforme les données déjà lues dans le dossier en valeurs éditables pour un
 * NOUVEAU brouillon. Il n'est jamais appelé à l'ouverture d'un brouillon existant.
 */

export interface AutoFillSource {
  readonly idDocumentNumber: string;
  readonly idDocumentIssuer: string;
  readonly birthDate: string | null;
  /** Date civile du cabinet, AAAA-MM-JJ. */
  readonly today: string;
  readonly activeTreatments: readonly TraitementV2[];
  readonly lastPrescription: PrescriptionResume | null;
}

export interface InitialDocumentData {
  readonly variables: Variables;
  readonly content: DocumentContent;
}

const TREATMENT_KEY = /^traitement_(\d+)$/u;

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** Le nom réellement porté par le dossier, sans fabriquer de dosage. */
function treatmentName(treatment: TraitementV2): string {
  return clean(treatment.medicationRaw) || clean(treatment.brandName) || clean(treatment.inn);
}

/** Normalisation destinée uniquement au rapprochement de deux libellés. */
function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

/**
 * Une fréquence quotidienne n'est reprise que si elle est EXPLICITE.
 * « matin et soir » n'est pas « 2 fois par jour » : on ne le convertit pas.
 */
export function parseExplicitDailyFrequency(value: string | null | undefined): number | null {
  const text = clean(value).toLocaleLowerCase("fr");
  const match = /^(\d{1,2})\s*(?:fois|prise|prises)\s*(?:par|\/)\s*jour$/u.exec(text)
    ?? /^(\d{1,2})\s*\/\s*jour$/u.exec(text);
  if (match === null) return null;
  const number = Number(match[1]);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function lineFrequencyForTreatment(
  treatment: TraitementV2,
  lines: PrescriptionResume["lignes"],
): number | null {
  const names = [treatment.medicationRaw, treatment.brandName, treatment.inn]
    .map(clean)
    .filter((name) => name !== "")
    .map(normalized)
    .filter((name) => name.length >= 3);
  if (names.length === 0) return null;

  for (const line of lines) {
    if (line.frequencyPerDay === null || !Number.isInteger(line.frequencyPerDay) || line.frequencyPerDay <= 0) {
      continue;
    }
    const candidate = normalized(clean(line.designation) || clean(line.brandName));
    if (candidate === "") continue;
    if (names.some((name) => name === candidate || name.includes(candidate) || candidate.includes(name))) {
      return line.frequencyPerDay;
    }
  }
  return null;
}

export function explicitDailyFrequency(
  treatment: TraitementV2,
  lastPrescription: PrescriptionResume | null,
): number | null {
  const fromPrescription = lastPrescription === null
    ? null
    : lineFrequencyForTreatment(treatment, lastPrescription.lignes);
  return fromPrescription ?? parseExplicitDailyFrequency(treatment.frequency);
}

/** Une seule ligne par médicament, même si deux sources se recoupent. */
export function uniqueActiveTreatments(source: AutoFillSource): readonly TraitementV2[] {
  const seen = new Set<string>();
  const result: TraitementV2[] = [];
  for (const treatment of source.activeTreatments) {
    if (treatment.status !== "active") continue;
    const key = clean(treatment.medicationId) || normalized(treatmentName(treatment));
    if (key === "" || seen.has(key)) continue;
    if (treatmentName(treatment) === "") continue;
    seen.add(key);
    result.push(treatment);
  }
  return result;
}

/**
 * Texte d'une ligne de certificat. On ne reprend que ce qui existe réellement :
 * le nom, puis le dosage prescrit et la fréquence si le dossier les porte.
 */
export function treatmentCertificateLine(
  treatment: TraitementV2,
  lastPrescription: PrescriptionResume | null = null,
): string {
  const name = treatmentName(treatment);
  if (name === "") return "";
  const dose = [clean(treatment.dose), clean(treatment.doseUnit)].filter((part) => part !== "").join(" ");
  const frequency = explicitDailyFrequency(treatment, lastPrescription);
  const extras: string[] = [];
  if (dose !== "" && !name.toLocaleLowerCase("fr").includes(dose.toLocaleLowerCase("fr"))) extras.push(dose);
  if (frequency !== null) extras.push(`${String(frequency)} fois par jour`);
  return extras.length === 0 ? name : `${name} — ${extras.join(" · ")}`;
}

export function treatmentVariables(values: readonly string[]): Variables {
  const variables: Record<string, string> = {};
  values.forEach((value, index) => {
    variables[`traitement_${String(index + 1)}`] = value;
  });
  return variables;
}

export function treatmentValues(variables: Variables): readonly string[] {
  const indexes = Object.keys(variables)
    .map((key) => ({ key, match: TREATMENT_KEY.exec(key) }))
    .filter((entry): entry is { key: string; match: RegExpExecArray } => entry.match !== null)
    .map((entry) => Number(entry.match[1]))
    .filter((index) => Number.isInteger(index) && index > 0)
    .sort((a, b) => a - b);
  if (indexes.length === 0) return [""];
  const max = indexes[indexes.length - 1] ?? 1;
  return Array.from({ length: max }, (_, index) => clean(variables[`traitement_${String(index + 1)}`]));
}

export function treatmentCount(variables: Variables): number {
  return Math.max(1, treatmentValues(variables).length);
}

function treatmentField(index: number): DocumentNode {
  return {
    type: "field",
    attrs: { name: `vars_traitement_${String(index + 1)}`, value: "" },
  };
}

function treatmentListItem(index: number): DocumentNode {
  return {
    type: "listItem",
    content: [{ type: "paragraph", content: [treatmentField(index)] }],
  };
}

/**
 * Le modèle v2 porte deux puces fixes. Un brouillon peut en porter autant que
 * de traitements actifs : on remplace la liste, jamais le reste du document.
 */
export function withTreatmentCount(content: DocumentContent, count: number): DocumentContent {
  const safeCount = Math.min(Math.max(Math.trunc(count), 1), 50);
  let replaced = false;
  const replaceIn = (node: DocumentNode): DocumentNode => {
    if (!replaced && node.type === "bulletList" && (node.content ?? []).some((child) => {
      if (child.type !== "listItem") return false;
      return JSON.stringify(child).includes("vars_traitement_");
    })) {
      replaced = true;
      return {
        ...node,
        content: Array.from({ length: safeCount }, (_, index) => treatmentListItem(index)),
      };
    }
    if (node.content === undefined) return node;
    return { ...node, content: node.content.map(replaceIn) };
  };
  return replaceIn(content) as DocumentContent;
}

function medicationNode(treatment: TraitementV2, frequency: number | null): DocumentNode {
  const name = treatmentName(treatment);
  return {
    type: "medication",
    attrs: {
      rowId: crypto.randomUUID(),
      medicationId: clean(treatment.medicationId) || null,
      source: clean(treatment.medicationId) === "" ? "free-text" : "catalogue",
      designation: name,
      strength: "",
      posology: frequency === null ? "" : `${String(frequency)} fois par jour`,
      quantity: "",
      frequency: "",
      duration: "",
      administration: "",
      instructions: "",
    },
  };
}

export function withMedicationRows(content: DocumentContent, source: AutoFillSource): DocumentContent {
  const rows = uniqueActiveTreatments(source).map((treatment) =>
    medicationNode(treatment, explicitDailyFrequency(treatment, source.lastPrescription)),
  );
  if (rows.length === 0) return content;
  return {
    ...content,
    content: [
      ...content.content.filter((node) => node.type !== "medication"),
      ...rows,
    ],
  };
}

export function buildAutoFillSource(
  patient: Patient | null,
  workspace: PatientWorkspace | null,
  now: Date = new Date(),
): AutoFillSource {
  return {
    idDocumentNumber: clean(workspace?.identification.idDocumentNumber) || clean(patient?.idDocumentNumber),
    idDocumentIssuer: clean(workspace?.identification.idDocumentIssuer) || clean(patient?.idDocumentIssuer),
    birthDate: workspace?.identite.birthDate ?? patient?.birthDate ?? null,
    today: aujourdHuiCabinet(now),
    activeTreatments: workspace?.traitementsV2?.actifs ?? [],
    lastPrescription: workspace?.traitements?.dernierePrescription ?? null,
  };
}

export function buildInitialVariables(kind: DocumentKind, source: AutoFillSource): Variables {
  switch (kind) {
    case "bonne_sante_mentale":
      return {
        id_document_number: source.idDocumentNumber,
        mairie: source.idDocumentIssuer,
      };
    case "suivi_medical":
      return {
        jours: "",
        jours_lettres: "",
        date_debut: isoVersFr(source.today),
      };
    case "certificat_medical": {
      const lines = uniqueActiveTreatments(source).map((treatment) =>
        treatmentCertificateLine(treatment, source.lastPrescription),
      );
      return {
        date_naissance: isoVersFr(source.birthDate),
        ...treatmentVariables(lines.length === 0 ? [""] : lines),
      };
    }
    case "justification":
      return { date_consultation: isoVersFr(source.today) };
    case "ordonnance":
      return {};
  }
}

export function buildInitialContent(
  kind: DocumentKind,
  baseContent: DocumentContent,
  source: AutoFillSource,
): DocumentContent {
  if (kind === "certificat_medical") {
    return withTreatmentCount(baseContent, treatmentCount(buildInitialVariables(kind, source)));
  }
  if (kind === "ordonnance") {
    return withMedicationRows(baseContent, source);
  }
  return baseContent;
}
