"use client";

import { fr } from "@/i18n/fr";

/**
 * Sélecteur 1–10 d'un repère de séance — dix boutons radio natifs.
 *
 * POURQUOI PAS UN CURSEUR. Un `<input type="range">` sans valeur affiche
 * toujours un pouce : « Non mesuré » et « 5 » se ressemblaient, et les boutons
 * +/− partaient de deux valeurs différentes (1 d'un côté, 6 de l'autre). Ici,
 * aucune valeur n'est sélectionnée tant que la praticienne n'a pas cliqué ;
 * le clavier, les flèches et le lecteur d'écran sont ceux d'un groupe radio
 * natif, sans roving tabindex à réinventer.
 */
export function SelecteurNote({
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

  return (
    <fieldset
      disabled={!modifiable}
      className="flex min-w-0 flex-col gap-2 border-0 p-0 py-3 first:pt-1 last:pb-1"
    >
      <legend className="flex w-full items-baseline justify-between gap-3 p-0">
        <span className="truncate font-ui text-body font-semibold text-ink-900">{libelle}</span>
        <span
          aria-live="polite"
          className={[
            "shrink-0 font-ui tabular-nums",
            valeur === null
              ? "text-label font-medium text-ink-500"
              : "text-chiffre font-extrabold tracking-chiffre text-ink-900",
          ].join(" ")}
        >
          {valeur === null ? cockpit.mesuresNonMesure : `${String(valeur)}/10`}
        </span>
      </legend>

      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 10 }, (_, index) => index + 1).map((n) => {
          const choisi = valeur === n;
          return (
            <label
              key={n}
              className={[
                "inline-flex cursor-pointer items-center justify-center rounded-lg border",
                "h-9 w-9 font-ui text-label font-semibold tabular-nums",
                "transition duration-quick ease-out",
                "focus-within:outline focus-within:outline-action-600 focus-within:outline-offset",
                choisi
                  ? "border-action-600 bg-action-600 text-on-brand shadow-douce"
                  : "border-rule bg-card text-ink-700 hover:border-action-600 hover:text-action-900",
                modifiable ? "" : "cursor-not-allowed opacity-50",
              ].join(" ")}
            >
              <input
                type="radio"
                name={id}
                value={n}
                checked={choisi}
                onChange={() => onChoisir(n)}
                disabled={!modifiable}
                className="sr-only"
              />
              <span aria-hidden="true">{n}</span>
              <span className="sr-only">{`${libelle} ${String(n)} ${cockpit.mesureSurDix}`}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
