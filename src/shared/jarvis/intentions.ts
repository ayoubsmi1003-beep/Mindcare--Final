/**
 * `intentions.ts` — LE CONTRAT D'INTENTION STRUCTURÉE (M01).
 *
 * ═══ POURQUOI CE FICHIER EXISTE ═══
 * `routing.ts` décide du CHEMIN (connaissance | patient | refus) par regex
 * déterministes ; il ne dit pas CE QUE la praticienne veut. Le modèle, lui,
 * proposait directement un outil (`proposition.ts`), sans vocabulaire fermé
 * de l'intention — d'où la fragilité aux paraphrases/darija/fautes. Ce fichier
 * ferme le vocabulaire de l'intention : 32 noms, qui correspondent 1:1 aux
 * capacités EXISTANTES (22 lectures de `jarvis-capacites.ts` + 7 écritures de
 * `jarvis-ecritures.ts` + 3 méta), validés en Zod strict AVANT toute sélection
 * d'outil.
 *
 * ═══ CE QUE CE FICHIER NE FAIT PAS ═══
 * Il ne résout aucune identité (M02), n'autorise aucun outil (les gates
 * existants : Zod capacité + allowlist 033/063 + RLS + confirmation humaine),
 * n'exécute rien, n'appelle aucun modèle, ne calcule aucune date. Une mention
 * `patientMention` est du TEXTE (« Karim »), jamais un UUID, jamais un jeton
 * `{{PATIENT_001}}` — un modèle qui en émet un rend l'intent INVALIDE.
 *
 * ═══ `confidence` EST UNE MÉTADONNÉE, JAMAIS UNE AUTORISATION ═══
 * `SEUIL_CONFIANCE_MIN` ne sert qu'à JETER (confiance basse → intent écarté,
 * direction fail-closed). `confiance haute => exécuter` est INTERDIT : une
 * exécution exige la compatibilité intent→outil + tous les gates existants.
 *
 * ═══ PUR ET SANS IMPORT MÉTIER ═══
 * Seul `zod`, comme les registres. Compilable offline (`tsc` + node) pour la
 * passe d'évaluation, comme `routing.ts`.
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// 1 · L'ONTOLOGIE FERMÉE — 1:1 avec les capacités existantes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Patient (8) ← `jarvis-capacites.ts` LECTURES.
 * Agenda (5), finance (3), système (2), briefs (3), brouillon (1).
 * Écritures (7) ← `jarvis-ecritures.ts` : classification SEULEMENT en M01 —
 * une intention d'écriture ne propose rien, n'autorise rien, n'exécute rien ;
 * le cycle PROPOSE→CONFIRM→EXECUTE→VERIFY→LOG reste seul maître.
 * Méta (3) : savoir général, clarification, inconnu — zéro outil.
 */
export const NOMS_INTENTIONS = [
  "SEARCH_PATIENT",
  "GET_PATIENT_CONTEXT",
  "GET_PATIENT_TIMELINE",
  "GET_CONSULTATION_HISTORY",
  "GET_CURRENT_MEDICATIONS",
  "GET_PATIENT_DOCUMENTS",
  "GET_PATIENT_FINANCIAL_SUMMARY",
  "GET_CONSULTATION",
  "GET_NEXT_PATIENT",
  "GET_TODAY_AGENDA",
  "GET_AGENDA_RANGE",
  "GET_WAITING_ROOM",
  "GET_APPOINTMENT_DETAIL",
  "GET_DAY_REVENUE",
  "GET_PERIOD_REVENUE",
  "GET_OUTSTANDING_PAYMENTS",
  "GET_NOTIFICATIONS",
  "GET_SYSTEM_STATUS",
  "BRIEF_MATINAL",
  "BRIEF_PROCHAIN_PATIENT",
  "BRIEF_FINANCE",
  "DRAFT_MESSAGE",
  "CREATE_APPOINTMENT",
  "RESCHEDULE_APPOINTMENT",
  "CANCEL_APPOINTMENT",
  "MARK_PATIENT_ARRIVED",
  "RECORD_PAYMENT_COLLECTED",
  "SET_CONSULTATION_PRICE",
  "CREATE_DOCUMENT_DRAFT",
  "GENERAL_KNOWLEDGE",
  "ASK_CLARIFICATION",
  "UNKNOWN",
] as const;

