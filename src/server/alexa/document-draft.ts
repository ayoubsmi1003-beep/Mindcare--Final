import { z } from "zod";

import type { DbPort } from "@/services/db/port";
import { aujourdHuiCabinet } from "@/services/finance-calendrier";
import {
  buildInitialContent,
  buildInitialVariables,
  missingInitialFields,
  type AutoFillPrescription,
  type AutoFillSource,
  type AutoFillTreatment,
} from "@/shared/documents/autofill";
import { parseDocumentContent } from "@/shared/documents/content";
import type { DocumentContent, DocumentKind, Variables } from "@/shared/documents/types";
import { alexaActions } from "@/i18n/alexa-actions";

const patientRow = z.object({
  id: z.uuid(),
  first_name: z.string().min(1).max(200),
  last_name: z.string().min(1).max(200),
  birth_date: z.string().nullable(),
  id_document_number: z.string().nullable(),
  id_document_issuer: z.string().nullable(),
}).passthrough();

const treatmentRow = z.object({
  status: z.enum(["active", "paused", "stopped"]),
  medication_id: z.string(),
  medication_raw: z.string().nullable(),
  brand_name: z.string().nullable(),
  inn: z.string().nullable().optional(),
  dose: z.string().nullable(),
  dose_unit: z.string().nullable(),
  frequency: z.string().nullable(),
}).passthrough();

const prescriptionLine = z.object({
  designation: z.string().nullable(),
  brand_name: z.string().nullable(),
  frequency_per_day: z.number().int().nullable(),
}).passthrough();

const workspaceRow = z.object({
  identite: z.object({ birth_date: z.string().nullable() }).passthrough(),
  identification: z.object({
    id_document_number: z.string().nullable(),
    id_document_issuer: z.string().nullable(),
  }).passthrough(),
  traitements_v2: z.object({ actifs: z.array(treatmentRow) }).passthrough().nullable().optional(),
  traitements: z.object({
    derniere_prescription: z.object({ lignes: z.array(prescriptionLine) }).passthrough().nullable(),
  }).passthrough().nullable().optional(),
}).passthrough();

const templateRow = z.object({
  content_json: z.unknown(),
  title_fr: z.string().min(1).max(200),
  version: z.number().int().positive(),
}).passthrough();

const consultationRow = z.object({
  id: z.uuid(),
  patient_id: z.uuid(),
  started_at: z.string(),
}).passthrough();

export type DocumentDraftResolution =
  | {
      readonly state: "ready";
      readonly patientId: string;
      readonly patientName: string;
      readonly kind: DocumentKind;
      readonly variables: Variables;
      readonly content: DocumentContent;
      readonly templateVersion: number;
    }
  | { readonly state: "missing"; readonly field: string; readonly question: string }
  | { readonly state: "unavailable" };

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function treatmentFromRow(row: z.infer<typeof treatmentRow>): AutoFillTreatment {
  return {
    status: row.status,
    medicationId: row.medication_id,
    medicationRaw: row.medication_raw,
    brandName: row.brand_name,
    inn: row.inn ?? null,
    dose: row.dose,
    doseUnit: row.dose_unit,
    frequency: row.frequency,
  };
}

function prescriptionFromWorkspace(
  workspace: z.infer<typeof workspaceRow> | null,
): AutoFillPrescription | null {
  const prescription = workspace?.traitements?.derniere_prescription ?? null;
  if (prescription === null) return null;
  return {
    lignes: prescription.lignes.map((line) => ({
      designation: line.designation,
      brandName: line.brand_name,
      frequencyPerDay: line.frequency_per_day,
    })),
  };
}

/** Un nombre de jours n'est repris que s'il est explicitement demandé. */
function explicitDays(text: string): number | null {
  const normalized = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const matches = [...normalized.matchAll(/(?<![\p{L}\p{N}])(\d{1,3})\s*(?:jours?|j)\b/gu)];
  if (matches.length !== 1) return null;
  const value = Number(matches[0]![1]);
  return Number.isInteger(value) && value >= 1 && value <= 365 ? value : null;
}

