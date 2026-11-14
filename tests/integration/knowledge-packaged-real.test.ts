import { describe, expect, it } from "vitest";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { creerChargeurSecondaire } from "@/server/knowledge/vecteur-secondaire-production";
import { rerankerSecondaireProduction, reinitialiserRerankSecondaireProduction, statutRerankSecondaire } from "@/server/knowledge/rerank-secondaire-production";

const root = process.env["MINDCARE_KNOWLEDGE_PACKAGE"];
describe.skipIf(!root)("real packaged local knowledge models", () => {
  const deps = {
    racine: root!, lireEnv: (key: string) => key === "KNOWLEDGE_VECTOR_RECETTE" ? "e5-base" : undefined,
    existe: existsSync, ouvrirLecture: createReadStream, lireFichier: (p: string) => readFileSync(p, "utf8"),
    dossierLocalAppData: undefined,
    importerBinaires: async () => {
      const ort = await import("onnxruntime-node");
      const { Tokenizer } = await import("@huggingface/tokenizers");
      return { ort, creerTokenizer: (json: unknown, config: unknown) => new Tokenizer(json as never, config as never),
        creerSession: (p: string) => ort.InferenceSession.create(p, { intraOpNumThreads: 2, executionProviders: ["cpu"] }) } as never;
    },
  };
  it("runs E5 from the package without a user-profile cache", async () => {
    const c = creerChargeurSecondaire(deps);
    const vector = await c.vecteurRequete("critères diagnostiques de la dépression");
    expect(c.statut().etat).toBe("pret");
    expect(vector?.length).toBe(768);
    expect(vector?.every(Number.isFinite)).toBe(true);
  }, 240_000);
  it("runs mMARCO from the package without a user-profile cache", async () => {
    reinitialiserRerankSecondaireProduction();
    const r = rerankerSecondaireProduction(deps);
    const base = { sourceId: "s", sourceTitre: "DSM", sourceVersion: "v", section: null, versionChunk: "v", langue: "fr" as const,
      scoreLexical: 0.1, scoreVectoriel: null, unitId: null, parentTexteHash: null, enfantIndex: null, enfantsTotal: null };
    const result = await r.rerankerAsync("depression", [{ ...base, chunkId:"a", texte:"Une humeur dépressive peut être présente." }, { ...base, chunkId:"b", texte:"Le calendrier indique une date." }], 2);
    expect(result.length).toBe(2);
    expect(statutRerankSecondaire().etat).toBe("pret");
    expect(statutRerankSecondaire().inferences).toBeGreaterThan(0);
  }, 240_000);
});
