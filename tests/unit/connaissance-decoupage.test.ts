/**
 * M07 — Découpage : structurel, déterministe, versionné.
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * Hiérarchie préservée, identifiants stables à la ré-ingestion, sensibilité
 * au contenu et à la version, bornage des paragraphes pathologiques.
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * La qualité sémantique des frontières (évaluation retrieval, matrice
 * reranker-gain) — ici : déterminisme et identité, rien de plus.
 */
import { describe, expect, it } from "vitest";

import {
  CHUNKER_VERSION,
  decouperDocument,
  hacherTexte,
  LIMITE_PARAGRAPHE,
  normaliserTexte,
  texteIndexable,
  type DocumentSource,
} from "../../src/server/knowledge/decoupage";

const SOURCE = "11111111-1111-1111-8111-111111111111";

function documentExemple(): DocumentSource {
  return {
    sourceId: SOURCE,
    titre: "Guide anxiété",
    version: "2026-09-01",
    langue: "fr",
    sections: [
      {
        titre: "Diagnostic",
        paragraphes: ["Le trouble panique se caractérise par des attaques récurrentes."],
        sousSections: [
          {
            titre: "Critères",
            paragraphes: ["Attaque inattendue suivie d'inquiétude persistante.", ""],
          },
        ],
      },
      { titre: "Traitement", paragraphes: ["La sertraline 50 mg est une option de première intention."] },
    ],
  };
}

describe("hiérarchie préservée", () => {
  it("un chunk par paragraphe non vide, contexte porté", () => {
    const chunks = decouperDocument(documentExemple());
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({
      section: "Diagnostic",
      sousSection: null,
      ordinal: 0,
      langue: "fr",
      versionChunk: CHUNKER_VERSION,
    });
    expect(chunks[1]).toMatchObject({ section: "Diagnostic", sousSection: "Critères", ordinal: 1 });
    expect(chunks[2]).toMatchObject({ section: "Traitement", sousSection: null, ordinal: 2 });
  });

  it("paragraphes vides ignorés : aucun chunk vide", () => {
    const chunks = decouperDocument(documentExemple());
    expect(chunks.every((c) => c.texte !== "")).toBe(true);
  });

  it("texte indexable porte le fil hiérarchique", () => {
    const chunks = decouperDocument(documentExemple());
    const indexable = texteIndexable(chunks[1] ?? { titreSource: "", section: null, sousSection: null, texte: "" });
    expect(indexable).toContain("Guide anxiété");
    expect(indexable).toContain("Critères");
    expect(indexable).toContain("Attaque inattendue");
  });
});

describe("déterminisme et identité (matrice n°23/25)", () => {
  it("même document ingéré deux fois → mêmes chunkId, aucun doublon incontrôlé", () => {
    const premier = decouperDocument(documentExemple());
    const second = decouperDocument(documentExemple());
    expect(second.map((c) => c.chunkId)).toEqual(premier.map((c) => c.chunkId));
    expect(new Set(premier.map((c) => c.chunkId)).size).toBe(premier.length);
  });

  it("paragraphe modifié → nouvelle identité de contenu pour ce chunk seul", () => {
    const avant = decouperDocument(documentExemple());
    const modifie = documentExemple();
    const sections = [...modifie.sections];
    sections[1] = { titre: "Traitement", paragraphes: ["La paroxétine 20 mg est une autre option."] };
    const apres = decouperDocument({ ...modifie, sections });
    expect(apres[2]?.chunkId).not.toBe(avant[2]?.chunkId);
    // Les chunks intacts gardent leur identité (insertion ailleurs sans effet).
    expect(apres[0]?.chunkId).toBe(avant[0]?.chunkId);
    expect(apres[1]?.chunkId).toBe(avant[1]?.chunkId);
  });

  it("changement de version source → nouvelles identités (matrice n°26, dérive détectable)", () => {
    const avant = decouperDocument(documentExemple());
    const apres = decouperDocument({ ...documentExemple(), version: "2026-10-01" });
    expect(apres[0]?.chunkId).not.toBe(avant[0]?.chunkId);
  });

  it("paragraphes jumeaux distingués par occurrence, ordre stable", () => {
    const doc: DocumentSource = {
      sourceId: SOURCE,
      titre: "T",
      version: "v1",
      langue: "ar",
      sections: [{ titre: "S", paragraphes: ["نفس النص.", "نفس النص."] }],
    };
    const chunks = decouperDocument(doc);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.chunkId).not.toBe(chunks[1]?.chunkId);
    expect(chunks[0]?.langue).toBe("ar");
  });
});

describe("robustesse", () => {
  it("paragraphe monstrueux coupé sur phrases, ordre préservé, rien perdu", () => {
    const phrase = "Une phrase clinique complète et autonome. ";
    const doc: DocumentSource = {
      sourceId: SOURCE,
      titre: "T",
      version: "v1",
      langue: "fr",
      sections: [{ titre: "S", paragraphes: [phrase.repeat(100)] }],
    };
    const chunks = decouperDocument(doc);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.texte.length <= LIMITE_PARAGRAPHE || !c.texte.includes(". "))).toBe(true);
    expect(chunks.map((c) => c.texte).join(" ")).toBe(normaliserTexte(phrase.repeat(100)));
  });

  it("normalisation : NFKC + espaces repliés", () => {
    expect(normaliserTexte("  La   sertraline\u00a0 50 mg.  ")).toBe("La sertraline 50 mg.");
  });

  it("hachage stable et sensible", () => {
    expect(hacherTexte("sertraline")).toBe(hacherTexte("sertraline"));
    expect(hacherTexte("sertraline")).not.toBe(hacherTexte("paroxétine"));
  });
});
