/**
 * What Alexa can really do, for the evaluation matrix and for honest "not available" answers.
 * `roles` documents and tests observed behaviour; RLS decides. Bound to the real tool schemas and
 * allowlisted gates by tests/unit/alexa-capabilities.test.ts, so an entry can't drift from the code.
 * Status: A accessible · C partial. Absent features are listed separately, never as tools.
 */
export interface AlexaCapability {
  readonly id: string; readonly domain: string; readonly tool: string; readonly section?: string; readonly view?: string;
  readonly mode: "read" | "propose"; readonly status: "A" | "C"; readonly gates: readonly string[];
  readonly roles: readonly ("owner" | "practitioner" | "assistant")[]; readonly limits?: string;
}
const clinical = ["owner", "practitioner"] as const, all = ["owner", "practitioner", "assistant"] as const;

export const ALEXA_CAPABILITIES: readonly AlexaCapability[] = [
  { id: "patient.search", domain: "patients", tool: "query_patients", mode: "read", status: "C", gates: ["search_patients"], roles: all },
  { id: "patient.profile", domain: "patients", tool: "get_patient_context", section: "profile", mode: "read", status: "A", gates: ["get_patient"], roles: all },
  { id: "patient.timeline", domain: "patients", tool: "get_patient_context", section: "timeline", mode: "read", status: "A", gates: ["list_patient_timeline"], roles: all, limits: "No date filter." },
  { id: "patient.summary", domain: "clinical", tool: "get_patient_context", section: "summary", mode: "read", status: "C", gates: ["get_alexa_clinical_context"], roles: clinical },
  { id: "patient.diagnoses", domain: "clinical", tool: "get_patient_context", section: "diagnoses", mode: "read", status: "A", gates: ["get_alexa_clinical_context"], roles: clinical },
  { id: "patient.treatments", domain: "clinical", tool: "get_patient_context", section: "treatments", mode: "read", status: "A", gates: ["get_alexa_clinical_context"], roles: clinical },
  { id: "patient.scales", domain: "clinical", tool: "get_patient_context", section: "scales", mode: "read", status: "A", gates: ["get_alexa_clinical_context"], roles: clinical },
  { id: "patient.notes", domain: "clinical", tool: "get_patient_context", section: "notes", mode: "read", status: "C", gates: ["query_alexa_note_sections"], roles: clinical },
  { id: "patient.allergies", domain: "clinical", tool: "get_patient_context", section: "allergies", mode: "read", status: "A", gates: ["list_patient_allergies"], roles: clinical },
  { id: "patient.adverse_events", domain: "clinical", tool: "get_patient_context", section: "adverse_events", mode: "read", status: "A", gates: ["list_patient_adverse_events"], roles: clinical },
  { id: "patient.adherence", domain: "clinical", tool: "get_patient_context", section: "adherence", mode: "read", status: "A", gates: ["list_patient_adherence"], roles: clinical },
  { id: "patient.measurements", domain: "clinical", tool: "get_patient_context", section: "measurements", mode: "read", status: "A", gates: ["list_patient_measurements"], roles: clinical },
  { id: "patient.medication_timeline", domain: "clinical", tool: "get_patient_context", section: "medication_timeline", mode: "read", status: "A", gates: ["list_patient_medication_timeline"], roles: clinical },
  { id: "patient.case_summary_status", domain: "clinical", tool: "get_patient_context", section: "case_summary_status", mode: "read", status: "C", gates: ["get_alexa_case_summary"], roles: clinical, limits: "State only: the generated text isn't read out." },
  { id: "consultations.query", domain: "consultations", tool: "query_consultations", mode: "read", status: "C", gates: ["query_alexa_records"], roles: clinical },
  { id: "documents.query", domain: "documents", tool: "query_documents", mode: "read", status: "A", gates: ["query_alexa_records"], roles: clinical },
  { id: "agenda.query", domain: "agenda", tool: "query_agenda", mode: "read", status: "A", gates: ["query_alexa_records"], roles: all },
  { id: "reception.board", domain: "agenda", tool: "query_app", view: "reception", mode: "read", status: "C", gates: ["reception_board"], roles: all },
  { id: "finance.query", domain: "finance", tool: "query_finance", mode: "read", status: "A", gates: ["get_finance_overview"], roles: clinical, limits: "Cash only: no invoices." },
  { id: "app.cabinet", domain: "settings", tool: "query_app", view: "cabinet", mode: "read", status: "C", gates: ["get_my_cabinet"], roles: all },
  { id: "app.notifications", domain: "notifications", tool: "query_app", view: "notifications", mode: "read", status: "C", gates: ["get_alexa_office_status"], roles: all, limits: "Counts only." },
  { id: "messages.internal", domain: "messages", tool: "query_app", view: "internal_messages", mode: "read", status: "A", gates: ["list_internal_messages"], roles: all },
  { id: "statistics.overview", domain: "statistics", tool: "query_app", view: "statistics", mode: "read", status: "A", gates: ["get_analysis_overview"], roles: clinical, limits: "Headline figures only, at most 366 days." },
  { id: "treatments.workload", domain: "treatments", tool: "query_app", view: "medication_workload", mode: "read", status: "C", gates: ["list_medication_workload"], roles: clinical, limits: "First 20 patients." },
  { id: "medications.catalog", domain: "treatments", tool: "query_app", view: "medication_catalog", mode: "read", status: "A", gates: ["search_medications"], roles: all },
  { id: "knowledge.search", domain: "knowledge", tool: "search_knowledge", mode: "read", status: "A", gates: ["search_knowledge_lexical", "search_knowledge_vector_v2_768"], roles: all },
  { id: "general.answer", domain: "general", tool: "answer_general", mode: "read", status: "C", gates: [], roles: all, limits: "Non-clinical questions; factual reliability limited by the local model." },
  { id: "actions.prepare", domain: "actions", tool: "prepare_action", mode: "propose", status: "C", gates: ["propose_jarvis_action"], roles: all, limits: "Never executes without confirmation." },
];

/** Features that don't exist here. Alexa says so plainly instead of searching or guessing. */
export const ABSENT_FEATURES: readonly { readonly id: string; readonly pattern: RegExp }[] = [
  { id: "invoices", pattern: /\bfactures?\b|\bfacturation\b/u },
  { id: "refunds", pattern: /\b(?:rembours\w*)\b|\bannul\w*\s+(?:le|un|ce)\s+paiement\b/u },
  { id: "financial_goals", pattern: /\bobjectifs?\s+(?:financiers?|de\s+(?:recettes?|chiffre))\b/u },
  { id: "payment_aging", pattern: /\b(?:anciennete|vieillissement)\s+des\s+impayes\b/u },
];
const NOT_ABOUT_THE_FEATURE = /\bcharges?\b|\bcomment\b|\bqu.est-ce\b|\bdefinition\b/u;
export function absentFeatureRequested(text: string): string | null {
  const plain = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  if (NOT_ABOUT_THE_FEATURE.test(plain)) return null;
  return ABSENT_FEATURES.find(feature => feature.pattern.test(plain))?.id ?? null;
}
