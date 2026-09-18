/**
 * `jarvis-routage-intentions.test.ts` - LE ROUTEUR M04, EPROUVE AVANT D'EXISTER.
 *
 * NOTE D'ENCODAGE : fichier volontairement ASCII-only (francais sans accents).
 *
 * TDD RED : ce fichier vise `src/services/jarvis-routage-intentions.ts`, qui
 * n'existe pas encore. Chaque test doit ECHOUER (module manquant) avant la
 * passe GREEN.
 *
 * Le routeur ne duplique AUCUNE table : l'autorite reste `COMPATIBLE` (M01).
 * Il expose la decision de routage (intent -> famille autorisee), valide le
 * signal d'intention qui accompagne une proposition, et ne fait rien d'autre :
 * ni resolution (M02), ni assemblage (M03), ni autorisation (RLS), ni
 * confirmation (ecritures).
 */
import { describe, expect, it } from "vitest";

import {
  capacitesAutorisees,
  intentionValideeDe,
  propositionAutorisee,
} from "../../src/services/jarvis-routage-intentions";
import {
  INTENTS_ECRITURE,
  INTENTS_META,
  NOMS_INTENTIONS,
  type NomIntention,
} from "../../src/shared/jarvis/intentions";

describe("routage M04 : les 32 intentions ont un comportement explicite", () => {
  it("chaque intention M01 expose une famille fermee (tableau, jamais undefined)", () => {
    for (const nom of NOMS_INTENTIONS) {
      const famille = capacitesAutorisees(nom);
      expect(Array.isArray(famille)).toBe(true);
    }
  });

  it("les 3 meta-intentions resolvent vers l'ensemble vide (zero outil)", () => {
    for (const nom of INTENTS_META) {
      expect(capacitesAutorisees(nom)).toEqual([]);
      expect(propositionAutorisee(nom, "search_patients")).toBe(false);
      expect(propositionAutorisee(nom, "get_today_agenda")).toBe(false);
      expect(propositionAutorisee(nom, "create_appointment")).toBe(false);
    }
  });

  it("chaque intention de lecture autorise au moins sa capacite nominale", () => {
    const nominales: Readonly<Record<string, string>> = {
      SEARCH_PATIENT: "search_patients",
      GET_PATIENT_CONTEXT: "get_patient_context",
      GET_PATIENT_TIMELINE: "get_patient_timeline",
      GET_CONSULTATION_HISTORY: "get_consultation_history",
      GET_CURRENT_MEDICATIONS: "get_current_medications",
      GET_PATIENT_DOCUMENTS: "get_patient_documents",
      GET_PATIENT_FINANCIAL_SUMMARY: "get_patient_financial_summary",
      GET_CONSULTATION: "get_consultation",
      GET_NEXT_PATIENT: "get_next_patient",
      GET_TODAY_AGENDA: "get_today_agenda",
      GET_AGENDA_RANGE: "get_agenda_range",
      GET_WAITING_ROOM: "get_waiting_room",
      GET_APPOINTMENT_DETAIL: "get_appointment",
      GET_DAY_REVENUE: "get_day_revenue",
      GET_PERIOD_REVENUE: "get_period_revenue",
      GET_OUTSTANDING_PAYMENTS: "get_outstanding_payments",
      GET_NOTIFICATIONS: "get_notifications",
      GET_SYSTEM_STATUS: "get_system_status",
      BRIEF_MATINAL: "brief_matinal",
      BRIEF_PROCHAIN_PATIENT: "brief_prochain_patient",
      BRIEF_FINANCE: "brief_finance",
      DRAFT_MESSAGE: "draft_patient_message",
    };
    for (const [intent, capacite] of Object.entries(nominales)) {
      expect(propositionAutorisee(intent as NomIntention, capacite)).toBe(true);
    }
  });

  it("chaque intention d'ecriture autorise sa capacite nominale (classification, pas execution)", () => {
    const nominales: Readonly<Record<string, string>> = {
      CREATE_APPOINTMENT: "create_appointment",
      RESCHEDULE_APPOINTMENT: "reschedule_appointment",
      CANCEL_APPOINTMENT: "cancel_appointment",
      MARK_PATIENT_ARRIVED: "mark_patient_arrived",
      RECORD_PAYMENT_COLLECTED: "record_payment_collected",
      SET_CONSULTATION_PRICE: "set_consultation_price",
      CREATE_DOCUMENT_DRAFT: "create_document_draft",
    };
    expect(INTENTS_ECRITURE.size).toBe(7);
    for (const [intent, capacite] of Object.entries(nominales)) {
      expect(propositionAutorisee(intent as NomIntention, capacite)).toBe(true);
    }
  });
});

