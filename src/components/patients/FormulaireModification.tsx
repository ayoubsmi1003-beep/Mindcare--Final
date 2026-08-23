/**
 * Modifier un dossier — sur l'UNIQUE porte d'écriture.
 *
 * ⚠️ AUCUN SECOND CHEMIN. Tout passe par `updatePatient`, qui appelle
 * `app.update_patient` (020) : verrou, allowlist de douze champs, `trg_audit`
 * pour la trace. Ce formulaire ne connaît aucune table et n'écrit rien
 * lui-même.
 *
 * ⚠️ CE QUI N'EST PAS MODIFIABLE ICI, ET CE N'EST PAS UN OUBLI :
 *   · `record_number` — la porte le refuse (numérotation sans trou, §6) ;
 *   · `cabinet_id`, `practitioner_id` — les changer déplacerait le dossier à
 *     travers la cloison ADR-003 ; la porte les refuse aussi ;
 *   · `is_active` — la porte l'accepte, mais désactiver un dossier est un geste
 *     qui mérite sa propre confirmation, pas une case au milieu d'un formulaire
 *     d'identité. Il n'est délibérément pas exposé.
 *
 * ⚠️ « EFFACER » ET « NE PAS TOUCHER » SONT DEUX GESTES DIFFÉRENTS. Pour la
 * porte, une clé absente veut dire « inchangé » et une clé à `null` veut dire
 * « effacer ». Le service n'envoie donc que les champs RÉELLEMENT modifiés — et
 * un champ vidé par la praticienne part bien en `null`, pour être effacé.
 */

"use client";

import { useState } from "react";

import {
  BarreActions,
  Bouton,
  ChampSelection,
  ChampTexte,
  ChampZoneTexte,
  GrilleChamps,
  IndicateurEnregistrement,
} from "@/components/ui";
import { fr } from "@/i18n/fr";
import {
  normaliserTelephone,
  telephoneValide,
  updatePatient,
  type EmergencyContact,
  type Patient,
  type Sexe,
  type PatientChanges,
} from "@/services/patients";

/** Un champ vidé par la praticienne vaut `null` — voir l'en-tête. */
function ouNull(valeur: string): string | null {
  const t = valeur.trim();
  return t === "" ? null : t;
}

