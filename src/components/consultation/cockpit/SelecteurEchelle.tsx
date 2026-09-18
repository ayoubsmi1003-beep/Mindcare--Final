"use client";

import { useCallback } from "react";

/**
 * Sélecteur clinique 1–10 — segmenté premium, accessible clavier.
 *
 * V10 : remplace les boutons « Stress / Sommeil » ennuyeux par un vrai
 * instrument de mesure. Teinte unique verte (intensité par valeur), label
 * texte obligatoire — jamais de gradient vert→rouge seul comme sévérité.
 * N'écrit RIEN tout seul : `onChoisir` remonte, la page écrit via `saveNote`.
 */
export function SelecteurEchelle({
  id,
  libelle,
  valeur,
  onChoisir,
  modifiable = true,
}: {
  readonly id: string;
  readonly libelle: string;
  readonly valeur: number | null;
  readonly onChoisir: (v: number) => void;
  readonly modifiable?: boolean;
}): React.JSX.Element {
  const choisir = useCallback(
    (v: number) => {
      if (!modifiable) return;
      onChoisir(v);
    },
    [modifiable, onChoisir],
  );

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-rule bg-card p-4 shadow-carte">
      <div className="flex items-baseline justify-between gap-3">
        <span id={`${id}-libelle`} className="truncate font-ui text-label font-semibold text-ink-700">
          {libelle}
        </span>
        <span
          aria-live="polite"
          className="shrink-0 font-ui text-chiffre font-extrabold tabular-nums tracking-chiffre text-ink-900"
        >
          {valeur === null ? "–" : `${String(valeur)}/10`}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-libelle`}
        className="grid grid-cols-10 gap-1"
      >
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const actif = valeur === n;
          const intensite = n / 10;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={actif}
              aria-label={`${libelle} ${String(n)} sur 10`}
              disabled={!modifiable}
              onClick={() => choisir(n)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" && n < 10) choisir(n + 1);
                if (e.key === "ArrowLeft" && n > 1) choisir(n - 1);
              }}
              className={[
                "flex min-h-target items-center justify-center rounded-lg border font-ui text-label font-semibold tabular-nums",
                "transition duration-quick ease-out",
                "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
                "disabled:cursor-not-allowed disabled:opacity-60",
                actif
                  ? "border-action-600 bg-action-600 text-on-brand shadow-douce"
                  : "border-rule bg-layer-surface text-ink-700 hover:border-action-600 hover:text-action-900",
              ].join(" ")}
              style={actif ? undefined : { backgroundColor: `color-mix(in srgb, var(--action-100) ${String(Math.round(intensite * 55))}%, var(--card))` }}
            >
              {n}
            </button>
          );
        })}
      </div>
      <p className="m-0 font-ui text-label font-medium text-ink-500">
        {valeur === null ? "Touchez une valeur — elle s'inscrit dans la note." : `Valeur retenue : ${String(valeur)}/10`}
      </p>
    </div>
  );
}
