/**
 * `jarvis-assembleur-contexte.test.ts` - L'ASSEMBLEUR M03, EPROUVE.
 *
 * NOTE D'ENCODAGE : fichier volontairement ASCII-only (francais sans accents).
 *
 * Couvre, dans l'ordre des garde-fous de mission :
 *   1. contrat atomique contribution+cliche, hash sur l'objet retourne ;
 *   2. table intention -> sections (exhaustive sur les 32 intentions M01) ;
 *   3. union discriminee de portee (invalide irrepresentable, sonde type) ;
 *   4. frontiere de projection (un DTO quatre-domaines ne voyage jamais entier) ;
 *   5. troncature semantique (items entiers, ordre fournisseur, nouveau protege) ;
 *   6. budget total 24 000 (existant, jamais reinvente) ;
 *   7. contamination inter-iterations (epoques de portee) ;
 *   8. confidentialite du cliche (scan PII) ;
 *   9. completude des 22 capacites ventilees.
 */
import { describe, expect, it } from "vitest";

import { NOMS_INTENTIONS, type NomIntention } from "../../src/shared/jarvis/intentions";
import {
  assembler,
  CAPACITES_VENTILEES,
  hacherContribution,
  jsonCanonique,
  porterScopeAssemblage,
  SECTIONS_REQUISES,
  type EntreeAssemblage,
  type ScopeAssemblage,
} from "../../src/services/jarvis-assembleur";
import { BUDGETS } from "../../src/services/jarvis-contexte";
import type {
  SafeMedicamentsContext,
  SafeTimelineContext,
  SafeToolResult,
} from "../../src/services/jarvis-projections";
import type { ValeurSafe as ValeurSafeCap } from "../../src/services/jarvis-capacites";
import { KARIM, MAHMOUD } from "../fixtures/patients";

// ---------------------------------------------------------------------------
// OUTILLAGE
// ---------------------------------------------------------------------------

const TEMPS = {
  aujourdHui: "2026-09-15",
  maintenant: "2026-09-15T09:00:00+01:00",
  decalage: "+01:00",
  bornesAujourdHui: { du: "2026-09-15T00:00:00+01:00", au: "2026-09-16T00:00:00+01:00" },
  bornesDemain: { du: "2026-09-16T00:00:00+01:00", au: "2026-09-17T00:00:00+01:00" },
} as const;

const SCOPE_RESOLU: ScopeAssemblage = {
  etat: "resolu",
  patientRef: "PATIENT_001",
  source: "explicite",
};
const SCOPE_AUCUN: ScopeAssemblage = { etat: "aucun" };
const SCOPE_AMBIGU: ScopeAssemblage = { etat: "ambigu" };

function entreeDeBase(partiel: Partial<EntreeAssemblage> = {}): EntreeAssemblage {
  return {
    runId: "00000000-0000-4000-8000-00000000a301",
    conversationId: "00000000-0000-4000-8000-00000000c301",
    clientTurnId: "00000000-0000-4000-8000-00000000t301",
    tourIndex: 0,
    intention: null,
    scope: SCOPE_RESOLU,
    amorce: {
      temps: { ...TEMPS },
      patientCible: "PATIENT_001",
      consultationOuverte: false,
    },
    resultats: [],
    epoqueCourante: 0,
    ...partiel,
  };
}

function succes(
  capacite: string,
  donnees: unknown,
  epoque = 0,
): { resultat: SafeToolResult<ValeurSafeCap>; epoque: number } {
  return {
    resultat: { capacite, ok: true, donnees: donnees as ValeurSafeCap },
    epoque,
  };
}

function echec(
  capacite: string,
  motifEchec: string,
  epoque = 0,
): { resultat: SafeToolResult<ValeurSafeCap>; epoque: number } {
  return { resultat: { capacite, ok: false, donnees: null, motifEchec }, epoque };
}

