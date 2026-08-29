/**
 * File d'attente — version réception console : cartes numérotées, progression, vide explicite.
 */
"use client";

import { fr } from "@/i18n/fr";
import { AttenteCard } from "./AttenteCard";
import type { RdvAccueil } from "@/services/reception";

interface Props {
  readonly journee: readonly RdvAccueil[];
  readonly maintenant: Date;
  readonly onAbsent: (rdv: RdvAccueil) => void;
  readonly onSelectRdv: (id: string) => void;
}

export function FileArrivees({ journee, maintenant, onAbsent, onSelectRdv }: Props): React.JSX.Element {
  const arrivees = journee
    .filter((rdv) => rdv.status === "arrived" && rdv.arrivedAt !== null)
    .sort((a, b) => Date.parse(a.arrivedAt ?? "") - Date.parse(b.arrivedAt ?? ""));

  const MAX_VISIBLE = 6;
  const visibles = arrivees.slice(0, MAX_VISIBLE);
  const restants = arrivees.length - visibles.length;

  return (
    <section aria-label={fr.reception.arrivees.titre} className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 font-ui text-heading font-semibold text-ink-900">
        {fr.reception.arrivees.titre}
        <span className="rounded-full bg-sunken px-2 py-0.5 font-num text-label font-semibold tabular-nums text-ink-500">{arrivees.length}</span>
      </h3>

      {arrivees.length === 0 ? (
        <div className="flex items-center gap-3 rounded-md border border-rule bg-sunken px-3 py-3">
          <span aria-hidden="true" className="h-9 w-9 rounded-full bg-grad-empty opacity-60" />
          <p className="font-ui text-body text-ink-500">{fr.reception.arrivees.vide}</p>
        </div>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {visibles.map((rdv, idx) => {
              const minutes = Math.max(0, Math.floor((maintenant.getTime() - Date.parse(rdv.arrivedAt ?? "")) / 60000));
              return (
                <li key={rdv.id}>
                  <AttenteCard index={idx} rdv={rdv} minutes={minutes} onAbsent={onAbsent} onSelect={onSelectRdv} />
                </li>
              );
            })}
          </ul>
          {restants > 0 ? (
            <p className="px-1 font-ui text-label text-ink-500">+ {restants} en attente — voir ci-dessus</p>
          ) : null}
        </>
      )}
    </section>
  );
}
