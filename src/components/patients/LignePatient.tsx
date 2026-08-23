/**
 * Une ligne de l'annuaire.
 *
 * ⚠️ CE QUI N'EST PAS DANS CETTE LIGNE, ET POURQUOI. Ni dernière consultation,
 * ni prochain rendez-vous : `app.search_patients` (020) ne les rend pas, et les
 * y ajouter transformerait la requête la plus chaude du produit — celle qui
 * s'exécute à chaque frappe — en requête inter-domaine. Une liste doit
 * retrouver quelqu'un vite ; le dossier dit le reste.
 *
 * Le statut « actif » n'est pas affiché non plus : la porte filtre déjà
 * `is_active` en base, donc TOUTES les lignes visibles ici sont actives. Une
 * pastille « Actif » sur cent lignes identiques n'informe de rien.
 *
 * Une LIGNE, pas une carte. Cent cartes empilées produisent cent bordures et
 * autant de rythmes verticaux à traverser ; un filet fin entre deux lignes
 * suffit à les séparer et laisse l'œil descendre.
 */

import Link from "next/link";

import { Avatar } from "@/components/ui";
import { fr } from "@/i18n/fr";
import type { PatientListItem } from "@/services/patients";

import { dateCivile } from "./format";

export function LignePatient({
  patient,
}: {
  readonly patient: PatientListItem;
}): React.JSX.Element {
  const naissance = dateCivile(patient.birthDate);

  return (
    <li className="list-none border-b border-rule last:border-b-0">
      <Link
        href={`/patients/${patient.id}`}
        className="flex min-h-target-lg items-center gap-4 px-3 py-3 transition-colors duration-quick ease-out hover:bg-sunken"
      >
        <Avatar prenom={patient.firstName} nom={patient.lastName} taille="normale" />

        <span className="flex min-w-0 grow flex-col gap-1">
          <span className="min-w-0 break-words font-ui text-body font-medium text-ink-900">
            {patient.lastName} {patient.firstName}
          </span>
          <span className="font-ui text-label tracking-label text-ink-500">
            <span className="tabular-nums">{patient.recordNumber}</span>
            {naissance === null ? null : (
              <>
                {" · "}
                <span className="tabular-nums">{naissance}</span>
              </>
            )}
          </span>
        </span>

        {/* Le téléphone à droite, en chasse fixe : c'est la colonne qu'on
            balaie verticalement quand on cherche à rappeler quelqu'un. Masqué
            sous la rupture `tablet`, où la largeur manque. */}
        <span className="hidden shrink-0 font-ui text-body tabular-nums text-ink-700 tablet:inline">
          {patient.phone}
        </span>
      </Link>
    </li>
  );
}

/** L'en-tête de colonne de l'annuaire — un repère, pas un tableau. */
export function EnTeteAnnuaire(): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 border-b border-rule px-3 pb-2">
      <span className="grow font-ui text-eyebrow tracking-eyebrow text-ink-500">
        {fr.patients.titre}
      </span>
      <span className="hidden shrink-0 font-ui text-eyebrow tracking-eyebrow text-ink-500 tablet:inline">
        {fr.patients.telephone}
      </span>
    </div>
  );
}
