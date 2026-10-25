"use client";

import { frConsultationCockpit } from "@/i18n/consultation-cockpit";

import { SelecteurNote } from "./SelecteurNote";

/**
 * Repères de séance 1–10 — Anxiété / Sommeil / Humeur.
 *
 * ⚠️ CE NE SONT PAS DES ÉCHELLES VALIDÉES. Le mot « échelle » est réservé aux
 * instruments du référentiel (PHQ-9, GAD-7…), avec leurs items et leur barème.
 * Ces trois repères sont des impressions de séance, enregistrées dans
 * `sessionDetails` avec la convention `difficulty-v1` ; ils ne doivent jamais
 * être lus comme un score clinique. Le badge et l'aide le disent.
 */
export type CleMesure = "anxiete" | "sommeil" | "humeur";

export function MesuresSeance({
  valeurs,
  onMesurer,
  modifiable,
}: {
  readonly valeurs: Record<CleMesure, number | null>;
  readonly onMesurer: (cle: CleMesure, valeur: number) => void;
  readonly modifiable: boolean;
}): React.JSX.Element {
  const renseignees = [valeurs.anxiete, valeurs.sommeil, valeurs.humeur].filter(
    (v) => v !== null,
  ).length;

  return (
    <section
      aria-label={frConsultationCockpit.mesuresTitre}
      className="flex scroll-mt-28 flex-col gap-1 rounded-2xl border border-rule bg-card p-4 shadow-douce"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="text-balance font-ui text-title font-bold text-ink-900">
            {frConsultationCockpit.mesuresTitre}
          </h2>
          <span className="shrink-0 rounded-full bg-layer-surface px-2.5 py-0.5 font-ui text-label font-semibold text-ink-700">
            {frConsultationCockpit.mesuresNonValidees}
          </span>
        </div>
        <p className="m-0 shrink-0 font-ui text-label font-semibold tabular-nums text-ink-500">
          {renseignees}/3
        </p>
      </div>
      <p className="m-0 font-ui text-label text-ink-500">{frConsultationCockpit.mesuresAide}</p>
      <div className="divide-y divide-rule">
        <SelecteurNote
          id="mesure-anxiete"
          libelle={frConsultationCockpit.anxiete}
          valeur={valeurs.anxiete}
          onChoisir={(v) => onMesurer("anxiete", v)}
          modifiable={modifiable}
        />
        <SelecteurNote
          id="mesure-sommeil"
          libelle={frConsultationCockpit.sommeil}
          valeur={valeurs.sommeil}
          onChoisir={(v) => onMesurer("sommeil", v)}
          modifiable={modifiable}
        />
        <SelecteurNote
          id="mesure-humeur"
          libelle={frConsultationCockpit.humeur}
          valeur={valeurs.humeur}
          onChoisir={(v) => onMesurer("humeur", v)}
          modifiable={modifiable}
        />
      </div>
    </section>
  );
}
