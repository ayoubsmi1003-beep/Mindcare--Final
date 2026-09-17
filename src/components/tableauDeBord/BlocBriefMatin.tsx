/**
 * `BlocBriefMatin` — le brief du matin, DÉTERMINISTE.
 *
 * ZÉRO appel réseau, ZÉRO `/api/jarvis/` : il reçoit `tableau` (déjà chargé
 * par le parent en UN appel `dashboard_today`) et compose via
 * `composerBriefMatinal` — les mêmes entrées que la capacité `brief_matinal`
 * (Task 2). Lignes agenda (trous/retards/restants) en constats chiffrés (L4).
 * Reste vrai passerelle tombée (I20) ; l'invariant est verrouillé en e2e.
 */
"use client";

import { m11 } from "@/i18n/m11";
import { composerBriefMatinal } from "@/services/jarvis-briefs";
import { preparerEntreeBriefMatinal } from "@/services/brief-matinal";
import type { TableauDeBord } from "@/services/dashboard";
import { aujourdHuiCabinet } from "@/services/finance-calendrier";
import { CarteIdentite } from "@/services/jarvis-identite";

import { heureCabinet } from "./heures";
import {
  dureeCourte,
  resteJournee,
  retardsJournee,
  trousJournee,
} from "./lecture-journee";

export function BlocBriefMatin({
  tableau,
  maintenant,
}: {
  readonly tableau: TableauDeBord;
  readonly maintenant: Date;
}): React.JSX.Element {
  const brief = composerBriefMatinal(
    preparerEntreeBriefMatinal(tableau, aujourdHuiCabinet(), maintenant.toISOString(), new CarteIdentite()),
  );
  const lignes: readonly string[] = [
    ...brief.faits,
    ...trousJournee(tableau.journee).map((t) =>
      m11.journee.pause(dureeCourte(t.minutes), heureCabinet(t.debut), heureCabinet(t.fin)),
    ),
    ...retardsJournee(tableau.journee).map((r) => m11.journee.retard(r.nom, r.minutes)),
    ...brief.observations,
    ...brief.attention,
  ];
  const reste = resteJournee(tableau.journee, maintenant);
  const ligneReste =
    reste.prochain === null
      ? m11.journee.aucunReste
      : m11.journee.reste(reste.restants, heureCabinet(reste.prochain.startsAt));

  return (
    <section
      aria-label={m11.brief.titre}
      className="flex min-w-0 flex-col gap-5 rounded-2xl border border-rule bg-card p-5 shadow-carte lg:p-6"
    >
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="min-w-0 truncate font-ui text-heading font-bold tracking-heading text-ink-900">
          {m11.brief.titre}
        </h2>
        <p className="min-w-0 truncate font-ui text-label text-ink-500">{m11.brief.aide}</p>
      </div>
      <ul className="m-0 flex min-w-0 flex-col gap-2 p-0">
        {lignes.map((ligne, i) => (
          <li key={`${i}::${ligne}`} className="min-w-0 font-ui text-body text-ink-700">
            {ligne}
          </li>
        ))}
        <li key={`reste::${ligneReste}`} className="min-w-0 font-ui text-body text-ink-700">
          {ligneReste}
        </li>
      </ul>
    </section>
  );
}
