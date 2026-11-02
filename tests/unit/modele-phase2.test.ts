import { describe, expect, it } from "vitest";

import {
  allergiesCourantes,
  derniereAdherence,
  estHorsReference,
  formaterMesure,
  mesuresParKind,
} from "../../src/components/traitements/modele-phase2";
import type {
  AdherenceReport,
  AllergyEvent,
  Measurement,
} from "../../src/services/medication-phase2";

function allergie(overrides: Partial<AllergyEvent> = {}): AllergyEvent {
  return {
    id: "a-1",
    patientId: "p-1",
    consultationId: null,
    substance: "Pénicilline",
    substanceKey: "penicilline",
    reaction: "Éruption",
    severity: "moderee",
    eventKind: "noted",
    notes: null,
    recordedAt: "2026-09-01T09:00:00+01:00",
    ...overrides,
  };
}

function adherence(overrides: Partial<AdherenceReport> = {}): AdherenceReport {
  return {
    id: "r-1",
    patientId: "p-1",
    consultationId: null,
    treatmentId: "t-1",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    status: "observant",
    source: "patient",
    notes: null,
    recordedAt: "2026-10-01T09:00:00+01:00",
    ...overrides,
  };
}

function mesure(overrides: Partial<Measurement> = {}): Measurement {
  return {
    id: "m-1",
    patientId: "p-1",
    consultationId: null,
    kind: "weight_kg",
    value: 72.5,
    unit: "kg",
    measuredAt: "2026-09-01T09:00:00+01:00",
    source: "consultation",
    referenceLow: null,
    referenceHigh: null,
    notes: null,
    recordedAt: "2026-09-01T09:00:00+01:00",
    ...overrides,
  };
}

describe("allergiesCourantes", () => {
  it("garde la dernière déclaration par substance", () => {
    const resultat = allergiesCourantes([
      allergie({ id: "a-1", recordedAt: "2026-09-01T09:00:00+01:00" }),
      allergie({ id: "a-2", severity: "severe", reaction: "Œdème", recordedAt: "2026-10-01T09:00:00+01:00" }),
    ]);
    expect(resultat).toHaveLength(1);
    expect(resultat[0]?.severity).toBe("severe");
    expect(resultat[0]?.reaction).toBe("Œdème");
  });

  it("retire une allergie résolue ou infirmée", () => {
    const resultat = allergiesCourantes([
      allergie({ id: "a-1" }),
      allergie({
        id: "a-2",
        eventKind: "resolved",
        severity: null,
        reaction: null,
        recordedAt: "2026-10-01T09:00:00+01:00",
      }),
    ]);
    expect(resultat).toEqual([]);
  });

  it("rouvre une allergie après une réintroduction documentée", () => {
    const resultat = allergiesCourantes([
      allergie({ id: "a-1" }),
      allergie({
        id: "a-2",
        eventKind: "refuted",
        severity: null,
        reaction: null,
        recordedAt: "2026-10-01T09:00:00+01:00",
      }),
      allergie({ id: "a-3", recordedAt: "2026-11-01T09:00:00+01:00" }),
    ]);
    expect(resultat).toHaveLength(1);
    expect(resultat[0]?.since).toBe("2026-11-01T09:00:00+01:00");
  });

  it("sépare deux substances distinctes", () => {
    const resultat = allergiesCourantes([
      allergie({ id: "a-1" }),
      allergie({
        id: "a-2",
        substance: "Iode",
        substanceKey: "iode",
        reaction: "Urticaire",
        recordedAt: "2026-10-01T09:00:00+01:00",
      }),
    ]);
    expect(resultat.map((a) => a.substance)).toEqual(["Iode", "Pénicilline"]);
  });
});

describe("derniereAdherence", () => {
  it("rend le rapport de période la plus récente pour ce traitement", () => {
    const resultat = derniereAdherence(
      [
        adherence({ id: "r-1", periodEnd: "2026-09-30", status: "partiel" }),
        adherence({ id: "r-2", periodEnd: "2026-10-31", status: "observant" }),
        adherence({ id: "r-3", treatmentId: "t-2", periodEnd: "2026-11-30", status: "non_observant" }),
      ],
      "t-1",
    );
    expect(resultat?.id).toBe("r-2");
    expect(resultat?.status).toBe("observant");
  });

  it("rend null sans rapport pour ce traitement", () => {
    expect(derniereAdherence([adherence({ treatmentId: "t-2" })], "t-1")).toBeNull();
  });
});

describe("mesuresParKind", () => {
  it("filtre et ordonne chronologiquement", () => {
    const resultat = mesuresParKind(
      [
        mesure({ id: "m-2", measuredAt: "2026-10-01T09:00:00+01:00", value: 71 }),
        mesure({ id: "m-1", measuredAt: "2026-09-01T09:00:00+01:00", value: 72.5 }),
        mesure({ id: "m-3", kind: "systolic_mmhg", unit: "mmHg", value: 120 }),
      ],
      "weight_kg",
    );
    expect(resultat.map((m) => m.id)).toEqual(["m-1", "m-2"]);
  });
});

describe("formaterMesure", () => {
  it("utilise la virgule française sans inventer de précision", () => {
    expect(formaterMesure(72.5, "kg")).toBe("72,5 kg");
    expect(formaterMesure(120, "mmHg")).toBe("120 mmHg");
  });
});

describe("estHorsReference", () => {
  it("ne conclut rien sans borne", () => {
    expect(estHorsReference({ value: 10, referenceLow: null, referenceHigh: null })).toBe(false);
  });

  it("signale une valeur sous la borne basse ou au-dessus de la haute", () => {
    expect(estHorsReference({ value: 3.9, referenceLow: 4.1, referenceHigh: 5.9 })).toBe(true);
    expect(estHorsReference({ value: 6.2, referenceLow: 4.1, referenceHigh: 5.9 })).toBe(true);
    expect(estHorsReference({ value: 5, referenceLow: 4.1, referenceHigh: 5.9 })).toBe(false);
  });
});
