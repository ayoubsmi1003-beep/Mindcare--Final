/**
 * M07 — Embeddings : porte C4, invariant zéro-octet, réponses validées.
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * C1/C2/UNKNOWN/C3-sans-reçu → `frontiere` avec 0 appel transport (matrice
 * n°1-5) ; faux C4 patient-identifiable bloqué sur les octets ; réponse
 * malformée → `invalide` sans vecteur partiel (n°6) ; dérive détectée (n°26).
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * L'autorité finale `external-call.ts` (câblage après la porte B, pas de
 * modèle verrouillé) — ici le transport est un doublon compté.
 */
import { describe, expect, it, vi } from "vitest";

import { CHUNKER_VERSION } from "../../src/server/knowledge/decoupage";
import {
  FournisseurC4Externe,
  FournisseurLocalIndisponible,
  passerelleEmbedding,
  recetteCompatible,
  type EmbeddingProvider,
  type TransportEmbedding,
} from "../../src/server/knowledge/embeddings";

const CONFIG = {
  nom: "faux-c4",
  modele: "faux-modele-v1",
  version: "2026-09-15",
  dimensions: 4,
  normalisation: "nfkc-trim-v1",
  instruction_requete: "query: ",
  instruction_document: "passage: ",
  distance: "cosine",
  versionChunk: CHUNKER_VERSION,
} as const;

function transportOk(vecteurs: readonly (readonly number[])[] = [[0.1, 0.2, 0.3, 0.4]]): {
  transport: TransportEmbedding;
  appels: () => number;
} {
  let n = 0;
  const transport: TransportEmbedding = async (textes) => {
    n += 1;
    void textes;
    return { vecteurs };
  };
  return { transport, appels: () => n };
}

function fournisseur(transport: TransportEmbedding): EmbeddingProvider {
  return new FournisseurC4Externe({ ...CONFIG }, transport);
}

describe("porte C4 — invariant zéro-octet (matrice n°1-5)", () => {
  it.each(["C1", "C2", "INCONNU"] as const)("déclaré %s → frontiere, 0 appel transport", async (classification) => {
    const { transport, appels } = transportOk();
    const resultat = await passerelleEmbedding(fournisseur(transport), {
      textes: ["Un texte générique sur l'anxiété."],
      classification,
    });
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.error.code).toBe("frontiere");
    expect(appels()).toBe(0);
  });

  it("C3 sans reçu approuvé → frontiere, 0 appel (matrice n°4)", async () => {
    const { transport, appels } = transportOk();
    const resultat = await passerelleEmbedding(fournisseur(transport), {
      textes: ["total 12000"],
      classification: "C3",
    });
    expect(resultat.ok).toBe(false);
    expect(appels()).toBe(0);
  });

  it("faux C4 patient-identifiable bloqué sur les OCTETS (matrice n°5)", async () => {
    const { transport, appels } = transportOk();
    const resultat = await passerelleEmbedding(fournisseur(transport), {
      // Déclaré C4, mais les octets portent un dossier : les octets gagnent.
      textes: ["Le dossier D-2026-0417 de Karim Belkacem : revoir la posologie."],
      classification: "C4",
    });
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.error.code).toBe("frontiere");
    expect(appels()).toBe(0);
  });

  it("vrai C4 → 1 appel, vecteurs + recette", async () => {
    const { transport, appels } = transportOk();
    const resultat = await passerelleEmbedding(fournisseur(transport), {
      textes: ["La sertraline est un inhibiteur sélectif de la recapture de la sérotonine."],
      classification: "C4",
    });
    expect(resultat.ok).toBe(true);
    if (resultat.ok) {
      expect(resultat.vecteurs).toHaveLength(1);
      expect(resultat.recette).toMatchObject({ modele: CONFIG.modele, dimensions: 4 });
    }
    expect(appels()).toBe(1);
  });

  it("C3 avec reçu approuvé → autorisé (politique M05 existante)", async () => {
    const { transport, appels } = transportOk();
    const resultat = await passerelleEmbedding(fournisseur(transport), {
      textes: ["total 12000"],
      classification: "C3",
      recu: { transformId: "agg-finance-v1" },
    });
    expect(resultat.ok).toBe(true);
    expect(appels()).toBe(1);
  });
});

describe("validation de réponse (matrice n°6)", () => {
  it.each([
    ["sans enveloppe", { rien: [] }],
    ["vecteur de mauvaise dimension", { vecteurs: [[0.1, 0.2]] }],
    ["composante non finie", { vecteurs: [[0.1, 0.2, Number.NaN, 0.4]] }],
    ["composante non numérique", { vecteurs: [[0.1, 0.2, "0.3", 0.4]] }],
  ])("réponse %s → invalide, aucun vecteur partiel", async (_cas, brut) => {
    const faux = vi.fn(async (_t: readonly string[]) => brut as unknown);
    const resultat = await fournisseur(faux).embed(["texte"]);
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.error.code).toBe("invalide");
    expect(faux).toHaveBeenCalledTimes(1);
  });

  it("lot vide → ok vide, 0 appel transport", async () => {
    const faux = vi.fn(async (_t: readonly string[]) => ({ vecteurs: [] as number[][] }));
    const resultat = await fournisseur(faux).embed([]);
    expect(resultat).toMatchObject({ ok: true });
    expect(faux).not.toHaveBeenCalled();
  });
});

describe("fournisseur local indisponible → fermé", () => {
  it("échoue `indisponible`, jamais de repli silencieux", async () => {
    const resultat = await new FournisseurLocalIndisponible().embed(["texte"]);
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.error.code).toBe("indisponible");
  });
});

describe("dérive de recette (matrice n°26, H0.5 — 9 champs immuables)", () => {
  const recette = {
    fournisseur: CONFIG.nom,
    modele: CONFIG.modele,
    versionModele: CONFIG.version,
    dimensions: CONFIG.dimensions,
    normalisation: CONFIG.normalisation,
    instruction_requete: CONFIG.instruction_requete,
    instruction_document: CONFIG.instruction_document,
    distance: CONFIG.distance,
    versionChunk: CHUNKER_VERSION,
  };

  it("recette identique → compatible", () => {
    expect(recetteCompatible(recette, fournisseur(transportOk().transport), CHUNKER_VERSION)).toBe(true);
  });

  it.each([
    ["modèle", { ...recette, modele: "autre-modele" }],
    ["version", { ...recette, versionModele: "2020-01-01" }],
    ["dimensions", { ...recette, dimensions: 8 }],
    ["normalisation", { ...recette, normalisation: "autre-v1" }],
    ["consigne requête", { ...recette, instruction_requete: "autre: " }],
    ["consigne document", { ...recette, instruction_document: "autre: " }],
    ["distance", { ...recette, distance: "euclidienne" }],
    ["découpeur", { ...recette, versionChunk: "struct-v2" }],
  ])("changement de %s → incompatible, ré-embedding requis", (_cas, alteree) => {
    expect(recetteCompatible(alteree, fournisseur(transportOk().transport), CHUNKER_VERSION)).toBe(false);
  });
});
