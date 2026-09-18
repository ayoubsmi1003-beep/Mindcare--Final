/**
 * `COMPATIBLE` — CHAQUE INTENT MÈNE À UNE CAPACITÉ RÉELLE, AUCUNE AUTRE.
 *
 * ═══ CE QUE CE FICHIER ÉPROUVE, SUR DU CODE RÉEL ═══
 * Chaque nom listé dans `COMPATIBLE` existe dans le registre de lecture
 * (`capaciteLecture`, alias inclus) ou d'écriture (`capaciteEcriture`).
 * Un nom inventé n'est compatible avec RIEN. Les écritures ne sont
 * compatibles qu'avec leur intent d'écriture. Les méta-intents refusent tout
 * outil. Les paires de confusion restent disjointes (hors recherche).
 */
import { describe, expect, it } from "vitest";

import { capaciteLecture } from "@/services/jarvis-capacites";
import { capaciteEcriture } from "@/services/jarvis-ecritures";
import {
  COMPATIBLE,
  estPropositionCompatible,
  INTENTS_ECRITURE,
  INTENTS_META,
  NOMS_INTENTIONS,
  type NomIntention,
} from "@/shared/jarvis/intentions";

function existe(nom: string): boolean {
  return capaciteLecture(nom) !== null || capaciteEcriture(nom) !== null;
}

describe("chaque intent mène à une capacité réelle", () => {
  it("tout nom de COMPATIBLE existe (lecture, alias ou écriture)", () => {
    const inconnus: string[] = [];
    for (const outils of Object.values(COMPATIBLE)) {
      for (const nom of outils) {
        if (!existe(nom)) inconnus.push(nom);
      }
    }
    expect(inconnus).toEqual([]);
  });

  it("les 7 écritures du registre sont couvertes 1:1, sans porte manquante", () => {
    const ecritures = [
      "create_appointment",
      "reschedule_appointment",
      "cancel_appointment",
      "mark_patient_arrived",
      "record_payment_collected",
      "set_consultation_price",
      "create_document_draft",
    ];
    for (const nom of ecritures) {
      expect(capaciteEcriture(nom), nom).not.toBeNull();
    }
    const couverts = new Set(Object.values(COMPATIBLE).flat());
    for (const nom of ecritures) {
      expect(couverts.has(nom), nom).toBe(true);
    }
  });

  it("aucun intent ne liste un outil SQL brut ou inconnu", () => {
    for (const outils of Object.values(COMPATIBLE)) {
      expect(outils).not.toContain("execute_sql");
    }
    expect(existe("execute_sql")).toBe(false);
  });
});

describe("noms inventés : compatibles avec rien", () => {
  it("effacer_base, execute_sql, sixième outil imaginaire → false partout", () => {
    for (const nom of NOMS_INTENTIONS) {
      expect(estPropositionCompatible(nom, "effacer_base")).toBe(false);
      expect(estPropositionCompatible(nom, "execute_sql")).toBe(false);
      expect(estPropositionCompatible(nom, "delete_charge")).toBe(false);
      expect(estPropositionCompatible(nom, "")).toBe(false);
    }
  });
});

describe("écritures cloisonnées", () => {
  it("une écriture n'est compatible qu'avec son intent d'écriture", () => {
    const intentEcritureDe: Record<string, NomIntention> = {
      create_appointment: "CREATE_APPOINTMENT",
      reschedule_appointment: "RESCHEDULE_APPOINTMENT",
      cancel_appointment: "CANCEL_APPOINTMENT",
      mark_patient_arrived: "MARK_PATIENT_ARRIVED",
      record_payment_collected: "RECORD_PAYMENT_COLLECTED",
      set_consultation_price: "SET_CONSULTATION_PRICE",
      create_document_draft: "CREATE_DOCUMENT_DRAFT",
    };
    for (const [outil, seulIntent] of Object.entries(intentEcritureDe)) {
      for (const nom of NOMS_INTENTIONS) {
        expect(estPropositionCompatible(nom, outil)).toBe(nom === seulIntent);
      }
    }
  });

  it("écritures et brouillon autorisent la résolution search_patients (premier pas légitime)", () => {
    for (const nom of [...INTENTS_ECRITURE, "DRAFT_MESSAGE" as const]) {
      expect(estPropositionCompatible(nom, "search_patients")).toBe(true);
    }
  });

  it("aucun intent de lecture ne laisse passer un outil d'écriture", () => {
    // Les 7 outils d'écriture eux-mêmes — pas les listes COMPATIBLE, qui
    // incluent volontairement `search_patients` (résolution, premier pas).
    const outilsEcriture = [
      "create_appointment",
      "reschedule_appointment",
      "cancel_appointment",
      "mark_patient_arrived",
      "record_payment_collected",
      "set_consultation_price",
      "create_document_draft",
    ];
    for (const nom of NOMS_INTENTIONS) {
      if (INTENTS_ECRITURE.has(nom) || INTENTS_META.has(nom)) continue;
      for (const outil of outilsEcriture) {
        expect(estPropositionCompatible(nom, outil)).toBe(false);
      }
    }
  });
});

describe("méta-intents : zéro outil", () => {
  it("GENERAL_KNOWLEDGE, ASK_CLARIFICATION, UNKNOWN refusent tout, même search_patients", () => {
    for (const nom of INTENTS_META) {
      expect(estPropositionCompatible(nom, "search_patients")).toBe(false);
      expect(estPropositionCompatible(nom, "get_next_patient")).toBe(false);
      expect(estPropositionCompatible(nom, "create_appointment")).toBe(false);
    }
  });
});

describe("paires de confusion : disjointes hors recherche", () => {
  const RECHERCHE = new Set(["search_patients", "search_patient"]);

  function horsRecherche(nom: NomIntention): Set<string> {
    return new Set([...COMPATIBLE[nom]].filter((o) => !RECHERCHE.has(o)));
  }

  function disjointesHorsRecherche(a: NomIntention, b: NomIntention): boolean {
    const sa = horsRecherche(a);
    return ![...horsRecherche(b)].some((o) => sa.has(o));
  }

  it("contexte vs timeline vs historique vs consultation", () => {
    expect(disjointesHorsRecherche("GET_PATIENT_CONTEXT", "GET_PATIENT_TIMELINE")).toBe(true);
    expect(disjointesHorsRecherche("GET_PATIENT_TIMELINE", "GET_CONSULTATION_HISTORY")).toBe(true);
    expect(disjointesHorsRecherche("GET_CONSULTATION_HISTORY", "GET_CONSULTATION")).toBe(true);
  });

  it("finance patient vs finance globale", () => {
    expect(
      disjointesHorsRecherche("GET_PATIENT_FINANCIAL_SUMMARY", "GET_DAY_REVENUE"),
    ).toBe(true);
    expect(
      disjointesHorsRecherche("GET_PATIENT_FINANCIAL_SUMMARY", "GET_PERIOD_REVENUE"),
    ).toBe(true);
  });
});
