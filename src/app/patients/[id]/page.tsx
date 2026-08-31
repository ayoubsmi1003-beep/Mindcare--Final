/**
 * Fiche patient — le poste 360°.
 *
 * ⚠️ INTROUVABLE ET HORS PÉRIMÈTRE SONT INDISCERNABLES, ET C'EST LE POINT LE
 * PLUS IMPORTANT DE CET ÉCRAN. `app.get_patient_workspace` rend NULL dans les
 * deux cas ; un seul message (`fr.patients.ficheIntrouvable`). Ne jamais
 * « améliorer » ce comportement — distinguer fabriquerait un oracle
 * d'existence (ADR-003).
 *
 * I4 — la lecture est journalisée PAR LA BASE : la porte écrit sa trace
 * `fiche` avant de retourner. Cet écran ne journalise rien lui-même.
 *
 * ═══ UN APPEL À L'OUVERTURE, LE RESTE À LA DEMANDE ════════════════════════
 * L'ouverture coûte UN appel (`getPatientWorkspace`, budget PERF §2). La
 * chronologie et les documents lisent à l'ouverture de LEUR onglet. La
 * génération du résumé part APRÈS le rendu, sur geste explicite — l'IA ne
 * bloque jamais l'écran et dispose d'un repli déterministe.
 *
 * ═══ CONTEXTE JARVIS ══════════════════════════════════════════════════════
 * Le dossier ouvert est publié dans `patient-actif` pour pré-résoudre la
 * CIBLE des outils — jamais une autorisation (L3). Le cleanup React EFFACE le
 * contexte au démontage : naviguer de A vers B ne laisse jamais A actif.
 *
 * Aucune décision d'autorisation ici : les onglets cliniques manquent quand
 * la base rend null (décision de COMPOSITION), pas un seul `if (role === …)`.
 */

