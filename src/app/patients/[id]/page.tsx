/**
 * Fiche patient — l'espace de travail clinique.
 *
 * ⚠️ INTROUVABLE ET HORS PÉRIMÈTRE SONT INDISCERNABLES, ET C'EST LE POINT LE
 * PLUS IMPORTANT DE CET ÉCRAN.
 *
 * `app.get_patient_workspace` rend NULL dans les deux cas, et
 * `getPatientWorkspace` rend `ok(null)` sans distinguer lequel. L'interface ne
 * doit pas distinguer non plus : afficher « ce dossier ne vous est pas
 * accessible » confirmerait à une praticienne l'EXISTENCE d'un dossier chez sa
 * consœur — une fuite d'information par le message d'erreur, sans qu'aucune
 * donnée n'ait été lue. Un seul message, `fr.patients.ficheIntrouvable`, pour
 * les deux situations. Ne jamais « améliorer » ce comportement.
 *
 * I4 — LA LECTURE EST JOURNALISÉE PAR LA BASE. La porte écrit dans `audit.log`
 * AVANT de retourner, dans la même transaction, y compris quand la RLS ne rend
 * rien : la TENTATIVE d'ouverture est tracée. Cet écran n'a rien à journaliser
 * lui-même, et ne doit surtout pas essayer — le journal applicatif n'est pas
 * l'audit légal.
 *
 * ═══ UN ÉCRAN, UN APPEL — ET LE RESTE À LA DEMANDE ════════════════════════
 *
 * L'ouverture ne coûte QU'UN appel de données (`getPatientWorkspace`), donc UNE
 * ligne d'audit `fiche`. La chronologie et les documents ne lisent qu'à
 * l'ouverture de leur onglet, et chacun écrit alors sa propre trace `liste`.
 *
 * Ce n'est pas d'abord une optimisation : ouvrir une fiche ne doit pas produire
 * une lecture que la praticienne n'a pas demandée (règle 6). C'est la raison
 * déjà écrite dans `SectionDocumentsPatient`, et elle vaut pour la chronologie.
 *
 * ═══ LES ONGLETS CLINIQUES PEUVENT MANQUER, ET CE N'EST PAS UN MASQUAGE ═══
 *
 * `espace.clinique` et `espace.traitements` valent `null` quand la base a
 * décidé que l'appelant ne voit pas le clinique (`can_see_clinical`, 003). On
 * ne monte alors pas ces onglets. Ce n'est PAS la frontière de sécurité — les
 * sous-requêtes sont de toute façon filtrées par la RLS et ne rendraient rien —
 * c'est une décision de COMPOSITION : proposer à l'accueil trois onglets
 * structurellement vides serait une mauvaise interface, pas une protection.
 * Il n'y a pas un seul `if (role === …)` dans ce fichier.
 */

"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { SectionDocumentsPatient } from "@/components/documents/SectionDocumentsPatient";
import { CarteIdentite } from "@/components/patients/CarteIdentite";
import { ChronologiePatient } from "@/components/patients/ChronologiePatient";
import { EnTetePatient, RetourListe } from "@/components/patients/EnTetePatient";
import { FormulaireModification } from "@/components/patients/FormulaireModification";
import { CarteContexteClinique, PanneauClinique } from "@/components/patients/PanneauClinique";
import {
  CarteProchaineEcheance,
  PanneauRendezVous,
} from "@/components/patients/PanneauRendezVous";
import { PanneauTraitements } from "@/components/patients/PanneauTraitements";
import {
  BandeauHorsLigne,
  BlocErreur,
  EtatVide,
  Onglets,
  PanneauOnglet,
  Squelette,
  type Onglet,
} from "@/components/ui";
import { fr } from "@/i18n/fr";
import { getSession, signOut } from "@/services/auth";
import { getCurrentUser, type CurrentUser } from "@/services/authz";
import {
  getPatient,
  getPatientWorkspace,
  type Patient,
  type PatientWorkspace,
} from "@/services/patients";

