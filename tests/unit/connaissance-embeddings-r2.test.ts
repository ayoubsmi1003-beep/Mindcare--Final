/**
 * M07 R2 — Fournisseur local ONNX : contrat, recette, déterminisme, artefacts mesurés.
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * Le contrat `FournisseurLocalOnnx` (1024 imposé, révision épinglée exigée,
 * inférence injectée 100 % locale, zéro `fetch`/`pg`) + la traçabilité des
 * mesures R2 (`artifacts/bench-r2/*.json`, recette épinglée) + l'absence
 * d'écriture de production dans le périmètre R2.
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * L'inférence ONNX réelle (poids ~2 Go, harness hors dépôt, résultats
 * vérifiés ici par leurs artefacts + hashes) ; le câblage R3 (`vecteurRequete`,
 * backfill) ; le rerank R4.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CHUNKER_VERSION } from "../../src/server/knowledge/decoupage";
import {
  DIMENSION_VECTEUR_PROD,
  FournisseurLocalOnnx,
  validerConfigLocale,
  type ConfigFournisseurLocal,
  type InferenceLocale,
} from "../../src/server/knowledge/embeddings";

const RECETTE_BGE: ConfigFournisseurLocal = {
  modele: "BAAI/bge-m3",
  version: "5617a9f61b028005a4858fdac845db406aefb181",
  dimensions: 1024,
  normalisation: "l2-native-tete-sentence-embedding-v1",
  instruction_requete: "",
  instruction_document: "",
  distance: "cosine",
  versionChunk: CHUNKER_VERSION,
} as const;

function vecteur1024(valeur = 0.03125): number[] {
  return Array.from({ length: 1024 }, () => valeur);
}

function inferenceOk(vecteurs: readonly (readonly number[])[] = [vecteur1024()]): {
  inference: InferenceLocale;
  appels: () => number;
  vus: () => readonly (readonly string[])[];
} {
  let n = 0;
  const vus: (readonly string[])[] = [];
  const inference: InferenceLocale = async (textes) => {
    n += 1;
    vus.push([...textes]);
    return { vecteurs };
  };
  return { inference, appels: () => n, vus: () => vus };
}

describe("R2 — verrou 1024 + révision épinglée", () => {
  it("DIMENSION_VECTEUR_PROD = 1024 (schéma 092)", () => {
    expect(DIMENSION_VECTEUR_PROD).toBe(1024);
  });

  it("recette BGE épinglée valide", () => {
    expect(validerConfigLocale({ ...RECETTE_BGE })).toEqual({ ok: true });
  });

  it.each([
    ["révision vide", { ...RECETTE_BGE, version: "" }],
    ["révision non épinglée", { ...RECETTE_BGE, version: "À PINGER À LA PORTE B" }],
    ["dimension 768", { ...RECETTE_BGE, dimensions: 768 }],
    ["dimension 0", { ...RECETTE_BGE, dimensions: 0 }],
    ["normalisation vide", { ...RECETTE_BGE, normalisation: "  " }],
    ["distance euclidienne", { ...RECETTE_BGE, distance: "euclidienne" }],
  ])("config invalide (%s) → refus de construction", (_cas, config) => {
    const { inference } = inferenceOk();
    expect(() => new FournisseurLocalOnnx(config, inference)).toThrow(/Recette locale invalide/);
  });
});

describe("R2 — fournisseur local : contrat EmbeddingProvider, zéro egress", () => {
  it("expose les 9 champs de recette + embed 1024d", async () => {
    const { inference, appels } = inferenceOk();
    const f = new FournisseurLocalOnnx({ ...RECETTE_BGE }, inference);
    expect(f.nom).toBe("local-onnx");
    expect(f.dimensions).toBe(1024);
    const r = await f.embed(["La sertraline 50 mg est une option de première intention."]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.vecteurs).toHaveLength(1);
      expect(r.vecteurs[0]).toHaveLength(1024);
      expect(r.recette).toMatchObject({
        fournisseur: "local-onnx",
        modele: "BAAI/bge-m3",
        versionModele: RECETTE_BGE.version,
        dimensions: 1024,
        distance: "cosine",
        versionChunk: CHUNKER_VERSION,
      });
    }
    expect(appels()).toBe(1);
  });

  it("vecteur de mauvaise dimension → invalide, aucun vecteur partiel", async () => {
    const { inference } = inferenceOk([[0.1, 0.2]]);
    const r = await new FournisseurLocalOnnx({ ...RECETTE_BGE }, inference).embed(["texte"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalide");
  });

  it("lot vide → ok vide, 0 appel d'inférence", async () => {
    const { inference, appels } = inferenceOk();
    const r = await new FournisseurLocalOnnx({ ...RECETTE_BGE }, inference).embed([]);
    expect(r).toMatchObject({ ok: true });
    expect(appels()).toBe(0);
  });

  it("même entrée → même sortie (déterminisme du contrat)", async () => {
    const { inference } = inferenceOk([vecteur1024(0.5), vecteur1024(-0.25)]);
    const f = new FournisseurLocalOnnx({ ...RECETTE_BGE }, inference);
    const a = await f.embed(["q1", "q2"]);
    const b = await f.embed(["q1", "q2"]);
    expect(a).toEqual(b);
  });

  it("zéro `fetch` dans embeddings.ts (inférence locale injectée, pas d'egress)", () => {
    const src = readFileSync(new URL("../../src/server/knowledge/embeddings.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/(^|[^_a-zA-Z])fetch\s*\(/);
  });

  it("aucun import `pg`/db/supabase dans le périmètre R2 (pas d'écriture prod)", () => {
    for (const f of ["../../src/server/knowledge/embeddings.ts"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      const imports = src.split("\n").filter((l) => l.startsWith("import "));
      expect(imports.join("\n")).not.toMatch(/from\s+["'](@\/server\/db|pg|@supabase)/);
    }
    const bench = readFileSync(new URL("../../scripts/bench-embeddings.mjs", import.meta.url), "utf8");
    expect(bench).not.toMatch(/from\s+["']pg["']|createClient|knowledge_chunks/);
  });
});

describe("R2 — consignes requête/document natives (E5 vs BGE)", () => {
  it("BGE : aucune consigne (identité)", () => {
    const { inference } = inferenceOk();
    const f = new FournisseurLocalOnnx({ ...RECETTE_BGE }, inference);
    expect(f.texteRequete("dwa dyal qalaq ?")).toBe("dwa dyal qalaq ?");
    expect(f.texteDocument("Qalaq bezaf.")).toBe("Qalaq bezaf.");
  });

  it("E5 : préfixes query:/passage: appliqués à l'octet (bench = prod)", async () => {
    const { inference, vus } = inferenceOk();
    const f = new FournisseurLocalOnnx(
      { ...RECETTE_BGE, modele: "intfloat/multilingual-e5-large", instruction_requete: "query: ", instruction_document: "passage: " },
      inference,
    );
    await f.embed([f.texteRequete("Quelle est la جرعة sertraline ?")]);
    await f.embed([f.texteDocument("جرعة سيرترالين للقلق.")]);
    expect(vus()[0]?.[0]?.startsWith("query: ")).toBe(true);
    expect(vus()[1]?.[0]?.startsWith("passage: ")).toBe(true);
  });

  it("sondes FR/AR/Darija : le texte traverse sans altération", async () => {
    const { inference, vus } = inferenceOk([vecteur1024(), vecteur1024(), vecteur1024()]);
    const f = new FournisseurLocalOnnx({ ...RECETTE_BGE }, inference);
    const sondes = ["Quelle est la posologie de la sertraline ?", "ما هي جرعة سيرترالين للقلق ؟", "wesh dwa dyal qalaq ?"];
    const r = await f.embed(sondes);
    expect(r.ok).toBe(true);
    expect(vus()[0]).toEqual(sondes);
  });
});

describe("R2 — artefacts mesurés (harness local, résultats rejoués ici)", () => {
  function artefact(nom: string) {
    return JSON.parse(readFileSync(new URL(`../../artifacts/bench-r2/${nom}.json`, import.meta.url), "utf8"));
  }

  it.each(["bge", "e5"])("%s : dim 1024 + seuils ADR-037 compatibles + déterminisme octet", (nom) => {
    const r = artefact(nom);
    expect(r.dimensions).toBe(1024);
    expect(r.qualite.recall5).toBeGreaterThanOrEqual(0.9);
    expect(r.qualite.mrr).toBeGreaterThanOrEqual(0.8);
    expect(r.qualite.ndcg5).toBeGreaterThanOrEqual(0.8);
    expect(r.determinisme.octets_identiques).toBe(true);
    expect(r.determinisme.sha256_repetition).toBe(r.determinisme.sha256_requetes);
    for (const langue of ["fr", "ar", "darija"]) {
      expect(r.qualite.langues[langue].recall5).toBeGreaterThanOrEqual(0.9);
    }
    expect(r.performance.requete_chaude_p50_s).toBeGreaterThan(0);
    expect(r.performance.requete_chaude_p95_s).toBeGreaterThanOrEqual(r.performance.requete_chaude_p50_s);
  });

  it("recette épinglée = mesure BGE (modèle, révision, dims, consignes, chunker)", () => {
    const recette = JSON.parse(readFileSync(new URL("../../knowledge/recette-embedding-pinee.json", import.meta.url), "utf8"));
    const bge = artefact("bge");
    expect(recette.provider).toBe("local-onnx");
    expect(recette.dimensions).toBe(1024);
    expect(recette.distance).toBe("cosine");
    expect(recette.chunking_version).toBe(CHUNKER_VERSION);
    expect(recette.model).toBe(bge.candidat);
    expect(recette.revision).toBe(bge.revision);
    expect(recette.query_prefix).toBe(bge.query_prefix);
    expect(recette.document_prefix).toBe(bge.document_prefix);
    expect(typeof recette.artifact_sha256.model_onnx_data).toBe("string");
    expect(recette.artifact_sha256.model_onnx_data).toHaveLength(64);
  });
});
