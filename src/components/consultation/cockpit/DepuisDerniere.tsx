import { ListeSignaux } from "@/components/patients/SectionsDeterministes";
import { frConsultationCockpit } from "@/i18n/consultation-cockpit";
import type { PatientWorkspace } from "@/services/patients";

/**
 * Les repères du dossier utiles PENDANT la séance.
 *
 * Uniquement les points à vérifier du résumé sourcé. Les blocs « Depuis la
 * dernière consultation » et « Point de situation » ont été retirés d'ici :
 * dans une séance ouverte, le workspace prend la séance EN COURS comme
 * référence et affichait donc « aucun nouvel élément depuis aujourd'hui » —
 * une phrase vraie et inutile, qui plus est déjà portée par la colonne de
 * contexte (séances précédentes, traitement, échelles).
 *
 * Aucun appel IA, aucune écriture : la liste est une reprise littérale des
 * signaux déjà persistés.
 */
export function DepuisDerniere({
  espace,
}: {
  readonly espace: PatientWorkspace;
}): React.JSX.Element {
  const textes = frConsultationCockpit.reperes;
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 font-ui text-label text-ink-700">{textes.aide}</p>
      <ListeSignaux espace={espace} compact />
    </div>
  );
}
