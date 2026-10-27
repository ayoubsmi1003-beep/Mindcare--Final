import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DIMENSION_VECTEUR_SECONDAIRE,
  configSecondaireDepuisRecette,
  encoderLotSecondaire,
  extraireEmpreintesSecondaires,
  inferenceSecondaireDepuisSession,
  vecteurRequeteSecondaire,
} from "@/server/knowledge/embeddings-secondaires";

const RECETTE = JSON.parse(readFileSync(join(process.cwd(), "knowledge", "recette-embedding-secondaire.json"), "utf8")) as Record<string, unknown>;

function tokenizerFaux() {
  return {
    encode: (_texte: string) => ({ ids: [1, 2, 3], attention_mask: [1, 1, 1] }),
    token_to_id: (_token: string) => 0,
  };
}

class TenseurFaux {
  constructor(readonly type: string, readonly data: BigInt64Array, readonly dims: readonly number[]) {}
}

/** Session factice : `last_hidden_state` de `valeur` partout, `L` tokens. */
function sessionFausse(options: { valeur: number; dimensions?: number; deuxDimensions?: boolean; masqueZero?: boolean } = { valeur: 1 }) {
  const dimensions = options.dimensions ?? DIMENSION_VECTEUR_SECONDAIRE;
  return {
    inputNames: ["input_ids", "attention_mask", "token_type_ids"],
    outputNames: [options.deuxDimensions ? "sentence_embedding" : "last_hidden_state"],
    run: async (entrees: Record<string, unknown>) => {
      const ids = entrees["input_ids"] as TenseurFaux;
      const n = ids.dims[0] ?? 1;
      const L = ids.dims[1] ?? 1;
      if (options.deuxDimensions) {
        return { sentence_embedding: { data: new Float32Array(n * dimensions).fill(1), dims: [n, dimensions] } };
      }
      const data = new Float32Array(n * L * dimensions);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < L; j++) {
          // La première ligne est masquée si demandé : sa valeur 9 ne doit PAS compter.
          const valeur = options.masqueZero === true && j === 0 ? 9 : options.valeur;
          for (let d = 0; d < dimensions; d++) data[(i * L + j) * dimensions + d] = valeur;
        }
      }
      return { last_hidden_state: { data, dims: [n, L, dimensions] } };
    },
  };
}

describe("recette secondaire : épinglée, jamais devinée", () => {
  it("accepte la recette du dépôt et rejette toute dérive", () => {
    expect(configSecondaireDepuisRecette(RECETTE).dimensions).toBe(384);
    expect(() => configSecondaireDepuisRecette({ ...RECETTE, revision: "autre" })).toThrow(/recette-derive/u);
    expect(() => configSecondaireDepuisRecette({ ...RECETTE, dimensions: 768 })).toThrow(/recette-derive/u);
    expect(() => configSecondaireDepuisRecette({ ...RECETTE, query_prefix: "" })).toThrow(/recette-(derive|incomplete)/u);
  });

  it("exige deux empreintes hexadécimales complètes", () => {
    expect(Object.keys(extraireEmpreintesSecondaires(RECETTE)).sort()).toEqual(["model.onnx", "tokenizer.json"]);
    expect(() => extraireEmpreintesSecondaires({ artifact_sha256: { model_onnx: "abc" } })).toThrow(/empreinte-invalide/u);
  });
});

describe("encodage secondaire : troncature et padding déterministes", () => {
  it("tronque à la longueur max et pad à droite", () => {
    const long = { encode: () => ({ ids: [1, 2, 3, 4, 5], attention_mask: [1, 1, 1, 1, 1] }), token_to_id: () => 0 };
    const court = { encode: () => ({ ids: [7], attention_mask: [1] }), token_to_id: () => 0 };
    const lot = encoderLotSecondaire({ encode: (t) => (t === "long" ? long : court).encode(t), token_to_id: () => 0 }, ["long", "court"], 4);
    expect(lot.ids[0]).toEqual([1, 2, 3, 4]);
    expect(lot.ids[1]).toEqual([7, 0, 0, 0]);
    expect(lot.attention_mask[1]).toEqual([1, 0, 0, 0]);
  });
});

describe("inférence secondaire : pooling moyen pondéré + L2", () => {
  it("rend un vecteur unitaire, identique pour les deux phrases du lot", async () => {
    const inference = inferenceSecondaireDepuisSession({ Tensor: TenseurFaux }, sessionFausse(), tokenizerFaux());
    const [a, b] = await inference(["phrase a", "phrase b"]);
    expect(a).toHaveLength(DIMENSION_VECTEUR_SECONDAIRE);
    const norme = Math.sqrt((a ?? []).reduce((s, v) => s + v * v, 0));
    expect(norme).toBeCloseTo(1, 6);
    (a ?? []).forEach((valeur, index) => expect(valeur).toBeCloseTo((b ?? [])[index] ?? Number.NaN, 10));
    const attendu = 1 / Math.sqrt(DIMENSION_VECTEUR_SECONDAIRE);
    expect((a ?? [])[0]).toBeCloseTo(attendu, 5);
  });

  it("ignore les positions masquées", async () => {
    const avecMasque = inferenceSecondaireDepuisSession({ Tensor: TenseurFaux }, sessionFausse({ valeur: 1, masqueZero: true }), tokenizerFaux());
    const sansMasque = inferenceSecondaireDepuisSession({ Tensor: TenseurFaux }, sessionFausse({ valeur: 1 }), tokenizerFaux());
    const [a] = await avecMasque(["x"]);
    const [b] = await sansMasque(["x"]);
    // Si la valeur 9 de la position masquée comptait, les vecteurs différeraient.
    (a ?? []).forEach((valeur, index) => expect(valeur).toBeCloseTo((b ?? [])[index] ?? Number.NaN, 10));
  });

  it("refuse une tête 2D (sentence_embedding) et une mauvaise dimension", async () => {
    expect(() => inferenceSecondaireDepuisSession({ Tensor: TenseurFaux }, sessionFausse({ valeur: 1, deuxDimensions: true }), tokenizerFaux()))
      .toThrow(/graphe-inattendu|dimension-inattendue/u);
    const mauvaise = inferenceSecondaireDepuisSession({ Tensor: TenseurFaux }, sessionFausse({ valeur: 1, dimensions: 768 }), tokenizerFaux());
    await expect(mauvaise(["x"])).rejects.toThrow(/dimension-inattendue/u);
  });
});

describe("adaptateur requête : préfixe de la recette, échec → null", () => {
  const config = configSecondaireDepuisRecette(RECETTE);
  it("applique le préfixe `query: `", async () => {
    const vus: string[] = [];
    const vecteur = vecteurRequeteSecondaire(config, async (textes) => {
      vus.push(...textes);
      return [new Array(DIMENSION_VECTEUR_SECONDAIRE).fill(0.1)];
    });
    await vecteur("posologie sertraline");
    expect(vus).toEqual(["query: posologie sertraline"]);
  });

  it("rend null sur panne ou dimension inattendue, jamais un vecteur partiel", async () => {
    const panne = vecteurRequeteSecondaire(config, async () => { throw new Error("boom"); });
    expect(await panne("x")).toBeNull();
    const mauvaise = vecteurRequeteSecondaire(config, async () => [[1, 2]]);
    expect(await mauvaise("x")).toBeNull();
  });
});