type CleOnglet =
  | "vueDEnsemble"
  | "chronologie"
  | "clinique"
  | "traitements"
  | "rendezVous"
  | "documents";

export default function PageFichePatient(): React.JSX.Element {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [utilisateur, setUtilisateur] = useState<CurrentUser | null | undefined>(undefined);
  const [espace, setEspace] = useState<PatientWorkspace | null | undefined>(undefined);
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);
  const [horsLigne, setHorsLigne] = useState(false);
  const [onglet, setOnglet] = useState<CleOnglet>("vueDEnsemble");

  // La modification travaille sur `Patient`, la forme de la porte d'écriture —
  // pas sur `PatientWorkspace`, qui est une VUE agrégée. Le dossier n'est relu
  // sous cette forme qu'au moment où on ouvre le formulaire : le charger à
  // l'ouverture de la fiche écrirait une seconde trace `fiche` pour un geste
  // que la praticienne n'a pas encore demandé.
  const [enModification, setEnModification] = useState<Patient | null>(null);
  const [erreurModification, setErreurModification] = useState<string | undefined>(undefined);

  // ⚠️ « ÉCHEC DE LECTURE DE LA SESSION » N'EST PAS « AUCUNE SESSION » — voir
  // le commentaire détaillé dans `src/app/patients/page.tsx`. Hors ligne, le
  // rafraîchissement de jeton échoue ; rediriger là-dessus éjecterait la
  // praticienne de la fiche qu'elle est en train de lire (I20).
  useEffect(() => {
    let annule = false;
    void getSession().then((result) => {
      if (annule) return;
      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        setUtilisateur(null);
        return;
      }
      if (result.data === null) {
        router.replace("/connexion");
        return;
      }
      void getCurrentUser().then((profil) => {
        if (annule) return;
        setUtilisateur(profil.ok ? profil.data : null);
      });
    });
    return () => {
      annule = true;
    };
  }, [router]);

  useEffect(() => {
    let annule = false;
    void getPatientWorkspace(id).then((result) => {
      if (annule) return;
      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        setMessageErreur(result.error.message);
        setEspace(null);
        return;
      }
      setHorsLigne(false);
      setMessageErreur(undefined);
      setEspace(result.data);
    });
    return () => {
      annule = true;
    };
  }, [id]);

  function deconnecter(): void {
    // `replace` et pas `push` : le bouton Retour ne doit pas ramener sur un
    // dossier après une déconnexion volontaire, sur un poste que le patient
    // suivant voit.
    void signOut().then(() => {
      router.replace("/connexion");
    });
  }

  function ouvrirModification(): void {
    setErreurModification(undefined);
    void getPatient(id).then((result) => {
      if (!result.ok) {
        setErreurModification(result.error.message);
        return;
      }
      if (result.data === null) {
        setErreurModification(fr.patients.ficheIntrouvable);
        return;
      }
      setEnModification(result.data);
    });
  }

  function apresModification(): void {
    setEnModification(null);
    // Relire l'espace complet : une modification d'identité change l'en-tête,
    // l'âge et les coordonnées. Recomposer la vue à partir du `Patient` rendu
    // par la porte d'écriture reconstruirait à la main ce que la porte de
    // lecture sait faire — et les deux formes divergeraient au premier champ
    // ajouté.
    void getPatientWorkspace(id).then((result) => {
      if (result.ok) setEspace(result.data);
    });
  }

  if (utilisateur === undefined) {
    return (
      <main className="p-8">
        <Squelette lignes={6} />
      </main>
    );
  }

  const contenu = ((): React.JSX.Element => {
    if (horsLigne && espace === undefined) return <BandeauHorsLigne />;

    if (messageErreur !== undefined && espace !== undefined && espace === null) {
      return <BlocErreur message={messageErreur} />;
    }

    if (espace === undefined) return <Squelette lignes={8} />;

    if (espace === null) {
      /* Dossier inexistant OU hors périmètre — un seul message, voir l'en-tête. */
      return <EtatVide message={fr.patients.ficheIntrouvable} action={<RetourListe />} />;
    }

    if (enModification !== null) {
      return (
        <FormulaireModification
          patient={enModification}
          onEnregistre={apresModification}
          onAnnuler={() => setEnModification(null)}
        />
      );
    }

    // Les onglets cliniques n'existent que si la base a rendu leur domaine.
    const onglets: readonly Onglet[] = [
      { cle: "vueDEnsemble", libelle: fr.patients.onglets.vueDEnsemble, icone: "patients" },
      ...(espace.clinique === null
        ? []
        : ([
            { cle: "chronologie", libelle: fr.patients.onglets.chronologie, icone: "suivi" },
            { cle: "clinique", libelle: fr.patients.onglets.clinique, icone: "statistiques" },
          ] as const)),
      ...(espace.traitements === null
        ? []
        : ([
            {
              cle: "traitements",
              libelle: fr.patients.onglets.traitements,
              icone: "traitements",
            },
          ] as const)),
      { cle: "rendezVous", libelle: fr.patients.onglets.rendezVous, icone: "agenda" },
      { cle: "documents", libelle: fr.patients.onglets.documents, icone: "documents" },
    ];

    // Si l'onglet actif a disparu (rôle sans clinique), on retombe sur la vue
    // d'ensemble plutôt que de rendre un panneau vide sans onglet sélectionné.
    const actif = onglets.some((o) => o.cle === onglet) ? onglet : "vueDEnsemble";

    return (
      <article className="flex flex-col gap-6">
        <EnTetePatient espace={espace} onModifier={ouvrirModification} />

        {erreurModification === undefined ? null : (
          <BlocErreur message={erreurModification} />
        )}

        <div>
          <Onglets
            onglets={onglets}
            actif={actif}
            onChanger={(cle) => setOnglet(cle as CleOnglet)}
            etiquette={fr.patients.titre}
          />

          {/* UN SEUL panneau monté à la fois. Monter les six et les masquer en
              CSS ferait lire le dossier six fois — et écrirait six traces. */}
          <PanneauOnglet cle={actif}>
            {actif === "vueDEnsemble" ? (
              <div className="grid grid-cols-fiche gap-6">
                <CarteIdentite espace={espace} />
                {espace.clinique === null ? null : (
                  <CarteContexteClinique clinique={espace.clinique} />
                )}
                <CarteProchaineEcheance agenda={espace.agenda} documents={espace.documents} />
              </div>
            ) : null}

            {actif === "chronologie" ? <ChronologiePatient patientId={espace.identite.id} /> : null}

            {actif === "clinique" && espace.clinique !== null ? (
              <PanneauClinique clinique={espace.clinique} />
            ) : null}

            {actif === "traitements" && espace.traitements !== null ? (
              <PanneauTraitements traitements={espace.traitements} />
            ) : null}

            {actif === "rendezVous" ? <PanneauRendezVous agenda={espace.agenda} /> : null}

            {actif === "documents" ? (
              <SectionDocumentsPatient patientId={espace.identite.id} />
            ) : null}
          </PanneauOnglet>
        </div>
      </article>
    );
  })();

  return (
    <AppShell
      role={utilisateur?.role ?? "assistant"}
      nomComplet={utilisateur?.fullName ?? ""}
      onDeconnexion={deconnecter}
    >
      <div className="mb-4">
        <RetourListe />
      </div>

      {horsLigne ? (
        <div className="mb-4">
          <BandeauHorsLigne />
        </div>
      ) : null}

      {messageErreur !== undefined && !horsLigne && espace !== null ? (
        <div className="mb-4">
          <BlocErreur message={messageErreur} />
        </div>
      ) : null}

      {contenu}
    </AppShell>
  );
}
