/**
 * ⚠️ FICHIER ENGENDRÉ — NE PAS MODIFIER À LA MAIN.
 *
 * Produit par `scripts/gen-db-allowlist.mjs` à partir des appels réels de
 * `src/services/**`. `preflight.sh` (contrôle 13) le régénère et échoue sur
 * toute différence : une modification manuelle sera écrasée et signalée.
 *
 * Pour ajouter une fonction ou une colonne : écrire l'appel dans le service,
 * puis relancer `node scripts/gen-db-allowlist.mjs`.
 *
 * Ce n'est PAS ce qui porte la sécurité — voir l'en-tête du générateur. La RLS
 * décide ; cette liste borne la surface et la rend énumérable en revue.
 */

export const RPC_AUTORISES: ReadonlySet<string> = new Set([
  "amend_note",
  "cancel_appointment",
  "check_slot_available",
  "close_consultation",
  "confirm_appointment",
  "confirm_jarvis_action",
  "create_appointment",
  "create_charge",
  "create_patient",
  "dashboard_today",
  "day_revenue",
  "delete_charge",
  "document_readiness",
  "execute_jarvis_action",
  "find_similar_patients",
  "flag_case_summary",
  "get_appointment",
  "get_charges_list",
  "get_consultation",
  "get_consultation_analysis",
  "get_consultation_payment",
  "get_document",
  "get_finance_overview",
  "get_jarvis_history",
  "get_my_cabinet",
  "get_my_profile",
  "get_open_consultation",
  "get_patient",
  "get_patient_workspace",
  "get_sessions_payments_list",
  "issue_document",
  "list_agenda",
  "list_amendments",
  "list_day_payments",
  "list_documents",
  "list_patient_documents",
  "list_patient_timeline",
  "mark_appointment_arrived",
  "mark_appointment_no_show",
  "mark_document_printed",
  "mark_notification_read",
  "nombre_en_lettres",
  "propose_jarvis_action",
  "reception_board",
  "record_payment_collected",
  "reject_jarvis_action",
  "save_note",
  "save_raw_notes",
  "search_patients",
  "set_consultation_price",
  "sign_note",
  "start_consultation",
  "start_jarvis_conversation",
  "update_appointment",
  "update_cabinet",
  "update_charge",
  "update_patient",
  "update_profile",
  "verify_document_hash",
  "void_document",
]);

export const RELATIONS_AUTORISEES: Readonly<Record<string, readonly string[]>> = {
  "deployment": ["environment"],
  "notifications": ["created_at", "id", "kind", "payload", "read_at"],
  "profiles": ["cabinet_id", "full_name", "id", "role"],
};

/** Nombre d'entrées, pour que le contrôle de démarrage puisse le journaliser. */
export const NB_RPC = 60;
