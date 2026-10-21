/**
 * Migration legacy Syglab — correspondance déterministe, sans invention.
 *
 * Règles verrouillées par `tests/unit/legacy-migration-mapping.test.ts` :
 * - le nom legacy est préservé verbatim (Pat_nom → last_name, Pat_prenom →
 *   first_name, lus depuis les colonnes d'origine, jamais réordonnés) ;
 * - un téléphone absent reste NULL (décision D2, migration 126) ;
 * - les clés d'idempotence dérivent des IDs legacy, jamais du nom ;
 * - aucune inférence clinique : ce module ne lit jamais le contenu des notes.
 */

import { z } from "zod";

import { fr } from "@/i18n/fr";

import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

/** Identité prête pour la porte `legacy_import_patient`. Champs NULL = absents. */
export interface LegacyPatientIdentity {
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string | null;
  readonly idDocumentNumber: string | null;
}

function verbatim(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Nom + prénom legacy → identité MindCare. Retourne `null` si les deux sont
 * vides : le dossier part en quarantaine, on n'invente pas un nom.
 */
export function toPatientIdentity(
  nom: string | null,
  prenom: string | null,
  tel: string | null,
  cdi: string | null,
): LegacyPatientIdentity | null {
  const lastName = verbatim(nom);
  const firstName = verbatim(prenom);
  if (lastName === "" && firstName === "") return null;
  const phone = verbatim(tel) === "" ? null : verbatim(tel);
  const idDocumentNumber = verbatim(cdi) === "" ? null : verbatim(cdi);
  return { firstName, lastName, phone, idDocumentNumber };
}

/** Chiffres uniquement — appariement doublons et garde CHECK, jamais stocké. */
export function normalizePhoneDigits(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D+/g, "");
}

/**
 * Miroir de `patients_phone_format` (004:30) avec NULL autorisé (126, D2).
 * `false` = rejet explicite, jamais correction silencieuse.
 */
export function isPhoneStorable(phone: string | null): boolean {
  if (phone === null) return true;
  return /^[0-9+ ]{8,20}$/.test(phone);
}

/** Clé d'idempotence stable : `syglab:<kind>:<legacyId>`. */
export function buildIdempotencyKey(
  kind: "patient" | "ordonnance" | "ligne" | "note",
  legacyId: string,
): string {
  return `syglab:${kind}:${legacyId}`;
}

/**
 * Mention de provenance d'une ordonnance historique : numéro legacy préservé,
 * observation verbatim. Sans observation, seul le numéro demeure.
 */
export function buildPrescriptionNotes(
  numero: string,
  observation: string,
): string {
  const obs = verbatim(observation);
  return obs === "" ? `Syglab N°${numero}` : `Syglab N°${numero} — ${obs}`;
}

function erreurSchema(porte: string) {
  return {
    code: "regle-metier" as const,
    message: fr.erreurs["regle-metier"],
    context: `zod:${porte}`,
  };
}

// ---------------------------------------------------------------------------
// Façonnage des lignes d'ordonnance — AUCUN mapping automatique.
// ---------------------------------------------------------------------------

/** Ligne legacy brute lue depuis l'extraction (texte verbatim). */
export interface LegacyPrescriptionLineInput {
  readonly legacyLineId: string;
  readonly legacyMedId: string;
  readonly display: string;
  readonly posologie: string;
  readonly texteLibre: string;
  readonly quantite: string;
  readonly nbrJour: string;
  readonly nbrFois: string;
  readonly qsp: string;
  readonly unresolved: boolean;
}

/** Charge de ligne pour la porte `legacy_import_prescription`. */
export interface PrescriptionLinePayload {
  readonly legacy_line_id: string;
  readonly legacy_med_id: string;
  readonly medication_id: null;
  readonly display: string;
  readonly posologie: string;
  readonly texte_libre: string;
  readonly quantite: string;
  readonly nbr_jour: string;
  readonly nbr_fois: string;
  readonly qsp: string;
  readonly unresolved: boolean;
}

