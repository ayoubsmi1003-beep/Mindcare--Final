/**
 * M07 — Expansion bornée (H6) : même lignée, relation explicite, plafond dur.
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * Voisin averti adjacent tiré, voisins banalisés ignorés, en-tête de section,
 * borne à 2 items, provenance préservée par item, plafond 8000 dur (preuve
 * prioritaire, expansions abandonnées entières, rien après le budget).
 */
import { describe, expect, it } from "vitest";

import { decouperDocument, type ChunkDecoupe, type DocumentSource } from "../../src/server/knowledge/decoupage";
import { appliquerPlafondDur, selectionnerExpansion } from "../../src/server/knowledge/expansion";

const SOURCE = "exp-source-1";

function documentDose(): DocumentSource {
  return {
    sourceId: SOURCE,
    titre: "Guide posologie",
    version: "2026-09-01",
    langue: "fr",
    sections: [
      { titre: "Posologie", paragraphes: ["La dose initiale est de 50 mg le matin."] },
      { titre: "Contre-indications", paragraphes: ["Ne jamais associer aux IMAO : risque mortel."] },
      { titre: "Posologie", paragraphes: ["En cas d'oubli, ne pas doubler la dose."] },
    ],
  };
}

describe("sélection bornée (H6)", () => {
  it("le chunk de dose tire l'avertissement adjacent marqué", () => {
    const chunks = decouperDocument(documentDose());
    const dose = chunks[0]!;
    const expansions = selectionnerExpansion(dose, chunks);
    expect(expansions).toHaveLength(1);
    expect(expansions[0]).toMatchObject({ relation: "avertissement-adjacent" });
    expect(expansions[0]?.chunk.texte).toContain("IMAO");
  });

  it("pas de voisins aveugles : section banale ignorée", () => {
    const doc: DocumentSource = {
      sourceId: SOURCE,
      titre: "T",
      version: "v1",
      langue: "fr",
      sections: [
        { titre: "Généralités", paragraphes: ["Premier paragraphe.", "Second paragraphe."] },
      ],
    };
    const chunks = decouperDocument(doc);
    expect(selectionnerExpansion(chunks[0]!, chunks)).toHaveLength(0);
  });

  it("même source/version/langue exigées : lignée étrangère ignorée", () => {
    const chunks = decouperDocument(documentDose());
    const intrus: ChunkDecoupe = { ...chunks[1]!, sourceId: "autre-source" };
    const expansions = selectionnerExpansion(chunks[0]!, [...chunks, intrus]);
    expect(expansions.every((e) => e.chunk.sourceId === SOURCE)).toBe(true);
  });

  it("au plus 2 items, provenance complète par item (jamais de blob)", () => {
    const chunks = decouperDocument(documentDose());
    for (const chunk of chunks) {
      const expansions = selectionnerExpansion(chunk, chunks);
      expect(expansions.length).toBeLessThanOrEqual(2);
      for (const expansion of expansions) {
        expect(expansion.chunk.chunkId).not.toBe("");
        expect(expansion.chunk.sourceId).toBe(SOURCE);
        expect(expansion.chunk.versionSource).toBe("2026-09-01");
      }
    }
  });
});

describe("plafond dur (H6)", () => {
  it("preuves prioritaires, expansions abandonnées entières sous pression", () => {
    const preuves = [{ texte: "a".repeat(7000) }];
    const expansions = [{ texte: "b".repeat(2000) }];
    const { retenus, tronque } = appliquerPlafondDur(preuves, expansions, 8000);
    expect(retenus).toHaveLength(1);
    expect(retenus[0]?.texte).toContain("a");
    expect(tronque).toBe(true);
  });

  it("tout tient → rien coupé", () => {
    const { retenus, tronque } = appliquerPlafondDur([{ texte: "a" }], [{ texte: "b" }], 8000);
    expect(retenus).toHaveLength(2);
    expect(tronque).toBe(false);
  });

  it("preuve trop grosse seule → portée vide + tronque (jamais de demi-preuve)", () => {
    const { retenus, tronque } = appliquerPlafondDur([{ texte: "a".repeat(9000) }], [], 8000);
    expect(retenus).toHaveLength(0);
    expect(tronque).toBe(true);
  });
});
