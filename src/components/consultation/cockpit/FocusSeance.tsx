"use client";

import { Bouton, ChampTexte } from "@/components/ui";
import { fr } from "@/i18n/fr";

/**
 * Le focus de la séance — choix multiples explicites + champ libre.
 *
 * Contrôlé par la page (`selection`, `libre`). Rien ne s'écrit tout seul :
 * `onAppliquer` recopie le marqueur dans Subjectif via `appliquerFocus`
 * (modele-cockpit) puis `saveNote`. Cocher ne réécrit jamais la note.
 */
export function FocusSeance({
  options,
  selection,
  onChanger,
  libre,
  onLibre,
  onAppliquer,
  peutAppliquer,
}: {
  readonly options: readonly string[];
  readonly selection: readonly string[];
  readonly onChanger: (suivant: readonly string[]) => void;
  readonly libre: string;
  readonly onLibre: (v: string) => void;
  readonly onAppliquer: () => void;
  readonly peutAppliquer: boolean;
}): React.JSX.Element {
  const cockpit = fr.consultation.cockpit;

  function basculer(option: string): void {
    onChanger(
      selection.includes(option)
        ? selection.filter((s) => s !== option)
        : [...selection, option],
    );
  }

  const compteur =
    selection.length === 0
      ? cockpit.focusSousTitre
      : `${String(selection.length)} ${
          selection.length === 1 ? cockpit.focusCompteurUn : cockpit.focusCompteurPlus
        } — ${selection.join(", ")}`;

  return (
    <section
      aria-label={cockpit.focusTitre}
      className="flex scroll-mt-28 flex-col gap-3 rounded-2xl border border-rule bg-layer-surface p-5 shadow-douce"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-balance font-ui text-heading font-bold text-ink-900">
          {cockpit.focusTitre}
        </h2>
        <p
          aria-live="polite"
          className="m-0 max-w-full truncate font-ui text-label font-medium tabular-nums text-ink-500"
          title={compteur}
        >
          {compteur}
        </p>
      </div>

      <div role="group" aria-label={cockpit.focusTitre} className="flex flex-wrap gap-2">
        {options.map((option) => {
          const actif = selection.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={actif}
              onClick={() => basculer(option)}
              className={[
                "inline-flex min-h-target items-center rounded-full border px-4 py-2",
                "font-ui text-body font-semibold",
                "transition duration-quick ease-out active:scale-95",
                "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
                actif
                  ? "border-action-600 bg-action-600 text-on-brand shadow-douce"
                  : "border-rule bg-card text-ink-700 shadow-lift0 hover:border-action-600 hover:text-action-900",
              ].join(" ")}
            >
              {actif ? (
                <span aria-hidden="true" className="mr-1.5 font-bold">✓</span>
              ) : null}
              <span className="truncate">{option}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t border-rule pt-3">
        <span className="min-w-40 flex-1">
          <ChampTexte libelle={cockpit.focusLibre} valeur={libre} onChange={onLibre} />
        </span>
        <Bouton
          rang={peutAppliquer ? "principal" : "secondaire"}
          taille="compact"
          onClick={onAppliquer}
          disabled={!peutAppliquer}
        >
          {cockpit.focusAppliquer}
        </Bouton>
      </div>
    </section>
  );
}
