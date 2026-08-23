/**
 * Le centre de notifications — signaux opérationnels du cabinet, non cliniques
 * par construction (le payload de la table ne porte aucune donnée patient :
 * reçu + montant, 029).
 *
 * DÉDUPLICATION : les alertes dérivées (retards, attente) vivent dans la zone
 * d'attention, PAS ici. Cette liste n'affiche que ce qui a été écrit en base,
 * plus récentes d'abord, lues estompées. Aucune suppression en v1 — le cycle
 * est non lu → lu (`mark_notification_read`, porte 046).
 *
 * Une notification `payment_due` est ACTIONNABLE : elle ouvre le tiroir
 * d'encaissement sur le paiement correspondant (rapprochement par numéro de
 * reçu — le seul lien que le payload porte volontairement).
 */

"use client";

import { fr } from "@/i18n/fr";

import { Bouton } from "@/components/ui/Bouton";
import { heure } from "@/components/AgendaPieces";
import {
  KIND_PAYMENT_DUE,
  type NotificationItem,
} from "@/services/notifications";
import type { PaiementAccueil } from "@/services/reception";

interface CentreNotificationsProps {
  readonly notifications: readonly NotificationItem[];
  readonly paiementsDus: readonly PaiementAccueil[];
  readonly onMarquerLu: (id: string) => void;
  readonly onOuvrirEncaissement: (paiement: PaiementAccueil) => void;
}

export function CentreNotifications({
  notifications,
  paiementsDus,
  onMarquerLu,
  onOuvrirEncaissement,
}: CentreNotificationsProps): React.JSX.Element | null {
  if (notifications.length === 0) return null;

  return (
    <section aria-label={fr.reception.notifications.titre} className="flex flex-col gap-2">
      <h3 className="font-ui text-heading font-semibold text-ink-900">
        {fr.reception.notifications.titre}
      </h3>

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {notifications.map((notification) => (
          <NotificationLigne
            key={notification.id}
            notification={notification}
            paiementsDus={paiementsDus}
            onMarquerLu={onMarquerLu}
            onOuvrirEncaissement={onOuvrirEncaissement}
          />
        ))}
      </ul>
    </section>
  );
}

function NotificationLigne({
  notification,
  paiementsDus,
  onMarquerLu,
  onOuvrirEncaissement,
}: {
  readonly notification: NotificationItem;
  readonly paiementsDus: readonly PaiementAccueil[];
  readonly onMarquerLu: (id: string) => void;
  readonly onOuvrirEncaissement: (paiement: PaiementAccueil) => void;
}): React.JSX.Element {
  const lue = notification.readAt !== null;
  const brutRecu = notification.payload["receipt_number"];
  const recu = typeof brutRecu === "string" ? brutRecu : null;

  const paiementCorrespondant =
    notification.kind === KIND_PAYMENT_DUE && recu !== null
      ? paiementsDus.find((p) => p.receiptNumber === recu)
      : undefined;

  return (
    <li>
      <div
        className={[
          "flex min-h-target items-center gap-3 rounded-md border px-3 py-2",
          lue ? "border-rule bg-sunken opacity-disabled" : "border-attention bg-attention-bg",
        ].join(" ")}
      >
        {/* Une forme, pas seulement une couleur (§4 règle 4). */}
        <span
          aria-hidden="true"
          className={[
            "inline-block h-2 w-2 shrink-0 rounded-full",
            lue ? "bg-transparent" : "border border-attention bg-attention",
          ].join(" ")}
        />

        <div className="min-w-0 flex-auto">
          <p className="truncate font-ui text-body font-medium text-ink-900">
            {notification.kind === KIND_PAYMENT_DUE
              ? fr.reception.notifications.paiementDue
              : notification.kind}
          </p>
          {recu !== null ? (
            <p className="truncate font-num text-label tabular-nums text-ink-500">
              {fr.reception.paiements.recu} {recu}
            </p>
          ) : null}
        </div>

        <span className="shrink-0 font-num text-label tabular-nums text-ink-500">
          {heure(notification.createdAt) ?? fr.etats.texteAbsent}
        </span>

        {!lue && paiementCorrespondant !== undefined ? (
          <Bouton rang="secondaire" onClick={() => onOuvrirEncaissement(paiementCorrespondant)}>
            {fr.reception.paiements.encaisser}
          </Bouton>
        ) : null}

        {!lue ? (
          <Bouton rang="discret" onClick={() => onMarquerLu(notification.id)}>
            {fr.reception.notifications.marquerLu}
          </Bouton>
        ) : null}
      </div>
    </li>
  );
}
