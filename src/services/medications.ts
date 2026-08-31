/**
 * Catalogue médicaments — ADR-028, 073.
 * Recherche côté base (<300ms), jamais 15k lignes en React.
 * Le parser est advisory ; source_raw_value reste l'autorité.
 */

import { z } from "zod";

import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

export interface MedicationCatalogItem {
  readonly id: string;
  readonly rawName: string;
  readonly inn: string;
  readonly brandName: string | null;
  readonly form: string | null;
  readonly strength: string | null;
  readonly normalizedName: string | null;
  readonly source: string;
  readonly rank: number;
}

const ROW = z.object({
  id: z.string(),
  raw_name: z.string(),
  inn: z.string(),
  brand_name: z.string().nullable(),
  form: z.string().nullable(),
  strength: z.string().nullable(),
  normalized_name: z.string().nullable(),
  source: z.string(),
  rank: z.coerce.number(),
});

function toItem(r: z.infer<typeof ROW>): MedicationCatalogItem {
  return {
    id: r.id,
    rawName: r.raw_name,
    inn: r.inn,
    brandName: r.brand_name,
    form: r.form,
    strength: r.strength,
    normalizedName: r.normalized_name,
    source: r.source,
    rank: r.rank,
  };
}

/**
 * Recherche catalogue — porte app.search_medications.
 * Accent/casse insensible, prefix-friendly, typo via pg_trgm.
 * p_query vide => [] (pas d'export).
 */
export async function searchMedications(
  query: string,
  limit = 20,
): Promise<Result<readonly MedicationCatalogItem[]>> {
  const q = query.trim();
  if (q === "") return ok([]);

  const result = await db().rpc<unknown>("search_medications", {
    p_query: q,
    p_limit: Math.min(Math.max(limit, 1), 50),
  });

  if (!result.ok) {
    log.error("medications.recherche", logFieldsFor(result.error));
    return err(result.error);
  }

  const parsed = z.array(ROW).safeParse(result.data);
  if (!parsed.success) {
    log.error("medications.recherche", {
      code: "regle-metier",
      context: `zod:${parsed.error.issues.map((i) => i.path.join(".")).join(",")}`,
    });
    return err({
      code: "regle-metier",
      message: "Réponse catalogue incohérente.",
      technical: "schema",
      context: "rpc:search_medications",
    });
  }

  log.info("medications.recherche", { count: parsed.data.length });
  return ok(parsed.data.map(toItem));
}

export async function getMedication(
  id: string,
): Promise<Result<MedicationCatalogItem | null>> {
  // Pas de porte dédiée : lecture via search avec filtre interne n'est pas exposée.
  // On passe par select si besoin futur, sinon via searchMedications avec exact.
  // Pour l'heure, lecture directe désactivée — catalogue via search uniquement.
  const all = await searchMedications(id, 1);
  if (!all.ok) return err(all.error);
  return ok(all.data[0] ?? null);
}
