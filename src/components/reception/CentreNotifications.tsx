/**
 * CentreNotifications — la file des signaux opérationnels du cabinet.
 *
 * CE QUI A CHANGÉ, ET POURQUOI.
 * La version précédente affichait six lignes puis « + 44 plus anciennes » sans
 * aucun moyen de les ouvrir. Sur la base réelle, elle montrait aussi le même
 * reçu plusieurs fois : une correction de tarif écrit une notification de plus
 * (029), et l'écran ne montrait ni le montant ni la différence entre deux
 * lignes. Ici :
 *   · une seule ligne par reçu — la plus récente, avec son montant ;
 *   · la liste défile, donc rien n'est annoncé puis rendu inatteignable ;
 *   · le compteur est le nombre de signaux NON LUS de cette liste, pas le
 *     nombre de lignes stockées ;
 *   · « Encaisser » ouvre directement le paiement concerné.
 *
 * ⚠️ La déduplication visuelle ne remplace pas la correction de la source :
 * la table continue de porter une ligne par correction de tarif. Le contrat
 * affiché reste juste parce qu'un reçu = un état de caisse. La correction de
 * la porte est un lot séparé, avec sa migration.
 */
"use client";

import { fr } from "@/i18n/fr";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icones";
import { formaterDzd } from "@/services/finance";
import { KIND_PAYMENT_DUE, type NotificationItem } from "@/services/notifications";
import type { PaiementAccueil } from "@/services/reception";

interface Props {
  readonly notifications: readonly NotificationItem[];
  readonly paiementsDus: readonly PaiementAccueil[];
  readonly onMarquerLu: (id: string) => void;
  readonly onFocusEncaissement: (p: PaiementAccueil) => void;
}

function recuDe(notification: NotificationItem): string | null {
  const brut = notification.payload["receipt_number"];
  return typeof brut === "string" ? brut : null;
}

function montantDe(notification: NotificationItem): number | null {
  const brut = notification.payload["amount_dzd"];
  if (typeof brut === "number" && Number.isFinite(brut)) return brut;
  if (typeof brut === "string" && brut.trim() !== "") {
    const valeur = Number(brut);
    if (Number.isFinite(valeur)) return valeur;
  }
  return null;
}

/**
 * L'heure seule ne dit pas QUAND. Les notifications de caisse s'étalent sur
 * plusieurs jours : « 22:10 » puis « 00:48 » se lit comme un ordre inversé
 * alors que ce sont deux jours différents. On nomme donc le jour dès qu'il
 * n'est pas aujourd'hui.
 */
function quand(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  const heure = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  const aujourdhui = new Date();
  if (date.toDateString() === aujourdhui.toDateString()) return heure;

  const hier = new Date(aujourdhui);
  hier.setDate(aujourdhui.getDate() - 1);
  if (date.toDateString() === hier.toDateString()) {
    return `${fr.reception.notifications.hier} ${heure}`;
  }

  return `${new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" }).format(date)} ${heure}`;
}

export function CentreNotifications({
  notifications,
  paiementsDus,
  onMarquerLu,
  onFocusEncaissement,
}: Props): React.JSX.Element {
  // La porte `listNotifications` rend déjà un état par reçu — voir
  // `etatParRecu` dans `services/notifications.ts`. Aucune déduplication ici :
  // deux endroits qui décident de la même chose finissent par diverger.
  const lignes = notifications;
  const nonLues = lignes.filter((n) => n.readAt === null).length;

  if (lignes.length === 0) {
    return (
      <section aria-label={fr.reception.notifications.titre} className="flex flex-col gap-2">
        <h3 className="font-ui text-heading font-semibold text-ink-900">
          {fr.reception.notifications.titre}
        </h3>
        <p className="rounded-md border border-rule bg-sunken px-3 py-2 font-ui text-body text-ink-500">
          {fr.reception.notifications.vide}
        </p>
      </section>
    );
  }

  return (
    <section aria-label={fr.reception.notifications.titre} className="flex min-h-0 flex-col gap-2">
      <h3 className="flex items-center gap-2 font-ui text-heading font-semibold text-ink-900">
        {fr.reception.notifications.titre}
        {nonLues > 0 ? (
          <span className="rounded-full bg-attention-bg px-2 py-0.5 font-num text-label font-semibold tabular-nums text-attention-ink">
            {nonLues}
          </span>
        ) : null}
        <span className="font-ui text-label font-regular text-ink-500">
          · {fr.reception.notifications.recentes}
        </span>
      </h3>

      <ul className="m-0 flex max-h-liste list-none flex-col gap-1 overflow-y-auto p-0 pe-1">
        {lignes.map((notification) => {
          const lue = notification.readAt !== null;
          const recu = recuDe(notification);
          const montant = montantDe(notification);
          const paiement =
            notification.kind === KIND_PAYMENT_DUE && recu !== null
              ? paiementsDus.find((p) => p.receiptNumber === recu)
              : undefined;

          const contenu = (
            <>
              <span
                aria-hidden="true"
                className={[
                  "h-2 w-2 shrink-0 rounded-full",
                  lue ? "bg-transparent" : "border border-attention bg-attention",
                ].join(" ")}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span
                    className={[
                      "truncate font-ui text-body font-medium",
                      lue ? "text-ink-500" : "text-ink-900",
                    ].join(" ")}
                  >
                    {notification.kind === KIND_PAYMENT_DUE
                      ? fr.reception.notifications.paiementDueCourt
                      : notification.kind}
                  </span>
                  {montant !== null ? (
                    <span className="ms-auto shrink-0 font-num text-label font-semibold tabular-nums text-ink-700">
                      {formaterDzd(montant)}
                    </span>
                  ) : null}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 font-num text-label tabular-nums text-ink-500">
                  {recu !== null ? (
                    <span className="truncate" title={recu}>
                      {fr.reception.paiements.recu} {recu.slice(-5)}
                    </span>
                  ) : null}
                  <span className="ms-auto shrink-0">{quand(notification.createdAt)}</span>
                </span>
              </span>
            </>
          );

          return (
            <li key={notification.id}>
              <div
                className={[
                  "flex min-h-target items-center gap-1 rounded-lg border ps-2.5 pe-1",
                  lue ? "border-rule bg-sunken" : "border-attention bg-attention-bg",
                ].join(" ")}
              >
                {paiement !== undefined ? (
                  <button
                    type="button"
                    onClick={() => onFocusEncaissement(paiement)}
                    aria-label={`${fr.reception.paiements.encaisserCourt} — ${recu ?? ""}`}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 text-left outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset-2"
                  >
                    {contenu}
                  </button>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-2 py-1.5">{contenu}</div>
                )}
                {!lue ? (
                  <Bouton
                    rang="discret"
                    taille="icone"
                    etiquette={`${fr.reception.notifications.marquerLu} — ${recu ?? notification.kind}`}
                    onClick={() => onMarquerLu(notification.id)}
                  >
                    <Icone nom="valide" taille={16} />
                  </Bouton>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
