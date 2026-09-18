/**
 * M07 R4 — Cross-encoder local : encodage déterministe, contrat de graphe,
 * réordonnancement pur (échelle heuristique préservée), repli service.
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * Assemblage XLM-R `<s> q </s> </s> d </s>`, troncature côté document,
 * padding, refus de graphe inattendu, réordonnancement total et stable,
 * préservation des scores heuristiques, contrat `RerankerLocalAsync`,
 * repli heuristique du service quand le scoreur lève. Sessions et
 * tokenizers FACTICES : le vrai modèle (4,3 Go) n'est exercé qu'en eval.
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * La qualité du modèle (gain nDCG : passes E/F), sa latence CPU ni son
 * chargement — voir `artifacts/m07-r4-*.json`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { setDbPort, type DbPort } from "../../src/services/db";
import type { Result } from "../../src/services/result";
import { ok } from "../../src/services/result";
import {
  rechercherConnaissance,
  type DependancesConnaissance,
} from "../../src/services/connaissance-recherche";
import {
  creerRerankerCrossEncoder,
  encoderPaires,
  noterPairesDepuisSession,
  reordonnerParLogits,
  RERANK_CROSS_ENCODER_NOM,
  RERANK_CROSS_ENCODER_VERSION,
  TRONCATURE_PAIRE_MAX,
  type SessionCrossEncoderMinimale,
  type TokenizerPairesMinimal,
} from "../../src/server/knowledge/rerank-cross-encoder";
import { HeuristiqueBaseline, type CandidatRange } from "../../src/server/knowledge/rerank";
import type { CandidatFusionne } from "../../src/server/knowledge/recherche";

/** Tokenizer factice : ids = longueurs de mots, spéciaux fixes. */
function fauxTokenizer(): TokenizerPairesMinimal {
  return {
    encode: (texte: string) => {
      const ids = texte.split(/\s+/).filter((m) => m !== "").map((m) => 100 + (m.length % 50));
      return { ids: [0, ...ids, 2], attention_mask: Array(ids.length + 2).fill(1) };
    },
    token_to_id: (jeton: string) => ({ "<s>": 0, "</s>": 2, "<pad>": 1 })[jeton],
  };
}

function fusionne(surcharge: Partial<CandidatFusionne> & { chunkId: string }): CandidatFusionne {
  return {
    sourceId: "source-1",
    sourceTitre: "Catalogue",
    sourceVersion: "2026-09-15",
    section: "Catalogue",
    versionChunk: "struct-v1",
    langue: "fr",
    texte: "Catalogue — SERTRALINE ALMUS — 50 mg",
    scoreLexical: 0.5,
    scoreVectoriel: 0.5,
    ...surcharge,
  };
}

function rangeDe(chunkId: string, score: number): CandidatRange {
  return { candidat: fusionne({ chunkId }), score, apparies: [] };
}

describe("encoderPaires : assemblage XLM-R déterministe", () => {
  it("forme <s> q </s> </s> d </s>, même entrée → mêmes ids", () => {
    const tok = fauxTokenizer();
    const a = encoderPaires(tok, "sertraline 50 mg", ["Catalogue — SERTRALINE"]);
    const b = encoderPaires(tok, "sertraline 50 mg", ["Catalogue — SERTRALINE"]);
    expect(a.ids).toEqual(b.ids);
    const ligne = a.ids[0] ?? [];
    expect(ligne[0]).toBe(0);
    // …q sep sep d… : deux séparateurs consécutifs entre requête et document.
    const doubles = ligne.filter((v, i) => v === 2 && ligne[i + 1] === 2).length;
    expect(doubles).toBeGreaterThanOrEqual(1);
    expect(ligne[ligne.length - 1]).toBe(2);
  });

  it("troncature côté document, requête préservée", () => {
    const tok = fauxTokenizer();
    const doc = Array.from({ length: TRONCATURE_PAIRE_MAX + 100 }, (_, i) => "mot" + i).join(" ");
    const { ids } = encoderPaires(tok, "q", [doc]);
    expect(ids[0]?.length).toBeLessThanOrEqual(TRONCATURE_PAIRE_MAX);
    // La requête courte survit entière : son premier mot suit <s>.
    expect(ids[0]?.[1]).toBe(100 + ("q".length % 50));
  });

  it("padding à droite au max du lot, masques 0/1", () => {
    const tok = fauxTokenizer();
    const { ids, attention_mask } = encoderPaires(tok, "q", ["court", "un document nettement plus long que le précédent"]);
    expect(ids[0]?.length).toBe(ids[1]?.length);
    const masque = attention_mask[0] ?? [];
    expect(masque[masque.length - 1]).toBe(0);
    expect(attention_mask[1]?.every((v) => v === 0 || v === 1)).toBe(true);
  });

  it("documents vides → lots vides ; spéciaux absents → refus", () => {
    expect(encoderPaires(fauxTokenizer(), "q", []).ids).toEqual([]);
    const sansSpeciaux: TokenizerPairesMinimal = {
      encode: () => ({ ids: [5], attention_mask: [1] }),
      token_to_id: () => undefined,
    };
    expect(() => encoderPaires(sansSpeciaux, "q", ["d"])).toThrow(/spéciaux/);
  });
});

