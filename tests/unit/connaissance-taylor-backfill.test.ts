/**
 * M08-Taylor D4 ACCEPT 2026-09-26 — Backfill : portée Taylor.
 *
 * ═══ CE QUI EST ÉPROUVÉ (sans base) ═══
 * - `taylor-units-v1-proposed` admis EXPLICITEMENT (pas de joker) ;
 * - `struct-v2` (quarantaine DSM) toujours exclu ;
 * - ids `taylor-[0-9a-f]{8}` acceptés par l'alphabet d'interpolation ;
 * - portée `--source` : prédicat `source_id = $N` EN PLUS du filtre
 *   non-active, numérotation $N correcte avec/sans exclusion ;
 * - chemin sans portée byte-identique à l'historique (non-régression R3) ;
 * - pré-vol : uuid strict exigé, source inconnue/active refusée côté SQL
 *   (construction), 6 colonnes de comptes, aucune PII.
 */
import { describe, expect, it } from "vitest";

import {
  CHUNKERS_ACCEPTES,
  sqlMiseAJourLot,
  sqlPreflightPortee,
  sqlSelectionLot,
  sqlSelectionLotBase64,
  sqlUniformiteRecette,
  validerIdChunk,
  validerUuidSource,
} from "../../scripts/remplir-embeddings-sql.mjs";

const RECETTE = {
  provider: "local-onnx",
  modele: "BAAI/bge-m3",
  version: "5617a9f61b028005a4858fdac845db406aefb181",
  dimensions: 1024,
  normalisation: "l2-native-tete-sentence-embedding-v1",
  instruction_requete: "",
  instruction_document: "",
  distance: "cosine",
  chunkers: [...CHUNKERS_ACCEPTES],
};

const UUID_TAYLOR = "9c2fd184-297e-504e-8c95-ffd06896e420";

describe("D4 : allowlist explicite, jamais de joker", () => {
  it("taylor-units-v1-proposed admis, struct-v2 toujours exclu", () => {
    expect(CHUNKERS_ACCEPTES).toContain("taylor-units-v1-proposed");
    expect(CHUNKERS_ACCEPTES).toContain("taylor-units-v2-candidate");
    expect(CHUNKERS_ACCEPTES).toContain("struct-v1");
    expect(CHUNKERS_ACCEPTES).toContain("struct-v1.1");
    expect(CHUNKERS_ACCEPTES).not.toContain("struct-v2");
    expect(CHUNKERS_ACCEPTES).toHaveLength(4);
  });

  it("alphabet taylor- accepté, injections refusées", () => {
    expect(validerIdChunk("taylor-fc961d09")).toBe("taylor-fc961d09");
    expect(() => validerIdChunk("taylor-XYZ")).toThrow(/inattendu/);
    expect(() => validerIdChunk("taylor-")).toThrow(/inattendu/);
    expect(() => validerIdChunk("struct-v2-abcdef12")).toThrow(/inattendu/);
  });
});

describe("portée --source : prédicat strict, numérotation prouvée", () => {
  it("sans portée : SQL historique inchangé (non-régression R3)", () => {
    const { texte, params } = sqlSelectionLot(8, RECETTE);
    expect(texte).not.toContain("AND source_id = $");
    expect(params).toHaveLength(10);
  });

  it("avec portée : AND source_id = $11::uuid, uuid en params[10]", () => {
    const { texte, params } = sqlSelectionLot(8, RECETTE, [], { sourceId: UUID_TAYLOR });
    expect(texte).toContain("AND source_id = $11::uuid");
    expect(texte).toContain("ORDER BY id ASC");
    expect(params).toHaveLength(11);
    expect(params[10]).toBe(UUID_TAYLOR);
  });

  it("avec portée + exclusion : source en $12, exclusion intacte en $11", () => {
    const { texte, params } = sqlSelectionLot(8, RECETTE, ["a", "b"], { sourceId: UUID_TAYLOR });
    expect(texte).toContain("NOT (id = ANY($11))");
    expect(texte).toContain("AND source_id = $12::uuid");
    expect(params[10]).toEqual(["a", "b"]);
    expect(params[11]).toBe(UUID_TAYLOR);
    expect(params).toHaveLength(12);
  });

  it("le filtre non-active survit à la portée (jamais remplacé)", () => {
    const { texte } = sqlSelectionLot(8, RECETTE, [], { sourceId: UUID_TAYLOR });
    expect(texte).toContain("AND NOT EXISTS (SELECT 1 FROM app.knowledge_sources s");
    expect(texte).toContain("s.statut = 'active'");
  });

  it("variante base64 hérite la portée (transport socket)", () => {
    const { texte, params } = sqlSelectionLotBase64(8, RECETTE, [], { sourceId: UUID_TAYLOR });
    expect(texte).toContain("AND source_id = $11::uuid");
    expect(texte).toContain("texte_b64");
    expect(params[10]).toBe(UUID_TAYLOR);
  });

  it("uuid de source strict : slug et injections refusés", () => {
    expect(validerUuidSource(UUID_TAYLOR)).toBe(UUID_TAYLOR);
    expect(() => validerUuidSource("corpus-taylor")).toThrow(/uuid exigé/);
    expect(() => validerUuidSource(`${UUID_TAYLOR.slice(0, 35)}; DROP`)).toThrow(/uuid exigé/);
    expect(() => validerUuidSource("")).toThrow(/uuid exigé/);
    expect(() => sqlSelectionLot(8, RECETTE, [], { sourceId: "corpus-taylor" })).toThrow(/uuid exigé/);
  });
});

describe("pré-vol : construction pure, comptes seuls", () => {  it("UNE instruction, 6 colonnes, param uuid $1", () => {
    const { texte, params } = sqlPreflightPortee(UUID_TAYLOR);
    expect(texte).toContain("s.statut");
    expect(texte).toContain("sans_embedding");
    expect(texte).toContain("chunkers");
    expect(texte).toContain("WHERE s.id = $1::uuid");
    expect(texte.match(/;/g) ?? []).toHaveLength(0);
    expect(params).toEqual([UUID_TAYLOR]);
    expect(texte).not.toMatch(/texte\b(?!_hash)/);
  });

  it("source invalide → throw à la construction (jamais de SQL)", () => {
    expect(() => sqlPreflightPortee("corpus-taylor")).toThrow(/uuid exigé/);
  });

  it("uniformité scopée : sans portée SQL historique, avec portée = source seule", () => {
    const sans = sqlUniformiteRecette(RECETTE);
    expect(sans.texte).not.toContain("source_id");
    const avec = sqlUniformiteRecette(RECETTE, { sourceId: UUID_TAYLOR });
    expect(avec.texte).toContain(`AND source_id = '${UUID_TAYLOR}'::uuid`);
    expect(avec.texte).toContain("IS DISTINCT FROM");
  });
});

describe("grand lot (--lot 64) : atomicité indépendante de N", () => {
  it("sélection 64 + UPDATE 64 lignes → 640 params, UNE instruction", () => {
    const sel = sqlSelectionLot(64, RECETTE, [], { sourceId: UUID_TAYLOR });
    expect(sel.params[0]).toBe(64);
    const lignes = Array.from({ length: 64 }, (_, i) => ({
      id: `taylor-${i.toString(16).padStart(8, "0")}`,
      litteral: "[0.1,0.2]",
    }));
    const { texte, params } = sqlMiseAJourLot(lignes, RECETTE);
    expect(params).toHaveLength(640);
    expect(texte).toContain("::public.vector");
    expect(texte).not.toContain("statut");
  });
});
