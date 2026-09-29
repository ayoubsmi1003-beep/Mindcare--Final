/**
 * Service Communication — orchestration locale (AUCUN appel réseau ici).
 *
 * Le chemin d'envoi : politique (`deciderEnvoi`) → consentement (porte) →
 * idempotence (`comm_register_delivery`) → transition d'état (porte).
 * L'appel externe réel vit en Phase 4 (`src/server/communication/`), derrière
 * l'egress unique — ce service prépare, il n'envoie jamais.
 */

import { db } from "../db";
import { logFieldsFor } from "../errors";
import { log } from "../log";
import { err, ok, type Result } from "../result";

import { lireConsentement } from "./consentement";
import { cleIdempotence } from "./idempotence";
import { deciderEnvoi, transitionLocale } from "./politique";
import type { Canal, EtatMessage, ItemMessage, ResumeConversation } from "./types";

interface ResumeRow {
  readonly id: string;
  readonly canal: Canal;
  readonly etatHandoff: EtatHandoff;
  readonly patientId: string | null;
  readonly dernierMessageA: string;
  readonly clotureA: string | null;
}

import type { EtatHandoff } from "./types";

interface MessageRow {
  readonly id: string;
  readonly direction: "entrant" | "sortant";
  readonly etat: EtatMessage;
  readonly contenu: string;
  readonly langue: string | null;
  readonly creeA: string;
}

function versResume(row: ResumeRow): ResumeConversation {
  return {
    id: row.id,
    canal: row.canal,
    etatHandoff: row.etatHandoff,
    patientId: row.patientId,
    dernierMessageA: row.dernierMessageA,
    clotureA: row.clotureA,
  };
}

function versItem(row: MessageRow): ItemMessage {
  return {
    id: row.id,
    direction: row.direction,
    etat: row.etat,
    contenu: row.contenu,
    langue: row.langue,
    creeA: row.creeA,
  };
}

export async function listerConversations(
  limite = 50,
): Promise<Result<readonly ResumeConversation[]>> {
  const result = await db().rpc<ResumeRow>("comm_list_conversations", { p_limit: limite });
  if (!result.ok) {
    log.error("communication.liste", logFieldsFor(result.error));
    return err(result.error);
  }
  return ok(result.data.map(versResume));
}

export async function listerMessages(
  conversationId: string,
  limite = 100,
): Promise<Result<readonly ItemMessage[]>> {
  const result = await db().rpc<MessageRow>("comm_list_messages", {
    p_conversation_id: conversationId,
    p_limit: limite,
  });
  if (!result.ok) {
    log.error("communication.messages", logFieldsFor(result.error));
    return err(result.error);
  }
  return ok(result.data.map(versItem));
}

export async function ouvrirConversation(
  canal: Canal,
  patientId: string | null,
  identifiantExterne: string | null,
): Promise<Result<string>> {
  const result = await db().rpc<string>("comm_create_conversation", {
    p_canal: canal,
    p_patient_id: patientId,
    p_identifiant_externe: identifiantExterne,
  });
  if (!result.ok) {
    log.error("communication.ouverture", logFieldsFor(result.error));
    return err(result.error);
  }
  const id = result.data[0];
  if (id === undefined) return err({ code: "interdit", message: "Conversation impossible." });
  log.info("communication.ouverture", { count: 1 });
  return ok(id);
}

/**
 * Prépare un message sortant : écrit `draft`, applique la politique, puis
 * avance vers `approval_required` (cas général), `queued` (hors-ligne) ou
 * `blocked` (consentement/signal). Rend l'identifiant du message et l'état
 * atteint — l'appelant (Phase 4) n'envoie que depuis `approved`.
 *
 * `signalPatient` vient du pré-filtre `messagePorteUnSignalPatient` : un
 * `true` bloque ici, et l'egress bloquera de toute façon à l'envoi.
 */
export async function preparerEnvoi(
  conversationId: string,
  contenu: string,
  options: {
    readonly patientId: string | null;
    readonly canal: Canal;
    readonly signalPatient: boolean;
    readonly connecte: boolean;
    readonly horsLigne: boolean;
    readonly clientMsgId: string;
  },
): Promise<Result<{ messageId: string; etat: EtatMessage }>> {
  // 1 · Écrire le brouillon (porte idempotente : rejeu → false).
  const ecrit = await db().rpc<string>("comm_append_message", {
    p_conversation_id: conversationId,
    p_client_msg_id: options.clientMsgId,
    p_direction: "sortant",
    p_contenu: contenu,
  });
  if (!ecrit.ok) {
    log.error("communication.brouillon", logFieldsFor(ecrit.error));
    return err(ecrit.error);
  }

  // Retrouver le message (rejeu : la ligne existe déjà).
  const existants = await listerMessages(conversationId, 500);
  if (!existants.ok) return err(existants.error);
  const courant = existants.data.find(
    (m) => m.direction === "sortant" && m.contenu === contenu.trim().slice(0, 4000),
  );
  if (courant === undefined) return err({ code: "introuvable", message: "Message introuvable." });

  // 2 · Politique. Consentement requis dès qu'un patient est lié.
  let consentement = true;
  if (options.patientId !== null) {
    const lu = await lireConsentement(options.patientId, options.canal);
    if (!lu.ok) return err(lu.error);
    consentement = lu.data;
  }
  const decision = deciderEnvoi({
    consentement,
    signalPatient: options.signalPatient,
    connecte: options.connecte,
    horsLigne: options.horsLigne,
  });

  // 3 · Avancer. `draft` → cible (la porte refuse les sauts, miroir testé).
  const cible: EtatMessage =
    decision.decision === "autoriser"
      ? "approval_required"
      : decision.decision === "file"
        ? "queued"
        : "blocked";
  if (!transitionLocale("draft", cible)) {
    return err({ code: "regle-metier", message: "Transition de message interdite." });
  }
  const avance = await db().rpc<boolean>("comm_transition_message", {
    p_message_id: courant.id,
    p_vers: cible,
  });
  if (!avance.ok) {
    log.error("communication.politique", logFieldsFor(avance.error));
    return err(avance.error);
  }

  // 4 · Idempotence : enregistrer la clé d'envoi dès la préparation pour que
  // le retry (Phase 4) ne duplique jamais, même après un timeout Meta.
  const cle = cleIdempotence(conversationId, `${options.clientMsgId}:${contenu.length}`);
  const dedup = await db().rpc<boolean>("comm_register_delivery", {
    p_message_id: courant.id,
    p_cle: cle,
  });
  if (!dedup.ok) {
    log.error("communication.idempotence", logFieldsFor(dedup.error));
    return err(dedup.error);
  }

  log.info("communication.preparation", { count: 1 });
  return ok({ messageId: courant.id, etat: cible });
}