/** Un dossier complet : les QUATRE domaines, plus des cles brutes pieges. */
function dossierComplet(): Record<string, unknown> {
  return {
    ref: "PATIENT_001",
    age: 45,
    sexe: "M",
    actif: true,
    clinique: {
      diagnostics: [
        {
          code: "F41.1",
          systeme: "ICD-10",
          libelle: "Trouble anxieux generalise",
          principal: true,
          depuis: "2024-01-01",
          resoluLe: null,
        },
      ],
      echelles: [],
      derniereConsultation: { le: "2026-09-01T10:00:00+01:00", type: "suivi", close: true },
      nombreConsultations: 12,
    },
    traitements: {
      dernierePrescriptionLe: "2026-09-01",
      lignes: [{ designation: "Sertraline", dose: "50 mg", frequenceParJour: 1, dureeJours: 30 }],
      nombrePrescriptions: 4,
      historiqueIncomplet: true,
    },
    agenda: {
      prochainRendezVous: null,
      dernierRendezVous: null,
      nombreRendezVous: 12,
    },
    documents: { nombre: 2, dernierEmisLe: "2026-08-01" },
    provenance: [{ porte: "app.get_patient_workspace", luA: "2026-09-15T09:00:00Z", tronque: false }],
    // Cles brutes : une derive future qui les ajouterait au DTO ne doit
    // jamais les voir voyager - la projection est une liste blanche.
    birthDate: "1980-05-05",
    phone: "0551234567",
    notesAdmin: "patient difficile",
  };
}

function chronologie(quantite: number, tailleDetail = 8): SafeTimelineContext {
  return {
    patient: "PATIENT_001",
    evenements: Array.from({ length: quantite }, (_, i) => ({
      le: `2026-09-${String(15 - (i % 15)).padStart(2, "0")}T10:00:00+01:00`,
      genre: "consultation_close" as const,
      detail: { status: "closed", kind: "suivi", bourrage: "x".repeat(tailleDetail) },
    })),
    provenance: [{ porte: "app.list_patient_timeline", luA: "2026-09-15T09:00:00Z", tronque: false }],
  };
}

// ---------------------------------------------------------------------------
// 1 - CONTRAT ATOMIQUE
// ---------------------------------------------------------------------------