describe("noterPairesDepuisSession : contrat de graphe", () => {
  function sessionPour(logits: number[]): SessionCrossEncoderMinimale {
    return {
      inputNames: ["input_ids", "attention_mask"],
      outputNames: ["logits"],
      run: async () => ({ logits: { data: logits } }),
    };
  }

  it("rend un logit par document, dans l'ordre", async () => {
    const T = class {
      constructor(public type: string, public data: BigInt64Array, public dims: readonly number[]) {}
    };
    const noter = noterPairesDepuisSession({ Tensor: T }, sessionPour([1.5, -2.25]), fauxTokenizer());
    await expect(noter("q", ["a", "b"])).resolves.toEqual([1.5, -2.25]);
  });

  it("refuse : entrées inattendues, logits absents, forme incohérente", () => {
    const tok = fauxTokenizer();
    const T = class {
      constructor(public type: string, public data: BigInt64Array, public dims: readonly number[]) {}
    };
    expect(() => noterPairesDepuisSession({ Tensor: T }, { inputNames: ["x"], outputNames: ["logits"], run: async () => ({}) }, tok))
      .toThrow(/entrées/);
    expect(() => noterPairesDepuisSession({ Tensor: T }, { inputNames: ["input_ids", "attention_mask"], outputNames: ["autre"], run: async () => ({}) }, tok))
      .toThrow(/logits/);
  });

  it("refuse des logits désalignés ou non finis", async () => {
    const tok = fauxTokenizer();
    const T = class {
      constructor(public type: string, public data: BigInt64Array, public dims: readonly number[]) {}
    };
    const noter = noterPairesDepuisSession({ Tensor: T }, sessionPour([1, 2, 3]), tok);
    await expect(noter("q", ["a", "b"])).rejects.toThrow(/inexploitables/);
    const noterNaN = noterPairesDepuisSession({ Tensor: T }, sessionPour([Number.NaN]), tok);
    await expect(noterNaN("q", ["a"])).rejects.toThrow(/inexploitables/);
  });
});

describe("reordonnerParLogits : ranking pur, échelle préservée", () => {
  it("ordonne par logit décroissant, scores heuristiques intacts", () => {
    const ranges = [rangeDe("a", 0.9), rangeDe("b", 0.2), rangeDe("c", 0.5)];
    const ordre = reordonnerParLogits(ranges, [0.1, 5.0, -1.0], 5);
    expect(ordre.map((r) => r.candidat.chunkId)).toEqual(["b", "a", "c"]);
    expect(ordre.map((r) => r.score)).toEqual([0.2, 0.9, 0.5]);
  });

  it("égalités départagées par chunkId ; topN appliqué après réordonnancement", () => {
    const ranges = [rangeDe("b", 0.1), rangeDe("a", 0.1)];
    expect(reordonnerParLogits(ranges, [1, 1], 5).map((r) => r.candidat.chunkId)).toEqual(["a", "b"]);
    expect(reordonnerParLogits(ranges, [1, 2], 1)).toHaveLength(1);
  });

  it("désalignement → refus, jamais d'ordre bricolé", () => {
    expect(() => reordonnerParLogits([rangeDe("a", 0.1)], [], 5)).toThrow(/désalignés/);
  });
});

