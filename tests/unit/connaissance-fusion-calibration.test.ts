/**
 * M07 slice 3 — calibration de fusion : mécanisme paramétré + garde-fous.
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * `rerankerCalibre` (même contrat que `reranker`, + `CalibrationFusion`) :
 *   · défaut = comportement historique à l'identique (pin, pas de dérive
 *     silencieuse) ;
 *   · monotonie en couverture ET en similarité (garde-fou anti-sur-ajustement :
 *     un score qui baisserait quand la preuve s'améliore serait un bricolage
 *     du golden, pas une calibration) ;
 *   · conjonction (δ≥1) : sans recouvrement lexical, le vecteur seul ne fait
 *     jamais franchir SEUIL_FAIBLESSE — « un voisin qui ne couvre rien de la
 *     question ne répond pas » ;
 *   · bornes [0,1], déterminisme à l'octet, topN.
 *
 * Les SEUILS (preuve.ts) ne sont PAS touchés ici : seuls les poids/forme du
 * score sont paramétrés. R0 (ADR-037) reste l'arbitre via `--reel`.
 */
import { describe, expect, it } from "vitest";

import { SEUIL_FAIBLESSE } from "../../src/server/knowledge/preuve";
import {
  CALIBRATION_COURANTE,
  type CalibrationFusion,
  HeuristiqueBaseline,
  reranker,
  rerankerCalibre,
} from "../../src/server/knowledge/rerank";
import type { CandidatFusionne } from "../../src/server/knowledge/recherche";

function candidat(surcharge: Partial<CandidatFusionne> & { chunkId: string }): CandidatFusionne {
  return {
    sourceId: "source-1",
    sourceTitre: "Guide anxiété",
    sourceVersion: "2026-09-01",
    section: "Traitement",
    versionChunk: "struct-v1",
    langue: "fr",
    texte: "La sertraline 50 mg est une option de première intention.",
    scoreLexical: null,
    scoreVectoriel: 0.7,
    ...surcharge,
  };
}

const REQUETE = "sertraline 50 mg";

describe("calibration de fusion (M07 slice 3)", () => {
  it("défaut = historique : mêmes scores, même ordre (pin anti-dérive)", () => {
    const candidats = [
      candidat({ chunkId: "a", scoreVectoriel: 0.7 }),
      candidat({ chunkId: "b", scoreVectoriel: 0.3, texte: "La clôture comptable mensuelle du cabinet." }),
      candidat({ chunkId: "c", scoreVectoriel: 0.9 }),
    ];
    const historique = reranker(REQUETE, candidats, 5);
    const calibre = rerankerCalibre(REQUETE, candidats, 5, CALIBRATION_COURANTE);
    expect(calibre.map((r) => r.candidat.chunkId)).toEqual(historique.map((r) => r.candidat.chunkId));
    expect(calibre.map((r) => r.score)).toEqual(historique.map((r) => r.score));
    expect(calibre).toEqual(historique);
  });

  it("HeuristiqueBaseline inchangée : nom + version (M13 s'y substitue, pas slice 3)", () => {
    expect(HeuristiqueBaseline.nom).toBe("heuristic-baseline");
    expect(HeuristiqueBaseline.version).toBe("local-v1");
  });

  it("monotonie en couverture : à similarité fixée, plus de couverture ne dégrade jamais", () => {
    const textes = [
      "La clôture comptable mensuelle du cabinet.", // couverture 0
      "La sertraline est mentionnée ici.", // couverture partielle
      "La sertraline 50 mg est une option de première intention.", // couverture totale
    ];
    const calib: CalibrationFusion = { poidsCouverture: 0.55, poidsVecteur: 0.45, exposantCouverture: 2, exposantVecteur: 2 };
    const scores = textes.map(
      (texte) => rerankerCalibre(REQUETE, [candidat({ chunkId: "x", texte, scoreVectoriel: 0.6 })], 5, calib)[0]!.score,
    );
    expect(scores[0]).toBeLessThanOrEqual(scores[1]!);
    expect(scores[1]).toBeLessThanOrEqual(scores[2]!);
  });

  it("monotonie en similarité : à couverture fixée, plus de similarité ne dégrade jamais", () => {
    const calib: CalibrationFusion = { poidsCouverture: 0.55, poidsVecteur: 0.45, exposantCouverture: 2, exposantVecteur: 2 };
    const scores = [0.1, 0.5, 0.9].map(
      (sim) => rerankerCalibre(REQUETE, [candidat({ chunkId: "x", scoreVectoriel: sim })], 5, calib)[0]!.score,
    );
    expect(scores[0]).toBeLessThanOrEqual(scores[1]!);
    expect(scores[1]).toBeLessThanOrEqual(scores[2]!);
  });

  it("conjonction (δ≥1) : couverture nulle → jamais faible, même à similarité maximale", () => {
    const calib: CalibrationFusion = { poidsCouverture: 0.55, poidsVecteur: 0.45, exposantCouverture: 1, exposantVecteur: 1 };
    const range = rerankerCalibre(
      REQUETE,
      [candidat({ chunkId: "x", texte: "La clôture comptable mensuelle du cabinet.", scoreVectoriel: 1.0 })],
      5,
      calib,
    )[0]!;
    expect(range.apparies).toHaveLength(0);
    expect(range.score).toBeLessThan(SEUIL_FAIBLESSE);
  });

  it("bornes : score ∈ [0,1], topN respecté, vide → vide", () => {
    const calib: CalibrationFusion = { poidsCouverture: 0.55, poidsVecteur: 0.45, exposantCouverture: 2, exposantVecteur: 2 };
    const candidats = [
      candidat({ chunkId: "a", scoreVectoriel: 1.0 }),
      candidat({ chunkId: "b", scoreVectoriel: -1.0 }),
      candidat({ chunkId: "c", scoreVectoriel: null }),
    ];
    const ranges = rerankerCalibre(REQUETE, candidats, 2, calib);
    expect(ranges).toHaveLength(2);
    for (const r of ranges) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
    expect(rerankerCalibre(REQUETE, [], 5, calib)).toEqual([]);
  });

  it("déterminisme : même entrée → même ordre à l'octet", () => {
    const calib: CalibrationFusion = { poidsCouverture: 0.55, poidsVecteur: 0.45, exposantCouverture: 2, exposantVecteur: 2 };
    const candidats = [
      candidat({ chunkId: "b", scoreVectoriel: 0.6 }),
      candidat({ chunkId: "a", scoreVectoriel: 0.6 }),
    ];
    const premier = JSON.stringify(rerankerCalibre(REQUETE, candidats, 5, calib));
    const second = JSON.stringify(rerankerCalibre(REQUETE, [...candidats].reverse(), 5, calib));
    expect(premier).toBe(second);
  });
});

