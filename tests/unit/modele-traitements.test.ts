import { describe, expect, it } from "vitest";

import {
  analyserDose,
  comparerEpisodes,
  construireAttention,
  construireEvolutionPosologie,
  construirePlanPrises,
  dosePrescrite,
  motifArretLisible,
  resumerPolypharmacie,
  type EpisodeComparable,
  type EvenementPosologie,
} from "../../src/components/traitements/modele-traitements";
import type { Treatment } from "../../src/services/patient-treatments";

function traitement(overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: "t-1",
    patientId: "p-1",
    medicationId: "m-1",
    medicationRaw: "Sertraline",
    brandName: "Zoloft",
    form: "comprimé",
    strength: "50 mg",
    inn: "sertraline",
    consultationId: null,
    previousTreatmentId: null,
    status: "active",
    dose: "50",
    doseUnit: "mg",
    frequency: "1 fois/jour",
    timing: ["matin"],
    instructions: null,
    startDate: "2026-09-01",
    endDate: null,
    stoppedAt: null,
    stoppedReason: null,
    currentVersion: 1,
    createdAt: "2026-09-01T09:00:00+01:00",
    updatedAt: "2026-09-01T09:00:00+01:00",
    practitionerName: "Dr Larbi",
    atcClass: "N06AB06",
    ...overrides,
  };
}

function evenement(overrides: Partial<EvenementPosologie> = {}): EvenementPosologie {
  return {
    id: "e-1",
    treatmentId: "t-1",
    occurredAt: "2026-09-01T09:00:00+01:00",
    action: "started",
    dose: "50",
    doseUnit: "mg",
    ...overrides,
  };
}

describe("dosePrescrite", () => {
  it("ne rend que la dose réellement enregistrée", () => {
    expect(dosePrescrite("25", "mg")).toBe("25 mg");
    expect(dosePrescrite("25 mg", null)).toBe("25 mg");
  });

  it("ne remplace jamais une dose absente par le dosage du catalogue", () => {
    expect(dosePrescrite(null, null)).toBeNull();
    expect(dosePrescrite("", "mg")).toBeNull();
  });
});

describe("motifArretLisible", () => {
  const libelles = { decision_clinique: "Décision clinique" } as const;

  it("traduit un code connu", () => {
    expect(motifArretLisible("decision_clinique", libelles)).toBe("Décision clinique");
  });

  it("rend un code inconnu au lieu de le masquer", () => {
    expect(motifArretLisible("motif_non_prev_u", libelles)).toBe("motif_non_prev_u");
  });

  it("traite vide et absent comme absents", () => {
    expect(motifArretLisible(null, libelles)).toBeNull();
    expect(motifArretLisible("  ", libelles)).toBeNull();
  });
});

describe("analyserDose", () => {
  it("lit une dose numérique suivie d'une unité", () => {
    expect(analyserDose("50 mg", "mg")).toEqual({ valeur: 50, unite: "mg" });
  });

  it("accepte la virgule décimale française", () => {
    expect(analyserDose("1,5", "mg")).toEqual({ valeur: 1.5, unite: "mg" });
  });

  it("refuse une dose non numérique plutôt que de l'inventer", () => {
    expect(analyserDose("1 comprimé", null)).toBeNull();
    expect(analyserDose("50-100", "mg")).toBeNull();
  });

  it("refuse une dose vide", () => {
    expect(analyserDose("", "mg")).toBeNull();
    expect(analyserDose(null, "mg")).toBeNull();
  });
});

describe("construireEvolutionPosologie", () => {
  it("garde uniquement les points réellement enregistrés, dans l'ordre chronologique", () => {
    const resultat = construireEvolutionPosologie(
      [
        evenement({ id: "e-2", occurredAt: "2026-10-01T09:00:00+01:00", action: "dose_changed", dose: "100" }),
        evenement({ id: "e-1", occurredAt: "2026-09-01T09:00:00+01:00", action: "started", dose: "50" }),
      ],
      "t-1",
    );

    expect(resultat.points.map((p) => p.valeur)).toEqual([50, 100]);
    expect(resultat.points.map((p) => p.date.slice(0, 10))).toEqual(["2026-09-01", "2026-10-01"]);
    expect(resultat.unite).toBe("mg");
  });

  it("ne trace pas de courbe quand les unités diffèrent", () => {
    const resultat = construireEvolutionPosologie(
      [
        evenement({ id: "e-1", occurredAt: "2026-09-01T09:00:00+01:00", dose: "50", doseUnit: "mg" }),
        evenement({ id: "e-2", occurredAt: "2026-10-01T09:00:00+01:00", action: "dose_changed", dose: "1", doseUnit: "comprimé" }),
      ],
      "t-1",
    );

    expect(resultat.points).toEqual([]);
    expect(resultat.unite).toBeNull();
    expect(resultat.nonNumeriques).toHaveLength(2);
  });

  it("conserve les modifications non numériques sans les inventer", () => {
    const resultat = construireEvolutionPosologie(
      [
        evenement({ id: "e-1", occurredAt: "2026-09-01T09:00:00+01:00", dose: "1 comprimé", doseUnit: null }),
        evenement({ id: "e-2", occurredAt: "2026-10-01T09:00:00+01:00", action: "dose_changed", dose: "2 comprimés", doseUnit: null }),
      ],
      "t-1",
    );

    expect(resultat.points).toEqual([]);
    expect(resultat.nonNumeriques.map((p) => p.libelle)).toEqual(["1 comprimé", "2 comprimés"]);
  });
});

