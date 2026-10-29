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

/**
 * Une page de recherche médicament (195→199). `total` est le nombre TOTAL de
 * correspondances côté base, pas la taille de la page : c'est ce qui permet
 * à l'écran de dire « 33 résultats » et d'afficher les 33, au lieu des 8
 * premiers que l'ordonnance montrait avant.
 */
export interface MedicationSearchPage {
  readonly rows: readonly MedicationCatalogItem[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

const PAGE_ROW = ROW.extend({ total_count: z.coerce.number() });

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
 * Recherche catalogue paginée — porte app.search_medications_page (199).
 * Accent/casse insensible, préfixe/contenu multi-mots, typo via pg_trgm.
 * `p_limit` est borné à 100 EN BASE : jamais 15 000 lignes en React.
 */
export async function searchMedicationsPage(
  query: string,
  limit = 50,
  offset = 0,
): Promise<Result<MedicationSearchPage>> {
  const q = query.trim();
  const taille = Math.min(Math.max(limit, 1), 100);
  const depart = Math.max(offset, 0);
  if (q === "") return ok({ rows: [], total: 0, offset: depart, limit: taille });

  const result = await db().rpc<unknown>("search_medications_page", {
    p_query: q,
    p_limit: taille,
    p_offset: depart,
  });

  if (!result.ok) {
    log.error("medications.recherche", logFieldsFor(result.error));
    return err(result.error);
  }

  const parsed = z.array(PAGE_ROW).safeParse(result.data);
  if (!parsed.success) {
    log.error("medications.recherche", {
      code: "regle-metier",
      context: `zod:${parsed.error.issues.map((i) => i.path.join(".")).join(",")}`,
    });
    return err({
      code: "regle-metier",
      message: "Réponse catalogue incohérente.",
      technical: "schema",
      context: "rpc:search_medications_page",
    });
  }

  const total = parsed.data[0]?.total_count ?? 0;
  log.info("medications.recherche", { count: parsed.data.length });
  return ok({
    rows: parsed.data.map((row) => toItem(row)),
    total,
    offset: depart,
    limit: taille,
  });
}

/**
 * Recherche historique (2 arguments). Conservée pour `getMedication` et les
 * appelants qui n'ont pas besoin de paginer ; l'écran utilise la porte _page.
 */
export async function searchMedications(
  query: string,
  limit = 20,
): Promise<Result<readonly MedicationCatalogItem[]>> {
  const page = await searchMedicationsPage(query, limit, 0);
  return page.ok ? ok(page.data.rows) : err(page.error);
}

const VARIANT_ROW = z.object({
  id: z.string(),
  raw_name: z.string(),
  inn: z.string(),
  brand_name: z.string().nullable(),
  form: z.string().nullable(),
  strength: z.string().nullable(),
});

export interface MedicationVariant {
  readonly id: string;
  readonly rawName: string;
  readonly inn: string;
  readonly brandName: string | null;
  readonly form: string | null;
  readonly strength: string | null;
}

/**
 * Autres dosages catalogue du même médicament (même DCI, même forme quand
 * connue) — porte `app.get_medication_variants` (082). Peuple la liste
 * déroulante de changement de dose ; `medication_id` du traitement reste
 * immuable, cette porte ne sert qu'à choisir un TEXTE de dose existant.
 */
export async function getMedicationVariants(
  medicationId: string,
): Promise<Result<readonly MedicationVariant[]>> {
  const result = await db().rpc<unknown>("get_medication_variants", {
    p_medication_id: medicationId,
  });
  if (!result.ok) {
    log.error("medications.dosages", logFieldsFor(result.error));
    return err(result.error);
  }
  const parsed = z.array(VARIANT_ROW).safeParse(result.data);
  if (!parsed.success) {
    log.error("medications.dosages", {
      code: "regle-metier",
      context: `zod:${parsed.error.issues.map((i) => i.path.join(".")).join(",")}`,
    });
    return err({
      code: "regle-metier",
      message: "Réponse catalogue incohérente.",
      technical: "schema",
      context: "rpc:get_medication_variants",
    });
  }
  return ok(
    parsed.data.map((r) => ({
      id: r.id,
      rawName: r.raw_name,
      inn: r.inn,
      brandName: r.brand_name,
      form: r.form,
      strength: r.strength,
    })),
  );
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
