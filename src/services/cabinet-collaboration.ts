/**
 * La collaboration interne du cabinet — alerte d'appel, messagerie, compte
 * d'accueil et fil d'événements (migration `178_cabinet_lan_collaboration.sql`).
 *
 * ═══ CE QUE CE FICHIER EST, ET CE QU'IL N'EST PAS ═══════════════════════════
 *
 * C'est la couche de SERVICE : elle ne décide d'aucune autorisation. Ce qui est
 * permis est tranché par la RLS et par les portes `app.*` (règle 4 de
 * CLAUDE.md). Un `if (role === …)` ici serait un bug de conception, pas une
 * précaution : la seule chose qu'on y fait, c'est nommer les gestes et traduire
 * les lignes en types lisibles par l'écran.
 *
 * Trois domaines, volontairement séparés :
 *   · l'ALERTE (`app.assistant_calls`) — un état de remise, une expiration,
 *     un accusé humain. Ce n'est pas un message : un appel « envoyé » ne prouve
 *     jamais qu'un son a été entendu ;
 *   · la MESSAGERIE (`app.internal_messages`) — texte seul, idempotente par
 *     `client_msg_id`, strictement interne au cabinet. Elle n'a rien à voir avec
 *     `communication/*` (canal patient externe : WhatsApp, Facebook, Instagram) ;
 *   · le COMPTE D'ACCUEIL (`app.manage_assistant_account`) — la porte qui
 *     manquait sur une installation `self-hosted`, où `083` supprime le compte
 *     d'appairage et où `084` ne crée que le propriétaire.
 *
 * ═══ AUCUNE DONNÉE PATIENT NE PASSE PAR ICI ═════════════════════════════════
 *
 * Ni nom de patient, ni identifiant de dossier, ni montant. Les seuls
 * identifiants transportés sont ceux d'un appel (`call_id`), d'un message
 * (`client_msg_id`) et d'une entité de domaine (`entity_id`) que l'écran
 * utilise pour rafraîchir une zone déjà autorisée. Le message lui-même est du
 * texte opérationnel saisi par le personnel ; il ne quitte jamais le cabinet et
 * la base en est la seule copie.
 */

import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** États d'un appel. « sent » ne prouve rien ; « acknowledged » engage quelqu'un. */
export type EtatAppel = "sent" | "delivered" | "acknowledged" | "expired";

export interface AppelAccueil {
  readonly callId: string;
  readonly etat: EtatAppel;
  readonly creeLe: string;
  readonly expireLe: string;
  /** Vrai quand la porte a rendu un appel existant au lieu d'en créer un. */
  readonly dedupliquee: boolean;
}

export interface StatutAppel {
  readonly callId: string;
  readonly etat: EtatAppel;
  readonly creeLe: string;
  readonly expireLe: string;
  readonly remisLe: string | null;
  readonly acquitteLe: string | null;
}

export interface AppelActif {
  readonly callId: string;
  readonly callerName: string;
  readonly etat: EtatAppel;
  readonly creeLe: string;
  readonly expireLe: string;
}

export type RoleCabinet = "owner" | "practitioner" | "assistant";

export interface MessageInterne {
  readonly id: string;
  readonly senderId: string;
  readonly senderRole: RoleCabinet;
  readonly senderName: string;
  readonly corps: string;
  readonly creeLe: string;
  readonly remisLe: string | null;
  readonly luLe: string | null;
  /** Vrai pour un message reçu et pas encore lu. Calculé en base. */
  readonly nonLu: boolean;
}

export interface CompteAccueil {
  readonly userId: string;
  readonly identifiant: string;
  readonly nomComplet: string;
  readonly actif: boolean;
}

export type TypeEvenement =
  | "agenda_updated"
  | "payment_updated"
  | "notification_created"
  | "message_updated"
  | "assistant_call";

