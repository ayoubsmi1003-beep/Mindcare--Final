/**
 * Le service des échelles — lecture du référentiel, aperçu, enregistrement,
 * historique. Aucun calcul de score ici : la base le fait, dans
 * `app.score_scale`, et rend le total avec sa bande d'interprétation.
 *
 * ⚠️ AUCUNE ÉCRITURE SANS PORTE. Ce fichier ne fait que `db().rpc(...)` vers
 * `list_scales`, `preview_scale_score`, `record_scale_administration` et
 * `get_scale_history`. La RLS, le verrou de séance et la trace d'audit vivent
 * dans la migration 184.
 */

import { z } from "zod";

import { frConsultationCockpit } from "@/i18n/consultation-cockpit";
import { db } from "./db";
import { logFieldsFor, type AppError } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

const OPTION = z
  .object({
    valeur: z.number().int().min(0).max(9),
    libelle: z.string().min(1),
  })
  .strict();

const ITEM = z
  .object({
    id: z.string().min(1),
    texte: z.string().min(1),
    options: z.array(OPTION).min(1),
    risque: z.boolean().optional(),
    alerte: z.string().min(1).optional(),
  })
  .strict();

const BANDE = z
  .object({
    min: z.number().int(),
    max: z.number().int(),
    interpretation: z.string().min(1),
  })
  .strict();

const SCORING = z
  .object({
    methode: z.literal("somme"),
    consigne: z.string().min(1),
    min: z.number().int(),
    max: z.number().int(),
    bandes: z.array(BANDE).min(1),
    source: z.string().min(1),
    note: z.string().min(1),
  })
  .strict();

const ECHELLE_ROW = z
  .object({
    code: z.string().min(1),
    name_fr: z.string().min(1),
    items: z.array(ITEM).min(1),
    scoring: SCORING,
  })
  .strict();

const ALERTE = z
  .object({
    itemId: z.string().min(1),
    valeur: z.number().int(),
    message: z.string().min(1),
  })
  .strict();

const APERCU_ROW = z
  .object({
    total: z.number().int().min(0),
    interpretation: z.string().min(1),
    alertes: z.array(ALERTE),
    consigne: z.string().min(1),
    note: z.string().min(1),
  })
  .strict();

const ADMIN_ROW = z
  .object({
    id: z.string().min(1),
    scale_code: z.string().min(1),
    scale_name: z.string().min(1),
    consultation_id: z.string().nullable(),
    total: z.number().nullable(),
    interpretation: z.string().nullable(),
    administered_at: z.string().min(1),
    responses: z.record(z.string(), z.unknown()),
  })
  .strict();

const RECORD_ROW = ADMIN_ROW.extend({ alertes: z.array(ALERTE) }).strict();

export interface EchelleOption {
  readonly valeur: number;
  readonly libelle: string;
}

export interface EchelleItem {
  readonly id: string;
  readonly texte: string;
  readonly options: readonly EchelleOption[];
  readonly risque?: boolean | undefined;
  readonly alerte?: string | undefined;
}

export interface EchelleBande {
  readonly min: number;
  readonly max: number;
  readonly interpretation: string;
}

export interface EchelleScoring {
  readonly methode: "somme";
  readonly consigne: string;
  readonly min: number;
  readonly max: number;
  readonly bandes: readonly EchelleBande[];
  readonly source: string;
  readonly note: string;
}

export interface EchelleDisponible {
  readonly code: string;
  readonly nom: string;
  readonly items: readonly EchelleItem[];
  readonly scoring: EchelleScoring;
}

export interface AlerteEchelle {
  readonly itemId: string;
  readonly valeur: number;
  readonly message: string;
}

export interface ApercuEchelle {
  readonly total: number;
  readonly interpretation: string;
  readonly alertes: readonly AlerteEchelle[];
  readonly consigne: string;
  readonly note: string;
}

export interface AdministrationEchelle {
  readonly id: string;
  readonly scaleCode: string;
  readonly scaleName: string;
  readonly consultationId: string | null;
  readonly total: number | null;
  readonly interpretation: string | null;
  readonly administeredAt: string;
  readonly responses: Readonly<Record<string, unknown>>;
  readonly alertes?: readonly AlerteEchelle[];
}

