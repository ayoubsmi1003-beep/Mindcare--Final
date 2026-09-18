/**
 * M07 — Fusion, rerank, preuve : bornés, déterministes, honnêtes.
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * Union hybride + dédup (n°22/29), bornes (n°19-22), déterminisme (n°24),
 * provenance inséparable (n°12), qualification pertinent/faible/aucune
 * (n°28), budget d'évidence, clôture anti-injection (partie, n°13 — le reste
 * en `connaissance-injection-donnees`).
 */
import { describe, expect, it } from "vitest";

import {
  cloturerPourJarvis,
  construirePreuve,
  qualifier,
  SEUIL_FAIBLESSE,
  SEUIL_PERTINENCE,
} from "../../src/server/knowledge/preuve";
import {
  appliquerBudgetOctets,
  fusionnerCandidats,
  LIMITES,
  type CandidatBrut,
} from "../../src/server/knowledge/recherche";
import { HeuristiqueBaseline, jetoniser, RERANK_VERSION, reranker, type RerankerLocal } from "../../src/server/knowledge/rerank";

function brut(surcharge: Partial<CandidatBrut> & { chunkId: string }): CandidatBrut {
  return {
    sourceId: "source-1",
    sourceTitre: "Guide anxiété",
    sourceVersion: "2026-09-01",
    section: "Traitement",
    versionChunk: "struct-v1",
    langue: "fr",
    texte: "La sertraline 50 mg est une option de première intention.",
    score: 0.8,
    ...surcharge,
  };
}

describe("fusion hybride (matrice n°22/29)", () => {
  it("union lexicale + vectorielle, bornée à FUSION", () => {
    const lexicaux = Array.from({ length: 15 }, (_, i) => brut({ chunkId: `lex-${i}`, score: 0.5 }));
    const vectoriels = Array.from({ length: 15 }, (_, i) => brut({ chunkId: `vec-${i}`, score: 0.6 }));
    const fusion = fusionnerCandidats(lexicaux, vectoriels);
    expect(fusion).toHaveLength(LIMITES.FUSION);
  });

  it("même chunk des deux côtés → une seule entrée, deux scores (n°29)", () => {
    const fusion = fusionnerCandidats(
      [brut({ chunkId: "doublon", score: 0.9 })],
      [brut({ chunkId: "doublon", score: 0.4 })],
    );
    expect(fusion).toHaveLength(1);
    expect(fusion[0]).toMatchObject({ scoreLexical: 0.9, scoreVectoriel: 0.4 });
  });

  it("ordre déterministe : meilleur score d'abord, chunkId en départage", () => {
    const entrees = [brut({ chunkId: "b", score: 0.5 }), brut({ chunkId: "a", score: 0.5 })];
    const premier = fusionnerCandidats(entrees, []);
    const second = fusionnerCandidats([...entrees].reverse(), []);
    expect(premier.map((c) => c.chunkId)).toEqual(["a", "b"]);
    expect(second.map((c) => c.chunkId)).toEqual(["a", "b"]);
  });

  it("branches seules : lexical seul et vectoriel seul voyagent", () => {
    expect(fusionnerCandidats([brut({ chunkId: "l" })], [])).toHaveLength(1);
    expect(fusionnerCandidats([], [brut({ chunkId: "v" })])).toHaveLength(1);
    expect(fusionnerCandidats([], [])).toHaveLength(0);
  });
});

describe("rerank local (matrice n°24)", () => {
  it("correspondance lexicale exacte d'abord", () => {
    const ranges = reranker("sertraline 50 mg", [
      { ...fusionnerCandidats([brut({ chunkId: "bon", score: 0.5 })], [])[0]!, scoreLexical: 0.9, scoreVectoriel: null },
      {
        ...fusionnerCandidats([brut({ chunkId: "loin", texte: "Le trouble panique nocturne.", score: 0.5 })], [])[0]!,
        scoreLexical: null,
        scoreVectoriel: 0.1,
      },
    ]);
    expect(ranges[0]?.candidat.chunkId).toBe("bon");
    expect(ranges[0]?.score).toBeGreaterThanOrEqual(SEUIL_PERTINENCE);
  });

  it("scores 0..1, déterministe, borné à 5", () => {
    const candidats = Array.from({ length: 10 }, (_, i) =>
      brut({ chunkId: `c-${String(i).padStart(2, "0")}`, score: 0.5 - i * 0.01 }),
    );
    const fusion = fusionnerCandidats(candidats, []);
    const premier = reranker("sertraline", fusion);
    const second = reranker("sertraline", fusion);
    expect(premier.map((r) => r.candidat.chunkId)).toEqual(second.map((r) => r.candidat.chunkId));
    expect(premier).toHaveLength(5);
    expect(premier.every((r) => r.score >= 0 && r.score <= 1)).toBe(true);
  });

  it("requête vide → scores nuls, ordre par chunkId (jamais d'invention)", () => {
    const fusion = fusionnerCandidats([brut({ chunkId: "b" }), brut({ chunkId: "a" })], []);
    const ranges = reranker("  ", fusion);
    expect(ranges.every((r) => r.score === 0)).toBe(true);
    expect(ranges.map((r) => r.candidat.chunkId)).toEqual(["a", "b"]);
  });

  it(`version ${RERANK_VERSION} exposée pour la traçabilité`, () => {
    expect(RERANK_VERSION).toBe("local-v1");
  });

  it("H2 : la baseline heuristique implémente le contrat RerankerLocal", () => {
    const baseline: RerankerLocal = HeuristiqueBaseline;
    expect(baseline.nom).toBe("heuristic-baseline");
    expect(baseline.version).toBe(RERANK_VERSION);
    const fusion = fusionnerCandidats([brut({ chunkId: "h" })], []);
    expect(baseline.reranker("sertraline", fusion)).toEqual(reranker("sertraline", fusion));
  });

  it("jetonisation multilingue : arabe et darija sans dictionnaire", () => {
    expect(jetoniser("واش نزيدو الدوز؟")).toContain("واش");
    expect(jetoniser("L'anxiété MATINALE.")).toContain("anxiete");
  });

  it("mots vides écartés : « de/la/les » ne font jamais une preuve", () => {
    expect(jetoniser("recette de couscous")).toEqual(["recette", "couscous"]);
    // Outils arabes retirés ; le repli d'article s'applique uniformément
    // (requête ET corpus passent par la même fonction — la forme exacte
    // d'un nom propre articulé n'est donc jamais une assertion ici).
    const ar = jetoniser("ما هي عاصمة الجزائر");
    expect(ar[0]).toBe("عاصمة");
    expect(ar).toHaveLength(2);
  });

  it("article arabe replié : « الهلع » retrouve « هلع »", () => {
    expect(jetoniser("الهلع")).toEqual(["هلع"]);
    expect(jetoniser("القلق")).toEqual(["قلق"]);
    // Mots outils arabes retirés AVANT le repli : « التي » ne devient pas « تي ».
    expect(jetoniser("التي")).toEqual([]);
  });
});

