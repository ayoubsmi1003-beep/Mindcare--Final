/**
 * Phase 2 du plan Alexa — médicaments en cours, historique des séances,
 * résumé financier par patient.
 *
 * ═══ CE QUE CES TESTS GARDENT ═══
 * 1. EN COURS vs HISTORIQUE : les actifs/en pause ne se mélangent jamais aux
 *    arrêtés ni à la dernière prescription ; chaque bloc porte sa provenance.
 * 2. Source canonique : l'en-cours vient de `get_patient_treatments`
 *    (`status`), jamais de la seule dernière prescription (historique seul).
 * 3. Clinique : aucune dictée brute (`rawNotes`) ne peut atteindre le modèle ;
 *    une note non signée ne rend aucun contenu.
 * 4. Finance déterministe : sommes entières en DZD calculées en local,
 *    `sansTarifNombre` explicite, `complet=false` dès qu'une page est coupée.
 * 5. `null ≠ 0` : hors droit clinique (forme décidée EN BASE par le workspace),
 *    les blocs rendent `null`, jamais des zéros.
 * 6. Fail-closed : arguments invalides → `regle-metier` avant toute lecture.
 *
 * ⚠️ AUCUNE DONNÉE PATIENT DANS CE FICHIER, AUCUN ACCÈS BASE. Les projections
 * sont éprouvées avec des fixtures écrites à la main ; les seuls `lancer`
 * exécutés échouent à la validation Zod, avant toute lecture. Les permissions
 * des 3 rôles sont portées par les portes INVOKER + RLS (074/076/029/047) et
 * prouvées par leurs checkpoints SQL ; ici on prouve que la capacité PROPAGE
 * leurs décisions (introuvable ≡ hors périmètre, `null` de forme).
 */
import { describe, expect, it } from "vitest";

import {
  capaciteLecture,
  estCapaciteLecture,
  nomsDeLecture,
} from "../../src/services/jarvis-capacites";
import type { RefPatient } from "../../src/services/jarvis-identite";
import { CarteIdentite } from "../../src/services/jarvis-identite";
import {
  projeterFinancePatient,
  projeterHistoriqueSeances,
  projeterMedicaments,
  sansNotesNonSignees,
} from "../../src/services/jarvis-projections";
import type { Treatment } from "../../src/services/patient-treatments";

const PATIENT = "PATIENT_001" as RefPatient;

function ctxTour() {
  return {
    carte: new CarteIdentite(),
    signal: new AbortController().signal,
    aujourdHui: "2026-09-03",
  };
}

function traitement(partiel: Partial<Treatment> & { id: string }): Treatment {
  return {
    patientId: "00000000-0000-4000-8000-000000000001",
    medicationId: "00000000-0000-4000-8000-000000000002",
    medicationRaw: "SERTRALINE 50 MG",
    brandName: null,
    form: "comprimé",
    strength: "50 mg",
    inn: "sertraline",
    consultationId: null,
    previousTreatmentId: null,
    status: "active",
    dose: "1 comprimé",
    doseUnit: null,
    frequency: "le soir",
    timing: ["soir"],
    instructions: "À prendre au cours du dîner, NE PAS DIFFUSER",
    startDate: "2026-06-01",
    endDate: null,
    stoppedAt: null,
    stoppedReason: null,
    currentVersion: 1,
    createdAt: "2026-06-01T09:00:00+01:00",
    updatedAt: "2026-06-01T09:00:00+01:00",
    ...partiel,
  };
}

