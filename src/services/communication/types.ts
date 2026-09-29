/**
 * Communication — types canoniques (miroir des tables 112/113, jamais de PII
 * dans les journaux : ces types ne portent que des états et des décisions).
 */

export type Canal = "whatsapp" | "instagram" | "facebook";

export type EtatMessage =
  | "received"
  | "classified"
  | "awaiting_action"
  | "draft"
  | "approval_required"
  | "approved"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "blocked"
  | "expired"
  | "rejected";

export type EtatHandoff = "AI_HANDLING" | "HUMAN_REQUIRED" | "HUMAN_HANDLING" | "RESOLVED";

export type DecisionEnvoi =
  | { readonly decision: "autoriser" }
  | { readonly decision: "bloquer"; readonly motif: "consentement" | "signal_patient" | "etat" }
  | { readonly decision: "file"; readonly etatCible: "queued" };

export interface EntreeDecision {
  readonly consentement: boolean;
  readonly signalPatient: boolean;
  readonly connecte: boolean;
  readonly horsLigne: boolean;
}

export interface ResumeConversation {
  readonly id: string;
  readonly canal: Canal;
  readonly etatHandoff: EtatHandoff;
  readonly patientId: string | null;
  readonly dernierMessageA: string;
  readonly clotureA: string | null;
}

export interface ItemMessage {
  readonly id: string;
  readonly direction: "entrant" | "sortant";
  readonly etat: EtatMessage;
  readonly contenu: string;
  readonly langue: string | null;
  readonly creeA: string;
}
