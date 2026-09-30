/**
 * Audit Alexa/Jarvis Slice 1 — la taxonomie d'erreur après la scission du
 * quatrième organe (`connaissance`).
 *
 * Ce fichier fige le contrat : chaque code de passerelle nomme SON organe en
 * panne, et `classerAppError` reste exhaustif (le `never` de
 * `jarvis-erreurs.ts` casse la compilation si un code est oublié — ce test
 * prouve en plus le RENDU, que `tsc` ne voit pas).
 */

import { describe, expect, it } from "vitest";

import { classerCodeEdge } from "@/services/errors";
import {
  classerAppError,
  classerMotifEchec,
  libelleEcran,
} from "@/services/jarvis-erreurs";

describe("taxonomie Slice 1 — chaque organe nomme sa panne", () => {
  it("citation-invalide → connaissance (pas indisponible)", () => {
    expect(classerCodeEdge("citation-invalide")).toBe("connaissance");
  });

  it("configuration (clé modèle) → analyse (pas indisponible)", () => {
    expect(classerCodeEdge("configuration")).toBe("analyse");
  });

  it("hors-ligne traverse tel quel (pas repli données)", () => {
    expect(classerCodeEdge("hors-ligne")).toBe("hors-ligne");
  });

  it("analyse-indisponible → analyse (régression : inchangé)", () => {
    expect(classerCodeEdge("analyse-indisponible")).toBe("analyse");
  });

  it("code inconnu → indisponible (repli gracieux inchangé)", () => {
    expect(classerCodeEdge("code-que-personne-connait")).toBe("indisponible");
    expect(classerCodeEdge(undefined)).toBe("indisponible");
  });

  it("connaissance → KNOWLEDGE_UNAVAILABLE dans le tiroir Alexa", () => {
    expect(classerAppError("connaissance")).toBe("KNOWLEDGE_UNAVAILABLE");
  });

  it("le libellé KNOWLEDGE_UNAVAILABLE ne parle ni de données ni d'analyse", () => {
    const libelle = libelleEcran("KNOWLEDGE_UNAVAILABLE");
    expect(libelle).toContain("recherche documentaire");
    expect(libelle).not.toContain("données");
    expect(libelle).not.toContain("analyse");
  });

  it("classerMotifEchec reste inchangé sur les motifs historiques", () => {
    expect(classerMotifEchec("delai-depasse")).toBe("TOOL_TIMEOUT");
    expect(classerMotifEchec("indisponible")).toBe("TOOL_UNAVAILABLE");
    expect(classerMotifEchec("code-inconnu-xyz")).toBe("TOOL_UNAVAILABLE");
    expect(classerMotifEchec(null)).toBe("OK");
  });
});
