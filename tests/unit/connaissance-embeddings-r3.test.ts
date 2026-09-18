/**
 * M07 R3 — Runtime local BGE-M3 : résolution d'artefact, recette gelée, formattage pgvector.
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * La partie PURE du câblage R3 (`embeddings-local.ts`) : ordre de résolution
 * du dossier modèle (env → resources → cache dev), vérification SHA-256 des
 * 3 artefacts, promotion recette JSON → `ConfigFournisseurLocal` avec rejet de
 * dérive, littéral pgvector, découpage en lots. Zéro `fetch`, zéro `pg`.
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * La session ONNX réelle + le tokenizer (poids 2,2 Go, natif) : prouvés par
 * `scripts/sonde-embeddings-production.mjs` (R3-A), pas par des unitaires.
 * Aucune écriture base ici.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  NOM_FICHIERS_MODELE,
  chargerSessionLocale,
  configLocaleDepuisRecette,
  decouperLots,
  encoderLot,
  extraireEmpreintes,
  formaterVecteurPg,
  inferenceDepuisSession,
  normaliserL2,
  resoudreDossierModele,
  vecteurRequeteDepuisFournisseur,
  verifierEmpreintes,
  verifierEmpreintesParFlux,
  type FabriqueSession,
  type OptionsSessionLocale,
  type OrtMinimal,
  type SessionOnnxMinimale,
  type TokenizerLocalMinimal,
} from "../../src/server/knowledge/embeddings-local";
import { validerConfigLocale, type EmbeddingProvider, type ResultatEmbedding } from "../../src/server/knowledge/embeddings";

function sha256(texte: string): string {
  return createHash("sha256").update(texte, "utf8").digest("hex");
}

function memoire(fichiers: Readonly<Record<string, string>>): {
  existe: (chemin: string) => boolean;
  lire: (chemin: string) => Buffer;
} {
  return {
    existe: (chemin) => Object.hasOwn(fichiers, chemin),
    lire: (chemin) => Buffer.from(fichiers[chemin] ?? "", "utf8"),
  };
}

describe("R3-A — résolution du dossier modèle (env → resources → cache)", () => {
  it("dossier env existant gagne", () => {
    const { existe } = memoire({ "/env/modele": "x" });
    expect(
      resoudreDossierModele({ env: "/env/modele", ressources: "/res/m", cache: "/cache/m" }, existe),
    ).toBe("/env/modele");
  });

  it("repli resources puis cache", () => {
    const { existe } = memoire({ "/res/m": "x" });
    expect(resoudreDossierModele({ ressources: "/res/m", cache: "/cache/m" }, existe)).toBe("/res/m");
    const avecCache = memoire({ "/cache/m": "x" });
    expect(resoudreDossierModele({ cache: "/cache/m" }, avecCache.existe)).toBe("/cache/m");
  });

  it("aucun dossier → échec fermé modele-introuvable, jamais de devinette", () => {
    const { existe } = memoire({});
    expect(() => resoudreDossierModele({}, existe)).toThrow(/modele-introuvable/);
    expect(() => resoudreDossierModele({ env: "/absent" }, existe)).toThrow(/modele-introuvable/);
  });

  it("les 3 noms d'artefacts sont ceux de la recette (onnx + data + tokenizer)", () => {
    expect([...NOM_FICHIERS_MODELE].sort()).toEqual(
      ["model.onnx", "model.onnx_data", "tokenizer.json"].sort(),
    );
  });
});

describe("R3-A — empreintes SHA-256 (corrompu = refus avant toute inférence)", () => {
  it("empreintes exactes → ok silencieux", () => {
    const { lire } = memoire({ "/m/model.onnx": "a", "/m/tokenizer.json": "b" });
    expect(() =>
      verifierEmpreintes("/m", { "model.onnx": sha256("a"), "tokenizer.json": sha256("b") }, lire),
    ).not.toThrow();
  });

  it("octet altéré → erreur nommant le fichier", () => {
    const { lire } = memoire({ "/m/model.onnx": "a!" });
    expect(() => verifierEmpreintes("/m", { "model.onnx": sha256("a") }, lire)).toThrow(
      /model\.onnx/,
    );
  });

  it("fichier manquant → erreur nommant le fichier", () => {
    const { lire } = memoire({});
    expect(() => verifierEmpreintes("/m", { "tokenizer.json": sha256("x") }, lire)).toThrow(
      /tokenizer\.json/,
    );
  });

  it("extrait les 3 empreintes depuis les clés de la recette épinglée", () => {
    const recette = JSON.parse(
      readFileSync(new URL("../../knowledge/recette-embedding-pinee.json", import.meta.url), "utf8"),
    );
    const empreintes = extraireEmpreintes(recette);
    expect(Object.keys(empreintes).sort()).toEqual(
      ["model.onnx", "model.onnx_data", "tokenizer.json"].sort(),
    );
    for (const sha of Object.values(empreintes)) {
      expect(sha).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(empreintes["tokenizer.json"]).toBe(recette.artifact_sha256.tokenizer_json);
  });

  it("clé d'empreinte absente ou malformée → rejet explicite", () => {
    expect(() => extraireEmpreintes({})).toThrow(/recette-/);
    expect(() =>
      extraireEmpreintes({ artifact_sha256: { model_onnx: "zz", model_onnx_data: "zz", tokenizer_json: "zz" } }),
    ).toThrow(/empreinte/);
  });

  it("variante par flux : morceaux assemblés avant hash (gros .onnx_data)", async () => {
    async function* flux(texte: string): AsyncIterable<Uint8Array> {
      yield Buffer.from(texte.slice(0, 1), "utf8");
      yield Buffer.from(texte.slice(1), "utf8");
    }
    await expect(
      verifierEmpreintesParFlux("/m", { "model.onnx_data": sha256("ab") }, (p) =>
        p === "/m/model.onnx_data" ? flux("ab") : (async function* () {})(),
      ),
    ).resolves.toBeUndefined();
    await expect(
      verifierEmpreintesParFlux("/m", { "model.onnx_data": sha256("ab") }, () => flux("a!")),
    ).rejects.toThrow(/model\.onnx_data/);
    await expect(
      verifierEmpreintesParFlux("/m", { "model.onnx_data": sha256("ab") }, () => {
        throw new Error("EACCES");
      }),
    ).rejects.toThrow(/model\.onnx_data/);
  });
});

describe("R3-A — recette JSON → config locale (dérive = rejet)", () => {
  function recettePinee(): unknown {
    return JSON.parse(
      readFileSync(new URL("../../knowledge/recette-embedding-pinee.json", import.meta.url), "utf8"),
    );
  }

  it("recette épinglée → config valide (porte validerConfigLocale verte)", () => {
    const config = configLocaleDepuisRecette(recettePinee());
    expect(config).toMatchObject({
      modele: "BAAI/bge-m3",
      version: "5617a9f61b028005a4858fdac845db406aefb181",
      dimensions: 1024,
      instruction_requete: "",
      instruction_document: "",
      distance: "cosine",
      versionChunk: "struct-v1",
    });
    expect(validerConfigLocale(config)).toEqual({ ok: true });
  });

  it.each([
    ["révision", { revision: "0000000000000000000000000000000000000000" }],
    ["modèle", { model: "intfloat/multilingual-e5-large" }],
    ["dimensions", { dimensions: 768 }],
    ["distance", { distance: "euclidienne" }],
    ["préfixe requête", { query_prefix: "query: " }],
    ["découpeur", { chunking_version: "struct-v2" }],
  ])("dérive %s → rejet recette-derive, jamais de coexistence silencieuse", (_cas, patch) => {
    const alteree = { ...(recettePinee() as Record<string, unknown>), ...patch };
    expect(() => configLocaleDepuisRecette(alteree)).toThrow(/recette-derive/);
  });

  it("recette illisible → rejet explicite", () => {
    expect(() => configLocaleDepuisRecette(null)).toThrow(/recette-/);
    expect(() => configLocaleDepuisRecette({})).toThrow(/recette-/);
  });
});

describe("R3-A — littéral pgvector + lots (backfill déterministe)", () => {
  it("formate [0.1,-2,3.5] en littéral pgvector", () => {
    expect(formaterVecteurPg([0.1, -2, 3.5])).toBe("[0.1,-2,3.5]");
  });

  it("1024 composantes : aller sans perte de dimension", () => {
    const vecteur = Array.from({ length: 1024 }, (_, i) => i / 1024);
    const litteral = formaterVecteurPg(vecteur);
    expect(litteral.startsWith("[") && litteral.endsWith("]")).toBe(true);
    expect(litteral.split(",")).toHaveLength(1024);
  });

  it("composante non finie → refus (jamais de vecteur corrompu en base)", () => {
    expect(() => formaterVecteurPg([0.1, Number.NaN])).toThrow(/fini/);
    expect(() => formaterVecteurPg([0.1, Number.POSITIVE_INFINITY])).toThrow(/fini/);
  });

  it("lots de 8 : 20 items → 8/8/4, ordre préservé", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(decouperLots(items, 8)).toEqual([
      [0, 1, 2, 3, 4, 5, 6, 7],
      [8, 9, 10, 11, 12, 13, 14, 15],
      [16, 17, 18, 19],
    ]);
  });

  it("vide → aucun lot ; taille ≤ 0 → refus", () => {
    expect(decouperLots([], 8)).toEqual([]);
    expect(() => decouperLots([1], 0)).toThrow(/taille/);
  });
});

describe("R3-A — hygiène : zéro egress, zéro accès base", () => {
  it("aucun fetch ni import pg/db dans le câblage local", () => {
    const src = readFileSync(
      new URL("../../src/server/knowledge/embeddings-local.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/(^|[^_a-zA-Z])fetch\s*\(/);
    const imports = src.split("\n").filter((l) => l.startsWith("import "));
    expect(imports.join("\n")).not.toMatch(/from\s+["'](@\/server\/db|pg|@supabase)/);
  });

  it("aucun import natif statique (ORT/tokenizer branchés par injection)", () => {
    const src = readFileSync(
      new URL("../../src/server/knowledge/embeddings-local.ts", import.meta.url),
      "utf8",
    );
    // Seules les lignes d'import comptent : un commentaire ne charge rien.
    const imports = src.split("\n").filter((l) => l.startsWith("import "));
    expect(imports.join("\n")).not.toMatch(/onnxruntime/);
    expect(imports.join("\n")).not.toMatch(/tokenizers/);
  });
});

describe("R3-A — encodage par lot (troncature 512 + padding lot)", () => {
  function fauxTokenizerLongs(): {
    tokenizer: TokenizerLocalMinimal;
    vus: () => string[];
  } {
    const vus: string[] = [];
    return {
      vus: () => vus,
      tokenizer: {
        encode: (texte: string) => {
          vus.push(texte);
          const n = texte === "long" ? 600 : 5;
          return {
            ids: Array.from({ length: n }, (_, i) => 100 + i),
            attention_mask: Array.from({ length: n }, () => 1),
          };
        },
        token_to_id: () => undefined,
      },
    };
  }

  it("tronque à 512 en gardant les spéciaux (511 premiers + dernier)", () => {
    const { tokenizer } = fauxTokenizerLongs();
    const lot = encoderLot(tokenizer, ["long"]);
    expect(lot.ids[0]).toHaveLength(512);
    expect(lot.ids[0]?.slice(0, 3)).toEqual([100, 101, 102]);
    expect(lot.ids[0]?.[510]).toBe(100 + 510);
    expect(lot.ids[0]?.[511]).toBe(100 + 599);
    expect(lot.attention_mask[0]).toHaveLength(512);
  });

  it("pad au max du lot avec 0 quand [PAD] est inconnu (parité R2)", () => {
    const { tokenizer } = fauxTokenizerLongs();
    const lot = encoderLot(tokenizer, ["a", "bb"]);
    expect(lot.ids).toHaveLength(2);
    expect(lot.ids[0]).toHaveLength(5);
    expect(lot.ids[1]).toHaveLength(5);
    expect(lot.attention_mask[1]).toEqual([1, 1, 1, 1, 1]);
  });

  it("pad avec l'id [PAD] quand le tokenizer le connaît", () => {
    const avecPad: TokenizerLocalMinimal = {
      encode: (t: string) =>
        t === "court" ? { ids: [1, 2], attention_mask: [1, 1] } : { ids: [1, 2, 3, 4], attention_mask: [1, 1, 1, 1] },
      token_to_id: (t: string) => (t === "[PAD]" ? 7 : undefined),
    };
    const deux = encoderLot(avecPad, ["court", "long4"]);
    expect(deux.ids[0]).toEqual([1, 2, 7, 7]);
    expect(deux.attention_mask[0]).toEqual([1, 1, 0, 0]);
    expect(deux.ids[1]).toEqual([1, 2, 3, 4]);
  });
});

describe("R3-A — normalisation L2 explicite (tête déjà ~normée, ceinture + bretelles R2)", () => {
  it("[3,4] → [0.6,0.8]", () => {
    expect(normaliserL2([3, 4])).toEqual([0.6, 0.8]);
  });

  it("vecteur nul → refus (jamais de NaN en base)", () => {
    expect(() => normaliserL2([0, 0])).toThrow(/nul/);
  });
});

describe("R3-A — inférence depuis session injectée (contrat InferenceLocale)", () => {
  function montage(vecteurTete: readonly number[] = Array.from({ length: 1024 }, () => 0.03125)): {
    ort: OrtMinimal;
    session: SessionOnnxMinimale & { appels: () => Array<{ cles: string[]; dims: readonly number[] }> };
  } {
    const appels: Array<{ cles: string[]; dims: readonly number[] }> = [];
    const session = {
      inputNames: ["input_ids", "attention_mask"],
      outputNames: ["token_embeddings", "sentence_embedding"],
      appels: () => appels,
      run: async (entrees: Record<string, unknown>) => {
        const cles = Object.keys(entrees).sort();
        const tenseur = entrees["input_ids"] as { dims: readonly number[] };
        appels.push({ cles, dims: tenseur.dims });
        const n = tenseur.dims[0] ?? 0;
        return {
          token_embeddings: { data: Array.from({ length: n * 2 }, () => 0) },
          sentence_embedding: { data: Array.from({ length: n }, () => [...vecteurTete]).flat() },
        };
      },
    };
    const ort: OrtMinimal = {
      Tensor: class {
        readonly dims: readonly number[];
        constructor(
          readonly type: string,
          readonly data: BigInt64Array,
          dims: readonly number[],
        ) {
          this.dims = dims;
        }
      },
    };
    return { ort, session };
  }

  function fauxTokenizer(): TokenizerLocalMinimal {
    return {
      encode: (texte: string) => ({
        ids: [0, 10 + texte.length, 2],
        attention_mask: [1, 1, 1],
      }),
      token_to_id: () => undefined,
    };
  }

  it("embed 2 textes : vecteurs L2-unitaires, entrées int64 nommées", async () => {
    const { ort, session } = montage();
    const inference = inferenceDepuisSession(ort, session, fauxTokenizer());
    const brut = (await inference(["a", "bb"])) as { vecteurs: number[][] };
    expect(brut.vecteurs).toHaveLength(2);
    for (const v of brut.vecteurs) {
      const norme = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      expect(norme).toBeCloseTo(1, 6);
    }
    expect(session.appels()).toHaveLength(1);
    expect(session.appels()[0]?.cles).toEqual(["attention_mask", "input_ids"]);
    expect(session.appels()[0]?.dims).toEqual([2, 3]);
  });

  it("9 textes en lots de 8 → 2 runs (8 + 1)", async () => {
    const { ort, session } = montage();
    const inference = inferenceDepuisSession(ort, session, fauxTokenizer(), { tailleLot: 8 });
    const brut = (await inference(Array.from({ length: 9 }, (_, i) => `t${i}`))) as {
      vecteurs: number[][];
    };
    expect(brut.vecteurs).toHaveLength(9);
    expect(session.appels().map((a) => a.dims[0])).toEqual([8, 1]);
  });

  it("graphe inattendu (entrées/sortie) → refus explicite dès le câblage", () => {
    const { ort, session } = montage();
    const mauvaisEntrees: SessionOnnxMinimale = { ...session, inputNames: ["x"] };
    expect(() => inferenceDepuisSession(ort, mauvaisEntrees, fauxTokenizer())).toThrow(
      /graphe-inattendu/,
    );
    const sansTete: SessionOnnxMinimale = { ...session, outputNames: ["token_embeddings"] };
    expect(() => inferenceDepuisSession(ort, sansTete, fauxTokenizer())).toThrow(
      /graphe-inattendu/,
    );
  });

  it("lot vide → enveloppe vide, 0 run", async () => {
    const { ort, session } = montage();
    const brut = (await inferenceDepuisSession(ort, session, fauxTokenizer())([])) as {
      vecteurs: number[][];
    };
    expect(brut.vecteurs).toEqual([]);
    expect(session.appels()).toHaveLength(0);
  });
});

describe("R3-A — chargement session + tokenizer (fichiers épinglés)", () => {
  it("lit tokenizer.json + config, crée la session CPU 4 fils sur model.onnx", async () => {
    const lus: string[] = [];
    const lireFichier = (chemin: string): string => {
      lus.push(chemin);
      if (chemin.endsWith("tokenizer.json")) return JSON.stringify({ tok: 1 });
      if (chemin.endsWith("tokenizer_config.json")) return JSON.stringify({ cfg: 1 });
      throw new Error(`fichier inattendu : ${chemin}`);
    };
    let tokenizerArgs: unknown = null;
    const creerTokenizer = (json: unknown, config: unknown): TokenizerLocalMinimal => {
      tokenizerArgs = [json, config];
      return { encode: () => ({ ids: [0, 2], attention_mask: [1, 1] }), token_to_id: () => 0 };
    };
    let sessionArgs: unknown = null;
    const fabrique: FabriqueSession = {
      creerSession: async (chemin: string, options: OptionsSessionLocale) => {
        sessionArgs = [chemin, options];
        return { inputNames: ["input_ids", "attention_mask"], outputNames: ["a", "sentence_embedding"], run: async () => ({}) };
      },
    };
    const prete = await chargerSessionLocale("/m", lireFichier, creerTokenizer, fabrique);
    expect(lus).toEqual(["/m/tokenizer.json", "/m/tokenizer_config.json"]);
    expect(tokenizerArgs).toEqual([{ tok: 1 }, { cfg: 1 }]);
    expect(sessionArgs).toEqual(["/m/model.onnx", { intraOpNumThreads: 4, executionProviders: ["cpu"] }]);
    expect(prete.tokenizer).toBeDefined();
    expect(prete.session).toBeDefined();
  });

  it("tokenizer.json invalide → tokenizer-illisible, session jamais créée", async () => {
    let sessionCreee = false;
    const fabrique: FabriqueSession = {
      creerSession: async () => {
        sessionCreee = true;
        return { inputNames: [], outputNames: [], run: async () => ({}) };
      },
    };
    await expect(
      chargerSessionLocale("/m", () => "{invalide", () => {
        throw new Error("ne doit pas être appelé");
      }, fabrique),
    ).rejects.toThrow(/tokenizer-illisible/);
    expect(sessionCreee).toBe(false);
  });
});

describe("R3-D — vecteur de requête depuis un fournisseur (voie service)", () => {
  function fauxFournisseur(issue: ResultatEmbedding): EmbeddingProvider & {
    texteRequete(texte: string): string;
  } {
    return {
      nom: "faux-local",
      modele: "BAAI/bge-m3",
      version: "v",
      dimensions: 2,
      normalisation: "n",
      instruction_requete: "",
      instruction_document: "",
      distance: "cosine",
      texteRequete: (texte: string) => texte,
      embed: async () => issue,
    };
  }

  it("succès → premier vecteur (requête préfixée recette)", async () => {
    const vus: string[] = [];
    const base = fauxFournisseur({ ok: true, vecteurs: [[0.6, 0.8]], recette: {
      fournisseur: "faux-local",
      modele: "BAAI/bge-m3",
      versionModele: "v",
      dimensions: 2,
      normalisation: "n",
      instruction_requete: "",
      instruction_document: "",
      distance: "cosine",
      versionChunk: "struct-v1",
    } });
    const fournisseur = {
      ...base,
      texteRequete: (t: string) => {
        vus.push(t);
        return `Q:${t}`;
      },
    };
    const requete = vecteurRequeteDepuisFournisseur(fournisseur);
    await expect(requete("sertraline")).resolves.toEqual([0.6, 0.8]);
    expect(vus).toEqual(["sertraline"]);
  });

  it("échec fournisseur → null (lexical seul, jamais d'exception)", async () => {
    const requete = vecteurRequeteDepuisFournisseur(
      fauxFournisseur({ ok: false, error: { code: "indisponible", message: "panne" } }),
    );
    await expect(requete("sertraline")).resolves.toBeNull();
  });

  it("vecteurs vides → null", async () => {
    const requete = vecteurRequeteDepuisFournisseur(
      fauxFournisseur({ ok: true, vecteurs: [], recette: {
        fournisseur: "faux-local",
        modele: "BAAI/bge-m3",
        versionModele: "v",
        dimensions: 2,
        normalisation: "n",
        instruction_requete: "",
        instruction_document: "",
        distance: "cosine",
        versionChunk: "struct-v1",
      } }),
    );
    await expect(requete("sertraline")).resolves.toBeNull();
  });
});