export interface EvenementCabinet {
  readonly seq: number;
  readonly kind: TypeEvenement;
  readonly targetRole: RoleCabinet | null;
  readonly entityId: string | null;
  readonly occurredAt: string;
}

export interface InstantaneEvenements {
  readonly maxSeq: number;
  readonly events: readonly EvenementCabinet[];
}

// ---------------------------------------------------------------------------
// Lignes brutes rendues par les portes
// ---------------------------------------------------------------------------

interface AppelRow {
  readonly call_id: string;
  readonly etat: EtatAppel;
  readonly cree_le: string;
  readonly expire_le: string;
  readonly dedupliquee: boolean;
}

interface StatutRow {
  readonly call_id: string;
  readonly etat: EtatAppel;
  readonly cree_le: string;
  readonly expire_le: string;
  readonly remis_le: string | null;
  readonly acquitte_le: string | null;
}

interface ActifRow {
  readonly call_id: string;
  readonly caller_name: string;
  readonly etat: EtatAppel;
  readonly cree_le: string;
  readonly expire_le: string;
}

interface MessageRow {
  readonly id: string;
  readonly sender_id: string;
  readonly sender_role: string;
  readonly sender_name: string;
  readonly corps: string;
  readonly cree_le: string;
  readonly remis_le: string | null;
  readonly lu_le: string | null;
  readonly non_lu: boolean | null;
}

interface MessageEnvoyeRow {
  readonly id: string;
  readonly cree_le: string;
  readonly deja_present: boolean;
}

interface CompteRow {
  readonly user_id: string;
  readonly identifiant: string;
  readonly nom_complet: string;
  readonly actif: boolean;
}

interface EvenementsPayload {
  readonly max_seq: number | string;
  readonly events: readonly {
    readonly seq: number | string;
    readonly kind: string;
    readonly target_role: string | null;
    readonly entity_id: string | null;
    readonly occurred_at: string;
  }[];
}

function roleValide(valeur: string): RoleCabinet {
  // Le CHECK de la table et les portes n'admettent que ces trois rôles. Un
  // `patient` ne peut pas atteindre ces portes ; le repli le plus étroit est
  // donc `assistant`, jamais un rôle plus large.
  return valeur === "owner" || valeur === "practitioner" ? valeur : "assistant";
}

function typeValide(valeur: string): TypeEvenement {
  switch (valeur) {
    case "agenda_updated":
    case "payment_updated":
    case "notification_created":
    case "message_updated":
    case "assistant_call":
      return valeur;
    default:
      // Un kind ajouté demain par une migration ne doit pas casser l'écran :
      // il déclenchera un rafraîchissement générique plutôt qu'une exception.
      return "agenda_updated";
  }
}

// ---------------------------------------------------------------------------
// L'alerte « Appeler la secrétaire »
// ---------------------------------------------------------------------------

/**
 * Déclenche l'alerte. `clientCallId` est généré par le poste AVANT l'appel :
 * un double clic ou un rejeu réseau porte le même identifiant et ne produit
 * pas un second appel.
 */
export async function appelerSecretaire(clientCallId: string): Promise<Result<AppelAccueil | null>> {
  const result = await db().rpc<AppelRow>("call_assistant", { p_client_call_id: clientCallId });

  if (!result.ok) {
    log.error("collaboration.appel", logFieldsFor(result.error));
    return err(result.error);
  }

  const row = result.data[0];
  if (row === undefined) {
    // La porte rend toujours une ligne en cas de succès. Une réponse vide
    // signifie un refus silencieux : on ne fabrique pas un succès.
    log.error("collaboration.appel", { code: "vide" });
    return ok(null);
  }

  log.info("collaboration.appel", { count: 1 });
  return ok({
    callId: row.call_id,
    etat: row.etat,
    creeLe: row.cree_le,
    expireLe: row.expire_le,
    dedupliquee: row.dedupliquee,
  });
}

