/**
 * M07 R3 — Backfill : SQL pur du remplissage (testé sans base).
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * Sélection déterministe (`ORDER BY id`, prédicat NULL-ou-dérive),
 * mise à jour mono-instruction (atomicité par construction),
 * gardes `active=0`, inventaire lecture seule. Zéro secret, zéro PII.
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * L'exécution (opérateur `remplir-embeddings.mjs`, `--limite` borné d'abord).
 */
import { describe, expect, it } from "vitest";

import {
  PARAMETRES_RECETTE,
  sqlGardeGlobaleActive,
  sqlGardeSourcesActives,
  sqlInventaire,
  sqlMiseAJourLot,
  sqlSelectionLot,
  sqlUniformiteRecette,
} from "../../scripts/remplir-embeddings-sql.mjs";

// NOTE M08 : les .mjs n'ont pas de declarations et allowJs est false dans le
// programme principal — voir tsconfig.test.json (allowJs local au programme
// de test). Rien ici ne change le runtime ; la session M07 reste
// proprietaire de ces signatures.

const RECETTE = {
  provider: "local-onnx",
  modele: "BAAI/bge-m3",
  version: "5617a9f61b028005a4858fdac845db406aefb181",
  dimensions: 1024,
  normalisation: "l2-native-tete-sentence-embedding-v1",
  instruction_requete: "",
  instruction_document: "",
  distance: "cosine",
  chunker: "struct-v1",
};

describe("sélection du lot : déterministe, NULL-ou-dérive, bornée", () => {
  it("ORDER BY id ASC + LIMIT $1, prédicat NULL ou dérive sur les 9 champs", () => {
    const { texte, params } = sqlSelectionLot(8, RECETTE);
    expect(texte).toContain("ORDER BY id ASC");
    expect(texte).toContain("LIMIT $1");
    expect(texte).toContain("embedding IS NULL");
    for (const colonne of PARAMETRES_RECETTE) {
      expect(texte).toContain(colonne);
    }
    expect(params[0]).toBe(8);
    expect(params).toContain("BAAI/bge-m3");
    expect(params).toContain(1024);
    expect(params).toHaveLength(10);
  });

  it("IS DISTINCT FROM (NULL-safe : une recette absente est une dérive)", () => {
    const { texte } = sqlSelectionLot(8, RECETTE);
    expect(texte).toMatch(/IS DISTINCT FROM/);
    expect(texte).not.toMatch(/[^A-Z]NULL =/);
  });

  it("ramène chunker_version (dérive découpeur = saut journalisé, jamais ré-embedding aveugle)", () => {
    const { texte } = sqlSelectionLot(8, RECETTE);
    expect(texte).toContain("chunker_version");
  });

  it("exclusion optionnelle d'ids déjà vus (anti-boucle sur pochettes dérivées)", () => {
    const sans = sqlSelectionLot(8, RECETTE);
    expect(sans.texte).not.toContain("ANY($11)");
    const avec = sqlSelectionLot(8, RECETTE, ["a", "b"]);
    expect(avec.texte).toContain("NOT (id = ANY($11))");
    expect(avec.params[10]).toEqual(["a", "b"]);
  });
});

describe("mise à jour : UNE instruction par lot (atomique, pas de demi-lot)", () => {
  function lot(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `chunk-${i}`,
      litteral: "[0.1,0.2]",
      ...RECETTE,
    }));
  }

  it("8 lignes → 80 params séquentiels, cast ::public.vector, 9 colonnes recette", () => {
    const { texte, params } = sqlMiseAJourLot(lot(8), RECETTE);
    expect(params).toHaveLength(80);
    expect(texte).toContain("::public.vector");
    expect(texte).toContain("v.dimensions::integer");
    for (const colonne of [
      "embedding_provider",
      "embedding_modele",
      "embedding_version",
      "embedding_dimensions",
      "embedding_normalisation",
      "embedding_instruction_requete",
      "embedding_instruction_document",
      "embedding_distance",
    ]) {
      expect(texte).toContain(colonne);
    }
    expect(texte).toContain("WHERE c.id = v.id");
    expect(params[0]).toBe("chunk-0");
    expect(params[9]).toBe("cosine");
    expect(params[10]).toBe("chunk-1");
  });

  it("une seule instruction (zéro point-virgule intérieur) : tout ou rien", () => {
    const { texte } = sqlMiseAJourLot(lot(3), RECETTE);
    expect(texte.match(/;/g)).toBeNull();
    expect(texte.trim().toUpperCase().startsWith("UPDATE")).toBe(true);
  });

  it("ne touche JAMAIS statut/sources/approbation (9 colonnes recette + embedding)", () => {
    const { texte } = sqlMiseAJourLot(lot(1), RECETTE);
    expect(texte.toLowerCase()).not.toContain("statut");
    expect(texte.toLowerCase()).not.toContain("approv");
    expect(texte.toLowerCase()).not.toContain("knowledge_sources");
  });

  it("lot vide → refus (jamais d'UPDATE sans VALUES)", () => {
    expect(() => sqlMiseAJourLot([], RECETTE)).toThrow(/vide/);
  });
});

describe("gardes : active=0, inventaire, uniformité", () => {
  it("garde staged : compte les actives parmi les ids (rollback R1-miroir)", () => {
    const { texte, params } = sqlGardeSourcesActives(["s1", "s2"]);
    expect(texte).toContain("statut = 'active'");
    expect(texte).toContain("ANY($1)");
    expect(params).toEqual([["s1", "s2"]]);
  });

  it("garde globale : compte TOUTES les actives (post-passe, sans ids)", () => {
    const { texte, params } = sqlGardeGlobaleActive();
    expect(texte).toContain("statut = 'active'");
    expect(texte).not.toContain("ANY");
    expect(params).toEqual([]);
  });

  it("inventaire : une ligne, que des comptes (aucun texte, aucune PII)", () => {
    const { texte, params } = sqlInventaire();
    expect(params).toEqual([]);
    for (const cle of ["chunks", "sans_embedding", "sources", "sources_active", "ext_vector", "migration_092"]) {
      expect(texte).toContain(cle);
    }
    expect(texte.toLowerCase()).not.toContain("texte");
  });

  it("uniformité : compte les lignes embarquées à recette dérivée (cible 0)", () => {
    const { texte, params } = sqlUniformiteRecette(RECETTE);
    expect(texte).toContain("embedding IS NOT NULL");
    expect(params).toContain("BAAI/bge-m3");
  });
});
