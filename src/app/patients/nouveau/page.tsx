/**
 * Nouveau dossier — la création de patient.
 *
 * ⚠️ UNE PAGE, DEUX SOURCES DE DONNÉES, TOUTES DEUX DÉBOUNCÉES OU À LA
 * DEMANDE :
 *   · `find_similar_patients` à 300 ms de pause — CHAQUE appel écrit une trace
 *     `recherche` dans `audit.log` (I4) ; frappe par frappe noierait le journal.
 *   · l'annuaire des praticiennes, UNIQUEMENT quand le sélecteur s'affiche
 *     (composition assistante, I12) — pas un appel de plus pour les autres.
 *
 * ⚠️ AUCUNE DÉCISION D'AUTORISATION ICI. Le rôle ne sert qu'à composer
 * (`selectionPraticienRequise`) ; qui peut créer et pour quel praticien est
 * tranché par la porte `app.create_patient` et les policies 004. Si
 * l'assistante cachait son navigateur pour forcer le chemin praticien, la base
 * répondrait « Praticien responsable introuvable » — fail secure.
 *
 * Après création : redirection vers le dossier. Pas de Toast (primitive
 * reportée à V4, dette assumée) : le geste suivant — consulter le dossier créé
 * — EST la confirmation.
 */

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { FormulaireCreation } from "@/components/patients/FormulaireCreation";
import { PanneauSimilaires } from "@/components/patients/PanneauSimilaires";
import {
  BandeauHorsLigne,
  BlocErreur,
  Squelette,
} from "@/components/ui";
import { fr } from "@/i18n/fr";
import { getSession, signOut } from "@/services/auth";
import { purgerContexteSession } from "@/services/conversation";
import { getCurrentUser, type CurrentUser } from "@/services/authz";
import { listPractitioners, type Practitioner } from "@/services/practitioners";
import {
  chercherPatientsSimilaires,
  doublonFort,
  type CandidatSimilaire,
  type Patient,
} from "@/services/patients";

/** Voir patients/page.tsx — chaque appel écrit une trace d'audit. */
const DEBOUNCE_SIMILAIRES_MS = 300;

export default function PageNouveauDossier(): React.JSX.Element {
  const router = useRouter();
  const [utilisateur, setUtilisateur] = useState<CurrentUser | null | undefined>(undefined);
  const [horsLigne, setHorsLigne] = useState(false);

  // La saisie brute vit ici ; la RECHERCHE travaille sur l'instantané débouncé.
  const [prenomSaisi, setPrenomSaisi] = useState("");
  const [nomSaisi, setNomSaisi] = useState("");
  const [telephoneSaisi, setTelephoneSaisi] = useState("");
  const [naissanceSaisie, setNaissanceSaisie] = useState("");

  const [candidats, setCandidats] = useState<readonly CandidatSimilaire[]>([]);
  const [verification, setVerification] = useState(false);
  const [erreurSimilaires, setErreurSimilaires] = useState<string | undefined>(undefined);

  const [praticiens, setPraticiens] = useState<readonly Practitioner[]>([]);

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

  // L'annuaire ne part que si la composition en a besoin (I12).
  useEffect(() => {
    if (utilisateur?.role !== "assistant") return;
    let annule = false;
    void listPractitioners().then((result) => {
      if (annule) return;
      if (result.ok) setPraticiens(result.data);
    });
    return () => {
      annule = true;
    };
  }, [utilisateur?.role]);

  function chiffres(valeur: string): string {
    return valeur.replace(/[^0-9]/g, "");
  }

  /**
   * Le formulaire remonte ses quatre champs de saisie ICI (défaut n°2 de la
   * clôture V3 : rien n'alimentait ces états, `rechercheActive` restait figé
   * à faux et le garde doublon était du code mort). Les validations restent
   * dans le formulaire ; la base (23505) reste l'autorité finale.
   */
  function surSaisie(
    champ: "prenom" | "nom" | "telephone" | "naissance",
    valeur: string,
  ): void {
    if (champ === "prenom") setPrenomSaisi(valeur);
    else if (champ === "nom") setNomSaisi(valeur);
    else if (champ === "telephone") setTelephoneSaisi(valeur);
    else setNaissanceSaisie(valeur);
  }

  // Le seuil d'ACTIVATION, distinct du débounce : chercher sur une lettre
  // coûterait une trace d'audit pour un bruit de résultats.
  const rechercheActive =
    nomSaisi.trim().length >= 2 ||
    prenomSaisi.trim().length >= 2 ||
    chiffres(telephoneSaisi).length >= 6 ||
    naissanceSaisie !== "";

  useEffect(() => {
    if (!rechercheActive) {
      setCandidats([]);
      setVerification(false);
      setErreurSimilaires(undefined);
      return;
    }
    setVerification(true);
    const minuteur = setTimeout(() => {
      let annule = false;
      void chercherPatientsSimilaires({
        ...(prenomSaisi.trim() !== "" ? { prenom: prenomSaisi.trim() } : {}),
        ...(nomSaisi.trim() !== "" ? { nom: nomSaisi.trim() } : {}),
        ...(chiffres(telephoneSaisi).length > 0 ? { telephone: telephoneSaisi } : {}),
        ...(naissanceSaisie !== "" ? { naissance: naissanceSaisie } : {}),
      }).then((result) => {
        if (annule) return;
        setVerification(false);
        if (!result.ok) {
          if (result.error.code !== "hors-ligne") {
            setErreurSimilaires(result.error.message);
          }
          return;
        }
        setErreurSimilaires(undefined);
        setCandidats(result.data);
      });
      return () => {
        annule = true;
      };
    }, DEBOUNCE_SIMILAIRES_MS);
    return () => {
      clearTimeout(minuteur);
    };
    // L'instantané est relu au debounce uniquement ; toutes les saisies
    // figurent dans les dépendances.
  }, [
    prenomSaisi,
    nomSaisi,
    telephoneSaisi,
    naissanceSaisie,
    rechercheActive,
  ]);

  function deconnecter(): void {
    // Phase 3 : aucun contexte patient ne survit à la session.
    purgerContexteSession();
    void signOut().then(() => {
      router.replace("/connexion");
    });
  }

  function apresCree(patient: Patient): void {
    router.push(`/patients/${patient.id}`);
  }

  if (utilisateur === undefined) {
    return (
      <main className="p-8">
        <Squelette lignes={6} />
      </main>
    );
  }

  const fortePresente = candidats.some(doublonFort);

  return (
    <AppShell
      role={utilisateur?.role ?? "assistant"}
      nomComplet={utilisateur?.fullName ?? ""}
      onDeconnexion={deconnecter}
      titre={fr.patients.creation.titre}
      sousTitre={fr.patients.creation.sousTitre}
    >
      {horsLigne ? (
        <div className="my-4">
          <BandeauHorsLigne />
        </div>
      ) : null}

      {erreurSimilaires !== undefined ? (
        <div className="mt-4">
          <BlocErreur message={erreurSimilaires} />
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-fiche items-start gap-6">
        <FormulaireCreation
          selectionPraticienRequise={utilisateur?.role === "assistant"}
          {...(utilisateur?.role === "assistant" ? { praticiens } : {})}
          creationFermee={fortePresente}
          onCree={apresCree}
          onSaisie={surSaisie}
        />

        <div className="tablet:sticky tablet:top-6">
          <PanneauSimilaires
            candidats={candidats}
            verification={verification}
            actif={rechercheActive}
          />
        </div>
      </div>
    </AppShell>
  );
}
