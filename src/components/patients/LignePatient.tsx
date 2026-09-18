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

import { Avatar, Icone } from "@/components/ui";
import { fr } from "@/i18n/fr";
import type { PatientListItem } from "@/services/patients";

import { dateCivile } from "./format";

export function LignePatient({
  patient,
}: {
  readonly patient: PatientListItem;
}): React.JSX.Element {
  const naissance = dateCivile(patient.birthDate);
  // L'âge ARRIVE CALCULÉ par la porte (066) — voir `PatientListItem.age` et
  // l'en-tête de `format.ts`. Il ne se dérive pas de `birthDate` ici : la
  // référence de temps serait l'horloge du poste, pas celle du serveur.
  // `null` tant que 066 n'est pas appliquée : la ligne s'affiche sans âge,
  // exactement comme avant, plutôt que de montrer une valeur inventée.
  const age =
    patient.age === null ? null : `${String(patient.age)} ${fr.patients.ageAnnees}`;

  return (
    <li className="list-none border-b border-rule last:border-b-0">
      <Link
        href={`/patients/${patient.id}`}
        /* v9 — la ligne respire un peu plus (py-3.5 → py-3 conservé, gap
            élargi) et gagne son AFFORDANCE : le chevron, discret au repos,
            dit « cette ligne s'ouvre » sans qu'aucun mot ne le dise. La
            pastille d'identité reste la marque — un patient n'est pas un
            statut, il n'a pas de couleur propre (voir Avatar). */
        /* V8 — LA LIGNE RESPIRE, ET LE SURVOL EST UN MATÉRIAU.
           `min-h-rang` (52 px) au lieu de 44 : un tableau dense n'est pas un
           tableau serré, c'est un tableau dont chaque ligne se vise du doigt.
           Le fond de survol passe du gris `sunken` au matériau menthe le plus
           clair — la même famille que le reste du produit, au lieu du gris
           par défaut d'un composant de framework. */
        className="group flex min-h-rang items-center gap-4 rounded-xl px-3 py-3 no-underline transition duration-quick ease-out hover:bg-action-50"
      >
        <Avatar prenom={patient.firstName} nom={patient.lastName} taille="normale" />

        <span className="flex min-w-0 grow flex-col gap-1">
          <span className="min-w-0 break-words font-ui text-body font-semibold text-ink-900">
            {patient.lastName} {patient.firstName}
          </span>
          <span className="font-ui text-label font-medium text-ink-500">
            <span className="rounded-md bg-sunken px-2 py-1 font-num text-label font-semibold tabular-nums text-ink-700 group-hover:bg-card">{patient.recordNumber}</span>
            {age === null ? null : (
              <>
                {" · "}
                {/* L'âge avant la date : en lecture clinique c'est lui qu'on
                    cherche, la date de naissance ne sert qu'à l'identitovigilance. */}
                <span className="tabular-nums text-ink-700">{age}</span>
              </>
            )}
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

        {/* L'affordance — invisible au repos, posée au survol : la ligne dit
            « ouvre-moi » au moment exact où la main hésite. Le chevron ne
            porte aucune information (le lien est annoncé par le lecteur
            d'écran) : `aria-hidden` par défaut du jeu d'icônes. */}
        <Icone
          nom="chevron"
          taille={16}
          className="shrink-0 text-ink-300 opacity-0 transition duration-quick ease-soft group-hover:text-action-600 group-hover:opacity-100"
        />
      </Link>
    </li>
  );
}

export function EnTeteAnnuaire(): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 rounded-t-2xl border-b border-rule bg-tete-tableau px-4 pb-3 pt-3.5">
      <span className="grow font-ui text-label font-semibold text-ink-700">
        {fr.patients.titre}
      </span>
      <span className="hidden shrink-0 font-ui text-label font-semibold text-ink-700 tablet:inline">
        {fr.patients.telephone}
      </span>
    </div>
  );
}