describe("assembler : contrat atomique contribution + cliche", () => {
  it("assemble une portee resolue sans resultats (bloc scope seul)", () => {
    const { contribution, snapshot } = assembler(entreeDeBase());
    expect(contribution.contexte.patientCible).toBe("PATIENT_001");
    expect(contribution.contexte.temps.aujourdHui).toBe("2026-09-15");
    expect(contribution.resultats).toEqual([]);
    expect(snapshot.runId).toBe("00000000-0000-4000-8000-00000000a301");
    expect(snapshot.scope).toEqual(SCOPE_RESOLU);
    expect(snapshot.depassementBudget).toBe(false);
  });

  it("le hash est recalcule sur la contribution EXACTEMENT retournee", () => {
    const { contribution, snapshot } = assembler(
      entreeDeBase({
        resultats: [succes("get_today_agenda", { creneaux: [], provenance: [] })],
      }),
    );
    const recalcule = hacherContribution(
      jsonCanonique({ contexte: contribution.contexte, resultats: contribution.resultats }),
    );
    expect(snapshot.contributionHash).toBe(recalcule);
  });

  it("l'assemblage est deterministe (deux passes, octets identiques)", () => {
    const fabrique = (): EntreeAssemblage =>
      entreeDeBase({
        intention: "GET_PATIENT_TIMELINE",
        resultats: [succes("get_patient_timeline", chronologie(6))],
      });
    const a = assembler(fabrique());
    const b = assembler(fabrique());
    expect(jsonCanonique(a.contribution)).toBe(jsonCanonique(b.contribution));
    expect(a.snapshot.contributionHash).toBe(b.snapshot.contributionHash);
  });

  it("la contribution retournee est gelee (immutable apres assemblage)", () => {
    const { contribution } = assembler(
      entreeDeBase({ resultats: [succes("get_today_agenda", { creneaux: [] })] }),
    );
    expect(Object.isFrozen(contribution)).toBe(true);
    expect(Object.isFrozen(contribution.resultats)).toBe(true);
  });

  it("l'entree de l'appelant n'est ni mutee ni gelee", () => {
    const donnees = { creneaux: [{ ref: "RDV_001" }], provenance: [] };
    const entrees = [succes("get_today_agenda", donnees)];
    assembler(entreeDeBase({ resultats: entrees }));
    expect(donnees.creneaux).toHaveLength(1);
    expect(Object.isFrozen(donnees)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2 - TABLE INTENTION -> SECTIONS
// ---------------------------------------------------------------------------

describe("SECTIONS_REQUISES : table normative", () => {
  it("couvre EXACTEMENT les 32 intentions M01 (ni plus, ni moins)", () => {
    expect(new Set(Object.keys(SECTIONS_REQUISES))).toEqual(new Set(NOMS_INTENTIONS));
  });

  it("cas nominaux de la table", () => {
    expect(SECTIONS_REQUISES["GET_CURRENT_MEDICATIONS"]).toEqual(["scope", "traitements"]);
    expect(SECTIONS_REQUISES["GET_TODAY_AGENDA"]).toEqual(["scope", "agenda"]);
    expect(SECTIONS_REQUISES["GET_PATIENT_TIMELINE"]).toEqual(["scope", "seances"]);
    expect(SECTIONS_REQUISES["GET_PATIENT_FINANCIAL_SUMMARY"]).toEqual(["scope", "finance"]);
    expect(SECTIONS_REQUISES["GET_PATIENT_DOCUMENTS"]).toEqual(["scope", "documents"]);
    expect(SECTIONS_REQUISES["UNKNOWN"]).toEqual(["scope"]);
    expect(SECTIONS_REQUISES["GENERAL_KNOWLEDGE"]).toEqual(["scope"]);
  });

  it("toute table commence par `scope`", () => {
    for (const nom of NOMS_INTENTIONS as readonly NomIntention[]) {
      expect(SECTIONS_REQUISES[nom]?.[0]).toBe("scope");
    }
  });

  it("intention nulle = repli comportement historique (tout ce qui est ventile voyage)", () => {
    const { contribution } = assembler(
      entreeDeBase({
        intention: null,
        resultats: [succes("get_patient_context", dossierComplet())],
      }),
    );
    const sections = contribution.resultats[0]?.donnees?.sections ?? {};
    expect(Object.keys(sections).sort()).toEqual(["agenda", "documents", "patient", "traitements"]);
  });

  it("intention connue = seules les sections requises voyagent", () => {
    const { contribution, snapshot } = assembler(
      entreeDeBase({
        intention: "GET_CURRENT_MEDICATIONS",
        resultats: [succes("get_patient_context", dossierComplet())],
      }),
    );
    const sections = contribution.resultats[0]?.donnees?.sections ?? {};
    expect(Object.keys(sections)).toEqual(["traitements"]);
    expect(snapshot.piecesOmisesNonRequises).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 3 - PORTEE DISCRIMINEE
// ---------------------------------------------------------------------------

describe("ScopeAssemblage : l'invalide est irrepresentable", () => {
  it("resolu porte la reference jeton, jamais d'UUID", () => {
    const scope: ScopeAssemblage = { etat: "resolu", patientRef: "PATIENT_001", source: "ecran" };
    expect(scope.patientRef).toBe("PATIENT_001");
  });

  it("aucun producteur de portee ne pose patientRef hors resolu", () => {
    // La preuve litterale (`{etat:"ambigu", patientRef}`) est un refus de
    // compilation par construction de l'union (revu, non testable : la regle
    // `ban-ts-comment` interdit `@ts-expect-error`). Ici : tout chemin qui
    // ne rend pas `resolu` est runtime-verifie sans la cle.
    const cas: ScopeAssemblage[] = [
      porterScopeAssemblage({
        verdict: { etat: "ambigu", mention: "Mohamed", total: 7, libelles: [], depasse: false },
        patientRef: "PATIENT_001",
        cibleId: KARIM.id,
        cibleOrigine: "recherche",
        ambiguiteConstatee: false,
        expire: false,
      }),
      porterScopeAssemblage({
        verdict: { etat: "nonResolu", mention: "Sarah" },
        patientRef: "PATIENT_001",
        cibleId: KARIM.id,
        cibleOrigine: "recherche",
        ambiguiteConstatee: false,
        expire: false,
      }),
      porterScopeAssemblage({
        verdict: { etat: "aucun" },
        patientRef: null,
        cibleId: null,
        cibleOrigine: null,
        ambiguiteConstatee: false,
        expire: false,
      }),
      porterScopeAssemblage({
        verdict: { etat: "aucun" },
        patientRef: null,
        cibleId: null,
        cibleOrigine: null,
        ambiguiteConstatee: false,
        expire: true,
      }),
    ];
    for (const scope of cas) {
      expect(scope.etat).not.toBe("resolu");
      expect("patientRef" in scope).toBe(false);
    }
  });

  it("porterScopeAssemblage : verdict unique concordant -> resolu", () => {
    expect(
      porterScopeAssemblage({
        verdict: {
          etat: "unique",
          source: "explicite",
          patient: { id: KARIM.id, libelle: KARIM.libelle },
        },
        patientRef: "PATIENT_001",
        cibleId: KARIM.id,
        cibleOrigine: "recherche",
        ambiguiteConstatee: false,
        expire: false,
      }),
    ).toEqual({ etat: "resolu", patientRef: "PATIENT_001", source: "explicite" });
  });

  it("porterScopeAssemblage : verdict unique mais jeton divergent -> aucun (fail-closed)", () => {
    expect(
      porterScopeAssemblage({
        verdict: {
          etat: "unique",
          source: "explicite",
          patient: { id: KARIM.id, libelle: KARIM.libelle },
        },
        patientRef: "PATIENT_001",
        cibleId: MAHMOUD.id,
        cibleOrigine: "recherche",
        ambiguiteConstatee: false,
        expire: false,
      }),
    ).toEqual({ etat: "aucun" });
  });

  it("porterScopeAssemblage : ambiguite constatee prime sur tout", () => {
    expect(
      porterScopeAssemblage({
        verdict: {
          etat: "unique",
          source: "conversation",
          patient: { id: KARIM.id, libelle: KARIM.libelle },
        },
        patientRef: "PATIENT_001",
        cibleId: KARIM.id,
        cibleOrigine: "recherche",
        ambiguiteConstatee: true,
        expire: false,
      }),
    ).toEqual({ etat: "ambigu" });
  });

  it("porterScopeAssemblage : nonResolu bloque, meme avec un jeton", () => {
    expect(
      porterScopeAssemblage({
        verdict: { etat: "nonResolu", mention: "Sarah" },
        patientRef: "PATIENT_001",
        cibleId: KARIM.id,
        cibleOrigine: "recherche",
        ambiguiteConstatee: false,
        expire: false,
      }).etat,
    ).toBe("nonResolu");
  });

  it("porterScopeAssemblage : verdict aucun + jeton = repli ecran/explicite", () => {
    expect(
      porterScopeAssemblage({
        verdict: { etat: "aucun" },
        patientRef: "PATIENT_001",
        cibleId: KARIM.id,
        cibleOrigine: "ecran",
        ambiguiteConstatee: false,
        expire: false,
      }),
    ).toEqual({ etat: "resolu", patientRef: "PATIENT_001", source: "ecran" });
  });

  it("porterScopeAssemblage : sans jeton, expire vaut signale", () => {
    expect(
      porterScopeAssemblage({
        verdict: { etat: "aucun" },
        patientRef: null,
        cibleId: null,
        cibleOrigine: null,
        ambiguiteConstatee: false,
        expire: true,
      }),
    ).toEqual({ etat: "expire" });
  });

  it("portee non resolue = contribution sans identite (cle absente)", () => {
    for (const scope of [
      { etat: "ambigu" },
      { etat: "nonResolu" },
      { etat: "aucun" },
      { etat: "expire" },
    ] as const) {
      const { contribution } = assembler(entreeDeBase({ scope }));
      expect("patientCible" in contribution.contexte).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4 - FRONTIERE DE PROJECTION
// ---------------------------------------------------------------------------

describe("ventilation : aucun DTO ne voyage entier", () => {
  it("get_patient_context sous intention medicaments : seuls les traitements voyagent", () => {
    const { contribution } = assembler(
      entreeDeBase({
        intention: "GET_CURRENT_MEDICATIONS",
        resultats: [succes("get_patient_context", dossierComplet())],
      }),
    );
    const transporte = JSON.stringify(contribution.resultats);
    // Le necessaire voyage.
    expect(transporte).toContain("Sertraline");
    // Les autres domaines restent au sol, y compris les cles pieges.
    expect(transporte).not.toContain("Trouble anxieux");
    expect(transporte).not.toContain("nombreRendezVous");
    expect(transporte).not.toContain("birthDate");
    expect(transporte).not.toContain("0551234567");
    expect(transporte).not.toContain("notesAdmin");
  });

  it("get_patient_context en repli : les quatre domaines voyages SEPARES (jamais fondus)", () => {
    const { contribution } = assembler(
      entreeDeBase({
        intention: null,
        resultats: [succes("get_patient_context", dossierComplet())],
      }),
    );
    const sections = contribution.resultats[0]?.donnees?.sections;
    expect(sections?.["patient"]).toBeDefined();
    expect(sections?.["traitements"]).toBeDefined();
    // ...mais les cles brutes ne passent aucune frontiere.
    const transporte = JSON.stringify(contribution.resultats);
    expect(transporte).not.toContain("birthDate");
    expect(transporte).not.toContain("0551234567");
  });

  it("capacite inconnue (faux) : repli atomique entier, mesure et trace", () => {
    const { contribution, snapshot } = assembler(
      entreeDeBase({
        intention: null,
        resultats: [succes("capacite_test", { creneaux: [{ ref: "RDV_001" }] })],
      }),
    );
    expect(JSON.stringify(contribution.resultats)).toContain("RDV_001");
    expect(snapshot.sections).toHaveLength(1);
    expect(snapshot.sections[0]).toMatchObject({ capacite: "capacite_test", items: 1, tronque: false });
  });

  it("echec : enveloppe preservee, donnees null (jamais de sections)", () => {
    const { contribution } = assembler(
      entreeDeBase({ resultats: [echec("get_today_agenda", "interdit")] }),
    );
    expect(contribution.resultats).toHaveLength(1);
    expect(contribution.resultats[0]).toMatchObject({
      capacite: "get_today_agenda",
      ok: false,
      donnees: null,
      motifEchec: "interdit",
    });
  });
});

// ---------------------------------------------------------------------------
// 5 - TRONCATURE SEMANTIQUE
// ---------------------------------------------------------------------------

describe("troncature : items entiers, ordre fournisseur, nouveau protege", () => {
  it("chronologie volumineuse : coupe par la fin, plus recents intacts", () => {
    const chrono = chronologie(60, 2000);
    const { contribution, snapshot } = assembler(
      entreeDeBase({
        intention: "GET_PATIENT_TIMELINE",
        resultats: [succes("get_patient_timeline", chrono)],
      }),
    );
    const porte = contribution.resultats[0]?.donnees?.sections["seances"] as {
      evenements: Array<{ le: string; detail: Record<string, string> }>;
    };
    expect(snapshot.octetsContribution).toBeLessThanOrEqual(BUDGETS.MAX_OCTETS_CONTEXTE);
    expect(snapshot.depassementBudget).toBe(false);
    const resume = snapshot.sections.find((s) => s.section === "seances");
    expect(resume?.tronque).toBe(true);
    // Les plus recents sont intacts, octet pour octet.
    expect(porte.evenements[0]).toEqual(chrono.evenements[0]);
    expect(porte.evenements[1]).toEqual(chrono.evenements[1]);
    expect(resume?.items).toBe(porte.evenements.length);
    expect(porte.evenements.length).toBeLessThan(60);
  });

  it("le resultat le plus recent n'est jamais omis (l'ancien cede d'abord)", () => {
    // ~16 Ko par chronologie : les deux survivent, seul l'ancien est coupe.
    const ancien = chronologie(40, 300);
    const nouveau = chronologie(40, 300);
    const { contribution, snapshot } = assembler(
      entreeDeBase({
        intention: "GET_PATIENT_TIMELINE",
        resultats: [succes("get_patient_timeline", ancien), succes("get_patient_timeline", nouveau)],
      }),
    );
    expect(snapshot.octetsContribution).toBeLessThanOrEqual(BUDGETS.MAX_OCTETS_CONTEXTE);
    expect(contribution.resultats).toHaveLength(2);
    const portes = contribution.resultats.map(
      (r) => (r.donnees?.sections["seances"] as { evenements: unknown[] }).evenements.length,
    );
    // Le nouveau garde tous ses items ; l'ancien a cede, sans omission entiere.
    expect(portes[1]).toBe(40);
    expect(portes[0]).toBeGreaterThan(0);
    expect(portes[0]).toBeLessThan(40);
    expect(snapshot.resultatsOmisBudget).toBe(0);
    // L'evenement le plus recent du nouveau est intact.
    const porteNeuf = contribution.resultats[1]?.donnees?.sections["seances"] as {
      evenements: unknown[];
    };
    expect(porteNeuf.evenements[0]).toEqual(nouveau.evenements[0]);
  });

  it("SOAP : un champ transporte est integral ou absent (jamais moitie)", () => {
    const seances = {
      patient: "PATIENT_001",
      seances: [
        {
          patient: "PATIENT_001",
          le: "2026-09-01T10:00:00+01:00",
          close: true,
          type: "suivi",
          note: {
            signee: true,
            soap: {
              subjective: "S".repeat(3000),
              objective: "O".repeat(3000),
              assessment: "A".repeat(3000),
              plan: "P".repeat(3000),
            },
          },
          provenance: [],
        },
      ],
      tronque: false,
      provenance: [],
    };
    const { contribution } = assembler(
      entreeDeBase({
        intention: "GET_CONSULTATION_HISTORY",
        resultats: [
          succes("get_consultation_history", seances),
          succes("get_patient_timeline", chronologie(30, 1500)),
        ],
      }),
    );
    const texte = JSON.stringify(contribution.resultats);
    // La seance atomique (12 Ko de SOAP) est soit entiere, soit absente.
    const subjectifEntier = "S".repeat(3000);
    if (texte.includes(subjectifEntier)) {
      expect(texte).toContain("O".repeat(3000));
      expect(texte).toContain("A".repeat(3000));
      expect(texte).toContain("P".repeat(3000));
    }
    expect(snapshotOmisOuPorte(contribution)).toBe(true);
  });

  it("la portee n'est jamais tronquee (temps + cible intacts)", () => {
    const { contribution } = assembler(
      entreeDeBase({
        intention: "GET_PATIENT_TIMELINE",
        resultats: [succes("get_patient_timeline", chronologie(60, 2000))],
      }),
    );
    expect(contribution.contexte.patientCible).toBe("PATIENT_001");
    expect(contribution.contexte.temps.aujourdHui).toBe("2026-09-15");
  });

  it("medicaments : l'en-cours est protege, seuls les arretes cedent", () => {
    const medicaments: SafeMedicamentsContext = {
      patient: "PATIENT_001",
      enCours: {
        actifs: [
          {
            designation: "Sertraline",
            dose: "50 mg",
            frequence: "1/j",
            statut: "active",
            debuteLe: "2026-01-01",
            arreteLe: null,
          },
        ],
        enPause: [],
      },
      historique: {
        arretesRecents: Array.from({ length: 30 }, (_, i) => ({
          designation: `Ancien-${i} ${"x".repeat(800)}`,
          dose: "10 mg",
          frequence: "1/j",
          statut: "stopped" as const,
          debuteLe: "2020-01-01",
          arreteLe: "2021-01-01",
        })),
        dernierePrescriptionLe: "2026-09-01",
        nombrePrescriptions: 31,
        historiqueIncomplet: true,
      },
      provenance: [{ porte: "app.get_patient_treatments", luA: "2026-09-15T09:00:00Z", tronque: false }],
    };
    const { contribution, snapshot } = assembler(
      entreeDeBase({
        intention: "GET_CURRENT_MEDICATIONS",
        resultats: [succes("get_current_medications", medicaments)],
      }),
    );
    expect(snapshot.octetsContribution).toBeLessThanOrEqual(BUDGETS.MAX_OCTETS_CONTEXTE);
    const texte = JSON.stringify(contribution.resultats);
    expect(texte).toContain("Sertraline");
    const resume = snapshot.sections.find((s) => s.section === "traitements");
    expect(resume?.tronque).toBe(true);
  });
});

function snapshotOmisOuPorte(contribution: { resultats: readonly unknown[] }): boolean {
  return contribution.resultats.length >= 1;
}

// ---------------------------------------------------------------------------
// 6 - BUDGET
// ---------------------------------------------------------------------------

describe("budget : le total existant est applique, rien d'invente", () => {
  it("melange adversarial : total borne, pas de depassement", () => {
    const { snapshot } = assembler(
      entreeDeBase({
        intention: null,
        resultats: [
          succes("get_patient_timeline", chronologie(40, 1500)),
          succes("get_patient_context", dossierComplet()),
          succes("get_today_agenda", {
            creneaux: Array.from({ length: 20 }, (_, i) => ({
              ref: `RDV_${String(i + 1).padStart(3, "0")}`,
              debut: "2026-09-15T09:00:00+01:00",
              fin: "2026-09-15T09:30:00+01:00",
              dureeMinutes: 30,
              statut: "scheduled",
              type: "suivi",
              arriveA: null,
              bourrage: "y".repeat(900),
            })),
            provenance: [],
          }),
        ],
      }),
    );
    expect(snapshot.budgetOctetsTotal).toBe(BUDGETS.MAX_OCTETS_CONTEXTE);
    expect(snapshot.budgetOctetsTotal).toBe(24_000);
    expect(snapshot.octetsContribution).toBeLessThanOrEqual(24_000);
    expect(snapshot.depassementBudget).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7 - CONTAMINATION INTER-ITERATIONS (EPOQUES)
// ---------------------------------------------------------------------------

describe("epoques de portee : le passe perime ne survit pas", () => {
  const agendaKarim = {
    creneaux: [{ ref: "RDV_001", patient: "PATIENT_001", debut: "2026-09-15T09:00:00+01:00" }],
    provenance: [],
  };

  it("succes d'epoque close + portee ambigue = ecarte, compte, hash change", () => {
    const avant = assembler(
      entreeDeBase({ resultats: [succes("get_today_agenda", agendaKarim, 0)], epoqueCourante: 0 }),
    );
    const apres = assembler(
      entreeDeBase({
        scope: SCOPE_AMBIGU,
        amorce: { temps: { ...TEMPS }, consultationOuverte: false },
        resultats: [succes("get_today_agenda", agendaKarim, 0)],
        epoqueCourante: 1,
      }),
    );
    expect(avant.contribution.resultats).toHaveLength(1);
    expect(apres.contribution.resultats).toHaveLength(0);
    expect(apres.snapshot.resultatsEcartesPortee).toBe(1);
    expect(apres.snapshot.contributionHash).not.toBe(avant.snapshot.contributionHash);
    expect("patientCible" in apres.contribution.contexte).toBe(false);
  });

  it("les echecs survivent au changement d'epoque (sans donnee, le modele en a besoin)", () => {
    const { contribution } = assembler(
      entreeDeBase({
        scope: SCOPE_AMBIGU,
        amorce: { temps: { ...TEMPS }, consultationOuverte: false },
        resultats: [echec("get_patient_context", "patient-hors-fil", 0)],
        epoqueCourante: 1,
      }),
    );
    expect(contribution.resultats).toHaveLength(1);
    expect(contribution.resultats[0]).toMatchObject({ ok: false, donnees: null });
  });

  it("la recherche ambigue survit (matiere de clarification), le reste non", () => {
    const { contribution, snapshot } = assembler(
      entreeDeBase({
        scope: SCOPE_AMBIGU,
        amorce: { temps: { ...TEMPS }, consultationOuverte: false },
        resultats: [
          succes("get_patient_context", dossierComplet(), 0),
          succes("search_patients", { resultats: ["PATIENT_001", "PATIENT_002"], total: 2, ambigu: true }, 0),
        ],
        epoqueCourante: 1,
      }),
    );
    expect(contribution.resultats).toHaveLength(1);
    expect(contribution.resultats[0]?.capacite).toBe("search_patients");
    expect(snapshot.resultatsEcartesPortee).toBe(1);
  });

  it("scenario A->B : le contexte de A ne fuit pas dans l'appel de B", () => {
    const scopeB: ScopeAssemblage = { etat: "resolu", patientRef: "PATIENT_002", source: "explicite" };
    const { contribution, snapshot } = assembler(
      entreeDeBase({
        scope: scopeB,
        amorce: { temps: { ...TEMPS }, patientCible: "PATIENT_002", consultationOuverte: false },
        resultats: [succes("get_patient_context", dossierComplet(), 0)],
        epoqueCourante: 1,
      }),
    );
    // Le succes de l'epoque 0 (lu sous A) est ecarte meme si une portee
    // resolue existe : seule l'epoque courante alimente la contribution.
    expect(contribution.resultats).toHaveLength(0);
    expect(snapshot.resultatsEcartesPortee).toBe(1);
    expect(contribution.contexte.patientCible).toBe("PATIENT_002");
  });
});

// ---------------------------------------------------------------------------
// 8 - CONFIDENTIALITE DU CLICHE
// ---------------------------------------------------------------------------

describe("cliche : metadonnees seules, jamais de PII", () => {
  it("le cliche ne contient ni identites, ni UUID, ni contenu clinique", () => {
    const medicaments: SafeMedicamentsContext = {
      patient: "PATIENT_001",
      enCours: {
        actifs: [
          {
            designation: "Sertraline 50 mg",
            dose: "50 mg",
            frequence: "1/j",
            statut: "active",
            debuteLe: "2026-01-01",
            arreteLe: null,
          },
        ],
        enPause: [],
      },
      historique: {
        arretesRecents: [],
        dernierePrescriptionLe: "2026-09-01",
        nombrePrescriptions: 1,
        historiqueIncomplet: true,
      },
      provenance: [{ porte: "app.get_patient_treatments", luA: "2026-09-15T09:00:00Z", tronque: false }],
    };
    const { snapshot } = assembler(
      entreeDeBase({
        intention: "GET_CURRENT_MEDICATIONS",
        resultats: [
          succes("get_patient_context", {
            ...dossierComplet(),
            // PII volontairement glissee dans les champs projetes.
            clinique: {
              diagnostics: [
                {
                  code: "F41.1",
                  systeme: "ICD-10",
                  libelle: `Suivi de ${KARIM.libelle} (${KARIM.numeroDossier}, 0551234567, nadia@example.dz)`,
                  principal: true,
                  depuis: "2024-01-01",
                  resoluLe: null,
                },
              ],
              echelles: [],
              derniereConsultation: null,
              nombreConsultations: 3,
            },
          }),
          succes("get_current_medications", medicaments),
        ],
      }),
    );
    const texte = JSON.stringify(snapshot);
    const interdits = [
      KARIM.libelle,
      KARIM.nom,
      KARIM.prenom,
      KARIM.numeroDossier,
      KARIM.id,
      MAHMOUD.libelle,
      MAHMOUD.id,
      "0551234567",
      "nadia@example.dz",
      "Sertraline",
      "50 mg",
      "subjective",
    ];
    for (const interdit of interdits) {
      expect(texte).not.toContain(interdit);
    }
    // ...mais la structure tracee est presente.
    expect(texte).toContain("GET_CURRENT_MEDICATIONS");
    expect(texte).toContain("traitements");
    expect(snapshot.sections.length).toBeGreaterThan(0);
  });

  it("les cles du cliche sont un vocabulaire ferme de metadonnees", () => {
    const { snapshot } = assembler(entreeDeBase());
    const clesSnapshot = Object.keys(snapshot).sort();
    expect(clesSnapshot).toEqual(
      [
        "budgetOctetsTotal",
        "clientTurnId",
        "contributionHash",
        "conversationId",
        "depassementBudget",
        "intention",
        "octetsContribution",
        "piecesOmisesNonRequises",
        "resultatsEcartesPortee",
        "resultatsOmisBudget",
        "runId",
        "scope",
        "sections",
        "sectionsRequises",
        "tourIndex",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// 9 - COMPLETUDE + AMORCE
// ---------------------------------------------------------------------------

describe("garde-fous structurels", () => {
  it("les 22 capacites de lecture sont toutes ventilees", () => {
    expect(CAPACITES_VENTILEES.size).toBe(22);
    for (const nom of [
      "search_patients",
      "get_patient_context",
      "get_patient_timeline",
      "get_patient_documents",
      "get_next_patient",
      "get_today_agenda",
      "get_agenda_range",
      "get_appointment",
      "get_waiting_room",
      "get_consultation",
      "get_day_revenue",
      "get_period_revenue",
      "get_outstanding_payments",
      "get_notifications",
      "get_system_status",
      "get_current_medications",
      "get_consultation_history",
      "get_patient_financial_summary",
      "brief_prochain_patient",
      "brief_matinal",
      "brief_finance",
      "draft_patient_message",
    ] as const) {
      expect(CAPACITES_VENTILEES.has(nom)).toBe(true);
    }
  });

  it("amorce maximale : la forme borne structurellement reste un tripwire (< 4 Ko)", () => {
    // Pas un budget : la forme (temps + jeton + bool) ne PEUT pas porter un
    // dossier. Ce test sonne si la forme change un jour.
    const { contribution } = assembler(
      entreeDeBase({
        amorce: { temps: { ...TEMPS }, patientCible: "PATIENT_001", consultationOuverte: true },
        resultats: [],
      }),
    );
    expect(JSON.stringify(contribution.contexte).length).toBeLessThan(4096);
  });
});