export async function statutAppel(callId: string): Promise<Result<StatutAppel | null>> {
  const result = await db().rpc<StatutRow>("get_assistant_call_status", { p_call_id: callId });

  if (!result.ok) {
    log.error("collaboration.appelStatut", logFieldsFor(result.error));
    return err(result.error);
  }

  const row = result.data[0];
  if (row === undefined) return ok(null);

  return ok({
    callId: row.call_id,
    etat: row.etat,
    creeLe: row.cree_le,
    expireLe: row.expire_le,
    remisLe: row.remis_le,
    acquitteLe: row.acquitte_le,
  });
}

/** Accusé de REMISE — affichage. Ne vaut pas accusé humain. */
export async function marquerAppelRemis(callId: string): Promise<Result<boolean>> {
  const result = await db().rpc<boolean>("mark_assistant_call_delivered", { p_call_id: callId });

  if (!result.ok) {
    log.error("collaboration.appelRemis", logFieldsFor(result.error));
    return err(result.error);
  }

  return ok(result.data[0] === true);
}

/** Accusé HUMAIN — le seul geste qui prouve qu'une personne a vu l'alerte. */
export async function acquitterAppel(callId: string): Promise<Result<boolean>> {
  const result = await db().rpc<boolean>("acknowledge_assistant_call", { p_call_id: callId });

  if (!result.ok) {
    log.error("collaboration.appelAcquitte", logFieldsFor(result.error));
    return err(result.error);
  }

  return ok(result.data[0] === true);
}

/** Appel encore actif, pour retrouver l'alerte après une reconnexion. */
export async function appelActif(): Promise<Result<AppelActif | null>> {
  const result = await db().rpc<ActifRow>("get_active_assistant_call", {});

  if (!result.ok) {
    log.error("collaboration.appelActif", logFieldsFor(result.error));
    return err(result.error);
  }

  const row = result.data[0];
  if (row === undefined) return ok(null);

  return ok({
    callId: row.call_id,
    callerName: row.caller_name,
    etat: row.etat,
    creeLe: row.cree_le,
    expireLe: row.expire_le,
  });
}

// ---------------------------------------------------------------------------
// La messagerie interne
// ---------------------------------------------------------------------------

/**
 * Envoie un message texte. Idempotent : le même `clientMsgId` rejoué après une
 * coupure rend la ligne déjà écrite (`dejaPresent = true`) et ne crée pas de
 * doublon. L'appelant conserve l'identifiant tant que l'envoi n'est pas confirmé.
 */
export async function envoyerMessageInterne(
  clientMsgId: string,
  corps: string,
): Promise<Result<{ readonly id: string; readonly creeLe: string; readonly dejaPresent: boolean } | null>> {
  const result = await db().rpc<MessageEnvoyeRow>("send_internal_message", {
    p_client_msg_id: clientMsgId,
    p_body: corps,
  });

  if (!result.ok) {
    log.error("collaboration.messageEnvoi", logFieldsFor(result.error));
    return err(result.error);
  }

  const row = result.data[0];
  if (row === undefined) return ok(null);

  return ok({ id: row.id, creeLe: row.cree_le, dejaPresent: row.deja_present === true });
}

export async function listerMessagesInternes(limite = 100): Promise<Result<readonly MessageInterne[]>> {
  const result = await db().rpc<MessageRow>("list_internal_messages", { p_limit: limite });

  if (!result.ok) {
    log.error("collaboration.messagesListe", logFieldsFor(result.error));
    return err(result.error);
  }

  return ok(
    result.data.map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      senderRole: roleValide(row.sender_role),
      senderName: row.sender_name,
      corps: row.corps,
      creeLe: row.cree_le,
      remisLe: row.remis_le,
      luLe: row.lu_le,
      nonLu: row.non_lu === true,
    })),
  );
}

