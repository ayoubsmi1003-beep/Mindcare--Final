import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DIMENSION_VECTEUR_SECONDAIRE,
  PORTES,
  porteVectorielle,
  porteVectorielleV2,
  sqlPorteVVectorielleV2Propose,
} from "@/server/knowledge/stockage";

describe("porte vectorielle secondaire (188) : identité de modèle obligatoire", () => {
  it("transmet exactement les quatre paramètres installés", () => {
    expect(porteVectorielleV2("[1,0]", "intfloat/multilingual-e5-small", "614241f", 24)).toEqual({
      porte: "search_knowledge_vector_v2",
      args: {
        p_embedding_json: "[1,0]",
        p_modele: "intfloat/multilingual-e5-small",
        p_version: "614241f",
        p_limite: 24,
      },
    });
  });

  it("borne à 40 candidats et refuse une identité vide", () => {
    expect(porteVectorielleV2("[0]", "m", "v", 999).args["p_limite"]).toBe(40);
    expect(porteVectorielleV2("[0]", "m", "v", 0).args["p_limite"]).toBe(1);
    expect(() => porteVectorielleV2("[0]", "  ", "v", 10)).toThrow(/IDENTITE_MANQUANTE/u);
    expect(() => porteVectorielleV2("[0]", "m", "", 10)).toThrow(/IDENTITE_MANQUANTE/u);
  });

  it("ne change pas la borne de l'ancienne porte (20)", () => {
    expect(porteVectorielle("[0]", 999).args["p_limite"]).toBe(20);
    expect(PORTES.VECTORIELLE).toBe("search_knowledge_vector");
    expect(PORTES.VECTORIELLE_V2).toBe("search_knowledge_vector_v2");
    expect(DIMENSION_VECTEUR_SECONDAIRE).toBe(384);
  });

  it("le SQL proposé garde le KNN avant l'autorité et l'égalité modele/version", () => {
    const sql = sqlPorteVVectorielleV2Propose();
    expect(sql).toContain("AS MATERIALIZED");
    expect(sql).toContain("v.modele = $2");
    expect(sql).toContain("v.version = $3");
    expect(sql).toContain("s.classification = 'C4'");
    expect(sql).toContain("s.approved_at IS NOT NULL");
    expect(sql).toContain("s.approved_by IS NOT NULL");
    expect(sql).toContain("s.superseded_by IS NULL");
    expect(sql).toContain("c.statut = 'active'");
    expect(sql).toContain("LIMIT LEAST(GREATEST($4::int, 1), 40)");
    expect(sql).toContain("app.knowledge_chunk_vectors");
  });
});

describe("migration 188 : contrat de schéma et de porte", () => {
  const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "188_knowledge_chunk_vectors.sql"), "utf8");

  it("crée une table séparée, versionnée, sans toucher 092", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS app.knowledge_chunk_vectors");
    expect(sql).toContain("PRIMARY KEY (chunk_id, modele, version)");
    expect(sql).toContain("CHECK (dimensions = 384)");
    expect(sql).toContain("public.vector(384)");
    expect(sql).toContain("knowledge_chunk_vectors_hnsw");
    expect(sql).not.toMatch(/ALTER TABLE app\.knowledge_chunks\b/u);
    expect(sql).not.toMatch(/DROP TABLE (IF EXISTS )?app\.knowledge_chunks\b/u);
    expect(sql).not.toMatch(/DROP COLUMN/u);
  });

  it("installe une porte SECURITY DEFINER avec filtre d'autorité et droits fermés", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION app.search_knowledge_vector_v2");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = app, audit, pg_catalog");
    expect(sql).toContain("OWNER TO app_gatekeeper");
    expect(sql).toContain("REVOKE ALL ON FUNCTION app.search_knowledge_vector_v2(text, text, text, integer) FROM PUBLIC");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION app.search_knowledge_vector_v2(text, text, text, integer) TO authenticated");
    expect(sql).toContain("hnsw.iterative_scan");
    expect(sql).toContain("AS MATERIALIZED");
    expect(sql).toContain("INSERT INTO app.schema_migrations (version) VALUES ('188_knowledge_chunk_vectors')");
  });

  it("ne se déclare jamais appliquée par le code applicatif", () => {
    expect(sql).toContain("Aucun backfill : la table naît vide");
    expect(sql).toContain("Aucune activation");
  });
});
