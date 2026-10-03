"use client";

import { useCallback } from "react";

import { fr } from "@/i18n/fr";

/**
 * Sélecteur clinique 1–10 — instrument compact V11.
 *
 * UNE ligne par mesure : libellé + curseur + valeur. Le curseur natif porte
 * le clavier (←/→) et le tactile ; la rangée de 10 pastilles porte le 1-clic
 * sans scroll. Teinte unique verte, jamais de gradient sévérité.
 * `onChoisir` remonte la valeur locale sans écrire dans les notes.
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
  const cockpit = fr.consultation.cockpit;
  const choisir = useCallback(
    (v: number) => {
      if (!modifiable) return;
      const borne = Math.min(10, Math.max(1, v));
      onChoisir(borne);
    },
    [modifiable, onChoisir],
  );

  return (
    <div className="flex min-w-0 flex-col gap-1.5 py-3 first:pt-1 last:pb-1">
      <div className="flex items-baseline justify-between gap-3">
        <span
          id={`${id}-libelle`}
          className="truncate font-ui text-body font-semibold text-ink-900"
        >
          {libelle}
        </span>
        <span
          aria-live="polite"
          className={[
            "shrink-0 font-ui tabular-nums",
            valeur === null
              ? "text-label font-medium text-ink-500"
              : "text-chiffre font-extrabold tracking-chiffre text-ink-900",
          ].join(" ")}
        >
          {valeur === null
            ? cockpit.mesuresNonMesure
            : `${String(valeur)}/10`}
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => choisir((valeur ?? 2) - 1)}
          disabled={!modifiable || valeur === 1}
          aria-label={`${cockpit.mesureDiminuer} — ${libelle}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-rule bg-layer-surface font-ui text-body font-bold text-ink-700 transition duration-quick ease-out hover:border-action-600 hover:text-action-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden="true">−</span>
        </button>
        <input
          id={id}
          type="range"
          min={1}
          max={10}
          step={1}
          value={valeur ?? 5}
          disabled={!modifiable}
          onChange={(e) => choisir(Number.parseInt(e.target.value, 10))}
          aria-labelledby={`${id}-libelle`}
          aria-valuetext={
            valeur === null
              ? cockpit.mesuresNonMesure
              : `${String(valeur)} ${cockpit.mesureSurDix}`
          }
          className="h-2.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full accent-action-600 disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: `linear-gradient(to right, var(--action-600) 0%, var(--action-600) ${String(((valeur ?? 5) - 1) * (100 / 9))}%, var(--layer-surface) ${String(((valeur ?? 5) - 1) * (100 / 9))}%, var(--layer-surface) 100%)`,
            opacity: valeur === null ? 0.5 : 1,
          }}
        />
        <button
          type="button"
          onClick={() => choisir((valeur ?? 5) + 1)}
          disabled={!modifiable || valeur === 10}
          aria-label={`${cockpit.mesureAugmenter} — ${libelle}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-rule bg-layer-surface font-ui text-body font-bold text-ink-700 transition duration-quick ease-out hover:border-action-600 hover:text-action-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
    </div>
  );
}