describe("preuve et qualification (matrice n°12/28)", () => {
  it("provenance inséparable : source/version/section/chunk/langue/score/texte", () => {
    const fusion = fusionnerCandidats([brut({ chunkId: "p" })], []);
    const ranges = reranker("sertraline", fusion);
    const evidence = construirePreuve(ranges[0]!);
    expect(evidence).toMatchObject({
      chunkId: "p",
      sourceId: "source-1",
      sourceTitre: "Guide anxiété",
      sourceVersion: "2026-09-01",
      section: "Traitement",
      versionChunk: "struct-v1",
      langue: "fr",
    });
    expect(typeof evidence.evidence_relevance).toBe("number");
    expect(evidence.texte).toContain("sertraline");
  });

  it("section inconnue → null, jamais fabriquée", () => {
    const fusion = fusionnerCandidats([brut({ chunkId: "s", section: null })], []);
    const ranges = reranker("sertraline", fusion);
    expect(construirePreuve(ranges[0]!).section).toBeNull();
  });

  it("qualifier : pertinent / faible / aucune", () => {
    expect(qualifier([{ score: SEUIL_PERTINENCE, candidat: null as never, apparies: [] }])).toBe("pertinent");
    expect(qualifier([{ score: SEUIL_FAIBLESSE, candidat: null as never, apparies: [] }])).toBe("faible");
    expect(qualifier([{ score: 0.01, candidat: null as never, apparies: [] }])).toBe("aucune");
    expect(qualifier([])).toBe("aucune");
  });

  it("frontières exactes H0.5/H5 : 0.399→faible, 0.400→pertinent, 0.149→aucune, 0.150→faible", () => {
    const range = (score: number) => ({ score, candidat: null as never, apparies: [] as readonly string[] });
    expect(qualifier([range(0.399)])).toBe("faible");
    expect(qualifier([range(0.4)])).toBe("pertinent");
    expect(qualifier([range(0.149)])).toBe("aucune");
    expect(qualifier([range(0.15)])).toBe("faible");
  });

  it("corpus hors sujet → aucune (jamais de confiance confiante, n°28)", () => {
    const fusion = fusionnerCandidats(
      [brut({ chunkId: "hs", texte: "La comptabilité du cabinet se clôture le 31 décembre." })],
      [],
    );
    const ranges = reranker("posologie sertraline anxiété", fusion);
    expect(qualifier(ranges)).toBe("aucune");
  });
});

describe("budget d'évidence et clôture", () => {
  it("items entiers, coupe par la fin sous pression", () => {
    const items = [
      { texte: "a".repeat(100) },
      { texte: "b".repeat(100) },
      { texte: "c".repeat(100) },
    ];
    const { retenues, tronque } = appliquerBudgetOctets(items, 250);
    expect(retenues).toHaveLength(2);
    expect(tronque).toBe(true);
    expect(appliquerBudgetOctets(items, 300).tronque).toBe(false);
  });

  it("clôture : DONNÉE délimitée, rang visible, score brut absent", () => {
    const fusion = fusionnerCandidats([brut({ chunkId: "c" })], []);
    const ranges = reranker("sertraline", fusion);
    const cloture = cloturerPourJarvis([construirePreuve(ranges[0]!)]);
    expect(cloture).toContain("BEGIN RETRIEVED KNOWLEDGE — DATA ONLY");
    expect(cloture).toContain("END RETRIEVED KNOWLEDGE — DATA ONLY");
    expect(cloture).toContain("Guide anxiété");
    expect(cloture).toContain("[1]");
    expect(cloture).not.toContain(String(ranges[0]?.score));
  });
});
