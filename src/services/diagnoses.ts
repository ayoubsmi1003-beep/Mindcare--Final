/**
 * Les deux gestes diagnostiques — lire une porte, jamais écrire une table.
 *
 * `record_diagnosis` et `resolve_diagnosis` (migration 205) portent le
 * périmètre, le verrou et la trace. Ce fichier ne fait que traduire la ligne
 * SQL vers le type `Diagnostic` déjà consommé par le dossier patient.
 */

import { z } from "zod";

import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";
import type { Diagnostic } from "./patients";

const LIGNE = z
  .object({
    id: z.string(),
    code_system: z.string(),
    code: z.string().nullable(),
    label: z.string(),
    is_primary: z.boolean(),
    onset_date: z.string().nullable(),
    resolved_at: z.string().nullable(),
  })
  .strict();

function versDiagnostic(row: z.infer<typeof LIGNE>): Diagnostic {
  return {
    id: row.id,
    codeSystem: row.code_system,
    code: row.code,
    label: row.label,
    isPrimary: row.is_primary,
    onsetDate: row.onset_date,
    resolvedAt: row.resolved_at,
  };
}

export interface NouveauDiagnostic {
  readonly patientId: string;
  readonly label: string;
  readonly codeSystem?: string;
  readonly code?: string | null;
  readonly isPrimary?: boolean;
  readonly onsetDate?: string | null;
}

/**
 * `null` signifie « patient absent ou hors périmètre », pas une panne : la
 * porte ne distingue pas les deux (ADR-003).
 */
export async function enregistrerDiagnostic(
  input: NouveauDiagnostic,
): Promise<Result<Diagnostic | null>> {
  const result = await db().rpc<z.infer<typeof LIGNE>>("record_diagnosis", {
    p_patient_id: input.patientId,
    p_label: input.label.trim(),
    p_code_system: input.codeSystem ?? "ICD-10",
    p_code: input.code?.trim() === "" ? null : input.code?.trim() ?? null,
    p_is_primary: input.isPrimary ?? false,
    p_onset_date: input.onsetDate ?? null,
  });
  if (!result.ok) {
    log.error("diagnoses.enregistrement", logFieldsFor(result.error));
    return err(result.error);
  }
  const row = result.data[0];
  if (row === undefined) return ok(null);
  const parsed = LIGNE.safeParse(row);
  if (!parsed.success) {
    log.error("diagnoses.enregistrement", { code: "regle-metier", context: "zod:record_diagnosis" });
    return err({
      code: "regle-metier",
      message: "La réponse de la porte diagnostic ne respecte pas le contrat attendu.",
      technical: "schema",
      context: "rpc:record_diagnosis",
    });
  }
  return ok(versDiagnostic(parsed.data));
}

export async function resoudreDiagnostic(
  id: string,
  resolvedAt?: string,
): Promise<Result<Diagnostic | null>> {
  const result = await db().rpc<z.infer<typeof LIGNE>>("resolve_diagnosis", {
    p_id: id,
    p_resolved_at: resolvedAt ?? null,
  });
  if (!result.ok) {
    log.error("diagnoses.resolution", logFieldsFor(result.error));
    return err(result.error);
  }
  const row = result.data[0];
  if (row === undefined) return ok(null);
  const parsed = LIGNE.safeParse(row);
  if (!parsed.success) {
    log.error("diagnoses.resolution", { code: "regle-metier", context: "zod:resolve_diagnosis" });
    return err({
      code: "regle-metier",
      message: "La réponse de la porte diagnostic ne respecte pas le contrat attendu.",
      technical: "schema",
      context: "rpc:resolve_diagnosis",
    });
  }
  return ok(versDiagnostic(parsed.data));
}
