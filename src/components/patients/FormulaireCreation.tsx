/**
 * Créer un dossier — sur l'UNIQUE porte de création.
 *
 * ⚠️ VINGT À TRENTE SECONDES VISÉS. Le trio obligatoire (prénom, nom,
 * téléphone) est visible d'emblée ; tout le reste vit dans un groupe replié
 * (disclosure progressive). Aucun champ que le schéma ne porte : pas d'e-mail,
 * pas de profession — ces colonnes n'existent pas, on ne les demande pas.
 *
 * ⚠️ LA BASE RESTE L'AUTORITÉ, LE FORMULAIRE NE FAIT QUE PRÉCÉDER. Format du
 * téléphone vérifié ici pour dire lequel des champs faut ; le garde de
 * doublon DUR reste en base (050/052) et son refus arrive avec un message
 * nommé (`creation.doublonRefuse`).
 *
 * ⚠️ CORRESPONDANCE FORTE ⇒ GESTE EXPLICITE. Tant qu'un candidat fort est
 * affiché et que « Créer malgré tout » n'est pas cochée, la soumission reste
 * fermée. Ce n'est pas une seconde validation : c'est le moment où la
 * praticienne assume en conscience un risque de doublon que le panneau lui a
 * montré.
 *
 * Sélecteur de praticien responsable : COMPOSITION, pas autorisation. Il n'est
 * proposé qu'à l'assistante (I12), car elle enregistre pour les praticiennes ;
 * un praticien crée par défaut sous sa propre identité — la porte le garantit
 * côté base quoi qu'il arrive.
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
import { SectionPliable } from "@/components/ui/Espaces";
import { fr } from "@/i18n/fr";
import type { Practitioner } from "@/services/practitioners";
import {
  creerPatient,
  normaliserTelephone,
  telephoneValide,
  type Patient,
} from "@/services/patients";

function ouNull(valeur: string): string | null {
  const t = valeur.trim();
  return t === "" ? null : t;
}

export function FormulaireCreation({
  praticiens,
  selectionPraticienRequise,
  creationFermee,
  onCree,
  onSaisie,
}: {
  /** L'annuaire du cabinet — fourni uniquement quand le sélecteur s'affiche. */
  readonly praticiens?: readonly Practitioner[];
  /** Vrai pour l'assistante : elle désigne qui sera responsable du dossier. */
  readonly selectionPraticienRequise: boolean;
  /**
   * Vrai tant qu'un candidat fort est affiché sans « Créer malgré tout ».
   * C'est le panneau similaires qui parle à travers cette prop.
   */
  readonly creationFermee: boolean;
  readonly onCree: (patient: Patient) => void;
  /**
   * ⚠️ SANS CETTE REMONTÉE, LE GARDE DOUBLON EST DU CODE MORT (défaut n°2 de
   * la clôture V3) : le panneau « Patients similaires », la bannière de match
   * fort et la case « Créer malgré tout » vivent DANS LA PAGE — si les saisies
   * ne remontent pas, `rechercheActive` reste figé à faux et rien ne s'allume.
   * Les validations restent ici ; la base (23505) reste l'autorité finale.
   */
  readonly onSaisie?: (
    champ: "prenom" | "nom" | "telephone" | "naissance",
    valeur: string,
  ) => void;
}): React.JSX.Element {
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [naissance, setNaissance] = useState("");
  const [sexe, setSexe] = useState("");
  const [telephoneAlt, setTelephoneAlt] = useState("");
  const [adresse, setAdresse] = useState("");
  const [pieceNumero, setPieceNumero] = useState("");
  const [pieceEmetteur, setPieceEmetteur] = useState("");
  const [urgenceNom, setUrgenceNom] = useState("");
  const [urgenceLien, setUrgenceLien] = useState("");
  const [urgenceTel, setUrgenceTel] = useState("");
  const [notes, setNotes] = useState("");
  const [praticienId, setPraticienId] = useState("");

  const [malgreTout, setMalgreTout] = useState(false);

  const [etat, setEtat] = useState<"repos" | "encours" | "enregistre" | "echec">("repos");
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);

  // Erreurs PAR CHAMP — séparées du message global : une saisie fautive se lit
  // à côté du champ, pas en bas du formulaire (motif FormulaireModification).
  const [erreurPrenom, setErreurPrenom] = useState<string | undefined>(undefined);
  const [erreurNom, setErreurNom] = useState<string | undefined>(undefined);
  const [erreurTelephone, setErreurTelephone] = useState<string | undefined>(undefined);
  const [erreurPraticien, setErreurPraticien] = useState<string | undefined>(undefined);

  function contactUrgence():
    | { name: string | null; relation: string | null; phone: string | null }
    | null {
    const n = ouNull(urgenceNom);
    const l = ouNull(urgenceLien);
    const t = ouNull(urgenceTel);
    if (n === null && l === null && t === null) return null;
    return { name: n, relation: l, phone: t };
  }

  function saisieValide(): boolean {
    const tel = normaliserTelephone(telephone);
    setTelephone(tel);

    const refusPrenom = prenom.trim() === "" ? fr.patients.creation.champRequis : undefined;
    const refusNom = nom.trim() === "" ? fr.patients.creation.champRequis : undefined;
    const refusTel =
      tel === "" || telephoneValide(tel)
        ? tel === ""
          ? fr.patients.creation.champRequis
          : undefined
        : fr.patients.telephoneRefuse;
    const refusPraticien =
      selectionPraticienRequise && praticienId === ""
        ? fr.patients.creation.champRequis
        : undefined;

    setErreurPrenom(refusPrenom);
    setErreurNom(refusNom);
    setErreurTelephone(refusTel);
    setErreurPraticien(refusPraticien);

    return (
      refusPrenom === undefined &&
      refusNom === undefined &&
      refusTel === undefined &&
      refusPraticien === undefined
    );
  }

  function creer(): void {
    setMessageErreur(undefined);
    if (!saisieValide()) {
      setEtat("echec");
      return;
    }
    setEtat("encours");

    // Champs facultatifs : seuls les renseignés partent (clé absente = la porte
    // n'en entend pas parler ; une chaîne vide ne ferait que salir la ligne).
    const telAlt = ouNull(normaliserTelephone(telephoneAlt));
    const adresseNette = ouNull(adresse);
    const pieceNum = ouNull(pieceNumero);
    const pieceEmet = ouNull(pieceEmetteur);
    const urgence = contactUrgence();
    const notesNettes = ouNull(notes);

    void creerPatient({
      firstName: prenom.trim(),
      lastName: nom.trim(),
      phone: normaliserTelephone(telephone),
      ...(naissance !== "" ? { birthDate: naissance } : {}),
      ...(sexe === "M" || sexe === "F" ? { sex: sexe } : {}),
      ...(telAlt !== null ? { phoneAlt: telAlt } : {}),
      ...(adresseNette !== null ? { address: adresseNette } : {}),
      ...(pieceNum !== null ? { idDocumentNumber: pieceNum } : {}),
      ...(pieceEmet !== null ? { idDocumentIssuer: pieceEmet } : {}),
      ...(urgence !== null ? { emergencyContact: urgence } : {}),
      ...(notesNettes !== null ? { notesAdmin: notesNettes } : {}),
      ...(selectionPraticienRequise && praticienId !== ""
        ? { practitionerId: praticienId }
        : {}),
    }).then((result) => {
      if (!result.ok) {
        setEtat("echec");
        setMessageErreur(result.error.message);
        return;
      }
      setEtat("enregistre");
      onCree(result.data);
    });
  }

  return (
    <form
      className="flex flex-col gap-6 rounded-lg border border-rule bg-card px-6 py-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!creationFermee) creer();
      }}
    >
      <h2 className="font-ui text-heading font-semibold tracking-heading text-ink-900">
        {fr.patients.creation.obligatoires}
      </h2>

      <GrilleChamps>
        <ChampTexte
          libelle={fr.patients.prenom}
          valeur={prenom}
          onChange={(v) => {
            setPrenom(v);
            setErreurPrenom(undefined);
            onSaisie?.("prenom", v);
          }}
          requis
          {...(erreurPrenom === undefined ? {} : { erreur: erreurPrenom })}
        />
        <ChampTexte
          libelle={fr.patients.nom}
          valeur={nom}
          onChange={(v) => {
            setNom(v);
            setErreurNom(undefined);
            onSaisie?.("nom", v);
          }}
          requis
          {...(erreurNom === undefined ? {} : { erreur: erreurNom })}
        />
        <ChampTexte
          libelle={fr.patients.telephone}
          valeur={telephone}
          onChange={(v) => {
            setTelephone(v);
            setErreurTelephone(undefined);
            onSaisie?.("telephone", v);
          }}
          indication={fr.patients.formatTelephone}
          requis
          {...(erreurTelephone === undefined ? {} : { erreur: erreurTelephone })}
        />
      </GrilleChamps>

      {selectionPraticienRequise ? (
        <ChampSelection
          libelle={fr.patients.creation.praticienResponsable}
          valeur={praticienId}
          onChange={(v) => {
            setPraticienId(v);
            setErreurPraticien(undefined);
          }}
          indication={fr.patients.creation.praticienAide}
          requis
          options={[
            { valeur: "", libelle: "—" },
            ...(praticiens ?? []).map((p) => ({ valeur: p.id, libelle: p.fullName })),
          ]}
          {...(erreurPraticien === undefined ? {} : { erreur: erreurPraticien })}
        />
      ) : null}

      <SectionPliable
        titre={fr.patients.creation.complementaires}
        annotation={fr.patients.creation.complementairesAide}
      >
        <div className="flex flex-col gap-6">
          <GrilleChamps>
            <ChampTexte
              libelle={fr.patients.dateNaissance}
              valeur={naissance}
              onChange={(v) => {
                setNaissance(v);
                onSaisie?.("naissance", v);
              }}
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
              libelle={fr.patients.telephoneSecondaire}
              valeur={telephoneAlt}
              onChange={setTelephoneAlt}
              indication={fr.patients.formatTelephone}
            />
          </GrilleChamps>

          <ChampZoneTexte libelle={fr.patients.adresse} valeur={adresse} onChange={setAdresse} lignes={3} />

          <GrilleChamps>
            <ChampTexte libelle={fr.patients.pieceIdentite} valeur={pieceNumero} onChange={setPieceNumero} />
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
        </div>
      </SectionPliable>

      {creationFermee ? (
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-attention bg-attention-bg px-4 py-3">
          <input
            type="checkbox"
            checked={malgreTout}
            onChange={(event) => setMalgreTout(event.target.checked)}
            className="mt-1"
          />
          <span className="font-ui text-body font-medium text-attention-ink">
            {fr.patients.similaires.creerMalgreTout} —{" "}
            <span className="font-regular">{fr.patients.similaires.forteCorps}</span>
          </span>
        </label>
      ) : null}

      {messageErreur === undefined ? null : (
        <p role="alert" className="font-ui text-body text-attention-ink">
          {messageErreur}
        </p>
      )}

      <BarreActions>
        <Bouton type="submit" disabled={etat === "encours" || (creationFermee && !malgreTout)}>
          {fr.patients.creation.creer}
        </Bouton>
        <IndicateurEnregistrement etat={etat} />
      </BarreActions>
    </form>
  );
}