describe("routage M04 : monotonicite (plus de modele ne donne jamais plus de droit)", () => {
  it("GET_PATIENT_CONTEXT : lecture autorisee, ecritures et autres familles refusees", () => {
    expect(propositionAutorisee("GET_PATIENT_CONTEXT", "get_patient_context")).toBe(true);
    // Monotonicite : le modele propose plus puissant -> refuse, jamais d'escalade.
    expect(propositionAutorisee("GET_PATIENT_CONTEXT", "create_appointment")).toBe(false);
    expect(propositionAutorisee("GET_PATIENT_CONTEXT", "record_payment_collected")).toBe(false);
    expect(propositionAutorisee("GET_PATIENT_CONTEXT", "set_consultation_price")).toBe(false);
    expect(propositionAutorisee("GET_PATIENT_CONTEXT", "get_day_revenue")).toBe(false);
    expect(propositionAutorisee("GET_PATIENT_CONTEXT", "get_today_agenda")).toBe(false);
    expect(propositionAutorisee("GET_PATIENT_CONTEXT", "outil_invente_par_le_modele")).toBe(false);
  });

  it("GET_DAY_REVENUE : finance autorisee, clinique refusee", () => {
    expect(propositionAutorisee("GET_DAY_REVENUE", "get_day_revenue")).toBe(true);
    expect(propositionAutorisee("GET_DAY_REVENUE", "get_patient_context")).toBe(false);
    expect(propositionAutorisee("GET_DAY_REVENUE", "get_current_medications")).toBe(false);
    expect(propositionAutorisee("GET_DAY_REVENUE", "record_payment_collected")).toBe(false);
  });

  it("UNKNOWN : rien ne passe, meme une lecture legitime", () => {
    expect(propositionAutorisee("UNKNOWN", "get_patient_context")).toBe(false);
    expect(propositionAutorisee("UNKNOWN", "get_today_agenda")).toBe(false);
    expect(propositionAutorisee("UNKNOWN", "search_patients")).toBe(false);
  });

  it("une intention d'ecriture n'autorise jamais une AUTRE ecriture", () => {
    expect(propositionAutorisee("CREATE_APPOINTMENT", "cancel_appointment")).toBe(false);
    expect(propositionAutorisee("CREATE_APPOINTMENT", "set_consultation_price")).toBe(false);
    expect(propositionAutorisee("CANCEL_APPOINTMENT", "create_appointment")).toBe(false);
  });
});

describe("routage M04 : determinisme et independance langue", () => {
  it("meme intention -> meme famille, meme ordre, a chaque appel (composition previsible)", () => {
    const a = capacitesAutorisees("GET_TODAY_AGENDA");
    const b = capacitesAutorisees("GET_TODAY_AGENDA");
    expect(a).toBe(b);
    expect([...a]).toEqual(["get_today_agenda", "get_agenda_range", "get_agenda"]);
  });

  it("familles de composition declarees : agenda et finance couvrent leurs partenaires", () => {
    // "qui vient demain et n'a pas paye ?" : les deux capacites vivent dans
    // des familles que leurs intentions autorisent - la composition multi-outil
    // reste possible dans la boucle, sans elargissement silencieux.
    expect(propositionAutorisee("GET_AGENDA_RANGE", "get_agenda_range")).toBe(true);
    expect(propositionAutorisee("GET_OUTSTANDING_PAYMENTS", "get_outstanding_payments")).toBe(true);
    expect(propositionAutorisee("BRIEF_PROCHAIN_PATIENT", "brief_prochain_patient")).toBe(true);
  });

  it("le routeur ne lit aucun message : deux langues, meme intention, meme decision", () => {
    // Apres normalisation M01, le routage est une fonction pure de
    // l'intention validee - aucun chemin par langue (FR/Darija/Arabe).
    const decide = (intent: NomIntention, nom: string): boolean =>
      propositionAutorisee(intent, nom);
    expect(decide("GET_CURRENT_MEDICATIONS", "get_current_medications")).toBe(true);
    expect(decide("GET_CURRENT_MEDICATIONS", "get_current_medications")).toBe(true);
    expect(decide("GET_CURRENT_MEDICATIONS", "get_day_revenue")).toBe(false);
  });
});

describe("routage M04 : signal d'intention absent ou corrompu", () => {
  it("intent null/undefined = comportement historique permissif (pas de filtre sans intent valide)", () => {
    expect(propositionAutorisee(null, "get_patient_context")).toBe(true);
    expect(propositionAutorisee(undefined, "outil_quelconque")).toBe(true);
  });

  it("nom propose non-chaine = refuse (jamais d'autorisation sur une forme etrangere)", () => {
    expect(propositionAutorisee("GET_PATIENT_CONTEXT", null)).toBe(false);
    expect(propositionAutorisee("GET_PATIENT_CONTEXT", undefined)).toBe(false);
    expect(propositionAutorisee("GET_PATIENT_CONTEXT", 42)).toBe(false);
    expect(propositionAutorisee("GET_PATIENT_CONTEXT", "")).toBe(false);
  });

  it("intentionValideeDe : nom M01 valide passe, tout le reste rend null", () => {
    expect(intentionValideeDe("GET_PATIENT_CONTEXT")).toBe("GET_PATIENT_CONTEXT");
    expect(intentionValideeDe("UNKNOWN")).toBe("UNKNOWN");
    // UUID forge, jeton, texte libre, null : jamais une autorite.
    expect(intentionValideeDe("00000000-0000-4000-8000-000000000001")).toBeNull();
    expect(intentionValideeDe("{{PATIENT_001}}")).toBeNull();
    expect(intentionValideeDe("PATIENT_001")).toBeNull();
    expect(intentionValideeDe("outil_invente")).toBeNull();
    expect(intentionValideeDe(null)).toBeNull();
    expect(intentionValideeDe(undefined)).toBeNull();
    expect(intentionValideeDe(42)).toBeNull();
  });
});