describe("construirePlanPrises", () => {
  it("répartit selon les horaires documentés et laisse le non-précisé à part", () => {
    const plan = construirePlanPrises([
      traitement({ id: "t-matin", timing: ["Matin"] }),
      traitement({ id: "t-midi", timing: ["midi"] }),
      traitement({ id: "t-deux", timing: ["Matin", "Soir"] }),
      traitement({ id: "t-vide", timing: [] }),
    ]);

    expect(plan.matin.map((t) => t.id)).toEqual(["t-matin", "t-deux"]);
    expect(plan.midi.map((t) => t.id)).toEqual(["t-midi"]);
    expect(plan.soir.map((t) => t.id)).toEqual(["t-deux"]);
    expect(plan.nonPrecise.map((t) => t.id)).toEqual(["t-vide"]);
  });

  it("ne déduit jamais un horaire de la fréquence", () => {
    const plan = construirePlanPrises([traitement({ timing: [], frequency: "2 fois/jour" })]);
    expect(plan.matin).toHaveLength(0);
    expect(plan.nonPrecise).toHaveLength(1);
  });
});

describe("construireAttention", () => {
  const aujourdHui = "2026-11-01";

  it("signale une fin de traitement planifiée dépassée", () => {
    const items = construireAttention(
      [traitement({ endDate: "2026-10-20" })],
      aujourdHui,
    );
    expect(items.map((i) => i.code)).toContain("fin_depassee");
    expect(items[0]?.params["dateFin"]).toBe("2026-10-20");
  });

  it("signale une fin planifiée proche sans la présenter comme un renouvellement", () => {
    const items = construireAttention([traitement({ endDate: "2026-11-10" })], aujourdHui);
    const item = items.find((i) => i.code === "fin_proche");
    expect(item?.params["dateFin"]).toBe("2026-11-10");
    expect(item?.params["joursRestants"]).toBe(9);
  });

  it("signale une posologie incomplète", () => {
    const items = construireAttention(
      [traitement({ dose: null, doseUnit: null, frequency: null })],
      aujourdHui,
    );
    expect(items.map((i) => i.code)).toContain("posologie_incomplete");
  });

  it("signale la polypharmacie à partir de cinq actifs, sans alarmer", () => {
    const traitements = Array.from({ length: 5 }, (_, i) =>
      traitement({ id: `t-${i}`, medicationRaw: `Médicament ${i}` }),
    );
    const items = construireAttention(traitements, aujourdHui);
    const item = items.find((i) => i.code === "polypharmacie");
    expect(item?.params["actifs"]).toBe(5);
  });

  it("ignore un traitement arrêté", () => {
    const items = construireAttention(
      [traitement({ status: "stopped", stoppedAt: "2026-10-01T09:00:00+01:00", endDate: "2026-09-01" })],
      aujourdHui,
    );
    expect(items).toHaveLength(0);
  });
});

describe("resumerPolypharmacie", () => {
  it("compte les actifs, les catégories, les chevauchements et les posologies manquantes", () => {
    const resume = resumerPolypharmacie([
      traitement({ id: "a", atcClass: "N06AB06", startDate: "2026-09-01", endDate: "2026-12-01" }),
      traitement({ id: "b", atcClass: "N06AB06", startDate: "2026-10-01", endDate: "2027-01-01" }),
      traitement({ id: "c", atcClass: "N05AH03", startDate: "2026-08-01", endDate: "2026-09-15" }),
      traitement({ id: "d", atcClass: null, startDate: "2026-10-10", dose: null, frequency: null }),
      traitement({ id: "e", status: "stopped", atcClass: "N06AB06" }),
    ]);

    expect(resume.actifs).toBe(4);
    expect(resume.categories).toBe(2);
    expect(resume.chevauchements).toBe(4);
    expect(resume.posologiesIncompletes).toBe(1);
  });
});

describe("comparerEpisodes", () => {
  const aujourdHui = "2026-11-01";

  it("compare des durées réelles sans fabriquer de score d'efficacité", () => {
    const a: EpisodeComparable = {
      id: "a", nom: "Sertraline 50 mg", dose: "50 mg", statut: "stopped",
      debut: "2026-01-01", fin: "2026-03-01",
    };
    const b: EpisodeComparable = {
      id: "b", nom: "Sertraline 100 mg", dose: "100 mg", statut: "active",
      debut: "2026-03-15", fin: null,
    };

    const comparaison = comparerEpisodes(a, b, aujourdHui);
    expect(comparaison.a.dureeJours).toBe(59);
    expect(comparaison.b.dureeJours).toBe(231);
    expect(comparaison).not.toHaveProperty("score");
    expect(comparaison).not.toHaveProperty("efficacite");
  });
});
