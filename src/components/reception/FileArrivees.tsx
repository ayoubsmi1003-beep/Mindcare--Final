/**
 * La file des arrivées — la salle d'attente, par attente DÉCROISSANTE.
 *
 * L'arrivée elle-même se pose depuis la frise ou la zone d'attention ; cette
 * file montre qui attend DEPUIS COMBIEN, avec l'action d'accueil restante :
 * « Non présenté(e) » (transition `arrived → no_show`, porte 046). Passer le
 * patient en séance est le geste de la praticienne (`start_consultation`),
 * jamais celui de l'assistante — aucun bouton ne l'y invite.
 */

"use client";

import { fr } from "@/i18n/fr";

import { Bouton } from "@/components/ui/Bouton";
import type { RdvAccueil } from "@/services/reception";

interface FileArriveesProps {
  readonly journee: readonly RdvAccueil[];
  readonly maintenant: Date;
  readonly onAbsent: (rdv: RdvAccueil) => void;
  readonly onSelectRdv: (id: string) => void;
}

export function FileArrivees({
  journee,
  maintenant,
  onAbsent,
  onSelectRdv,
}: FileArriveesProps): React.JSX.Element | null {
  const arrivees = journee
    .filter((rdv) => rdv.status === "arrived" && rdv.arrivedAt !== null)
    .sort(
      (a, b) => Date.parse(a.arrivedAt ?? "") - Date.parse(b.arrivedAt ?? ""),
    );

  if (arrivees.length === 0) return null;

  return (
    <section aria-label={fr.reception.arrivees.titre} className="flex flex-col gap-2">
      <h3 className="font-ui text-heading font-semibold text-ink-900">
        {fr.reception.arrivees.titre}
        <span className="ml-2 font-num text-num tabular-nums text-ink-500">{arrivees.length}</span>
      </h3>

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {arrivees.map((rdv) => {
          const minutes = Math.max(
            0,
            Math.floor((maintenant.getTime() - Date.parse(rdv.arrivedAt ?? "")) / 60000),
          );
          return (
            <li key={rdv.id}>
              <div className="flex min-h-target items-center gap-3 rounded-md border border-info-100 bg-card px-3 py-2">
                <button
                  type="button"
                  onClick={() => onSelectRdv(rdv.id)}
                  className="min-w-0 flex-auto truncate bg-transparent text-left font-ui text-body font-medium text-ink-900 outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
                >
                  {[rdv.lastName, rdv.firstName].filter(Boolean).join(" ") ||
                    fr.agenda.patientNonRattache}
                </button>
                <span className="shrink-0 font-num text-label tabular-nums text-ink-500">
                  {fr.reception.arrivees.attenteDepuis} {minutes} min
                </span>
                <Bouton rang="discret" onClick={() => onAbsent(rdv)}>
                  {fr.reception.arrivees.marquerAbsent}
                </Bouton>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