describe("porte de majorité (M07 slice 3, A3)", () => {
  // Un voisin purement vectoriel (jamais vu par le lexical, qui exige
  // l'unanimité des termes) ne répond que s'il couvre la MAJORITÉ STRICTE
  // de la question (2·appariés > jetons). En deçà : silence (score 0),
  // jamais une preuve faible. Les candidats corroborés lexicalement
  // (scoreLexical non nul) en sont exempts.
  const A3: CalibrationFusion = {
    poidsCouverture: 0.55,
    poidsVecteur: 0.45,
    exposantCouverture: 1,
    exposantVecteur: 1,
    porteMajorite: true,
  };

  it("éteinte par défaut : CALIBRATION_COURANTE ignore la porte (pin historique)", () => {
    expect(CALIBRATION_COURANTE.porteMajorite ?? false).toBe(false);
  });

  it("voisin pur à couverture moitié (1/2) → silence, même à similarité maximale", () => {
    // « sertraline ou paroxétine » : 2 jetons, 1 apparié → 1/2, pas majoritaire.
    const range = rerankerCalibre(
      "sertraline ou paroxétine",
      [candidat({ chunkId: "x", texte: "La paroxétine 20 mg est un ISRS souvent prescrit.", scoreLexical: null, scoreVectoriel: 1.0 })],
      5,
      A3,
    )[0]!;
    expect(range.apparies).toHaveLength(1);
    expect(range.score).toBe(0);
  });

  it("voisin pur à couverture majoritaire (2/3) → noté normalement (TY-01)", () => {
    const range = rerankerCalibre(
      REQUETE,
      [candidat({ chunkId: "x", texte: "Sertraline 50 contre placebo.", scoreLexical: null, scoreVectoriel: 0.73 })],
      5,
      A3,
    )[0]!;
    expect(range.apparies).toHaveLength(2);
    expect(range.score).toBeGreaterThanOrEqual(0.4);
  });

  it("candidat corroboré lexicalement à couverture moitié → exempt de la porte", () => {
    const range = rerankerCalibre(
      "sertraline ou paroxétine",
      [candidat({ chunkId: "x", texte: "La paroxétine 20 mg est un ISRS souvent prescrit.", scoreLexical: 0.25, scoreVectoriel: 0.6 })],
      5,
      A3,
    )[0]!;
    expect(range.score).toBeGreaterThan(0);
  });

  it("la porte préserve la monotonie : plus de couverture ne dégrade jamais", () => {
    // REQUETE = 3 jetons : 1/3 → silence (porte), 2/3 et 3/3 → formule croissante.
    const textes = [
      "La sertraline est mentionnée.", // 1/3
      "Sertraline 50 contre placebo.", // 2/3
      "La sertraline 50 mg est une option.", // 3/3
    ];
    const scores = textes.map(
      (texte) => rerankerCalibre(REQUETE, [candidat({ chunkId: "x", texte, scoreLexical: null, scoreVectoriel: 0.6 })], 5, A3)[0]!.score,
    );
    expect(scores[0]).toBe(0);
    expect(scores[0]).toBeLessThanOrEqual(scores[1]!);
    expect(scores[1]).toBeLessThanOrEqual(scores[2]!);
  });
});
