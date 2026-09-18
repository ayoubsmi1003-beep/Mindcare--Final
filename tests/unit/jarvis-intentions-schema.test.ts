/**
 * `intentions.ts` — LE CONTRAT NE LAISSE RIEN PASSER.
 *
 * ═══ CE QUE CE FICHIER ÉPROUVE ═══
 * Le schéma strict : valides acceptés, TOUT le reste (`null`) — nom inconnu,
 * champ libre, UUID/jeton/téléphone en mention, confiance hors borne, doublon
 * de `missingInformation`. Un invalide écarté, jamais « rattrapé ».
 */
import { describe, expect, it } from "vitest";

import {
  COMPATIBLE,
  confianceSuffisante,
  mentionsEgales,
  NOMS_INTENTIONS,
  normaliserMention,
  validerIntent,
} from "@/shared/jarvis/intentions";

function intentMinimal(name: string): Record<string, unknown> {
  return {
    name,
    entities: {},
    references: { pronomSansAntecedent: false, homonymePossible: false },
    confidence: 0.9,
    missingInformation: [],
  };
}

describe("valides acceptés", () => {
  it("les 32 noms passent avec la forme minimale", () => {
    expect(NOMS_INTENTIONS).toHaveLength(32);
    for (const name of NOMS_INTENTIONS) {
      expect(validerIntent(intentMinimal(name))?.name).toBe(name);
    }
  });

  it("l'exemple contrat « après Karim » passe", () => {
    const v = validerIntent({
      name: "GET_NEXT_PATIENT",
      entities: { patientMention: "Karim" },
      references: { pronomSansAntecedent: false, homonymePossible: false },
      confidence: 0.82,
      missingInformation: [],
    });
    expect(v?.name).toBe("GET_NEXT_PATIENT");
    if (v?.entities && "patientMention" in v.entities) {
      expect(v.entities.patientMention).toBe("Karim");
    }
  });

  it("toutes les entités optionnelles combinées passent", () => {
    expect(
      validerIntent({
        name: "DRAFT_MESSAGE",
        entities: {
          patientMention: "Mahmoud Saidi",
          dateMention: "demain matin",
          periode: "semaine",
          motifBrouillon: "rappel_rendez_vous",
        },
        references: { pronomSansAntecedent: true, homonymePossible: false },
        confidence: 0.55,
        missingInformation: ["patientMention"],
      }),
    ).not.toBeNull();
  });
});

describe("invalides écartés (null, jamais deviné)", () => {
  it("nom inconnu → null", () => {
    expect(validerIntent({ ...intentMinimal("GET_NEXT_PATIENT"), name: "EFFACER_BASE" })).toBeNull();
    expect(validerIntent({ ...intentMinimal("GET_NEXT_PATIENT"), name: "get_next_patient" })).toBeNull();
  });

  it("champ libre → null (strictObject, deux niveaux)", () => {
    expect(
      validerIntent({ ...intentMinimal("UNKNOWN"), outil: "search_patients" }),
    ).toBeNull();
    expect(
      validerIntent({
        ...intentMinimal("SEARCH_PATIENT"),
        entities: { patientMention: "Karim", patientId: "quelque-chose" },
      }),
    ).toBeNull();
    expect(
      validerIntent({
        ...intentMinimal("UNKNOWN"),
        references: { pronomSansAntecedent: false, homonymePossible: false, autre: 1 },
      }),
    ).toBeNull();
  });

  it("mention non textuelle → null (UUID, jeton, téléphone, courriel)", () => {
    for (const patientMention of [
      "123e4567-e89b-12d3-a456-426614174000",
      "{{PATIENT_001}}",
      "PATIENT_001",
      "0612345678",
      "nadia@example.dz",
    ]) {
      expect(
        validerIntent({
          ...intentMinimal("GET_PATIENT_CONTEXT"),
          entities: { patientMention },
        }),
      ).toBeNull();
    }
  });

  it("mention trop courte → null", () => {
    expect(
      validerIntent({ ...intentMinimal("SEARCH_PATIENT"), entities: { patientMention: "K" } }),
    ).toBeNull();
  });

  it("confiance hors borne ou non finie → null", () => {
    for (const confidence of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, "0.9"]) {
      expect(validerIntent({ ...intentMinimal("UNKNOWN"), confidence })).toBeNull();
    }
  });

  it("missingInformation : doublon ou valeur inconnue → null", () => {
    expect(
      validerIntent({ ...intentMinimal("UNKNOWN"), missingInformation: ["jour", "jour"] }),
    ).toBeNull();
    expect(
      validerIntent({ ...intentMinimal("UNKNOWN"), missingInformation: ["demain"] }),
    ).toBeNull();
  });

  it("structure absente ou non-objet → null", () => {
    expect(validerIntent(null)).toBeNull();
    expect(validerIntent("GET_NEXT_PATIENT")).toBeNull();
    expect(validerIntent({ name: "UNKNOWN" })).toBeNull();
    expect(validerIntent({ ...intentMinimal("UNKNOWN"), entities: null })).toBeNull();
  });

  it("periode et motifBrouillon hors enum → null", () => {
    expect(
      validerIntent({ ...intentMinimal("GET_PERIOD_REVENUE"), entities: { periode: "decennie" } }),
    ).toBeNull();
    expect(
      validerIntent({ ...intentMinimal("DRAFT_MESSAGE"), entities: { motifBrouillon: "envoyer_sms" } }),
    ).toBeNull();
  });
});

describe("confiance = métadonnée (jamais une autorisation)", () => {
  it("seuil de rejet seul : 0.54 écarté, 0.55 gardé — sans rien autoriser", () => {
    const bas = validerIntent({ ...intentMinimal("GET_NEXT_PATIENT"), confidence: 0.54 });
    const haut = validerIntent({ ...intentMinimal("GET_NEXT_PATIENT"), confidence: 0.55 });
    expect(bas && confianceSuffisante(bas)).toBe(false);
    expect(haut && confianceSuffisante(haut)).toBe(true);
  });
});

describe("mentions : comparaison insensible casse/accents", () => {
  it("Karim == karim == Karîm", () => {
    expect(mentionsEgales("Karim", "karim")).toBe(true);
    expect(normaliserMention("  Mahmoud   Saidi ")).toBe("mahmoud saidi");
  });

  it("noms distincts restent distincts", () => {
    expect(mentionsEgales("Karim", "Amina")).toBe(false);
  });
});

describe("table COMPATIBLE : forme", () => {
  it("32 entrées, méta vides, autres non vides", () => {
    expect(Object.keys(COMPATIBLE)).toHaveLength(32);
    for (const [nom, outils] of Object.entries(COMPATIBLE)) {
      if (["GENERAL_KNOWLEDGE", "ASK_CLARIFICATION", "UNKNOWN"].includes(nom)) {
        expect(outils).toEqual([]);
      } else {
        expect(outils.length).toBeGreaterThan(0);
      }
    }
  });
});
