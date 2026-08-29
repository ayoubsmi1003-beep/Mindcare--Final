/**
 * AgendaCompact — liste dense, alternative à FriseJour quand 1 praticienne.
 * Rangées 48px : heure | patient | statut | arrivée | paiement | chevron.
 * Même source (RdvAccueil[]) que FriseJour, choix fait par le parent.
 */
"use client";

import { fr } from "@/i18n/fr";
import { heure, plage, Statut } from "@/components/AgendaPieces";
import type { RdvAccueil, PaiementAccueil } from "@/services/reception";
import { formaterDzd } from "@/services/finance";

interface Props {
  readonly journee: readonly RdvAccueil[];
  readonly maintenant: Date;
  readonly estAujourdhui: boolean;
  readonly selectionId: string | null;
  readonly onSelectRdv: (id: string) => void;
  readonly paiementPour: (rdv: RdvAccueil) => PaiementAccueil | undefined;
}

function minutesDepuis(iso: string | null, maintenant: Date): number {
  if (iso === null) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((maintenant.getTime() - t) / 60000));
}

export function AgendaCompact({ journee, maintenant, estAujourdhui, selectionId, onSelectRdv, paiementPour }: Props): React.JSX.Element {
  const triee = [...journee].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const minutesMaintenant = maintenant.getHours() * 60 + maintenant.getMinutes();

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex-1 overflow-y-auto">
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {triee.map((rdv) => {
            const selectionne = selectionId === rdv.id;
            const paiement = paiementPour(rdv);
            const attente = rdv.arrivedAt ? minutesDepuis(rdv.arrivedAt, maintenant) : null;
            const debutMin = (() => {
              const t = Date.parse(rdv.startsAt);
              if (Number.isNaN(t)) return null;
              const d = new Date(t);
              return d.getHours() * 60 + d.getMinutes();
            })();
            const estMaintenant =
              estAujourdhui &&
              debutMin !== null &&
              Math.abs(minutesMaintenant - debutMin) < 15 &&
              (rdv.status === "confirmed" || rdv.status === "arrived");
            const nom = [rdv.lastName, rdv.firstName].filter(Boolean).join(" ") || fr.agenda.patientNonRattache;

            return (
              <li key={rdv.id} className="relative">
                {estMaintenant ? (
                  <div className="absolute inset-x-0 top-0 h-px bg-attention" aria-hidden="true" />
                ) : null}
                <button
                  type="button"
                  onClick={() => onSelectRdv(rdv.id)}
                  aria-pressed={selectionne}
                  className={[
                    "flex w-full min-h-target items-center gap-2 rounded-md border px-3 py-2 text-left outline-none transition duration-instant",
                    "focus-visible:outline focus-visible:outline-action-600",
                    selectionne ? "border-brand-600 bg-brand-100 shadow-lift1" : "border-rule bg-card hover:border-ink-300 hover:shadow-lift1",
                  ].join(" ")}
                >
                  <span className="shrink-0 font-num text-label font-medium tabular-nums text-ink-700">
                    {heure(rdv.startsAt) ?? "--:--"}
                  </span>
                  <span className="hidden shrink-0 font-num text-label tabular-nums text-ink-500 desktop:inline">
                    {plage(rdv.startsAt, rdv.endsAt) ?? ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-ui text-body font-medium text-ink-900">{nom}</span>
                  <span className="shrink-0">
                    <Statut statut={rdv.status} />
                  </span>
                  {attente !== null && rdv.status === "arrived" ? (
                    <span className="hidden shrink-0 font-num text-label tabular-nums text-attention-ink desktop:inline">
                      {attente} min
                    </span>
                  ) : null}
                  {paiement ? (
                    <span className="hidden shrink-0 rounded-full bg-attention-bg px-2 py-1 font-num text-label tabular-nums text-attention-ink desktop:inline">
                      {formaterDzd(paiement.amountDzd)}
                    </span>
                  ) : null}
                  <span className="shrink-0 font-ui text-label text-ink-500">›</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