describe("registre Phase 2 — les trois capacités sont offertes", () => {
  it.each([
    "get_current_medications",
    "get_consultation_history",
    "get_patient_financial_summary",
  ])("%s est enregistrée, bornée, sans argument libre", (nom) => {
    const cap = capaciteLecture(nom);
    expect(cap).not.toBeNull();
    expect(cap?.nom).toBe(nom);
    expect(estCapaciteLecture(nom)).toBe(true);
    expect(nomsDeLecture()).toContain(nom);
    expect(cap?.budgetOctets).toBeLessThanOrEqual(12_000);
  });

  it.each([
    "get_current_medications",
    "get_consultation_history",
    "get_patient_financial_summary",
  ])("%s refuse des arguments invalides avant toute lecture", async (nom) => {
    const cap = capaciteLecture(nom);
    const r = await cap?.lancer({ patientId: "pas-un-uuid" }, ctxTour());
    expect(r?.ok).toBe(false);
    if (r !== undefined && !r.ok) {
      const echec = r as { ok: false; error: { code: string } };
      expect(echec.error.code).toBe("regle-metier");
    }
  });
});

describe("médicaments — EN COURS vs HISTORIQUE", () => {
  const actifs = [
    traitement({ id: "a1" }),
    traitement({ id: "a2", medicationRaw: "", brandName: "XANAX", inn: "alprazolam" }),
  ];
  const enPause = [traitement({ id: "p1", status: "paused", medicationRaw: "LORAZEPAM 1 MG" })];
  const arretes = [
    traitement({ id: "s1", status: "stopped", stoppedAt: "2026-07-15T10:00:00+01:00" }),
  ];

  it("sépare l'en-cours de l'historique, avec les deux provenances", () => {
    const projete = projeterMedicaments(
      PATIENT,
      { actifs, enPause, arretesRecents: arretes, totalActifs: 2, total: 4 },
      { dernierePrescriptionLe: "2026-08-20", nombrePrescriptions: 6 },
    );
    expect(projete.patient).toBe(PATIENT);
    expect(projete.enCours?.actifs).toHaveLength(2);
    expect(projete.enCours?.enPause).toHaveLength(1);
    expect(projete.historique?.arretesRecents).toHaveLength(1);
    expect(projete.historique?.dernierePrescriptionLe).toBe("2026-08-20");
    expect(projete.historique?.nombrePrescriptions).toBe(6);
    expect(projete.historique?.historiqueIncomplet).toBe(true);
    expect(projete.provenance.map((s) => s.porte).sort()).toEqual(
      ["app.get_patient_treatments", "app.get_patient_workspace"].sort(),
    );
  });

  it("désignation en cascade, instructions et champs internes exclus", () => {
    const projete = projeterMedicaments(
      PATIENT,
      { actifs, enPause: [], arretesRecents: [], totalActifs: 2, total: 2 },
      { dernierePrescriptionLe: null, nombrePrescriptions: 1 },
    );
    const premier = projete.enCours?.actifs[0];
    expect(premier?.designation).toBe("SERTRALINE 50 MG");
    // `brandName` prend le relais quand le brut est absent.
    expect(projete.enCours?.actifs[1]?.designation).toBe("XANAX");
    const cles = Object.keys(premier ?? {}).sort();
    expect(cles).toEqual(
      ["arreteLe", "debuteLe", "designation", "dose", "frequence", "statut"].sort(),
    );
    // Ni instructions (texte libre), ni identifiants, ni versions.
    expect(JSON.stringify(projete)).not.toContain("NE PAS DIFFUSER");
    expect(JSON.stringify(projete)).not.toContain("currentVersion");
  });

  it("hors droit clinique : null, jamais des listes vides", () => {
    const projete = projeterMedicaments(
      PATIENT,
      { actifs: [], enPause: [], arretesRecents: [], totalActifs: 0, total: 0 },
      null,
    );
    expect(projete.enCours).toBeNull();
    expect(projete.historique).toBeNull();
  });
});

