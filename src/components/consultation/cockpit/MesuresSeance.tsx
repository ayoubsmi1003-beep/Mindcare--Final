"use client";

import { SelecteurEchelle } from "./SelecteurEchelle";

/**
 * Mesures de séance 1–10 — Anxiété / Sommeil / Humeur.
 *
 * V10 : les 3 premières options du Focus deviennent de vrais instruments.
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
  return (
    <section
      aria-label="Mesures de la séance"
      className="flex flex-col gap-3 rounded-2xl border border-rule bg-card p-5 shadow-carte"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-ui text-heading font-semibold text-ink-900">
          Mesures de la séance
        </h2>
        <p className="m-0 shrink-0 font-ui text-label font-medium tabular-nums text-ink-500">
          1–10
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 tablet:grid-cols-3">
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