/** Marquage « lu » du courrier reçu. Rend le nombre de messages marqués. */
export async function marquerMessagesLus(): Promise<Result<number>> {
  const result = await db().rpc<number>("mark_internal_messages_read", {});

  if (!result.ok) {
    log.error("collaboration.messagesLus", logFieldsFor(result.error));
    return err(result.error);
  }

  return ok(typeof result.data[0] === "number" ? result.data[0] : 0);
}

// ---------------------------------------------------------------------------
// Le fil d'événements (rattrapage du flux SSE)
// ---------------------------------------------------------------------------

/**
 * Rend le maximum courant et les événements visibles par le rôle appelant
 * au-delà de `depuisSeq`. Le client avance ensuite de `maxSeq`.
 *
 * Plafond de 200 par appel, en base : si `maxSeq` dépasse le dernier événement
 * reçu, il reste des événements à lire et l'appelant doit redemander — le flux
 * SSE le fait à la connexion.
 */
export async function lireEvenementsDepuis(depuisSeq: number): Promise<Result<InstantaneEvenements | null>> {
  const result = await db().rpc<EvenementsPayload>("list_cabinet_events_since", {
    p_since_seq: Number.isFinite(depuisSeq) && depuisSeq > 0 ? Math.floor(depuisSeq) : 0,
  });

  if (!result.ok) {
    log.error("collaboration.evenements", logFieldsFor(result.error));
    return err(result.error);
  }

  const payload = result.data[0];
  if (payload === undefined) return ok(null);

  const maxSeq = typeof payload.max_seq === "string" ? Number.parseInt(payload.max_seq, 10) : payload.max_seq;
  const events = (payload.events ?? []).map((e) => ({
    seq: typeof e.seq === "string" ? Number.parseInt(e.seq, 10) : e.seq,
    kind: typeValide(e.kind),
    targetRole: e.target_role === null ? null : roleValide(e.target_role),
    entityId: e.entity_id,
    occurredAt: e.occurred_at,
  }));

  return ok({ maxSeq: Number.isFinite(maxSeq) ? maxSeq : 0, events });
}

// ---------------------------------------------------------------------------
// Le compte d'accueil
// ---------------------------------------------------------------------------

export async function etatCompteAccueil(): Promise<Result<CompteAccueil | null>> {
  const result = await db().rpc<CompteRow>("get_assistant_account_status", {});

  if (!result.ok) {
    log.error("collaboration.compteEtat", logFieldsFor(result.error));
    return err(result.error);
  }

  const row = result.data[0];
  if (row === undefined) return ok(null);

  return ok({
    userId: row.user_id,
    identifiant: row.identifiant,
    nomComplet: row.nom_complet,
    actif: row.actif,
  });
}

/**
 * Crée, met à jour, réinitialise ou désactive le compte d'accueil. La porte
 * refuse tout appelant qui n'est pas `owner` — le contrôle est en base, pas ici.
 *
 * `motDePasse` omis = mot de passe inchangé (réutilisation du hachage existant).
 * `actif = false` supprime aussi les sessions ouvertes de ce compte.
 */
export async function gererCompteAccueil(entree: {
  readonly nomComplet: string;
  readonly identifiant: string;
  readonly motDePasse?: string | undefined;
  readonly actif: boolean;
}): Promise<Result<CompteAccueil | null>> {
  const result = await db().rpc<CompteRow>("manage_assistant_account", {
    p_full_name: entree.nomComplet,
    p_login: entree.identifiant,
    p_password: entree.motDePasse ?? null,
    p_is_active: entree.actif,
  });

  if (!result.ok) {
    log.error("collaboration.compteGestion", logFieldsFor(result.error));
    return err(result.error);
  }

  const row = result.data[0];
  if (row === undefined) return ok(null);

  log.info("collaboration.compteGestion", { count: 1 });
  return ok({
    userId: row.user_id,
    identifiant: row.identifiant,
    nomComplet: row.nom_complet,
    actif: row.actif,
  });
}
