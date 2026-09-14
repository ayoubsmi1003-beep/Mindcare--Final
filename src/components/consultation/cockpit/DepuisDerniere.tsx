import { Icone } from "@/components/ui/Icones";
import {
  ListeSignaux,
  PointDeSituation,
  SectionDepuisDerniere,
} from "@/components/patients/SectionsDeterministes";
import { fr } from "@/i18n/fr";
import type { PatientWorkspace } from "@/services/patients";

/**
 * « Depuis la dernière séance » — les trois sections déterministes, sans
 * copie et sans invention, dans UNE carte au lieu d'un empilement nu.
 *
 * Mêmes composants que l'onglet Résumé (`page.tsx`), donc mêmes chiffres :
 * deux écrans ne peuvent pas diverger puisqu'ils partagent la règle de
 * calcul. Aucun bandeau synthétique : ce qui n'est pas dans le dossier ne
 * s'affiche pas.
 */
export function DepuisDerniere({
  espace,
}: {
  readonly espace: PatientWorkspace;
}): React.JSX.Element {
  const cockpit = fr.consultation.cockpit;
  return (
    <section
      aria-label={cockpit.depuisTitre}
      className="flex flex-col gap-4 rounded-2xl border border-rule bg-card p-5 shadow-carte"
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-action-100 bg-tuile-neutre text-action-600 shadow-douce">
          <Icone nom="horloge" taille={20} />
        </span>
        <h2 className="font-ui text-heading font-bold text-ink-900">{cockpit.depuisTitre}</h2>
      </div>
      <div className="flex flex-col gap-6 divide-y divide-rule [&>*:not(:first-child)]:pt-6">
        <PointDeSituation espace={espace} />
        <SectionDepuisDerniere espace={espace} />
        <ListeSignaux espace={espace} />
      </div>
    </section>
  );
}