export type NomIntention = (typeof NOMS_INTENTIONS)[number];

/** Les 7 intentions d'écriture — classification seule, jamais d'exécution. */
export const INTENTS_ECRITURE: ReadonlySet<NomIntention> = new Set([
  "CREATE_APPOINTMENT",
  "RESCHEDULE_APPOINTMENT",
  "CANCEL_APPOINTMENT",
  "MARK_PATIENT_ARRIVED",
  "RECORD_PAYMENT_COLLECTED",
  "SET_CONSULTATION_PRICE",
  "CREATE_DOCUMENT_DRAFT",
]);

/** Les 3 méta-intentions — zéro outil autorisé. */
export const INTENTS_META: ReadonlySet<NomIntention> = new Set([
  "GENERAL_KNOWLEDGE",
  "ASK_CLARIFICATION",
  "UNKNOWN",
]);

export function estNomIntention(v: unknown): v is NomIntention {
  return typeof v === "string" && (NOMS_INTENTIONS as readonly string[]).includes(v);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · LE SCHÉMA — Zod v4 strict, aucun champ libre
// ═══════════════════════════════════════════════════════════════════════════

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Jetons système `{{PATIENT_001}}` / refs `PATIENT_001` : jamais une mention. */
const JETON_RE = /\{\{|\}\}|^(PATIENT|RDV|DOC|PRATICIEN)_\d+$/i;
const TEL_RE = /\b0[5-7]\d{8}\b|(?:\+|00)213\s?\d[\d\s.-]{7,}/;
const MAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

const MentionPatient = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .refine((s) => !UUID_RE.test(s.trim()), "mention textuelle, jamais un UUID")
  .refine((s) => !JETON_RE.test(s.trim()), "mention textuelle, jamais un jeton")
  .refine(
    (s) => !TEL_RE.test(s) && !MAIL_RE.test(s),
    "mention textuelle, jamais un identifiant",
  );

/**
 * La mention de jour reste BRUTE (« demain », « jeudi ») : le modèle ne calcule
 * AUCUNE date. La normalisation déterministe (calendrier du cabinet,
 * Africa/Algiers) appartient à l'application, pas au classifieur.
 */
const MentionJour = z.string().trim().min(2).max(40);

export const IntentSchema = z.strictObject({
  name: z.enum(NOMS_INTENTIONS),
  entities: z.strictObject({
    patientMention: MentionPatient.optional(),
    dateMention: MentionJour.optional(),
    periode: z.enum(["jour", "semaine", "mois", "annee"]).optional(),
    motifBrouillon: z.enum(["rappel_rendez_vous", "document_pret"]).optional(),
  }),
  references: z.strictObject({
    /** Pronom/référence sans antécédent détecté — NON résolu (M02). */
    pronomSansAntecedent: z.boolean(),
    /** Homonymie possible détectée lexicalement — NON tranchée (M02). */
    homonymePossible: z.boolean(),
  }),
  /** 0..1, fini. Métadonnée d'observation — jamais une autorisation. */
  confidence: z
    .number()
    .min(0)
    .max(1)
    .refine((n) => Number.isFinite(n), "confiance finie"),
  missingInformation: z
    .array(z.enum(["patientMention", "jour", "periode", "precisionDemande"]))
    .max(4)
    .refine((t) => new Set(t).size === t.length, "sans doublon"),
});

export type IntentValide = z.infer<typeof IntentSchema>;

/**
 * Valide strictement. Rend l'intent ou `null` — jamais de réparation, jamais
 * de devinette : un invalide est écarté (fail-closed), pas « rattrapé ».
 */
export function validerIntent(v: unknown): IntentValide | null {
  const analyse = IntentSchema.safeParse(v);
  return analyse.success ? analyse.data : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · CONFIANCE — seuil de REJET seul (fail-closed)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * En dessous : l'intent est ÉCARTÉ (→ UNKNOWN/clarification). Au-dessus :
 * RIEN n'est autorisé pour autant — la compatibilité + les gates décident.
 * Valeur initiale calibrée sur le harness, pas gravée : l'ajuster exige de
 * rejouer le golden complet (un seuil qui monte ne doit jamais faire passer
 * un cas qui passait, dans le sens dangereux).
 */
export const SEUIL_CONFIANCE_MIN = 0.55;

export function confianceSuffisante(intent: IntentValide): boolean {
  return intent.confidence >= SEUIL_CONFIANCE_MIN;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · COMPATIBILITÉ INTENT → CAPACITÉS — la seule table qui compte
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Noms RÉELS du registre + alias connus (`jarvis-alias.ts`) listés
 * explicitement — pas d'import de services ici (les couches ESLint
 * interdisent à `shared` d'importer `services`) ; la canonisation
 * (`canoniserAppel`) a lieu côté serveur AVANT ce contrôle, et les deux
 * orthographes sont acceptées ici pour que le contrôle reste total.
 */
export const COMPATIBLE: Readonly<Record<NomIntention, readonly string[]>> = {
  SEARCH_PATIENT: ["search_patients", "search_patient"],
  GET_PATIENT_CONTEXT: ["get_patient_context", "get_patient_summary", "search_patients", "search_patient"],
  GET_PATIENT_TIMELINE: ["get_patient_timeline", "search_patients", "search_patient"],
  GET_CONSULTATION_HISTORY: ["get_consultation_history", "search_patients", "search_patient"],
  GET_CURRENT_MEDICATIONS: ["get_current_medications", "search_patients", "search_patient"],
  GET_PATIENT_DOCUMENTS: ["get_patient_documents", "search_patients", "search_patient"],
  GET_PATIENT_FINANCIAL_SUMMARY: ["get_patient_financial_summary", "search_patients", "search_patient"],
  GET_CONSULTATION: ["get_consultation"],
  GET_NEXT_PATIENT: ["get_next_patient", "get_next_appointment", "get_agenda_range", "get_agenda", "get_today_agenda"],
  GET_TODAY_AGENDA: ["get_today_agenda", "get_agenda_range", "get_agenda"],
  GET_AGENDA_RANGE: ["get_agenda_range", "get_agenda"],
  GET_WAITING_ROOM: ["get_waiting_room"],
  GET_APPOINTMENT_DETAIL: ["get_appointment"],
  GET_DAY_REVENUE: ["get_day_revenue"],
  GET_PERIOD_REVENUE: ["get_period_revenue", "get_finance_overview", "brief_finance"],
  GET_OUTSTANDING_PAYMENTS: ["get_outstanding_payments", "get_pending_payments"],
  GET_NOTIFICATIONS: ["get_notifications", "get_attention_items"],
  GET_SYSTEM_STATUS: ["get_system_status"],
  BRIEF_MATINAL: ["brief_matinal"],
  BRIEF_PROCHAIN_PATIENT: ["brief_prochain_patient"],
  BRIEF_FINANCE: ["brief_finance", "get_period_revenue", "get_finance_overview"],
  // Écritures + brouillon : la résolution (`search_patients`) précède toujours la
  // proposition d'écriture (le modèle ne connaît aucun UUID) — sans elle, le
  // filtre bloquerait le premier pas légitime de tout flux d'écriture.
  DRAFT_MESSAGE: ["draft_patient_message", "search_patients", "search_patient"],
  CREATE_APPOINTMENT: ["create_appointment", "search_patients", "search_patient"],
  RESCHEDULE_APPOINTMENT: ["reschedule_appointment", "search_patients", "search_patient"],
  CANCEL_APPOINTMENT: ["cancel_appointment", "search_patients", "search_patient"],
  MARK_PATIENT_ARRIVED: ["mark_patient_arrived", "search_patients", "search_patient"],
  RECORD_PAYMENT_COLLECTED: ["record_payment_collected", "search_patients", "search_patient"],
  SET_CONSULTATION_PRICE: ["set_consultation_price", "search_patients", "search_patient"],
  CREATE_DOCUMENT_DRAFT: ["create_document_draft", "search_patients", "search_patient"],
  GENERAL_KNOWLEDGE: [],
  ASK_CLARIFICATION: [],
  UNKNOWN: [],
};

/**
 * `true` si la proposition du modèle appartient à la famille fermée de
 * l'intent. Toute autre valeur (nom inventé, outil hors famille, outil sur
 * intent méta) rend `false` → proposition bloquée serveur, zéro exécution.
 */
export function estPropositionCompatible(
  nomIntent: NomIntention,
  nomPropose: string,
): boolean {
  return COMPATIBLE[nomIntent]?.includes(nomPropose) ?? false;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · COMPARAISON DE MENTIONS — pour le harness (insensible casse/accents)
// ═══════════════════════════════════════════════════════════════════════════

/** Minuscules, sans accents : « Karim » et « karim » sont la même mention. */
export function normaliserMention(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function mentionsEgales(a: string, b: string): boolean {
  return normaliserMention(a) === normaliserMention(b);
}

// ═══════════════════════════════════════════════════════════════════════════
// 6 · DESCRIPTION COURTE — source unique du prompt classifieur
// ═══════════════════════════════════════════════════════════════════════════

/** Une ligne par intent, en français, sans jargon. Le prompt la recopie. */
export const DESCRIPTION_INTENTIONS: Readonly<Record<NomIntention, string>> = {
  SEARCH_PATIENT: "chercher un dossier patient par nom",
  GET_PATIENT_CONTEXT: "lire le dossier d'un patient nommé",
  GET_PATIENT_TIMELINE: "l'historique longitudinal d'un patient nommé",
  GET_CONSULTATION_HISTORY: "les séances passées d'un patient nommé",
  GET_CURRENT_MEDICATIONS: "les médicaments en cours d'un patient nommé",
  GET_PATIENT_DOCUMENTS: "les documents émis pour un patient nommé",
  GET_PATIENT_FINANCIAL_SUMMARY: "le résumé financier d'un patient nommé",
  GET_CONSULTATION: "le détail d'une consultation précise",
  GET_NEXT_PATIENT: "le prochain patient / qui vient après",
  GET_TODAY_AGENDA: "les créneaux d'une journée",
  GET_AGENDA_RANGE: "les créneaux sur une période",
  GET_WAITING_ROOM: "la salle d'attente (patients arrivés)",
  GET_APPOINTMENT_DETAIL: "le détail d'un rendez-vous précis",
  GET_DAY_REVENUE: "l'encaissé d'une journée",
  GET_PERIOD_REVENUE: "le chiffre d'une période (jour/semaine/mois/année)",
  GET_OUTSTANDING_PAYMENTS: "les paiements en attente",
  GET_NOTIFICATIONS: "ce qui demande l'attention (nature et nombre)",
  GET_SYSTEM_STATUS: "l'état du système local",
  BRIEF_MATINAL: "le point du matin",
  BRIEF_PROCHAIN_PATIENT: "préparer le prochain patient",
  BRIEF_FINANCE: "le point financier d'une période",
  DRAFT_MESSAGE: "rédiger un BROUILLON de message (jamais d'envoi)",
  CREATE_APPOINTMENT: "créer un rendez-vous (écriture, confirmation requise)",
  RESCHEDULE_APPOINTMENT: "déplacer un rendez-vous (écriture, confirmation requise)",
  CANCEL_APPOINTMENT: "annuler un rendez-vous (écriture, confirmation requise)",
  MARK_PATIENT_ARRIVED: "marquer un patient arrivé (écriture, confirmation requise)",
  RECORD_PAYMENT_COLLECTED: "encaisser un paiement (écriture, confirmation requise)",
  SET_CONSULTATION_PRICE: "fixer le tarif d'une consultation (écriture, confirmation requise)",
  CREATE_DOCUMENT_DRAFT: "préparer un brouillon de document (écriture, confirmation requise)",
  GENERAL_KNOWLEDGE: "question de savoir général, sans dossier",
  ASK_CLARIFICATION: "référence ambiguë ou pronom sans antécédent : demander lequel",
  UNKNOWN: "demande incomprise, vague ou hors périmètre",
};
