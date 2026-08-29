/**
 * PreparationJour — compact horizontal, pas 3 cartes empilées.
 * Une ligne : confirmés · premier à HH:MM · restants à encaisser · annulations repliees.
 */
"use client";

import { fr } from "@/i18n/fr";
import { heure } from "@/components/AgendaPieces";
import type { PaiementAccueil, RdvAccueil } from "@/services/reception";

interface Props {
  readonly journee: readonly RdvAccueil[];
  readonly paiements: readonly PaiementAccueil[];
}

export function PreparationJour({ journee, paiements }: Props): React.JSX.Element {
  const confirmes = journee.filter((r) => r.status === "confirmed");
  const premier = [...confirmes].sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const restants = paiements.filter((p) => p.collectedAt === null).length;
  const annules = journee.filter((r) => r.status === "cancelled").length;

  return (
    <section aria-label={fr.reception.demain.titre} className="rounded-md border border-rule bg-sunken px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-ui text-label text-ink-700">
        <span className="font-semibold uppercase tracking-label text-ink-500">{fr.reception.demain.cloture}</span>
        <span>
          <span className="font-num font-semibold tabular-nums text-ink-900">{confirmes.length}</span> {fr.reception.demain.rdvConfirmes}
          {premier ? <> · {fr.reception.demain.premierA} <span className="font-num tabular-nums">{heure(premier.startsAt) ?? "--:--"}</span></> : null}
        </span>
        <span className="h-3 w-px bg-rule" aria-hidden="true" />
        <span>
          <span className="font-num font-semibold tabular-nums text-ink-900">{restants}</span> {fr.reception.demain.paiementsRestants}
        </span>
        {annules > 0 ? (
          <>
            <span className="h-3 w-px bg-rule" aria-hidden="true" />
            <span>{annules} annulation(s)</span>
          </>
        ) : null}
      </div>
    </section>
  );
}
