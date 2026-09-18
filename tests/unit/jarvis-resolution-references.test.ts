/**
 * `jarvis-resolution-references.test.ts` — le verdict M02, épuisé hors ligne.
 *
 * Zéro modèle, zéro base : `evaluerVerdictTour`, `construireIntentionChainee`
 * et `intentRetenuDesAppels` sont purs. Chaque cas prouve une transition du
 * plan durci (§3, §4, §9) — dont l'invariant M02-I1 : une mention explicite
 * non résolue ne retombe JAMAIS sur un fil pré-existant.
 */

import { describe, expect, it } from "vitest";

import {
  construireIntentionChainee,
  evaluerVerdictTour,
  fixerActivationResolutionM02,
  intentDeCapacite,
  intentRetenuDesAppels,
  resolutionM02Active,
  type EntreeVerdict,
} from "@/shared/jarvis/resolution-references";

const FIL_KARIM = { id: "uuid-karim", libelle: "Karim Benali", source: "conversation" as const };
const CANDIDAT_KARIM = { id: "uuid-karim", libelle: "Karim Benali" };

// ═══════════════════════════════════════════════════════════════════════════
// M02-I1 — la mention explicite sort du rang des fils
// ═══════════════════════════════════════════════════════════════════════════

describe("M02-I1 : mention explicite non résolue ne retombe jamais", () => {
  it("0 candidat + fil Karim => nonResolu SANS patient (jamais Karim)", () => {
    const entree: EntreeVerdict = {
      mention: "Sarah",
      sonde: { total: 0, candidats: [], depasse: false },
      fil: FIL_KARIM,
    };
    const v = evaluerVerdictTour(entree);
    expect(v.etat).toBe("nonResolu");
    expect(v.patient).toBeUndefined();
    expect(v.source).toBeUndefined();
    expect(v.mention).toBe("Sarah");
  });

  it("3 candidats + fil Karim => ambigu SANS patient (jamais Karim)", () => {
    const entree: EntreeVerdict = {
      mention: "Mohamed",
      sonde: {
        total: 3,
        candidats: [
          { id: "u-1", libelle: "Mohamed A" },
          { id: "u-2", libelle: "Mohamed B" },
          { id: "u-3", libelle: "Mohamed C" },
        ],
        depasse: false,
      },
      fil: FIL_KARIM,
    };
    const v = evaluerVerdictTour(entree);
    expect(v.etat).toBe("ambigu");
    expect(v.patient).toBeUndefined();
    expect(v.total).toBe(3);
    expect(v.libelles).toEqual(["Mohamed A", "Mohamed B", "Mohamed C"]);
  });

  it("mention sans sonde (panne de preuve) => nonResolu, jamais le fil", () => {
    const v = evaluerVerdictTour({ mention: "Sarah", sonde: null, fil: FIL_KARIM });
    expect(v.etat).toBe("nonResolu");
    expect(v.patient).toBeUndefined();
  });

  it("sonde incohérente (total 1, candidat vide) => nonResolu fail-closed", () => {
    const v = evaluerVerdictTour({
      mention: "Karim",
      sonde: { total: 1, candidats: [{ id: "  ", libelle: "?" }], depasse: false },
      fil: null,
    });
    expect(v.etat).toBe("nonResolu");
    expect(v.patient).toBeUndefined();
  });

  it("1 candidat + fil CONCURRENT (Nadia) => l'explicite gagne, jamais Nadia", () => {
    const v = evaluerVerdictTour({
      mention: "Karim",
      sonde: { total: 1, candidats: [CANDIDAT_KARIM], depasse: false },
      fil: { id: "uuid-nadia", libelle: "Nadia", source: "ecran" },
    });
    expect(v.etat).toBe("unique");
    expect(v.source).toBe("explicite");
    expect(v.patient).toEqual({ id: "uuid-karim", libelle: "Karim Benali" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Verdicts nominaux
// ═══════════════════════════════════════════════════════════════════════════

describe("verdicts nominaux", () => {
  it("1 candidat, sans fil => unique explicite", () => {
    const v = evaluerVerdictTour({
      mention: "Karim",
      sonde: { total: 1, candidats: [CANDIDAT_KARIM], depasse: false },
      fil: null,
    });
    expect(v).toMatchObject({
      etat: "unique",
      source: "explicite",
      patient: { id: "uuid-karim", libelle: "Karim Benali" },
      total: 1,
      mention: "Karim",
    });
  });

  it("2 candidats => ambigu avec libellés", () => {
    const v = evaluerVerdictTour({
      mention: "Mohamed",
      sonde: {
        total: 2,
        candidats: [
          { id: "u-1", libelle: "Mohamed A" },
          { id: "u-2", libelle: "Mohamed B" },
        ],
        depasse: false,
      },
      fil: null,
    });
    expect(v.etat).toBe("ambigu");
    expect(v.libelles).toHaveLength(2);
    expect(v.depasse).toBe(false);
  });

  it("résultat tronqué (total > visibles) => ambigu + dépassé", () => {
    const v = evaluerVerdictTour({
      mention: "Mohamed",
      sonde: {
        total: 7,
        candidats: [
          { id: "u-1", libelle: "Mohamed A" },
          { id: "u-2", libelle: "Mohamed B" },
        ],
        depasse: true,
      },
      fil: null,
    });
    expect(v.etat).toBe("ambigu");
    expect(v.total).toBe(7);
    expect(v.depasse).toBe(true);
    expect(v.libelles).toHaveLength(2);
  });

  it("0 candidat, sans fil => nonResolu avec total 0", () => {
    const v = evaluerVerdictTour({
      mention: "Sarah",
      sonde: { total: 0, candidats: [], depasse: false },
      fil: null,
    });
    expect(v.etat).toBe("nonResolu");
    expect(v.total).toBe(0);
  });

  it.each([
    ["ecran" as const],
    ["conversation" as const],
    ["ancre" as const],
  ])("sans mention + fil %s => unique, source préservée", (source) => {
    const v = evaluerVerdictTour({
      mention: null,
      sonde: null,
      fil: { id: "uuid-x", libelle: "X", source },
    });
    expect(v.etat).toBe("unique");
    expect(v.source).toBe(source);
    expect(v.patient).toEqual({ id: "uuid-x", libelle: "X" });
  });

  it("ni mention ni fil => aucun", () => {
    expect(evaluerVerdictTour({ mention: null, sonde: null, fil: null }).etat).toBe("aucun");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Chaînage — reuse, jamais d'invention
// ═══════════════════════════════════════════════════════════════════════════

describe("construireIntentionChainee", () => {
  const verdictKarim = evaluerVerdictTour({ mention: null, sonde: null, fil: FIL_KARIM });

  it("fil prouvé + intent précédent chaînable => intent reconstruit, plafonné", () => {
    const c = construireIntentionChainee({
      intentionPrecedente: "GET_CONSULTATION_HISTORY",
      mention: null,
      verdict: verdictKarim,
      filPrecedentId: "uuid-karim",
    });
    expect(c).not.toBeNull();
    expect(c?.name).toBe("GET_CONSULTATION_HISTORY");
    expect(c?.confidence).toBe(0.6);
    expect(c?.entities).toEqual({});
    expect(c?.missingInformation).toEqual([]);
    expect(c?.references).toEqual({ pronomSansAntecedent: false, homonymePossible: false });
  });

  it("mention explicite => null (nouveau fil, le classifieur décide)", () => {
    expect(
      construireIntentionChainee({
        intentionPrecedente: "GET_CONSULTATION_HISTORY",
        mention: "Nadia",
        verdict: verdictKarim,
        filPrecedentId: "uuid-karim",
      }),
    ).toBeNull();
  });

  it("sans intention précédente => null", () => {
    expect(
      construireIntentionChainee({
        intentionPrecedente: null,
        mention: null,
        verdict: verdictKarim,
        filPrecedentId: "uuid-karim",
      }),
    ).toBeNull();
  });

  it.each([["UNKNOWN"], ["ASK_CLARIFICATION"], ["GENERAL_KNOWLEDGE"]] as const)(
    "méta %s => null (rien à continuer)",
    (meta) => {
      expect(
        construireIntentionChainee({
          intentionPrecedente: meta,
          mention: null,
          verdict: verdictKarim,
          filPrecedentId: "uuid-karim",
        }),
      ).toBeNull();
    },
  );

  it.each([["CREATE_APPOINTMENT"], ["RECORD_PAYMENT_COLLECTED"], ["CANCEL_APPOINTMENT"]] as const)(
    "écriture %s => null (un suivi vague ne porte jamais d'écriture)",
    (ecriture) => {
      expect(
        construireIntentionChainee({
          intentionPrecedente: ecriture,
          mention: null,
          verdict: verdictKarim,
          filPrecedentId: "uuid-karim",
        }),
      ).toBeNull();
    },
  );

  it("verdict non unique => null", () => {
    const ambigu = evaluerVerdictTour({
      mention: "Mohamed",
      sonde: {
        total: 2,
        candidats: [
          { id: "u-1", libelle: "A" },
          { id: "u-2", libelle: "B" },
        ],
        depasse: false,
      },
      fil: FIL_KARIM,
    });
    expect(
      construireIntentionChainee({
        intentionPrecedente: "GET_CONSULTATION_HISTORY",
        mention: null,
        verdict: ambigu,
        filPrecedentId: "uuid-karim",
      }),
    ).toBeNull();
  });

  it("miroir divergé (fil précédent ≠ fil courant) => null, on jette", () => {
    expect(
      construireIntentionChainee({
        intentionPrecedente: "GET_CONSULTATION_HISTORY",
        mention: null,
        verdict: verdictKarim,
        filPrecedentId: "uuid-nadia",
      }),
    ).toBeNull();
  });

  it("miroir absent => null", () => {
    expect(
      construireIntentionChainee({
        intentionPrecedente: "GET_CONSULTATION_HISTORY",
        mention: null,
        verdict: verdictKarim,
        filPrecedentId: null,
      }),
    ).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Intent retenu — inverse de COMPATIBLE, ambiguïté = rien
// ═══════════════════════════════════════════════════════════════════════════

describe("intentRetenuDesAppels", () => {
  it("historique seul => GET_CONSULTATION_HISTORY", () => {
    expect(intentRetenuDesAppels(["get_consultation_history"])).toBe("GET_CONSULTATION_HISTORY");
  });

  it("recherche puis lecture => la lecture (la recherche n'inverse vers rien)", () => {
    expect(intentRetenuDesAppels(["search_patients", "get_current_medications"])).toBe(
      "GET_CURRENT_MEDICATIONS",
    );
  });

  it("lecture puis recherche (tâtonnement) => la lecture", () => {
    expect(intentRetenuDesAppels(["get_patient_context", "search_patients"])).toBe(
      "GET_PATIENT_CONTEXT",
    );
  });

  it("recherche seule => null", () => {
    expect(intentRetenuDesAppels(["search_patients"])).toBeNull();
  });

  it("capacité partagée (get_agenda_range, 3 intents) => null", () => {
    expect(intentDeCapacite("get_agenda_range")).toBeNull();
    expect(intentRetenuDesAppels(["get_agenda_range"])).toBeNull();
  });

  it("search_patients n'inverse vers rien (premier pas de presque tout)", () => {
    expect(intentDeCapacite("search_patients")).toBeNull();
  });

  it("vide => null", () => {
    expect(intentRetenuDesAppels([])).toBeNull();
  });

  it("capacité inconnue => null (jamais d'invention)", () => {
    expect(intentDeCapacite("outil_invente")).toBeNull();
    expect(intentRetenuDesAppels(["outil_invente"])).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Interrupteur
// ═══════════════════════════════════════════════════════════════════════════

describe("interrupteur M02", () => {
  it("actif par défaut, bascule réversible (restauré après)", () => {
    expect(resolutionM02Active()).toBe(true);
    fixerActivationResolutionM02(false);
    expect(resolutionM02Active()).toBe(false);
    fixerActivationResolutionM02(true);
    expect(resolutionM02Active()).toBe(true);
  });
});