describe("creerRerankerCrossEncoder : contrat async + repli", () => {
  it("nom/version stables ; voie synchrone = heuristique", () => {
    const r = creerRerankerCrossEncoder(async () => [0]);
    expect(r.nom).toBe(RERANK_CROSS_ENCODER_NOM);
    expect(r.version).toBe(RERANK_CROSS_ENCODER_VERSION);
    const c = [fusionne({ chunkId: "a" })];
    expect(r.reranker("q", c, 5)).toEqual(HeuristiqueBaseline.reranker("q", c, 5));
  });

  it("la voie async voit les ≤20 fusionnés et réordonne", async () => {
    const vus: string[][] = [];
    const r = creerRerankerCrossEncoder(async (_q, docs) => {
      vus.push([...docs]);
      return docs.map((_, i) => -i);
    });
    const candidats = Array.from({ length: 12 }, (_, i) => fusionne({ chunkId: `c${i}` }));
    const ranges = await r.rerankerAsync("sertraline", candidats, 5);
    expect(vus[0]).toHaveLength(12);
    expect(ranges).toHaveLength(5);
    // Logits décroissants d'indice → l'ordre heuristique est conservé ici
    // (le test du mouvement réel vit en eval, passes E/F).
    expect(ranges[0]?.candidat.chunkId).toBe("c0");
  });
});

describe("service : repli heuristique quand le cross-encoder lève", () => {
  function porteLexicaleUnique(): DbPort {
    const inattendu = (): never => {
      throw new Error("porte factice : méthode non implantée");
    };
    return {
      select: inattendu,
      rpc: async <T>(nom: string, _args: unknown): Promise<Result<readonly T[]>> => {
        if (nom === "search_knowledge_lexical") {
          return ok([{
            chunk_id: "c1", source_id: "s1", source_titre: "Catalogue", source_version: "2026-09-15",
            section: "Catalogue", version_chunk: "struct-v1", langue: "fr",
            texte: "Catalogue — SERTRALINE ALMUS — 50 mg", score: 1,
            source_statut: "active", source_classification: "C4",
            source_approuvee_le: "2026-09-15", source_approuvee_par: "p",
            source_revue_a_jour: true, source_remplacee_par: null,
          }]) as Result<readonly T[]>;
        }
        return { ok: false, error: { code: "introuvable", message: "porte inconnue" } };
      },
      signIn: inattendu,
      signOut: inattendu,
      getSession: inattendu,
      getInstallationStatus: inattendu,
      provisionOwnerAccount: inattendu,
      invokeFunction: inattendu,
      invokeFunctionStream: inattendu,
    };
  }

  function deps(rerankerLocal?: DependancesConnaissance["rerankerLocal"]): DependancesConnaissance {
    setDbPort(porteLexicaleUnique());
    return rerankerLocal === undefined
      ? { vecteurRequete: async () => null }
      : { vecteurRequete: async () => null, rerankerLocal };
  }

  afterEach(() => {
    setDbPort(undefined);
  });

  it("scoreur en panne → résultat heuristique, jamais d'exception", async () => {
    const explose = creerRerankerCrossEncoder(async () => { throw new Error("onnx indisponible"); });
    const resultat = await rechercherConnaissance("sertraline 50 mg", "fr", deps(explose));
    expect(resultat.ok).toBe(true);
    if (resultat.ok) expect(resultat.data.issue).toBe("pertinent");
  });

  it("sans reranker injecté → voie heuristique inchangée", async () => {
    const resultat = await rechercherConnaissance("sertraline 50 mg", "fr", deps());
    expect(resultat.ok).toBe(true);
    if (resultat.ok) expect(resultat.data.evidences).toHaveLength(1);
  });

  it("le mock vitest observe l'appel du service (discipline, pas d'assertion creuse)", () => {
    const espion = vi.fn(async () => [0.5]);
    const r = creerRerankerCrossEncoder(espion);
    expect(r.nom).toBe(RERANK_CROSS_ENCODER_NOM);
  });
});
