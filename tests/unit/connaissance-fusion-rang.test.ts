import { describe, expect, it } from "vitest";

import { fusionnerParRang } from "@/server/knowledge/fusion-rang";
import { LIMITES } from "@/server/knowledge/recherche";
import { orchestrerRecherche } from "@/server/knowledge/recherche";
import type { CandidatBrut } from "@/server/knowledge/recherche";

function candidat(chunkId: string, score: number): CandidatBrut {
  return {
    chunkId, sourceId: "source", sourceTitre: "DSM-5 — Manuel diagnostique et statistique des troubles mentaux",
    sourceVersion: "v1", section: "Section", versionChunk: "struct-v2", langue: "fr",
    texte: `Passage ${chunkId}.`, score, unitId: null, parentTexteHash: null, enfantIndex: null, enfantsTotal: null,
  };
}

function ligne(chunkId: string, score: number, extra: Record<string, unknown> = {}) {
  return {
    chunk_id: chunkId, source_id: "source",
    source_titre: "DSM-5 — Manuel diagnostique et statistique des troubles mentaux",
    source_version: "v1", section: "Section", version_chunk: "struct-v2", langue: "fr",
    texte: `Passage ${chunkId} sur le trouble panique.`, score,
    source_statut: "active", source_classification: "C4",
    source_approuvee_le: new Date("2026-01-01"), source_approuvee_par: "practitioner",
    source_revue_a_jour: true, source_remplacee_par: null,
    unit_id: null, parent_texte_hash: null, enfant_index: null, enfants_total: null,
    ...extra,
  };
}

describe("fusion par rang : les scores natifs ne sont jamais additionnés", () => {
  it("fait primer un chunk trouvé par LES DEUX branches sur un chunk d'une seule branche", () => {
    // `deux` est 2e partout ; `lexical-seul` est 1er du lexical mais absent du
    // vectoriel. Deux contributions valent mieux qu'une, quelle que soit la
    // magnitude des scores natifs (ici 0.99 contre 0.2).
    const fusion = fusionnerParRang(
      [candidat("lexical-seul", 0.99), candidat("deux", 0.2)],
      [candidat("vectoriel-seul", 0.95), candidat("deux", 0.2)],
      { limite: 10 },
    );
    expect(fusion.map((c) => c.chunkId)).toEqual(["deux", "lexical-seul", "vectoriel-seul"]);
  });

  it("conserve les deux scores natifs du chunk vu des deux côtés", () => {
    const fusion = fusionnerParRang([candidat("double", 0.8)], [candidat("double", 0.6)], { limite: 10 });
    expect(fusion).toHaveLength(1);
    expect(fusion[0]).toMatchObject({ chunkId: "double", scoreLexical: 0.8, scoreVectoriel: 0.6 });
  });

  it("est déterministe : à rangs égaux, l'ordre suit le chunkId", () => {
    const a = candidat("aaa", 0.5), b = candidat("bbb", 0.5);
    const un = fusionnerParRang([a, b], [], { limite: 10 }).map((c) => c.chunkId);
    const deux = fusionnerParRang([b, a], [], { limite: 10 }).map((c) => c.chunkId);
    // L'ordre d'entrée fixe le rang, donc le score : on vérifie la stabilité
    // du départage sur des rangs strictement égaux (deux branches distinctes).
    expect(un).toEqual(["aaa", "bbb"]);
    expect(deux).toEqual(["bbb", "aaa"]);
    const égal = fusionnerParRang([a], [b], { limite: 10 }).map((c) => c.chunkId);
    expect(égal).toEqual(["aaa", "bbb"]);
  });

  it("borne la sortie et ignore une limite invalide", () => {
    const fusion = fusionnerParRang([candidat("a", 1), candidat("b", 1)], [candidat("c", 1)], { limite: 2 });
    expect(fusion).toHaveLength(2);
    expect(fusionnerParRang([candidat("a", 1)], [], { limite: 0 })).toEqual([]);
  });
});

describe("orchestration : la fusion par rang est explicite, jamais silencieuse", () => {
  it("sélectionne par rang quand elle est demandée et que les deux branches existent", async () => {
    const resultat = await orchestrerRecherche(
      "trouble panique criteres",
      [ligne("lexical", 0.99), ligne("deux", 0.55)],
      [ligne("vectoriel", 0.95), ligne("deux", 0.55)],
      undefined,
      undefined,
      "rang",
    );
    expect(resultat.evidences.map((e) => e.chunkId)).toContain("deux");
    expect(resultat.evidences.every((e) => e.evidence_relevance <= 1)).toBe(true);
  });

  it("garde la fusion par score quand une seule branche est présente", async () => {
    const resultat = await orchestrerRecherche("trouble panique criteres", [ligne("lexical", 0.99)],
      [], undefined, undefined, "rang");
    expect(resultat.evidences.map((e) => e.chunkId)).toEqual(["lexical"]);
    expect(LIMITES.FUSION).toBeGreaterThan(0);
  });
});
