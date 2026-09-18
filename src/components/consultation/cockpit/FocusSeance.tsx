"use client";

import { Bouton, ChampTexte } from "@/components/ui";
import { Icone } from "@/components/ui/Icones";
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

  return (
    <section
      aria-label={cockpit.focusTitre}
      className="flex flex-col gap-4 rounded-2xl border border-rule bg-card p-5 shadow-carte"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-ambre-100 bg-tuile-ambre text-ambre-700 shadow-douce">
            <Icone nom="fleche" taille={20} />
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 className="font-ui text-heading font-semibold text-ink-900">{cockpit.focusTitre}</h2>
            {selection.length === 0 ? (
              <p className="m-0 font-ui text-label font-medium text-ink-500">
                Sujets de la séance — un clic = sélectionné
              </p>
            ) : (
              <p className="m-0 font-ui text-label tabular-nums text-ink-500">
                {`${String(selection.length)} · ${selection.join(", ")}`}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Bouton
            key={option}
            rang="secondaire"
            taille="compact"
            enfonce={selection.includes(option)}
            onClick={() => basculer(option)}
          >
            <span className="truncate">{option}</span>
          </Bouton>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <span className="min-w-40 flex-1">
          <ChampTexte libelle={cockpit.focusLibre} valeur={libre} onChange={onLibre} />
        </span>
        <Bouton rang="secondaire" onClick={onAppliquer} disabled={!peutAppliquer}>
          {cockpit.focusAppliquer}
        </Bouton>
      </div>
    </section>
  );
}
