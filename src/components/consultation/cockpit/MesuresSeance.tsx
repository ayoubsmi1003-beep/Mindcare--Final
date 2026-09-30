"use client";

import { fr } from "@/i18n/fr";

import { SelecteurEchelle } from "./SelecteurEchelle";

/**
 * Mesures de séance 1–10 — Anxiété / Sommeil / Humeur.
 *
 * V11 : UNE carte, TROIS lignes compactes (curseur + 1-clic), UNE aide.
 * N'écrit RIEN seule : `onMesurer(cle, valeur)` remonte, la page inscrit
 * `« Anxiété : 6/10 »` dans Subjectif via `saveNote` (même chemin que Focus).
 * Label texte obligatoire, teinte unique verte — pas de gradient sévérité.
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
  const cockpit = fr.consultation.cockpit;
  const renseignees = [valeurs.anxiete, valeurs.sommeil, valeurs.humeur].filter(
    (v) => v !== null,
  ).length;
  return (
    <section
      aria-label={cockpit.mesuresTitre}
      className="flex scroll-mt-28 flex-col gap-1 rounded-2xl border border-rule bg-card p-5 shadow-elevee"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="text-balance font-ui text-title font-bold text-ink-900">
            {cockpit.mesuresTitre}
          </h2>
          <span className="shrink-0 rounded-full bg-layer-surface px-2.5 py-0.5 font-ui text-label font-semibold tabular-nums text-ink-700">
            {cockpit.mesuresEchelle}
          </span>
        </div>
        <p className="m-0 shrink-0 font-ui text-label font-semibold tabular-nums text-ink-500">
          {renseignees}/3
        </p>
      </div>
      <p className="m-0 font-ui text-label text-ink-500">{cockpit.mesuresAide}</p>
      <div className="divide-y divide-rule">
        <SelecteurEchelle
          id="mesure-anxiete"
          libelle="Anxiété"
          valeur={valeurs.anxiete}
          onChoisir={(v) => onMesurer("anxiete", v)}
          modifiable={modifiable}
        />
        <SelecteurEchelle
          id="mesure-sommeil"
          libelle="Sommeil"
          valeur={valeurs.sommeil}
          onChoisir={(v) => onMesurer("sommeil", v)}
          modifiable={modifiable}
        />
        <SelecteurEchelle
          id="mesure-humeur"
          libelle="Humeur"
          valeur={valeurs.humeur}
          onChoisir={(v) => onMesurer("humeur", v)}
          modifiable={modifiable}
        />
      </div>
    </section>
  );
}
