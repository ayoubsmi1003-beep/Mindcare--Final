/**
 * CentreNotifications — 1 CTA max par notif. payment_due avec paiement → Voir encaissement (focus colonne droite),
 * sinon → Marquer lu / info.
 */
"use client";

import { fr } from "@/i18n/fr";
import { Bouton } from "@/components/ui/Bouton";
import { heure } from "@/components/AgendaPieces";
import { KIND_PAYMENT_DUE, type NotificationItem } from "@/services/notifications";
import type { PaiementAccueil } from "@/services/reception";

interface Props {
  readonly notifications: readonly NotificationItem[];
  readonly paiementsDus: readonly PaiementAccueil[];
  readonly onMarquerLu: (id: string) => void;
  readonly onFocusEncaissement: (p: PaiementAccueil) => void;
}

export function CentreNotifications({ notifications, paiementsDus, onMarquerLu, onFocusEncaissement }: Props): React.JSX.Element | null {
  if (notifications.length === 0) {
    return (
      <section aria-label={fr.reception.notifications.titre} className="flex flex-col gap-2">
        <h3 className="font-ui text-heading font-semibold text-ink-900">{fr.reception.notifications.titre}</h3>
        <p className="rounded-md border border-rule bg-sunken px-3 py-2 font-ui text-body text-ink-500">{fr.reception.notifications.vide}</p>
      </section>
    );
  }

  const visibles = notifications.slice(0, 6);
  const restants = notifications.length - 6;

  return (
    <section aria-label={fr.reception.notifications.titre} className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 font-ui text-heading font-semibold text-ink-900">
        {fr.reception.notifications.titre}
        <span className="rounded-full bg-sunken px-2 py-0.5 font-num text-label tabular-nums text-ink-500">{notifications.length}</span>
      </h3>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {visibles.map((n) => (
          <NotificationLigne key={n.id} notification={n} paiementsDus={paiementsDus} onMarquerLu={onMarquerLu} onFocusEncaissement={onFocusEncaissement} />
        ))}
      </ul>
      {restants > 0 ? <p className="px-1 font-ui text-label text-ink-500">+ {restants} plus anciennes</p> : null}
    </section>
  );
}

function NotificationLigne({
  notification,
  paiementsDus,
  onMarquerLu,
  onFocusEncaissement,
}: {
  readonly notification: NotificationItem;
  readonly paiementsDus: readonly PaiementAccueil[];
  readonly onMarquerLu: (id: string) => void;
  readonly onFocusEncaissement: (p: PaiementAccueil) => void;
}): React.JSX.Element {
  const lue = notification.readAt !== null;
  const brutRecu = notification.payload["receipt_number"];
  const recu = typeof brutRecu === "string" ? brutRecu : null;
  const paiement = notification.kind === KIND_PAYMENT_DUE && recu ? paiementsDus.find((p) => p.receiptNumber === recu) : undefined;

  return (
    <li>
      <div className={["flex min-h-target items-center gap-2 rounded-md border px-2 py-1.5", lue ? "border-rule bg-sunken opacity-disabled" : "border-attention bg-attention-bg"].join(" ")}>
        <span aria-hidden="true" className={["h-2 w-2 shrink-0 rounded-full", lue ? "bg-transparent" : "border border-attention bg-attention"].join(" ")} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-ui text-body font-medium text-ink-900">
            {notification.kind === KIND_PAYMENT_DUE ? fr.reception.notifications.paiementDue : notification.kind}
          </p>
          {recu ? <p className="truncate font-num text-label tabular-nums text-ink-500">{fr.reception.paiements.recu} {recu}</p> : null}
        </div>
        <span className="shrink-0 font-num text-label tabular-nums text-ink-500">{heure(notification.createdAt) ?? "--:--"}</span>
        {!lue && paiement ? (
          <Bouton rang="discret" onClick={() => onFocusEncaissement(paiement)}>
            {fr.reception.attention.voirEncaissement}
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
