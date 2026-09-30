/**
 * M07 — Stockage : l'autorité vit dans le SQL (proposition porte A, H1).
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * Les deux portes proposées filtrent la JOINTURE chunk→source sur
 * `C4 + active + approved + revue + non-superseded` DANS le SQL (matrice
 * n°11) ; unicité tenant-sûre partielle (H0.1) ; HNSW, jamais IVFFLAT ;
 * autorité tenant unique via `source_id` (H0.2 — aucun `cabinet_id` chunk).
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * L'exécution réelle (exige la migration 092 + `MINDCARE_TEST_DATABASE_URL`,
 * sinon NOT RUN). La migration appliquée fera foi sur le SQL final.
 */
import { describe, expect, it } from "vitest";

import {
  COLONNES_CHUNK,
  COLONNES_LIGNEE,
  FILTRE_AUTORITE_SQL,
  GARDE_LIGNEE_SQL,
  INDEX_HNSW_SQL,
  INDEX_UNICITE_SQL,
  PORTES,
  porteLexicale,
  porteVectorielle,
  sqlPorteLexicalePropose,
  sqlPorteVectoriellePropose,
  TABLES,
  validerLignePorte,
} from "../../src/server/knowledge/stockage";

describe("autorité source dans le SQL (matrice n°11, H1)", () => {
  for (const [nom, sql] of [
    ["lexicale", sqlPorteLexicalePropose()],
    ["vectorielle", sqlPorteVectoriellePropose()],
  ] as const) {
    it(`porte ${nom} : jointure chunk→source + filtre complet du défaut`, () => {
      expect(sql).toContain(`JOIN ${TABLES.SOURCES} s ON s.id = c.source_id`);
      expect(sql).toContain("s.classification = 'C4'");
      expect(sql).toContain("s.statut = 'active'");
      expect(sql).toContain("s.approved_at IS NOT NULL");
      expect(sql).toContain("s.approved_by IS NOT NULL");
      expect(sql).toContain("s.review_due_at");
      expect(sql).toContain("s.superseded_by IS NULL");
      // Le statut du chunk seul ne suffit pas : les DEUX côtés sont filtrés.
      expect(sql).toContain("c.statut = 'active'");
      expect(sql).toContain(FILTRE_AUTORITE_SQL);
    });

    it(`porte ${nom} : bornée, colonnes fermées + attestation, rien de patient`, () => {
      expect(sql).toMatch(/LIMIT LEAST\(GREATEST\(\$\d::int, 1\), 20\)/);
      for (const colonne of COLONNES_CHUNK) expect(sql).toContain(colonne);
      // D3-A : la lignée voyage avec chaque chunk (nullable côté base).
      for (const colonne of COLONNES_LIGNEE) expect(sql).toContain(colonne);
      // Défense en profondeur : l'attestation voyage avec chaque chunk.
      expect(sql).toContain("source_statut");
      expect(sql).toContain("source_classification");
      expect(sql).toContain("source_approuvee_le");
      expect(sql).toContain("source_approuvee_par");
      expect(sql).toContain("source_revue_a_jour");
      expect(sql).toContain("source_remplacee_par");
      expect(sql).not.toContain("*");
      expect(sql.toLowerCase()).not.toContain("patient");
      expect(sql.toLowerCase()).not.toContain("audit");
    });

    it(`porte ${nom} : aucune autorité tenant sur le chunk (H0.2)`, () => {
      // L'autorité tenant vit dans sources.cabinet_id, atteinte par jointure.
      // Un `c.cabinet_id` serait une seconde autorité en attente de divergence.
      expect(sql).not.toContain("c.cabinet_id");
    });

    // Parité stricte avec `092_knowledge_rag.sql` : les portes n'incluent
    // pas `public` dans leur search_path (motif 003).
    if (nom === "lexicale") {
      it("porte lexicale : FTS via app.immutable_unaccent qualifié", () => {
        expect(sql).toContain("app.immutable_unaccent($1)");
        expect(sql).not.toMatch(/(?<![\w.])unaccent\(\$1\)/);
      });
    }
  }

  it("porte vectorielle : opérateur et type qualifiés (092)", () => {
    const sql = sqlPorteVectoriellePropose();
    expect(sql).toContain("OPERATOR(public.<=>)");
    expect(sql).toContain("$1::public.vector");
  });

  it("aucune porte sans filtre d'autorité : le filtre est partagé, pas copié", () => {
    // Si un futur troisième accès oublie la jointure, CE test nomme l'écart :
    // le filtre canonique vit dans FILTRE_AUTORITE_SQL, en un seul exemplaire.
    expect(FILTRE_AUTORITE_SQL.split("AND")).toHaveLength(7);
  });
});

