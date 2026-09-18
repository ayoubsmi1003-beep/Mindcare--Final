/**
 * M06 — ResponseGuard : la garde ne constate un succès que prouvé.
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * La fonction PURE `garderReponse` (aucune base, aucun réseau, aucun LLM) :
 * un seul chemin rend `ALLOW_SUCCESS` — exécution prouvée + entité affectée
 * + relecture prouvée + correspondance totale (outil, arguments, patient).
 * Tout le reste BLOQUE, avec la raison qui désigne le défaut.
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * L'autorisation acteur/cabinet (RLS, éprouvée en
 * `tests/integration/jarvis-approbation.test.ts` et `checkpoint-v2.sql`
 * C14/C16), ni la relecture métier elle-même (`eval-jarvis-ecritures` E3/E4).
 * La garde compare ; elle n'autorise ni ne relit.
 */
import { describe, expect, it } from "vitest";

import {
  garderReponse,
  type EntreeGarde,
} from "../../src/services/jarvis-response-guard";

const ACTION = "11111111-1111-1111-8111-111111111111";
const AFFECTE = "22222222-2222-2222-8222-222222222222";
const PATIENT_A = "00000000-0000-0000-0000-0000000000b1";
const PATIENT_B = "00000000-0000-0000-0000-0000000000b2";

function argsDeplacement(patient: string): Record<string, unknown> {
  return {
    appointmentId: "33333333-3333-3333-8333-333333333333",
    patientId: patient,
    nouveauDebut: "2026-09-20T15:00:00+01:00",
    dureeMinutes: 30,
  };
}

function entreeValide(): EntreeGarde {
  const args = argsDeplacement(PATIENT_A);
  return {
    actionId: ACTION,
    canonique: { outil: "reschedule_appointment", args },
    verifieAvec: { outil: "reschedule_appointment", args: { ...args } },
    execution: { ok: true, affecteId: AFFECTE },
    verification: { ok: true },
  };
}

describe("succès prouvé uniquement", () => {
  it("exécution + relecture + correspondance → ALLOW_SUCCESS", () => {
    expect(garderReponse(entreeValide())).toEqual({ verdict: "ALLOW_SUCCESS" });
  });

  it("ordre des clés sans importance (comparaison canonique)", () => {
    const e = entreeValide();
    const inverse = Object.fromEntries(
      Object.entries(e.canonique.args as Record<string, unknown>).reverse(),
    );
    expect(
      garderReponse({ ...e, verifieAvec: { outil: "reschedule_appointment", args: inverse } }),
    ).toEqual({ verdict: "ALLOW_SUCCESS" });
  });
});

describe("exécution non prouvée → NOT_EXECUTED", () => {
  it("porte en échec", () => {
    const e = entreeValide();
    expect(
      garderReponse({ ...e, execution: { ok: false, affecteId: null } }),
    ).toEqual({ verdict: "BLOCK", reason: "NOT_EXECUTED" });
  });

  it("affecté manquant (NULL = cible introuvable ou hors périmètre)", () => {
    const e = entreeValide();
    expect(
      garderReponse({ ...e, execution: { ok: true, affecteId: null } }),
    ).toEqual({ verdict: "BLOCK", reason: "NOT_EXECUTED" });
  });

  it("affecté vide", () => {
    const e = entreeValide();
    expect(
      garderReponse({ ...e, execution: { ok: true, affecteId: "" } }),
    ).toEqual({ verdict: "BLOCK", reason: "NOT_EXECUTED" });
  });
});

describe("relecture non prouvée → NOT_VERIFIED", () => {
  it("verifier en échec malgré une exécution ok", () => {
    const e = entreeValide();
    expect(garderReponse({ ...e, verification: { ok: false } })).toEqual({
      verdict: "BLOCK",
      reason: "NOT_VERIFIED",
    });
  });
});

describe("correspondance action → MISMATCH_ACTION", () => {
  it("outil relu ≠ outil de l'action (A approuvé, B vérifié)", () => {
    const e = entreeValide();
    expect(
      garderReponse({
        ...e,
        verifieAvec: { outil: "cancel_appointment", args: e.canonique.args },
      }),
    ).toEqual({ verdict: "BLOCK", reason: "MISMATCH_ACTION" });
  });
});

