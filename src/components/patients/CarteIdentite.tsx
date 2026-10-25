/**
 * Identité & coordonnées — ce qu'il faut pour reconnaître et joindre.
 *
 * La carte est une lecture, pas un formulaire : chaque valeur est une ligne de
 * définition, pas une tuile colorée. Les champs secondaires absents sont omis ;
 * une seule phrase dit qu'il n'y en a aucun, au lieu d'aligner six « Non
 * renseigné » qui prennent la place du clinique.
 */

import { Carte } from "@/components/ui";
import { fr } from "@/i18n/fr";
import type { PatientWorkspace } from "@/services/patients";

import { dateCivile, sexeLisible, situationLisible } from "./format";

function Ligne({ libelle, valeur }: { readonly libelle: string; readonly valeur: string | null }): React.JSX.Element | null {
  if (valeur === null || valeur === "") return null;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="font-ui text-label font-medium text-ink-500">{libelle}</dt>
      <dd className="m-0 break-words font-ui text-body text-ink-900">{valeur}</dd>
    </div>
  );
}

function contactUrgenceLisible(contact: PatientWorkspace["contact"]["emergencyContact"]): string | null {
  if (contact === null) return null;
  const identite = contact.relation === null || contact.relation === ""
    ? contact.name
    : `${contact.name ?? ""} (${contact.relation})`.trim();
  const morceaux = [identite, contact.phone].filter((morceau): morceau is string => morceau !== null && morceau !== "");
  return morceaux.length === 0 ? null : morceaux.join(" · ");
}

export function CarteIdentite({ espace }: { readonly espace: PatientWorkspace }): React.JSX.Element {
  const { identite, contact, identification, admin } = espace;
  const urgence = contactUrgenceLisible(contact.emergencyContact);
  const secondaires = [contact.phoneAlt, contact.address, urgence, identification.idDocumentNumber, identification.idDocumentIssuer]
    .filter((valeur): valeur is string => valeur !== null && valeur !== "");

  return (
    <Carte niveau="primaire">
      <div className="flex flex-col gap-5 p-5">
        <h2 className="m-0 font-ui text-heading font-semibold tracking-heading text-ink-900">
          {fr.patients.sections.identite}
        </h2>

        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-4 tablet:grid-cols-3">
          <Ligne libelle={fr.patients.numeroDossier} valeur={identite.recordNumber} />
          <Ligne libelle={fr.patients.dateNaissance} valeur={dateCivile(identite.birthDate)} />
          <Ligne libelle={fr.patients.age} valeur={identite.age === null ? null : `${String(identite.age)} ${fr.patients.ageAnnees}`} />
          <Ligne libelle={fr.patients.sexe} valeur={sexeLisible(identite.sex)} />
          <Ligne libelle={fr.patients.situationFamiliale} valeur={situationLisible(identite.maritalStatus)} />
          <Ligne libelle={fr.patients.telephone} valeur={contact.phone} />
        </dl>

        {secondaires.length === 0 ? (
          <p className="m-0 border-t border-rule pt-4 font-ui text-label text-ink-500">
            Aucune coordonnée secondaire ni pièce d’identité renseignée.
          </p>
        ) : (
          <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-4 border-t border-rule pt-4 tablet:grid-cols-2">
            <Ligne libelle={fr.patients.telephoneSecondaire} valeur={contact.phoneAlt} />
            <Ligne libelle={fr.patients.adresse} valeur={contact.address} />
            <Ligne libelle={fr.patients.contactUrgence} valeur={urgence} />
            <Ligne libelle={fr.patients.pieceIdentite} valeur={identification.idDocumentNumber} />
            <Ligne libelle={fr.patients.pieceIdentiteEmetteur} valeur={identification.idDocumentIssuer} />
          </dl>
        )}

        {admin.notesAdmin === null || admin.notesAdmin === "" ? null : (
          <div className="border-t border-rule pt-4">
            <Ligne libelle={fr.patients.notesAdministratives} valeur={admin.notesAdmin} />
          </div>
        )}
      </div>
    </Carte>
  );
}