function erreurSchema(porte: string): AppError {
  return {
    code: "regle-metier",
    message: frConsultationCockpit.echelles.reponseIncoherente,
    technical: "schema",
    context: `rpc:${porte}`,
  };
}

function versEchelle(row: z.infer<typeof ECHELLE_ROW>): EchelleDisponible {
  return {
    code: row.code,
    nom: row.name_fr,
    items: row.items,
    scoring: row.scoring,
  };
}

function versAdministration(
  row: z.infer<typeof ADMIN_ROW>,
): AdministrationEchelle {
  return {
    id: row.id,
    scaleCode: row.scale_code,
    scaleName: row.scale_name,
    consultationId: row.consultation_id,
    total: row.total,
    interpretation: row.interpretation,
    administeredAt: row.administered_at,
    responses: row.responses,
  };
}

/**
 * Le référentiel actif. Fonction scalaire `jsonb` : `pgPort` déplie un tableau
 * JSON directement dans `data` (pas dans `data[0]`).
 */
export async function listerEchelles(): Promise<Result<readonly EchelleDisponible[]>> {
  const result = await db().rpc<unknown>("list_scales", {});
  if (!result.ok) {
    log.error("scales.liste", logFieldsFor(result.error));
    return err(result.error);
  }
  const analyse = z.array(ECHELLE_ROW).safeParse(result.data);
  if (!analyse.success) {
    log.error("scales.liste", { code: "regle-metier", context: "zod:list_scales" });
    return err(erreurSchema("list_scales"));
  }
  return ok(analyse.data.map(versEchelle));
}

/**
 * L'aperçu est un calcul SERVEUR. Aucun total n'est additionné ici : le jour
 * où un barème pondéré arrive (HDRS/YMRS), l'écran n'aura pas à changer.
 */
export async function apercuScore(
  code: string,
  responses: Readonly<Record<string, number>>,
): Promise<Result<ApercuEchelle | null>> {
  const result = await db().rpc<unknown>("preview_scale_score", {
    p_code: code,
    p_responses: JSON.stringify(responses),
  });
  if (!result.ok) {
    log.error("scales.apercu", logFieldsFor(result.error));
    return err(result.error);
  }
  const row = result.data[0];
  if (row === undefined || row === null) return ok(null);
  const analyse = APERCU_ROW.safeParse(row);
  if (!analyse.success) {
    log.error("scales.apercu", { code: "regle-metier", context: "zod:preview_scale_score" });
    return err(erreurSchema("preview_scale_score"));
  }
  return ok(analyse.data);
}

export async function enregistrerEchelle(input: {
  readonly patientId: string;
  readonly consultationId: string;
  readonly code: string;
  readonly responses: Readonly<Record<string, number>>;
}): Promise<Result<AdministrationEchelle | null>> {
  const result = await db().rpc<unknown>("record_scale_administration", {
    p_patient_id: input.patientId,
    p_consultation_id: input.consultationId,
    p_scale_code: input.code,
    p_responses: JSON.stringify(input.responses),
  });
  if (!result.ok) {
    log.error("scales.enregistrement", logFieldsFor(result.error));
    return err(result.error);
  }
  const row = result.data[0];
  if (row === undefined || row === null) return ok(null);
  const analyse = RECORD_ROW.safeParse(row);
  if (!analyse.success) {
    log.error("scales.enregistrement", {
      code: "regle-metier",
      context: "zod:record_scale_administration",
    });
    return err(erreurSchema("record_scale_administration"));
  }
  return ok({
    ...versAdministration(analyse.data),
    alertes: analyse.data.alertes,
  });
}

export async function historiqueEchelles(
  patientId: string,
  code?: string,
): Promise<Result<readonly AdministrationEchelle[]>> {
  const result = await db().rpc<unknown>("get_scale_history", {
    p_patient_id: patientId,
    p_scale_code: code ?? null,
  });
  if (!result.ok) {
    log.error("scales.historique", logFieldsFor(result.error));
    return err(result.error);
  }
  const analyse = z.array(ADMIN_ROW).safeParse(result.data);
  if (!analyse.success) {
    log.error("scales.historique", {
      code: "regle-metier",
      context: "zod:get_scale_history",
    });
    return err(erreurSchema("get_scale_history"));
  }
  return ok(analyse.data.map(versAdministration));
}