async function readConsultationDate(
  db: Pick<DbPort, "rpc">,
  page: string,
  signal: AbortSignal,
): Promise<string | null> {
  const match = /^\/consultation\/([0-9a-f-]{36})$/iu.exec(page);
  if (!match) return null;
  const id = match[1]!;
  if (!z.uuid().safeParse(id).success) return null;
  const result = await db.rpc<unknown>("get_consultation", { p_id: id });
  signal.throwIfAborted();
  if (!result.ok || result.data.length !== 1) return null;
  const parsed = consultationRow.safeParse(result.data[0]);
  return parsed.success && z.uuid().safeParse(parsed.data.id).success ? parsed.data.started_at : null;
}

function civilDateFromInstant(value: string | null): string | null {
  if (value === null) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time));
}

/**
 * Résout les entrées d'un brouillon de document à partir des seules sources
 * autoritatives disponibles. Le modèle ne fournit jamais ces valeurs : il
 * choisit le type et le patient, puis cette fonction compose le reste.
 */
export async function resolveDocumentDraftInputs(
  db: Pick<DbPort, "rpc">,
  patientId: string,
  kind: DocumentKind,
  text: string,
  page: string,
  signal: AbortSignal,
  now: Date = new Date(),
): Promise<DocumentDraftResolution> {
  if (!z.uuid().safeParse(patientId).success) return { state: "unavailable" };
  signal.throwIfAborted();

  const [patientResult, workspaceResult, templateResult] = await Promise.all([
    db.rpc<unknown>("get_patient", { p_id: patientId }),
    db.rpc<unknown>("get_patient_workspace", { p_id: patientId }),
    db.rpc<unknown>("get_active_document_template", { p_type: kind }),
  ]);
  signal.throwIfAborted();
  if (!patientResult.ok || patientResult.data.length !== 1) return { state: "unavailable" };
  if (!templateResult.ok || templateResult.data.length !== 1) return { state: "unavailable" };

  const patient = patientRow.safeParse(patientResult.data[0]);
  const template = templateRow.safeParse(templateResult.data[0]);
  if (!patient.success || patient.data.id !== patientId || !template.success) {
    return { state: "unavailable" };
  }

  const workspace = workspaceResult.ok && workspaceResult.data.length === 1
    ? workspaceRow.safeParse(workspaceResult.data[0])
    : null;
  const readableWorkspace = workspace?.success ? workspace.data : null;
  const source: AutoFillSource = {
    idDocumentNumber: clean(readableWorkspace?.identification.id_document_number) || clean(patient.data.id_document_number),
    idDocumentIssuer: clean(readableWorkspace?.identification.id_document_issuer) || clean(patient.data.id_document_issuer),
    birthDate: readableWorkspace?.identite.birth_date ?? patient.data.birth_date,
    today: aujourdHuiCabinet(now),
    activeTreatments: (readableWorkspace?.traitements_v2?.actifs ?? []).map(treatmentFromRow),
    lastPrescription: prescriptionFromWorkspace(readableWorkspace),
  };

  let variables = buildInitialVariables(kind, source);
  if (kind === "suivi_medical") {
    const days = explicitDays(text);
    if (days !== null) variables = { ...variables, jours: String(days) };
  }
  if (kind === "justification") {
    const consultationDate = civilDateFromInstant(await readConsultationDate(db, page, signal));
    if (consultationDate !== null) variables = { ...variables, date_consultation: consultationDate.split("-").reverse().join("/") };
  }

  const missing = missingInitialFields(kind, variables);
  if (missing.length > 0) {
    const field = missing[0]!;
    return { state: "missing", field, question: alexaActions.missingDocumentField(field) };
  }

  let content: DocumentContent;
  try {
    const base = parseDocumentContent(template.data.content_json);
    content = buildInitialContent(kind, base, source);
    parseDocumentContent(content);
  } catch {
    return { state: "unavailable" };
  }

  if (kind === "ordonnance" && !content.content.some((node) => node.type === "medication")) {
    return { state: "missing", field: "medicament", question: alexaActions.documentDraftMissingMedication };
  }

  return {
    state: "ready",
    patientId,
    patientName: `${patient.data.first_name} ${patient.data.last_name}`.trim(),
    kind,
    variables,
    content,
    templateVersion: template.data.version,
  };
}
