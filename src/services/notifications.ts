/**
 * Notifications INTERNES du cabinet — table `app.notifications` (011).
 *
 * ⚠️ CE QUE CE FICHIER N'EST PAS. Ce n'est ni une messagerie, ni un canal
 * sortant : `send_message_to_patient` n'existe pas et n'entrera pas
 * (`src/services/ports.ts`). La table porte des signaux opérationnels dont le
 * payload ne contient JAMAIS de donnée clinique ni identifiante — la porte
 * `set_consultation_price` (029) n'y écrit que `receipt_number` et
 * `amount_dzd`, car l'écran qui l'affiche peut être vu du patient suivant.
 *
 * LA LECTURE EST UN `select` DIRECT, ET C'EST LÉGITIME ICI. Contrairement aux
 * patients (ADR-019) ou à l'agenda nominatif (ADR-021), ces lignes ne nomment
 * personne : aucune trace de lecture n'est requise, et `notifications_mine`
 * (011) limite déjà les lignes au cabinet et au rôle appelant. Le traitement
 * est celui de `authz.ts` sur `profiles` : colonnes fermées, jamais `"*"`.
 *
 * Aucune décision d'autorisation ici : ce qui est visible est décidé par la
 * policy, pas par ce fichier.
 */

import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

/**
 * Les kinds écrits en base aujourd'hui. Union OUVERTE côté affichage (un kind
 * inconnu s'affiche comme signal générique plutôt que de planter l'écran),
 * fermée côté logique métier : seul `payment_due` a une action dédiée en v1.
 */
export const KIND_PAYMENT_DUE = "payment_due" as const;

export interface NotificationItem {
  readonly id: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly readAt: string | null;
  readonly createdAt: string;
}

interface NotificationRow {
  readonly id: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly read_at: string | null;
  readonly created_at: string;
}

/** Colonnes fermées — SelectSpec refuse `"*"` pour ne jamais transporter un champ ajouté demain (I12). */
const COLONNES_NOTIFICATIONS = [
  "id",
  "kind",
  "payload",
  "read_at",
  "created_at",
] as const;

/** Fenêtre d'affichage : les plus récentes suffisent, la table est bornée par l'usage. */
const PLAFOND_LISTE = 50;

function versItem(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    kind: row.kind,
    // La colonne `payload` est NOT NULL (011) ; la forme est portée par le
    // type du row — aucune assertion, aucune recomposition.
    payload: row.payload ?? {},
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export async function listNotifications(): Promise<Result<readonly NotificationItem[]>> {
  const result = await db().select<NotificationRow>({
    relation: "notifications",
    columns: COLONNES_NOTIFICATIONS,
    order: [{ column: "created_at", ascending: false }],
    limit: PLAFOND_LISTE,
  });

  if (!result.ok) {
    // Un échec ici ne bloque jamais le reste du cockpit (I20) : c'est un
    // complément, pas la raison d'être de l'écran.
    log.error("accueil.notifications.liste", logFieldsFor(result.error));
    return err(result.error);
  }

  log.info("accueil.notifications.liste", { count: result.data.length });
  return ok(result.data.map(versItem));
}

/**
 * Pose `read_at` sur UNE notification. Rejouée, elle rend `true` sans
 * réécrire l'horodatage ; introuvable ou hors périmètre → `false` (la policy
 * `notifications_mine` a déjà filtré).
 */
export async function markNotificationRead(id: string): Promise<Result<boolean>> {
  const result = await db().rpc<string>("mark_notification_read", { p_id: id });

  if (!result.ok) {
    log.error("accueil.notifications.lu", logFieldsFor(result.error));
    return err(result.error);
  }

  const touche = result.data[0] !== undefined && result.data[0] !== null;
  if (touche) log.info("accueil.notifications.lu", { count: 1 });
  return ok(touche);
}