describe("unicité tenant-sûre (H0.1)", () => {
  it("partagé : UNIQUE (titre, version) WHERE cabinet_id IS NULL", () => {
    expect(INDEX_UNICITE_SQL).toContain(
      "UNIQUE INDEX knowledge_sources_partage ON app.knowledge_sources (titre, version) WHERE cabinet_id IS NULL;",
    );
  });

  it("cabinet : UNIQUE (cabinet_id, titre, version) WHERE cabinet_id IS NOT NULL", () => {
    expect(INDEX_UNICITE_SQL).toContain(
      "UNIQUE INDEX knowledge_sources_cabinet ON app.knowledge_sources (cabinet_id, titre, version) WHERE cabinet_id IS NOT NULL;",
    );
  });

  it("chunks : identité stable sans tenant (l'autorité vient de la source)", () => {
    expect(INDEX_UNICITE_SQL).toContain(
      "UNIQUE INDEX knowledge_chunks_identite ON app.knowledge_chunks (source_id, section, sous_section, texte_hash, occurrence);",
    );
  });
});

describe("index vectoriel HNSW, jamais IVFFLAT (H1)", () => {
  it("HNSW cosine avec m et ef_construction explicites", () => {
    expect(INDEX_HNSW_SQL).toContain("USING hnsw (embedding vector_cosine_ops)");
    expect(INDEX_HNSW_SQL).toContain("m = 16");
    expect(INDEX_HNSW_SQL).toContain("ef_construction = 64");
  });

  it("aucune trace d'IVFFLAT dans la proposition", () => {
    expect(INDEX_HNSW_SQL.toLowerCase()).not.toContain("ivfflat");
    expect(sqlPorteLexicalePropose().toLowerCase()).not.toContain("ivfflat");
    expect(sqlPorteVectoriellePropose().toLowerCase()).not.toContain("ivfflat");
  });
});

describe("lignée de supersession (H1)", () => {
  it("garde anti auto-supersession proposée", () => {
    expect(GARDE_LIGNEE_SQL).toContain("superseded_by");
  });
});

describe("appels de portes (contrat DbPort.rpc)", () => {
  it("porte lexicale : signature installée, limite scalaire bornée, historique exclu", () => {
    const appel = porteLexicale("sertraline", "fr", 99);
    expect(appel.porte).toBe(PORTES.LEXICALE);
    expect(appel.args).toEqual({ p_requete: "sertraline", p_langue: "fr", p_limite: 20 });
    expect(porteLexicale("x", "ar", 0).args["p_limite"]).toBe(1);
  });

  it("porte vectorielle : embedding en JSON texte (RpcArgs scalaire), limite bornée", () => {
    const appel = porteVectorielle("[0.1,0.2]", 50);
    expect(appel.porte).toBe(PORTES.VECTORIELLE);
    expect(typeof appel.args["p_embedding_json"]).toBe("string");
    expect(appel.args["p_limite"]).toBe(20);
  });
});

describe("D3-A : lignée optionnelle validée strictement, jamais exigée", () => {
  const ligneValide = () => ({
    chunk_id: "taylor-abcdef12",
    source_id: "9c2fd184-297e-504e-8c95-ffd06896e420",
    source_titre: "The Maudsley Prescribing Guidelines in Psychiatry",
    source_version: "sha256:14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0",
    section: "X",
    version_chunk: "taylor-units-v1-proposed",
    langue: "en",
    texte: "extrait",
    score: 0.5,
    source_statut: "active",
    source_classification: "C4",
    source_approuvee_le: "2026-09-26T00:00:00.000Z",
    source_approuvee_par: "fixture",
    source_revue_a_jour: true,
    source_remplacee_par: null,
  });

  it("lignée absente : ligne acceptée, lignée null (rétro-compatibilité v1)", () => {
    const l = validerLignePorte(ligneValide());
    expect(l).not.toBeNull();
    expect(l?.unit_id).toBeNull();
    expect(l?.enfant_index).toBeNull();
  });

  it("lignée complète : transportée telle quelle", () => {
    const l = validerLignePorte({
      ...ligneValide(),
      unit_id: "tu-fc961d09",
      parent_texte_hash: "abcdef12",
      enfant_index: 1,
      enfants_total: 3,
    });
    expect(l?.unit_id).toBe("tu-fc961d09");
    expect(l?.enfant_index).toBe(1);
    expect(l?.enfants_total).toBe(3);
  });

  it("lignée corrompue : ligne écartée (sens fermé, jamais de lignée bricolée)", () => {
    expect(validerLignePorte({ ...ligneValide(), unit_id: 42 })).toBeNull();
    expect(validerLignePorte({ ...ligneValide(), enfant_index: -1 })).toBeNull();
    expect(validerLignePorte({ ...ligneValide(), enfant_index: 1.5 })).toBeNull();
    expect(validerLignePorte({ ...ligneValide(), enfants_total: "3" })).toBeNull();
  });
});