export function FormulaireModification({
  patient,
  onEnregistre,
  onAnnuler,
}: {
  readonly patient: Patient;
  readonly onEnregistre: (patient: Patient) => void;
  readonly onAnnuler: () => void;
}): React.JSX.Element {
  const [prenom, setPrenom] = useState(patient.firstName);
  const [nom, setNom] = useState(patient.lastName);
  const [naissance, setNaissance] = useState(patient.birthDate ?? "");
  const [sexe, setSexe] = useState<string>(patient.sex ?? "");
  const [telephone, setTelephone] = useState(patient.phone);
  const [telephoneAlt, setTelephoneAlt] = useState(patient.phoneAlt ?? "");
  const [adresse, setAdresse] = useState(patient.address ?? "");
  const [pieceNumero, setPieceNumero] = useState(patient.idDocumentNumber ?? "");
  const [pieceEmetteur, setPieceEmetteur] = useState(patient.idDocumentIssuer ?? "");
  const [urgenceNom, setUrgenceNom] = useState(patient.emergencyContact?.name ?? "");
  const [urgenceLien, setUrgenceLien] = useState(patient.emergencyContact?.relation ?? "");
  const [urgenceTel, setUrgenceTel] = useState(patient.emergencyContact?.phone ?? "");
  const [notes, setNotes] = useState(patient.notesAdmin ?? "");

  const [etat, setEtat] = useState<"repos" | "encours" | "enregistre" | "echec">("repos");
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);

  /**
   * Refus de format, PAR CHAMP. Séparé de `messageErreur` : une erreur de
   * saisie se lit à côté du champ fautif, pas en bas du formulaire — la porte
   * `app.update_patient` refuse en bloc et ne peut pas dire lequel des deux
   * numéros est en cause.
   */
  const [erreurTelephone, setErreurTelephone] = useState<string | undefined>(undefined);
  const [erreurTelephoneAlt, setErreurTelephoneAlt] = useState<string | undefined>(undefined);

  // Le type est `| null` et NON `PatientChanges["emergencyContact"]` : cette
  // dernière inclut `undefined`, puisque la clé est optionnelle. Or ici les deux
  // ne veulent pas dire la même chose — `null` efface le contact, `undefined`
  // le laisse intact. La fonction décide toujours ; c'est l'appelant qui omet.
  function contactUrgence(): EmergencyContact | null {
    const n = ouNull(urgenceNom);
    const l = ouNull(urgenceLien);
    const t = ouNull(urgenceTel);
    // Les trois vides : on efface le contact, plutôt que d'enregistrer un objet
    // de trois `null` qui s'afficherait comme un contact existant mais muet.
    if (n === null && l === null && t === null) return null;
    return { name: n, relation: l, phone: t };
  }

  /**
   * Ne partent que les champs réellement modifiés. Comparer AVANT d'envoyer
   * évite d'écrire une ligne d'audit de modification pour un formulaire ouvert
   * puis refermé sans changement — le journal doit dire ce qui a changé, pas
   * ce qui a été regardé.
   */
  function modifications(): PatientChanges {
    // Mutable puis rendu en lecture seule : `PatientChanges` a toutes ses clés
    // optionnelles, donc un objet construit par ajouts successifs lui est déjà
    // assignable — aucune assertion nécessaire.
    const changes: {
      -readonly [K in keyof PatientChanges]: PatientChanges[K];
    } = {};

    if (prenom.trim() !== patient.firstName) changes.firstName = prenom.trim();
    if (nom.trim() !== patient.lastName) changes.lastName = nom.trim();
    if (ouNull(naissance) !== patient.birthDate) changes.birthDate = ouNull(naissance);
    // Le champ de sélection ne rend qu'une chaîne : on la RAMÈNE au type de la
    // colonne (`app.sex`) plutôt que de l'assurer. Une valeur inattendue vaut
    // « non renseigné », jamais un cast qui la ferait passer telle quelle
    // jusqu'à la porte.
    const sexeChoisi: Sexe | null = sexe === "M" ? "M" : sexe === "F" ? "F" : null;
    if (sexeChoisi !== patient.sex) changes.sex = sexeChoisi;
    const tel = normaliserTelephone(telephone);
    const telAlt = normaliserTelephone(telephoneAlt);
    if (tel !== patient.phone) changes.phone = tel;
    if (ouNull(telAlt) !== patient.phoneAlt) changes.phoneAlt = ouNull(telAlt);
    if (ouNull(adresse) !== patient.address) changes.address = ouNull(adresse);
    if (ouNull(pieceNumero) !== patient.idDocumentNumber) {
      changes.idDocumentNumber = ouNull(pieceNumero);
    }
    if (ouNull(pieceEmetteur) !== patient.idDocumentIssuer) {
      changes.idDocumentIssuer = ouNull(pieceEmetteur);
    }
    if (ouNull(notes) !== patient.notesAdmin) changes.notesAdmin = ouNull(notes);

    const urgence = contactUrgence();
    const avant = patient.emergencyContact;
    const differe =
      (urgence === null) !== (avant === null) ||
      (urgence !== null &&
        avant !== null &&
        (urgence.name !== avant.name ||
          urgence.relation !== avant.relation ||
          urgence.phone !== avant.phone));
    if (differe) changes.emergencyContact = urgence;

    return changes;
  }

  /**
   * Le contrôle de format AVANT l'aller-retour — pas à la place de la base.
   *
   * `app.update_patient` refuse de toute façon (contrainte 004), mais son refus
   * remonte en message générique : `errors.ts` n'affiche jamais le texte brut
   * de Postgres, qui porterait le numéro lui-même dans un message d'erreur
   * (I5, règle 1). Sans ce contrôle, la praticienne relançait le même
   * enregistrement sans savoir quel champ corriger.
   *
   * La ponctuation est d'abord ramenée à des espaces ET RÉAFFICHÉE : le champ
   * montre exactement ce qui sera enregistré.
   */
  function saisieTelephonesValide(): boolean {
    const tel = normaliserTelephone(telephone);
    const telAlt = normaliserTelephone(telephoneAlt);
    setTelephone(tel);
    setTelephoneAlt(telAlt);

    const refusTel = telephoneValide(tel) ? undefined : fr.patients.telephoneRefuse;
    // Un second numéro VIDE est légitime — il s'efface. Seul un numéro saisi
    // doit tenir le format.
    const refusAlt =
      telAlt === "" || telephoneValide(telAlt) ? undefined : fr.patients.telephoneRefuse;

    setErreurTelephone(refusTel);
    setErreurTelephoneAlt(refusAlt);
    return refusTel === undefined && refusAlt === undefined;
  }

  function enregistrer(): void {
    setMessageErreur(undefined);
    if (!saisieTelephonesValide()) {
      setEtat("echec");
      return;
    }
    setEtat("encours");

    void updatePatient(patient.id, modifications()).then((result) => {
      if (!result.ok) {
        setEtat("echec");
        setMessageErreur(result.error.message);
        return;
      }
      setEtat("enregistre");
      onEnregistre(result.data);
    });
  }

  return (
    <form
      className="flex flex-col gap-6 rounded-lg border border-rule bg-card px-6 py-6"
      onSubmit={(e) => {
        e.preventDefault();
        enregistrer();
      }}
    >
      <h2 className="font-ui text-heading font-semibold tracking-heading text-ink-900">
        {fr.patients.modification.titre}
      </h2>

      <GrilleChamps>
        <ChampTexte libelle={fr.patients.prenom} valeur={prenom} onChange={setPrenom} requis />
        <ChampTexte libelle={fr.patients.nom} valeur={nom} onChange={setNom} requis />
        <ChampTexte
          libelle={fr.patients.dateNaissance}
          valeur={naissance}
          onChange={setNaissance}
          type="date"
        />
        <ChampSelection
          libelle={fr.patients.sexe}
          valeur={sexe}
          onChange={setSexe}
          options={[
            { valeur: "", libelle: fr.etats.texteAbsent },
            { valeur: "M", libelle: fr.patients.sexeM },
            { valeur: "F", libelle: fr.patients.sexeF },
          ]}
        />
        <ChampTexte
          libelle={fr.patients.telephone}
          valeur={telephone}
          onChange={(v) => {
            setTelephone(v);
            setErreurTelephone(undefined);
          }}
          indication={fr.patients.formatTelephone}
          {...(erreurTelephone === undefined ? {} : { erreur: erreurTelephone })}
          requis
        />
        <ChampTexte
          libelle={fr.patients.telephoneSecondaire}
          valeur={telephoneAlt}
          onChange={(v) => {
            setTelephoneAlt(v);
            setErreurTelephoneAlt(undefined);
          }}
          indication={fr.patients.formatTelephone}
          {...(erreurTelephoneAlt === undefined ? {} : { erreur: erreurTelephoneAlt })}
        />
      </GrilleChamps>

      {/* L'adresse est une zone de texte, pas une ligne : elle tient rarement
          sur une seule, et les retours saisis sont conservés à l'affichage. */}
      <ChampZoneTexte
        libelle={fr.patients.adresse}
        valeur={adresse}
        onChange={setAdresse}
        lignes={3}
      />

      <GrilleChamps>
        <ChampTexte
          libelle={fr.patients.pieceIdentite}
          valeur={pieceNumero}
          onChange={setPieceNumero}
        />
        <ChampTexte
          libelle={fr.patients.pieceIdentiteEmetteur}
          valeur={pieceEmetteur}
          onChange={setPieceEmetteur}
        />
      </GrilleChamps>

      <GrilleChamps>
        <ChampTexte
          libelle={fr.patients.modification.contactNom}
          valeur={urgenceNom}
          onChange={setUrgenceNom}
        />
        <ChampTexte
          libelle={fr.patients.modification.contactLien}
          valeur={urgenceLien}
          onChange={setUrgenceLien}
        />
        <ChampTexte
          libelle={fr.patients.modification.contactTelephone}
          valeur={urgenceTel}
          onChange={setUrgenceTel}
        />
      </GrilleChamps>

      <ChampZoneTexte
        libelle={fr.patients.notesAdministratives}
        valeur={notes}
        onChange={setNotes}
        lignes={3}
      />

      {messageErreur === undefined ? null : (
        <p role="alert" className="font-ui text-body text-attention-ink">
          {messageErreur}
        </p>
      )}

      <BarreActions>
        <Bouton type="submit" disabled={etat === "encours"}>
          {fr.patients.modification.enregistrer}
        </Bouton>
        <Bouton rang="discret" onClick={onAnnuler} disabled={etat === "encours"}>
          {fr.patients.modification.annuler}
        </Bouton>
        <IndicateurEnregistrement etat={etat} />
      </BarreActions>
    </form>
  );
}
