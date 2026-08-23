/**
 * Identité & coordonnées — ce qu'il faut pour reconnaître et joindre.
 *
 * ⚠️ CE QUI N'EST PAS ICI, ET POURQUOI CE N'EST PAS UN OUBLI. Ni e-mail, ni
 * situation familiale, ni profession, ni adresse structurée : AUCUNE de ces
 * colonnes n'existe dans `app.patients` (004, jamais altérée). On pourrait
 * afficher six cartes « Non renseigné » pour faire riche — ce serait affirmer
 * que ces champs existent et que personne ne les remplit, alors que le produit
 * ne sait pas encore les enregistrer. Un champ absent du schéma est absent de
 * l'écran ; un champ présent mais vide dit « Non renseigné ». La distinction
 * est ce qui rend l'écran honnête.
 *
 * L'adresse a son propre bloc (`BlocAdresse`) parce qu'elle est multiligne et
 * qu'elle mérite d'être lue, pas parcourue.
 */

import { Carte, Champ, GrilleChamps } from "@/components/ui";
import { fr } from "@/i18n/fr";
import type { PatientWorkspace } from "@/services/patients";

import { BlocAdresse } from "./BlocAdresse";
import { dateCivile, sexeLisible } from "./format";

/**
 * Le contact d'urgence, en une phrase plutôt qu'en trois champs : « Nom
 * (relation) · téléphone ». Trois `Champ` séparés pour une information qu'on
 * lit d'un bloc découperaient l'attention sans rien clarifier.
 */
function contactUrgenceLisible(
  contact: PatientWorkspace["contact"]["emergencyContact"],
): string | null {
  if (contact === null) return null;

  const identite =
    contact.relation === null || contact.relation === ""
      ? contact.name
      : `${contact.name ?? ""} (${contact.relation})`.trim();

  const morceaux = [identite, contact.phone].filter(
    (m): m is string => m !== null && m !== "",
  );

  return morceaux.length === 0 ? null : morceaux.join(" · ");
}

export function CarteIdentite({
  espace,
}: {
  readonly espace: PatientWorkspace;
}): React.JSX.Element {
  const { identite, contact, identification, admin } = espace;

  return (
    <Carte niveau="primaire">
      <h2 className="mb-4 font-ui text-heading font-semibold tracking-heading text-ink-900">
        {fr.patients.sections.identite}
      </h2>

      <GrilleChamps>
        <Champ libelle={fr.patients.numeroDossier} valeur={identite.recordNumber} />
        <Champ
          libelle={fr.patients.dateNaissance}
          valeur={dateCivile(identite.birthDate)}
        />
        {/* L'âge arrive calculé par la porte — jamais recalculé ici, voir
            `format.ts`. */}
        <Champ
          libelle={fr.patients.age}
          valeur={
            identite.age === null
              ? null
              : `${String(identite.age)} ${fr.patients.ageAnnees}`
          }
        />
        <Champ libelle={fr.patients.sexe} valeur={sexeLisible(identite.sex)} />
        <Champ libelle={fr.patients.telephone} valeur={contact.phone} />
        <Champ libelle={fr.patients.telephoneSecondaire} valeur={contact.phoneAlt} />
      </GrilleChamps>

      {/* L'adresse traverse toute la carte : une adresse sur trois lignes dans
          une colonne d'un tiers de largeur se lit mal. */}
      <div className="mt-6 border-t border-rule pt-6">
        <BlocAdresse adresse={contact.address} />
      </div>

      <div className="mt-6 border-t border-rule pt-6">
        <GrilleChamps>
          <Champ
            libelle={fr.patients.contactUrgence}
            valeur={contactUrgenceLisible(contact.emergencyContact)}
          />
          <Champ
            libelle={fr.patients.pieceIdentite}
            valeur={identification.idDocumentNumber}
          />
          <Champ
            libelle={fr.patients.pieceIdentiteEmetteur}
            valeur={identification.idDocumentIssuer}
          />
        </GrilleChamps>
      </div>

      {/* Les notes administratives en dernier et en retrait : elles sont utiles
          mais ne sont pas de l'identité, et rien ne doit laisser croire qu'on y
          consigne du clinique — la colonne est explicitement non clinique (004). */}
      {admin.notesAdmin === null || admin.notesAdmin === "" ? null : (
        <div className="mt-6 border-t border-rule pt-6">
          <Champ
            libelle={fr.patients.notesAdministratives}
            valeur={admin.notesAdmin}
          />
        </div>
      )}
    </Carte>
  );
}