/**
 * `medication_id` reste TOUJOURS NULL à l'import : aucun référentiel croisé
 * faisant autorité n'existe entre les IDs numériques Syglab et les uuids
 * MindCare, et un appariement flou automatique est interdit (§23). Le texte
 * legacy voyage verbatim ; `unresolved` signale les 7 lignes à ID inconnu
 * pour revue humaine. Un futur référentiel validé humainement pourra renseigner
 * `medication_id` — jamais ce code.
 */
export function shapePrescriptionLine(
  input: LegacyPrescriptionLineInput,
): PrescriptionLinePayload {
  return {
    legacy_line_id: input.legacyLineId,
    legacy_med_id: input.legacyMedId,
    medication_id: null,
    display: input.display,
    posologie: input.posologie,
    texte_libre: input.texteLibre,
    quantite: input.quantite,
    nbr_jour: input.nbrJour,
    nbr_fois: input.nbrFois,
    qsp: input.qsp,
    unresolved: input.unresolved,
  };
}

// ---------------------------------------------------------------------------
// Réconciliation source ↔ importé — les deux moitiés viennent d'exécutions.
// ---------------------------------------------------------------------------

export interface MigrationSourceCounts {
  readonly patientsSource: number;
  readonly prescriptionsSource: number;
  readonly orphansSource: number;
}

export interface MergedMigrationReport extends LegacyMigrationReport {
  readonly patientsSource: number;
  readonly prescriptionsSource: number;
  readonly orphansSource: number;
  readonly patientsLost: number;
  readonly prescriptionsLost: number;
  readonly orphansLost: number;
}

/**
 * Toute perte non expliquée (importé < source) fait passer le statut à
 * BLOCKED — un PASS ne peut jamais coexister avec une perte silencieuse.
 */
export function mergeMigrationReports(
  source: MigrationSourceCounts,
  gate: LegacyMigrationReport,
): MergedMigrationReport {
  const patientsLost = Math.max(0, source.patientsSource - gate.patients_imported);
  const prescriptionsLost = Math.max(
    0,
    source.prescriptionsSource - gate.prescriptions_imported,
  );
  const orphansLost = Math.max(0, source.orphansSource - gate.orphans_quarantined);
  const status =
    patientsLost > 0 || prescriptionsLost > 0 || orphansLost > 0
      ? ("BLOCKED" as const)
      : gate.status;
  return {
    ...gate,
    patientsSource: source.patientsSource,
    prescriptionsSource: source.prescriptionsSource,
    orphansSource: source.orphansSource,
    patientsLost,
    prescriptionsLost,
    orphansLost,
    status,
  };
}

// ---------------------------------------------------------------------------
// Lecture du rapport de migration — les comptes viennent de l'exécution.
// ---------------------------------------------------------------------------

const LEGACY_REPORT_ROW = z.object({
  batch_id: z.string(),
  batch_status: z.string(),
  patients_imported: z.coerce.number(),
  histories_imported: z.coerce.number(),
  prescriptions_imported: z.coerce.number(),
  orphans_quarantined: z.coerce.number(),
  reviews_open: z.coerce.number(),
  reviews_total: z.coerce.number(),
  duplicates_pending: z.coerce.number(),
  rtf_integrity_ok: z.boolean(),
  status: z.enum(["PASS", "PASS_WITH_REVIEW", "BLOCKED"]),
});

export type LegacyMigrationReport = z.infer<typeof LEGACY_REPORT_ROW>;

// ---------------------------------------------------------------------------
// File de revue — lecture et résolution humaine.
// ---------------------------------------------------------------------------

const LEGACY_REVIEW_ROW = z.object({
  review_id: z.string(),
  entity_type: z.enum(["patient", "ordonnance", "ligne", "duplicate_group"]),
  source_ref: z.string(),
  issue_type: z.enum([
    "weak_identity",
    "unmatched_medication",
    "orphan",
    "possible_duplicate",
    "missing_date",
  ]),
  status: z.enum(["pending", "confirmed", "rejected", "resolved", "deferred"]),
  proposed_action: z.string().nullable(),
  reviewer: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  resolution: z.string().nullable(),
  created_at: z.string(),
  total_count: z.coerce.number(),
});

