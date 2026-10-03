import { Icone } from "@/components/ui/Icones";
import {
  ListeSignaux,
  PointDeSituation,
  SectionDepuisDerniere,
} from "@/components/patients/SectionsDeterministes";
import { frConsultationCockpit } from "@/i18n/consultation-cockpit";
import type { PatientWorkspace } from "@/services/patients";

/**
 * Repères de consultation : points du résumé sourcé, changements factuels,
 * puis dernières valeurs documentées. Aucun appel IA ni écriture clinique.
 *
 * Mêmes composants que l'onglet Résumé (`page.tsx`), donc mêmes chiffres :
 * deux écrans ne peuvent pas diverger puisqu'ils partagent la règle de
 * calcul. Le mode compact distingue explicitement absence et indisponibilité.
 */
export function DepuisDerniere({
  espace,
}: {
  readonly espace: PatientWorkspace;
}): React.JSX.Element {
  const textes = frConsultationCockpit.reperes;
  return (
    <section
      aria-label={textes.titre}
      className="flex scroll-mt-28 flex-col gap-5 rounded-2xl border border-rule bg-card p-5 shadow-douce"
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-action-100 bg-tuile-menthe text-action-600">
          <Icone nom="horloge" taille={20} />
        </span>
        <div className="flex min-w-0 flex-col">
          <h2 className="font-ui text-heading font-bold text-ink-900">{textes.titre}</h2>
          <p className="m-0 font-ui text-label text-ink-700">{textes.aide}</p>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <ListeSignaux espace={espace} compact />
        <SectionDepuisDerniere espace={espace} compact />
        <PointDeSituation espace={espace} compact />
      </div>
    </section>
  );
}