"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { SectionDocumentsPatient } from "@/components/documents/SectionDocumentsPatient";
import { BandeauAujourdhui } from "@/components/patients/BandeauAujourdhui";
import { CarteResumeCas, type ResumeEtat } from "@/components/patients/CarteResumeCas";
import { CarteIdentite } from "@/components/patients/CarteIdentite";
import { ChronologiePatient } from "@/components/patients/ChronologiePatient";
import {
  ListeSignaux,
  PointDeSituation,
  SectionDepuisDerniere,
} from "@/components/patients/SectionsDeterministes";
import { EnTeteCollant, type ActionDominante } from "@/components/patients/EnTeteCollant";
import { RetourListe } from "@/components/patients/EnTetePatient";
import { FormulaireModification } from "@/components/patients/FormulaireModification";
import { PanneauClinique } from "@/components/patients/PanneauClinique";
import {
  CarteProchaineEcheance,
  PanneauRendezVous,
} from "@/components/patients/PanneauRendezVous";
import { PanneauTraitements } from "@/components/patients/PanneauTraitements";
import {
  BandeauHorsLigne,
  BlocErreur,
  Bouton,
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
  definirPatientActif,
  effacerPatientActif,
} from "@/services/patient-actif";
import { genererResumeCas } from "@/services/resume-cas";
import { startConsultation } from "@/services/consultations";
import type { SourceResume } from "@/services/patients";
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
  /** L'historique se déplie dans le fil, sur geste — jamais à l'ouverture. */
  const [historiqueOuvert, setHistoriqueOuvert] = useState(false);

  const [resumeEtat, setResumeEtat] = useState<ResumeEtat>({
    resume: null,
    generationEnCours: false,
    indisponible: false,
  });
  // Le premier workspace portait-il un résumé ? Sert à ne PAS afficher
  // « indisponible » avant toute tentative quand il n'y a simplement
  // encore rien généré.
  const [premierChargement, setPremierChargement] = useState(true);

  const [enModification, setEnModification] = useState<Patient | null>(null);
  const [erreurModification, setErreurModification] = useState<string | undefined>(undefined);

  // ⚠️ « ÉCHEC DE LECTURE DE LA SESSION » N'EST PAS « AUCUNE SESSION » — voir
  // patients/page.tsx. Hors ligne, rediriger éjecterait la praticienne du
  // dossier qu'elle lit (I20).
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
      setResumeEtat((s) => ({
        ...s,
        resume: result.data?.resume ?? null,
        generationEnCours: false,
      }));
    });
    return () => {
      annule = true;
    };
  }, [id]);

  // ── Contexte patient actif — publication + effacement GARANTI. ──────────
  useEffect(() => {
    if (espace !== null && espace !== undefined) {
      definirPatientActif({
        id: espace.identite.id,
        nom: `${espace.identite.lastName.toUpperCase()} ${espace.identite.firstName}`,
        numero: espace.identite.recordNumber,
      });
    }
    return () => {
      effacerPatientActif();
    };
  }, [espace]);

  function deconnecter(): void {
    effacerPatientActif();
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
    void getPatientWorkspace(id).then((result) => {
      if (result.ok && result.data !== null) setEspace(result.data);
    });
  }

  // ── Génération du résumé — post-rendu, repli honnête sur échec. ─────────
  const generer = useCallback((): void => {
    void genererResumeCas(id).then((result) => {
      if (result.ok) {
        setResumeEtat({
          resume: result.data.resume,
          generationEnCours: false,
          indisponible: false,
        });
      } else {
        setResumeEtat((s) => ({ ...s, generationEnCours: false, indisponible: true }));
      }
    });
  }, [id]);

  // ── Action dominante — cartographie HONNÊTE des portes existantes. ──────
  function dominante(espace: PatientWorkspace): ActionDominante | null {
    const rdvDuJour = espace.rendezVousDuJour.find(
      (r) => r.status === "confirmed" || r.status === "arrived" || r.status === "requested",
    );
    if (rdvDuJour !== undefined) {
      return {
        libelle: fr.actions.demarrerLaSeance,
        onClick: () => {
          void startConsultation({ patientId: id, appointmentId: rdvDuJour.id }).then((res) => {
            if (res.ok) router.push(`/consultation/${res.data}`);
            else setMessageErreur(res.error.message);
          });
        },
      };
    }
    return {
      libelle: fr.patients.actions.nouveauRendezVous,
      href: `/agenda/nouveau?patient=${encodeURIComponent(id)}`,
    };
  }

  /** Preuve → fait : bascule sur l'onglet qui porte la source citée. */
  function ouvrirSource(source: SourceResume): void {
    switch (source.t) {
      case "diagnostic":
      case "echelle":
        setOnglet("clinique");
        break;
      case "prescription":
        setOnglet("traitements");
        break;
      case "consultation":
        setOnglet("chronologie");
        break;
      case "rdv":
        setOnglet("rendezVous");
        break;
      case "document":
        setOnglet("documents");
        break;
    }
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

    if (messageErreur !== undefined && espace === null) {
      return <BlocErreur message={messageErreur} />;
    }

    if (espace === undefined) return <Squelette lignes={8} />;

    if (espace === null) {
      /* Dossier inexistant OU hors périmètre — un seul message, voir en-tête. */
      return <EtatVide message={fr.patients.ficheIntrouvable} icone="patients" action={<RetourListe />} />;
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

    const onglets: readonly Onglet[] = [
      { cle: "vueDEnsemble", libelle: fr.patients.onglets.vueDEnsemble, icone: "patients" },
      ...(espace.clinique === null
        ? []
        : ([
            { cle: "chronologie", libelle: fr.patients.onglets.chronologie, icone: "suivi" },
            { cle: "clinique", libelle: fr.patients.onglets.clinique, icone: "statistiques" },
          ] as const)),
      ...((espace.traitements === null && (espace.traitementsV2 === null || espace.traitementsV2 === undefined))
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

    const actif = onglets.some((o) => o.cle === onglet) ? onglet : "vueDEnsemble";

    // Le Point de situation n'apparaît QUE si l'IA a échoué sans résumé
    // valide à montrer — sinon c'est du bruit sur une page déjà complète.
    const montrerPointSituation = resumeEtat.indisponible && resumeEtat.resume === null;

    return (
      <article className="flex flex-col gap-4">
        <EnTeteCollant
          espace={espace}
          dominante={dominante(espace)}
          onJarvis={() => {
            window.dispatchEvent(
              new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
            );
          }}
          onModifier={ouvrirModification}
        />

        <BandeauAujourdhui espace={espace} />

        <div>
          <Onglets
            onglets={onglets}
            actif={actif}
            onChanger={(cle) => setOnglet(cle as CleOnglet)}
            etiquette={fr.patients.titre}
          />

          {/* UN SEUL panneau monté à la fois — chaque lecture doit avoir été
              demandée (règle 6). */}
          <PanneauOnglet cle={actif}>
            {actif === "vueDEnsemble" ? (
              /* ⚠️ UN SEUL FIL DE LECTURE, ET C'EST TOUT L'ENJEU DE L'ÉCRAN.
                 La colonne de droite mettait l'identité et la prochaine
                 échéance EN CONCURRENCE avec l'histoire de la patiente : deux
                 points d'entrée, deux rythmes, et l'œil qui recommence. Ce qui
                 y vivait n'a pas disparu — l'identité est déjà dans l'en-tête
                 collant, qui la suit pendant tout le défilement, et l'échéance
                 a rejoint le fil, à sa place chronologique. Il reste une
                 lecture : qui, où en est-on, et ce qui s'est passé. */
              <div className="mx-auto flex w-full max-w-lecture min-w-0 flex-col gap-8">
                <CarteResumeCas
                  etat={{
                    ...resumeEtat,
                    resume: resumeEtat.resume ?? espace.resume ?? null,
                  }}
                  onEtatChange={setResumeEtat}
                  onGenerer={generer}
                  onOuvrirSource={ouvrirSource}
                />
                {montrerPointSituation ? <PointDeSituation espace={espace} /> : null}
                <SectionDepuisDerniere espace={espace} />
                <ListeSignaux espace={{ ...espace, resume: resumeEtat.resume ?? espace.resume }} />
                <CarteProchaineEcheance agenda={espace.agenda} documents={espace.documents} />

                {/* L'ADMINISTRATIF EN BAS, ET C'EST UN CHOIX DE HIÉRARCHIE, PAS
                    UN OUBLI. Téléphone, adresse, pièce d'identité : on en a
                    besoin quelques fois par mois, et cette grille de dix champs
                    occupait la colonne de droite en permanence, à hauteur d'œil,
                    en concurrence avec l'histoire de la patiente. Ce qui sert à
                    chaque ouverture — nom, âge, sexe, numéro de dossier — est
                    dans l'en-tête collant, visible pendant tout le défilement. */}
                <CarteIdentite espace={espace} />

                {/* L'HISTORIQUE FERME LE FIL, ET IL EST L'ÉPINE DORSALE :
                    chaque consultation s'y ouvre d'un clic. Il ne se charge
                    QUE sur demande — voir `fr.patients.actions.afficherHistorique`
                    et l'en-tête de `ChronologiePatient`. */}
                <section className="flex flex-col gap-4 border-t border-rule pt-6">
                  <h2 className="font-ui text-heading font-semibold tracking-heading text-ink-900">
                    {fr.patients.onglets.chronologie}
                  </h2>
                  {historiqueOuvert ? (
                    <ChronologiePatient patientId={espace.identite.id} />
                  ) : (
                    <span>
                      <Bouton rang="secondaire" onClick={() => setHistoriqueOuvert(true)}>
                        {fr.patients.actions.afficherHistorique}
                      </Bouton>
                    </span>
                  )}
                </section>
              </div>
            ) : null}

            {actif === "chronologie" ? <ChronologiePatient patientId={espace.identite.id} /> : null}

            {actif === "clinique" && espace.clinique !== null ? (
              <PanneauClinique clinique={espace.clinique} />
            ) : null}

            {actif === "traitements" && (espace.traitements !== null || espace.traitementsV2 !== null) ? (
              <PanneauTraitements
                traitements={espace.traitements}
                traitementsV2={espace.traitementsV2 ?? null}
                patientId={espace.identite.id}
                onRefresh={() => {
                  void getPatientWorkspace(id).then((res) => {
                    if (res.ok && res.data) setEspace(res.data);
                  });
                }}
              />
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
      /*
        LE CHROME NOMME TOUJOURS LE DOSSIER OUVERT, ET C'EST UNE PROPRIETE DE
        SECURITE AUTANT QUE DE LISIBILITE. Sans ce titre, la barre affichait
        « Patients » — deduit du segment de route — pendant qu'on lisait le
        dossier de quelqu'un. Dans une salle ou le patient suivant s'assoit
        devant l'ecran, savoir en permanence QUEL dossier est ouvert vaut la
        repetition du nom entre le chrome et l'en-tete de la fiche.
      */
      {...(espace == null
        ? {}
        : {
            titre: `${espace.identite.lastName.toUpperCase()} ${espace.identite.firstName}`,
            sousTitre: espace.identite.recordNumber,
          })}
    >
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