export interface LegacyReview {
  readonly reviewId: string;
  readonly entityType: string;
  readonly sourceRef: string;
  readonly issueType: string;
  readonly status: string;
  readonly proposedAction: string | null;
  readonly reviewer: string | null;
  readonly reviewedAt: string | null;
  readonly resolution: string | null;
  readonly createdAt: string;
}

export interface LegacyReviewPage {
  readonly rows: readonly LegacyReview[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

const REVIEW_STATUSES = ["pending", "confirmed", "rejected", "resolved", "deferred"] as const;

export async function listLegacyReviews(
  batchId: string,
  status: string | null,
  limit: number,
  offset: number,
): Promise<Result<LegacyReviewPage>> {
  const clampedLimit = Math.min(Math.max(limit, 1), 100);
  const clampedOffset = Math.max(offset, 0);
  const result = await db().rpc<unknown>("legacy_list_reviews", {
    p_batch_id: batchId,
    p_status: status,
    p_limit: clampedLimit,
    p_offset: clampedOffset,
  });
  if (!result.ok) {
    log.error("migration.revue.liste", logFieldsFor(result.error));
    return err(result.error);
  }
  const rows: LegacyReview[] = [];
  for (const raw of result.data) {
    const parsed = LEGACY_REVIEW_ROW.safeParse(raw);
    if (!parsed.success) {
      log.error("migration.revue.liste", {
        code: "regle-metier",
        context: `zod:${parsed.error.issues.map((i) => i.path.join(".")).join(",")}`,
      });
      return err(erreurSchema("legacy_list_reviews"));
    }
    const r = parsed.data;
    rows.push({
      reviewId: r.review_id,
      entityType: r.entity_type,
      sourceRef: r.source_ref,
      issueType: r.issue_type,
      status: r.status,
      proposedAction: r.proposed_action,
      reviewer: r.reviewer,
      reviewedAt: r.reviewed_at,
      resolution: r.resolution,
      createdAt: r.created_at,
    });
  }
  const total =
    result.data.length > 0
      ? Number(
          (result.data[0] as Record<string, unknown>)["total_count"] ?? rows.length,
        )
      : 0;
  return ok({ rows, total, offset: clampedOffset, limit: clampedLimit });
}

export async function resolveLegacyReview(
  reviewId: string,
  status: string,
  resolution: string | null,
): Promise<Result<void>> {
  if (
    status !== "confirmed" &&
    status !== "rejected" &&
    status !== "resolved" &&
    status !== "deferred"
  ) {
    return err({ code: "regle-metier", message: fr.erreurs["regle-metier"] });
  }
  const result = await db().rpc<unknown>("legacy_resolve_review", {
    p_review_id: reviewId,
    p_status: status,
    p_resolution: resolution,
  });
  if (!result.ok) {
    log.error("migration.revue.trancher", logFieldsFor(result.error));
    return err(result.error);
  }
  return ok(undefined);
}

export async function getLegacyReport(
  batchId: string,
): Promise<Result<LegacyMigrationReport>> {
  const result = await db().rpc<unknown>("legacy_get_report", {
    p_batch_id: batchId,
  });
  if (!result.ok) {
    log.error("migration.rapport", logFieldsFor(result.error));
    return err(result.error);
  }
  const raw = result.data[0] as Record<string, unknown> | undefined;
  if (!raw) {
    return err({ code: "introuvable", message: fr.erreurs.introuvable });
  }
  const parsed = LEGACY_REPORT_ROW.safeParse(raw);
  if (!parsed.success) {
    log.error("migration.rapport", {
      code: "regle-metier",
      context: `zod:${parsed.error.issues.map((i) => i.path.join(".")).join(",")}`,
    });
    return err(erreurSchema("legacy_get_report"));
  }
  return ok(parsed.data);
}
