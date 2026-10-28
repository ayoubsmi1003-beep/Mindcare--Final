/**
 * Explicit French Alexa commands may authorize these actions after the server
 * has matched the requested action to the user's authenticated utterance.
 * The existing database confirmation gate still records confirmed_at before
 * execution; this only removes the second UI click.
 */
const ACTIONS_AUTORISEES_PAR_COMMANDE_EXPLICITE = new Set([
  "create_appointment",
  "reschedule_appointment",
  "cancel_appointment",
  "mark_patient_arrived",
  "set_consultation_price",
  "record_payment_collected",
  "close_consultation",
  "create_document_draft",
  "create_editable_document_draft",
  "update_editable_document_draft",
  "update_treatment",
  "pause_treatment",
  "resume_treatment",
  "stop_treatment",
  "create_charge",
  "update_charge",
  "deactivate_charge",
  "send_internal_message",
]);

export function alexaActionsAuthorizedByExplicitCommand(action: string): boolean {
  return ACTIONS_AUTORISEES_PAR_COMMANDE_EXPLICITE.has(action);
}
