/**
 * `jarvis-intention-chainee.test.ts` — l'inlet M02, règle par règle.
 *
 * Pur et hors ligne : aucune passerelle, aucune base. Chaque cas prouve une
 * ligne du contrat (`intention-chainee.ts`) — surtout les refus : un client
 * compromis ou buggué ne doit jamais obtenir d'intent chaîné dangereux.
 */

import { describe, expect, it } from "vitest";

import { intentionChaineeOperationnelle } from "@/server/jarvis/intention-chainee";
import type { ResultatClassification } from "@/server/jarvis/classifieur-intentions";

function valide(nom: string): ResultatClassification {
  return {
    statut: "valide",
    intent: {
      name: nom as "UNKNOWN",
      entities: {},
      references: { pronomSansAntecedent: false, homonymePossible: false },
      confidence: 0.9,
      missingInformation: [],
    },
    latenceMs: 1,
    modele: "test",
  };
}

const ECARTE: ResultatClassification = {
  statut: "ecarte",
  raison: "indisponible",
  latenceMs: 1,
  modele: "test",
};

const BRUTE = { nom: "GET_CONSULTATION_HISTORY", conversationId: "conv-1" };

describe("intentionChaineeOperationnelle", () => {
  it("classifieur en panne (écarté) + histoire + même conversation => intent reconstruit, plafonné", () => {
    const intent = intentionChaineeOperationnelle(BRUTE, ECARTE, "patient", "conv-1");
    expect(intent).not.toBeNull();
    expect(intent?.name).toBe("GET_CONSULTATION_HISTORY");
    expect(intent?.confidence).toBe(0.6);
    expect(intent?.entities).toEqual({});
    expect(intent?.missingInformation).toEqual([]);
  });

  it("UNKNOWN confiant + histoire => rempli (le cas « Et avant ? »)", () => {
    expect(intentionChaineeOperationnelle(BRUTE, valide("UNKNOWN"), "patient", "conv-1")?.name).toBe(
      "GET_CONSULTATION_HISTORY",
    );
  });

  it("classifieur décidé (HISTORY valide) => null, jamais d'écrasement", () => {
    expect(
      intentionChaineeOperationnelle(BRUTE, valide("GET_CONSULTATION_HISTORY"), "patient", "conv-1"),
    ).toBeNull();
  });

  it("ASK_CLARIFICATION confiant => null, on respecte la demande", () => {
    expect(intentionChaineeOperationnelle(BRUTE, valide("ASK_CLARIFICATION"), "patient", "conv-1")).toBeNull();
  });

  it("classification absente (coupe-circuit) + histoire => rempli", () => {
    expect(intentionChaineeOperationnelle(BRUTE, null, "patient", "conv-1")?.name).toBe(
      "GET_CONSULTATION_HISTORY",
    );
  });

  it("chemin refus => null, toujours (le refus est absolu)", () => {
    expect(intentionChaineeOperationnelle(BRUTE, ECARTE, "refus", "conv-1")).toBeNull();
    expect(intentionChaineeOperationnelle(BRUTE, valide("UNKNOWN"), "refus", "conv-1")).toBeNull();
  });

  it("connaissance + panne classifieur => rempli (escalade du suivi nu)", () => {
    expect(intentionChaineeOperationnelle(BRUTE, ECARTE, "connaissance", "conv-1")?.name).toBe(
      "GET_CONSULTATION_HISTORY",
    );
  });

  it("connaissance + UNKNOWN => rempli (le cas « Et avant ? »)", () => {
    expect(
      intentionChaineeOperationnelle(BRUTE, valide("UNKNOWN"), "connaissance", "conv-1")?.name,
    ).toBe("GET_CONSULTATION_HISTORY");
  });

  it("connaissance + savoir DÉCIDÉ (GENERAL_KNOWLEDGE) => null, pas d'escalade", () => {
    expect(
      intentionChaineeOperationnelle(BRUTE, valide("GENERAL_KNOWLEDGE"), "connaissance", "conv-1"),
    ).toBeNull();
  });

  it("connaissance + ASK => null", () => {
    expect(
      intentionChaineeOperationnelle(BRUTE, valide("ASK_CLARIFICATION"), "connaissance", "conv-1"),
    ).toBeNull();
  });

  it("écriture chaînée => null (client compromis : refusé)", () => {
    expect(
      intentionChaineeOperationnelle(
        { nom: "CREATE_APPOINTMENT", conversationId: "conv-1" },
        ECARTE,
        "patient",
        "conv-1",
      ),
    ).toBeNull();
  });

  it("méta chaînée => null", () => {
    expect(
      intentionChaineeOperationnelle({ nom: "UNKNOWN", conversationId: "conv-1" }, ECARTE, "patient", "conv-1"),
    ).toBeNull();
  });

  it("conversation différente => null (anti-rejeu inter-conversations)", () => {
    expect(intentionChaineeOperationnelle(BRUTE, ECARTE, "patient", "conv-2")).toBeNull();
  });

  it("nom inconnu => null", () => {
    expect(
      intentionChaineeOperationnelle({ nom: "FAIRE_CAFE", conversationId: "conv-1" }, ECARTE, "patient", "conv-1"),
    ).toBeNull();
  });

  it("corps absent ou malformé => null", () => {
    expect(intentionChaineeOperationnelle(null, ECARTE, "patient", "conv-1")).toBeNull();
    expect(intentionChaineeOperationnelle(undefined, ECARTE, "patient", "conv-1")).toBeNull();
    expect(
      intentionChaineeOperationnelle({ nom: 42, conversationId: "conv-1" }, ECARTE, "patient", "conv-1"),
    ).toBeNull();
  });
});