describe("historique des séances — SOAP signé seul", () => {
  const signee = {
    patient: PATIENT,
    le: "2026-08-20T10:00:00+01:00",
    close: true,
    type: "suivi" as const,
    note: {
      signee: true,
      soap: {
        subjective: "Va mieux",
        objective: null,
        assessment: null,
        plan: "Poursuivre",
      },
    },
    provenance: [],
  };
  const brouillon = {
    ...signee,
    le: "2026-08-27T10:00:00+01:00",
    note: { signee: false, soap: { subjective: "Brouillon", objective: null, assessment: null, plan: null } },
  };

  it("masque le contenu des notes non signées", () => {
    const nettoyees = sansNotesNonSignees([signee, brouillon]);
    expect(nettoyees[0]?.note?.soap.subjective).toBe("Va mieux");
    expect(nettoyees[1]?.note).toBeNull();
  });

  it("rend les séances avec troncature déclarée et provenance", () => {
    const projete = projeterHistoriqueSeances(PATIENT, sansNotesNonSignees([signee]), true);
    expect(projete.patient).toBe(PATIENT);
    expect(projete.seances).toHaveLength(1);
    expect(projete.tronque).toBe(true);
    expect(projete.provenance.map((s) => s.porte).sort()).toEqual(
      ["app.get_consultation", "app.list_patient_timeline"].sort(),
    );
    // Aucune dictée brute, sous aucun nom.
    expect(JSON.stringify(projete)).not.toContain("rawNotes");
    expect(JSON.stringify(projete)).not.toContain("dictee");
  });
});

describe("résumé financier patient — déterministe, null ≠ 0", () => {
  it("additionne en entiers, distingue encaissé et attente", () => {
    const projete = projeterFinancePatient(
      PATIENT,
      [
        { le: "2026-08-20T10:00:00+01:00", montantDzd: 4000, encaisse: true, creeLe: "2026-08-20T10:00:00+01:00" },
        { le: "2026-08-27T10:00:00+01:00", montantDzd: 2500, encaisse: false, creeLe: "2026-08-27T10:00:00+01:00" },
        { le: "2026-09-02T10:00:00+01:00", montantDzd: null, encaisse: false, creeLe: "2026-09-02T10:00:00+01:00" },
      ],
      true,
    );
    expect(projete.totalEncaisseDzd).toBe(4000);
    expect(projete.totalEnAttenteDzd).toBe(2500);
    expect(projete.nombreEnAttente).toBe(1);
    // Tarif non fixé : compté à part, jamais dans les totaux.
    expect(projete.sansTarifNombre).toBe(1);
    expect(projete.complet).toBe(true);
    expect(Number.isInteger(projete.totalEncaisseDzd)).toBe(true);
    expect(Number.isInteger(projete.totalEnAttenteDzd)).toBe(true);
  });

  it("page coupée : complet=false, les totaux restent partiels et dits", () => {
    const projete = projeterFinancePatient(
      PATIENT,
      [{ le: "2026-09-02T10:00:00+01:00", montantDzd: 4000, encaisse: false, creeLe: "2026-09-02T10:00:00+01:00" }],
      false,
    );
    expect(projete.complet).toBe(false);
    expect(projete.totalEnAttenteDzd).toBe(4000);
  });

  it("aucune séance visible : des zéros, pas des null", () => {
    const projete = projeterFinancePatient(PATIENT, [], true);
    expect(projete.totalEncaisseDzd).toBe(0);
    expect(projete.totalEnAttenteDzd).toBe(0);
    expect(projete.nombreEnAttente).toBe(0);
    expect(projete.sansTarifNombre).toBe(0);
    expect(projete.seances).toEqual([]);
  });

  it("aucun reçu, aucun numéro : ni identifiant, ni métadonnée citable", () => {
    const projete = projeterFinancePatient(
      PATIENT,
      [
        { le: "2026-08-20T10:00:00+01:00", montantDzd: 4000, encaisse: true, creeLe: "2026-08-20T10:00:00+01:00" },
      ],
      true,
    );
    expect(Object.keys(projete).sort()).toEqual(
      [
        "complet",
        "nombreEnAttente",
        "patient",
        "provenance",
        "sansTarifNombre",
        "seances",
        "totalEnAttenteDzd",
        "totalEncaisseDzd",
      ].sort(),
    );
    expect(Object.keys(projete.seances[0] ?? {}).sort()).toEqual(
      ["creeLe", "encaisse", "le", "montantDzd"].sort(),
    );
    expect(JSON.stringify(projete)).not.toMatch(/receipt|recu|numero/i);
  });
});
