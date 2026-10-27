import { describe, expect, it } from "vitest";

import {
  reinitialiserRerankSecondaireProduction,
  rerankerSecondaireProduction,
  statutRerankSecondaire,
} from "@/server/knowledge/rerank-secondaire-production";
import type { CandidatFusionne } from "@/server/knowledge/recherche";

function fusionne(surcharge: Partial<CandidatFusionne> & { chunkId: string }): CandidatFusionne {
  return {
    sourceId: "source-1",
    sourceTitre: "DSM-5 — Manuel diagnostique et statistique des troubles mentaux",
    sourceVersion: "v1",
    section: "Section II",
    versionChunk: "struct-v2",
    langue: "fr",
    texte: "Texte synthétique.",
    scoreLexical: 0.5,
    scoreVectoriel: null,
    unitId: null, parentTexteHash: null, enfantIndex: null, enfantsTotal: null,
    ...surcharge,
  };
}

class TenseurFaux {
  constructor(readonly type: string, readonly data: BigInt64Array, readonly dims: readonly number[]) {}
}

const VIDE_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const RECETTE = JSON.stringify({
  model: "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1",
  revision: "rev-test",
  artifact_sha256: { model_onnx: VIDE_SHA256, tokenizer_json: VIDE_SHA256 },
});

function depsFaux(options: { recette?: string; binaires?: "ok" | "panne" } = {}) {
  const tokenizer = {
    encode: (_texte: string) => ({ ids: [0, 5, 2], attention_mask: [1, 1, 1] }),
    token_to_id: (jeton: string) => ({ "<s>": 0, "</s>": 2, "<pad>": 1 })[jeton],
  };
  return {
    racine: "/racine",
    lireEnv: () => undefined,
    existe: () => true,
    ouvrirLecture: async function* () {},
    lireFichier: (chemin: string) => {
      if (chemin.endsWith("recette-rerank-secondaire.json")) return options.recette ?? RECETTE;
      if (chemin.endsWith("tokenizer.json")) return "{}";
      if (chemin.endsWith("tokenizer_config.json")) return "{}";
      throw new Error(`fichier inattendu : ${chemin}`);
    },
    dossierLocalAppData: undefined,
    importerBinaires: async () => {
      if (options.binaires === "panne") throw new Error("binaires indisponibles");
      return {
        ort: { Tensor: TenseurFaux },
        creerTokenizer: () => tokenizer,
        creerSession: async () => ({
          inputNames: ["input_ids", "attention_mask"],
          outputNames: ["logits"],
          run: async () => ({ logits: { data: [2, 1], dims: [2] } }),
        }),
      };
    },
  };
}

describe("rerank secondaire : échec fermé, jamais de faux rerank", () => {
  it("recette absente → async lève et statut indisponible", async () => {
    reinitialiserRerankSecondaireProduction();
    const r = rerankerSecondaireProduction(depsFaux({ recette: "{}" }));
    await expect(r.rerankerAsync("q", [fusionne({ chunkId: "a" })], 5)).rejects.toThrow(/indisponible/u);
    expect(statutRerankSecondaire().etat).toBe("indisponible");
  });

  it("succès factice → réordonne par logits, voie sync = heuristique", async () => {
    reinitialiserRerankSecondaireProduction();
    const r = rerankerSecondaireProduction(depsFaux());
    const ranges = await r.rerankerAsync("q", [fusionne({ chunkId: "a" }), fusionne({ chunkId: "b" })], 5);
    expect(ranges.map((x) => x.candidat.chunkId)).toEqual(["a", "b"]);
    expect(r.nom).toBe("mmarco-mMiniLMv2");
  });
});
