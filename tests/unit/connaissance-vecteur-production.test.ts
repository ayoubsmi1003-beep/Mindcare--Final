/**
 * M07 slice 3 — shell de production du vecteur requête (BGE-M3 local).
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * La fabrique à dépendances injectées (`creerChargeurVecteur`) : modèle
 * absent → `null` (repli lexical honnête, jamais d'exception vers l'appelant),
 * recette corrompue → `null`, session en panne → `null`, chemin heureux →
 * vecteur, singleton (une seule initialisation), statut observable.
 * Les pièces pures (résolution, empreintes, config, session, inférence) sont
 * déjà éprouvées dans `connaissance-embeddings-r2/r3` — ici seul le shell.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  creerChargeurVecteur,
  type DependancesChargeurVecteur,
} from "../../src/server/knowledge/vecteur-production";

/** Contenus factices indexés par NOM DE FICHIER + leurs vrais sha256. */
const CONTENUS: Record<string, Uint8Array> = {
  "model.onnx": new TextEncoder().encode("onnx-factice"),
  "model.onnx_data": new TextEncoder().encode("data-factice"),
  "tokenizer.json": new TextEncoder().encode("tokenizer-factice"),
};
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

const RECETTE = JSON.stringify({
  model: "BAAI/bge-m3",
  revision: "5617a9f61b028005a4858fdac845db406aefb181",
  dimensions: 1024,
  distance: "cosine",
  query_prefix: "",
  document_prefix: "",
  chunking_version: "struct-v1",
  normalization: "l2 native (tete sentence_embedding ONNX)",
  artifact_sha256: {
    "model_onnx": sha(CONTENUS["model.onnx"]!),
    "model_onnx_data": sha(CONTENUS["model.onnx_data"]!),
    "tokenizer_json": sha(CONTENUS["tokenizer.json"]!),
  },
});

function ouvrirLectureFactice(chemin: string): AsyncIterable<Uint8Array> {
  const nom = chemin.split("/").pop() ?? "";
  const contenu = CONTENUS[nom];
  return (async function* () {
    if (contenu !== undefined) yield contenu;
  })();
}

function dependances(surcharge: Partial<DependancesChargeurVecteur> = {}): DependancesChargeurVecteur {
  return {
    racine: "/app",
    lireEnv: () => undefined,
    existe: () => true,
    ouvrirLecture: ouvrirLectureFactice,
    lireFichier: (chemin: string) => {
      if (chemin.endsWith("recette-embedding-pinee.json")) return RECETTE;
      if (chemin.endsWith("tokenizer.json")) return "{}";
      if (chemin.endsWith("tokenizer_config.json")) return "{}";
      throw new Error(`fichier inconnu : ${chemin}`);
    },
    importerBinaires: async () => ({
      ort: { Tensor: class {} },
      creerTokenizer: () => ({
        encode: () => ({ ids: [1, 2, 3], attention_mask: [1, 1, 1] }),
        token_to_id: () => 0,
      }),
      creerSession: async () => ({
        inputNames: ["input_ids", "attention_mask"],
        outputNames: ["sentence_embedding"],
        run: async () => ({ sentence_embedding: { data: Array<number>(1024).fill(0.1) } }),
      }),
    }),
    ...surcharge,
  };
}

describe("chargeur vecteur de production (M07 slice 3)", () => {
  it("modèle absent partout → null + statut indisponible (repli lexical)", async () => {
    const chargeur = creerChargeurVecteur(dependances({ existe: () => false }));
    await expect(chargeur.vecteurRequete("sertraline")).resolves.toBeNull();
    expect(chargeur.statut().etat).toBe("indisponible");
    expect(chargeur.statut().motif).toMatch(/introuvable|indisponible/);
  });

  it("recette corrompue → null, jamais d'exception", async () => {
    const chargeur = creerChargeurVecteur(
      dependances({ lireFichier: () => "pas-du-json{{{" }),
    );
    await expect(chargeur.vecteurRequete("sertraline")).resolves.toBeNull();
    expect(chargeur.statut().etat).toBe("indisponible");
  });

  it("session en panne → null (fail-closed lexical)", async () => {
    const chargeur = creerChargeurVecteur(
      dependances({
        importerBinaires: async () => ({
          ort: { Tensor: class {} },
          creerTokenizer: () => {
            throw new Error("tokenizer-illisible");
          },
          creerSession: async () => {
            throw new Error("jamais atteint");
          },
        }),
      }),
    );
    await expect(chargeur.vecteurRequete("sertraline")).resolves.toBeNull();
    expect(chargeur.statut().etat).toBe("indisponible");
  });

  it("singleton : une seule initialisation pour N appels", async () => {
    let initialisations = 0;
    const base = dependances();
    const chargeur = creerChargeurVecteur({
      ...base,
      importerBinaires: async () => {
        initialisations += 1;
        return base.importerBinaires();
      },
    });
    await chargeur.vecteurRequete("a");
    await chargeur.vecteurRequete("b");
    expect(initialisations).toBe(1);
  });

  it("chemin heureux factice : vecteur 1024 + statut prêt", async () => {
    const chargeur = creerChargeurVecteur(dependances());
    const vecteur = await chargeur.vecteurRequete("sertraline 50 mg");
    expect(vecteur).not.toBeNull();
    expect(vecteur).toHaveLength(1024);
    expect(chargeur.statut()).toEqual({ etat: "pret" });
  });
});