describe("correspondance patient/contexte → MISMATCH_PATIENT", () => {
  it("patient relu ≠ patient de l'action (le cas qui compte vraiment)", () => {
    const e = entreeValide();
    expect(
      garderReponse({
        ...e,
        verifieAvec: {
          outil: "reschedule_appointment",
          args: argsDeplacement(PATIENT_B),
        },
      }),
    ).toEqual({ verdict: "BLOCK", reason: "MISMATCH_PATIENT" });
  });

  it("convention snake_case couverte aussi", () => {
    const canonique = { patient_id: PATIENT_A, starts_at: "2026-09-20T15:00:00+01:00" };
    const relus = { patient_id: PATIENT_B, starts_at: "2026-09-20T15:00:00+01:00" };
    const e = entreeValide();
    expect(
      garderReponse({
        ...e,
        canonique: { outil: "create_appointment", args: canonique },
        verifieAvec: { outil: "create_appointment", args: relus },
      }),
    ).toEqual({ verdict: "BLOCK", reason: "MISMATCH_PATIENT" });
  });

  it("consultation divergente = autre contexte", () => {
    const e = entreeValide();
    const args = {
      consultationId: "44444444-4444-4444-8444-444444444444",
      amountDzd: 5000,
    };
    expect(
      garderReponse({
        ...e,
        canonique: { outil: "set_consultation_price", args },
        verifieAvec: {
          outil: "set_consultation_price",
          args: { ...args, consultationId: "55555555-5555-5555-8555-555555555555" },
        },
      }),
    ).toEqual({ verdict: "BLOCK", reason: "MISMATCH_PATIENT" });
  });

  it("divergence mixte patient + métier → MISMATCH_ARGS (pas de sous-classe)", () => {
    const e = entreeValide();
    expect(
      garderReponse({
        ...e,
        verifieAvec: {
          outil: "reschedule_appointment",
          args: { ...argsDeplacement(PATIENT_B), dureeMinutes: 60 },
        },
      }),
    ).toEqual({ verdict: "BLOCK", reason: "MISMATCH_ARGS" });
  });
});

describe("correspondance arguments → MISMATCH_ARGS", () => {
  it("heure relue ≠ heure de l'action", () => {
    const e = entreeValide();
    expect(
      garderReponse({
        ...e,
        verifieAvec: {
          outil: "reschedule_appointment",
          args: { ...argsDeplacement(PATIENT_A), nouveauDebut: "2026-09-20T16:00:00+01:00" },
        },
      }),
    ).toEqual({ verdict: "BLOCK", reason: "MISMATCH_ARGS" });
  });

  it("clé inattendue rejetée (esprit strictObject : jamais ignorée)", () => {
    const e = entreeValide();
    expect(
      garderReponse({
        ...e,
        verifieAvec: {
          outil: "reschedule_appointment",
          args: { ...argsDeplacement(PATIENT_A), force: true },
        },
      }),
    ).toEqual({ verdict: "BLOCK", reason: "MISMATCH_ARGS" });
  });

  it("clé manquante", () => {
    const e = entreeValide();
    const { dureeMinutes: _retiree, ...restants } = argsDeplacement(PATIENT_A);
    void _retiree;
    expect(
      garderReponse({
        ...e,
        verifieAvec: { outil: "reschedule_appointment", args: restants },
      }),
    ).toEqual({ verdict: "BLOCK", reason: "MISMATCH_ARGS" });
  });
});

describe("doublon connu → DUPLICATE", () => {
  it("déjà menée au succès dans la session, même si la porte rendait ok", () => {
    const e = entreeValide();
    expect(
      garderReponse({ ...e, execution: { ok: true, affecteId: AFFECTE, dejaExecutee: true } }),
    ).toEqual({ verdict: "BLOCK", reason: "DUPLICATE" });
  });

  it("déjà menée au succès + nouvel échec → DUPLICATE, pas NOT_EXECUTED", () => {
    const e = entreeValide();
    expect(
      garderReponse({ ...e, execution: { ok: false, affecteId: null, dejaExecutee: true } }),
    ).toEqual({ verdict: "BLOCK", reason: "DUPLICATE" });
  });
});

describe("entrée malformée → MALFORMED", () => {
  it("actionId vide", () => {
    expect(garderReponse({ ...entreeValide(), actionId: "" })).toEqual({
      verdict: "BLOCK",
      reason: "MALFORMED",
    });
  });

  it("outil canonique vide", () => {
    const e = entreeValide();
    expect(
      garderReponse({ ...e, canonique: { outil: "", args: e.canonique.args } }),
    ).toEqual({ verdict: "BLOCK", reason: "MALFORMED" });
  });

  it("arguments persistés NULL (ligne malformée / direct-RPC)", () => {
    const e = entreeValide();
    expect(
      garderReponse({ ...e, canonique: { outil: "reschedule_appointment", args: null } }),
    ).toEqual({ verdict: "BLOCK", reason: "MALFORMED" });
  });

  it("arguments persistés non-objet (chaîne, tableau)", () => {
    const e = entreeValide();
    for (const args of ["pas un objet", ["tableau"], 42]) {
      expect(
        garderReponse({ ...e, canonique: { outil: "reschedule_appointment", args } }),
      ).toEqual({ verdict: "BLOCK", reason: "MALFORMED" });
    }
  });
});
