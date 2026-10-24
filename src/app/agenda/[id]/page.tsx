/**
 * Rendez-vous — détail, modification, annulation.
 *
 * ⚠️ INTROUVABLE ET HORS PÉRIMÈTRE SONT INDISCERNABLES, ET C'EST LE POINT LE
 * PLUS IMPORTANT DE CET ÉCRAN. `app.get_appointment` rend zéro ligne dans les
 * deux cas et `getAppointment` rend `ok(null)` sans distinguer lequel. Afficher
 * « ce rendez-vous ne vous est pas accessible » confirmerait à une praticienne
 * l'EXISTENCE d'une consultation chez sa consœur — une fuite par le message
 * d'erreur, sans qu'aucune donnée n'ait été lue. Un seul message pour les deux
 * situations. Ne jamais « améliorer » ce comportement.
 *
 * ⚠️ CE QUI N'EST PAS MODIFIABLE ICI L'EST PARCE QUE LA BASE LE REFUSE, pas
 * parce que le formulaire l'omet. `app.update_appointment` porte une allowlist
 * de quatre champs — `starts_at`, `duration_minutes`, `notes_admin`, `kind` ;
 * `patient_id`, `practitioner_id`, `cabinet_id` et `status` en sont exclus pour
 * qu'une modification de routine ne puisse pas réattribuer un rendez-vous d'une
 * praticienne à l'autre (ADR-003). Ajouter le champ à ce formulaire ne
 * l'ouvrirait pas — la porte lèverait une exception, et c'est le but.
 *
 * `status` fait exception PAR SES PROPRES PORTES, pas par l'allowlist :
 * `app.confirm_appointment` et `app.cancel_appointment` nomment chacune leur
 * transition. Chaque changement d'état est ainsi un geste explicite, jamais un
 * effet de bord d'une mise à jour de routine.
 *
 * ⚠️ L'ANNULATION N'EST PAS UNE SUPPRESSION. Le clinique est en ajout seul : le
 * rendez-vous reste, marqué `Annulé`, avec son historique dans `audit.log`. Un
 * rendez-vous terminé ne s'annule pas, et un déclencheur le refuse — pas ce
 * fichier.
 *
 * Le MOTIF D'ANNULATION va dans les notes administratives, visibles de
 * l'assistante — c'est elle qui rappelle le patient. Le champ le dit à l'écran,
 * pour que personne n'y écrive de clinique (ADR-017).
 */

"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import {
  jourComplet,
  nomPatient,
  plage,
  Statut,
  versIso,
  versSaisieLocale,
} from "@/components/AgendaPieces";
import {
  BandeauHorsLigne,
  BarreActions,
  BlocErreur,
  Bouton,
  Carte,
  ChampSelection,
  ChampTexte,
  ChampZoneTexte,
  EtatVide,
  LienBouton,
} from "@/components/ui";
import { useSessionEcran } from "@/components/useSessionEcran";
import { fr } from "@/i18n/fr";
import {
  cancelAppointment,
  confirmAppointment,
  getAppointment,
  updateAppointment,
  type AgendaEntry,
  type ConsultationKind,
} from "@/services/appointments";
import { startConsultation } from "@/services/consultations";

/** Les treize types, dans l'ordre fourni par le cabinet (cf. `/agenda/nouveau`). */
const TYPES_ORDONNES = [
  "premiere_consultation",
  "suivi",
  "psychotherapie_individuelle",
  "therapie_couple",
  "therapie_familiale",
  "therapie_groupe",
  "teleconsultation",
  "certificat_medical",
  "renouvellement_ordonnance",
  "evaluation_psychiatrique",
  "bilan_psychologique",
  "entretien_famille",
  "entretien_tiers",
] as const satisfies readonly ConsultationKind[];

const champStyle: React.CSSProperties = {
  minHeight: "var(--target-min)",
  padding: "var(--s-2) var(--s-4)",
  borderRadius: "var(--r-md)",
  border: "var(--rule-width) solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink-900)",
  fontSize: "var(--text-body-size)",
  lineHeight: "var(--text-body-leading)",
  fontFamily: "var(--font-ui)",
  width: "var(--size-full)",
};

const ISSUES_APPEL = [
  { cle: "joint", libelle: fr.agenda.demande.joint },
  { cle: "sans_reponse", libelle: fr.agenda.demande.sansReponse },
  { cle: "rappel", libelle: fr.agenda.demande.rappel },
  { cle: "mauvais_numero", libelle: fr.agenda.demande.mauvaisNumero },
] as const;

type IssueAppel = (typeof ISSUES_APPEL)[number]["cle"];

const libelleStyle: React.CSSProperties = {
  fontSize: "var(--text-label-size)",
  lineHeight: "var(--text-label-leading)",
  letterSpacing: "var(--text-label-tracking)",
  fontWeight: "var(--weight-medium)",
  color: "var(--ink-500)",
};

export default function PageRendezVous(): React.JSX.Element {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { utilisateur, horsLigne: horsLigneSession, deconnecter } = useSessionEcran();

  const [rdv, setRdv] = useState<AgendaEntry | null | undefined>(undefined);
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);
  const [confirmation, setConfirmation] = useState<string | undefined>(undefined);
  const [horsLigne, setHorsLigne] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  const [edition, setEdition] = useState(false);
  const [debutLocal, setDebutLocal] = useState("");
  const [duree, setDuree] = useState("");
  const [notes, setNotes] = useState("");
  const [kind, setKind] = useState<ConsultationKind | "">("");

  const [annulationOuverte, setAnnulationOuverte] = useState(false);
  const [motif, setMotif] = useState("");

  /** Issue de l'appel choisie, puis enregistrée dans `notes_admin` (journalisée). */
  const [issueAppel, setIssueAppel] = useState<IssueAppel | "">("");
  const [appelEnregistre, setAppelEnregistre] = useState(false);

  // Attend que la session soit tranchée : la porte journalise CHAQUE appel, et
  // interroger pour un visiteur qu'on redirige écrirait une trace de lecture
  // pour une consultation qui n'a pas eu lieu.
  useEffect(() => {
    if (utilisateur === undefined) return;
    let annule = false;
    void getAppointment(id).then((result) => {
      if (annule) return;
      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        setMessageErreur(result.error.message);
        setRdv(null);
        return;
      }
      setHorsLigne(false);
      setMessageErreur(undefined);
      setRdv(result.data);
      if (result.data !== null) {
        setDebutLocal(versSaisieLocale(result.data.startsAt));
        setDuree(String(result.data.durationMinutes));
        setNotes(result.data.notesAdmin ?? "");
        setKind(result.data.kind ?? "");
      }
    });
    return () => {
      annule = true;
    };
  }, [id, utilisateur]);

  /**
   * Une issue déjà écrite dans la note (rechargement, retour sur la page)
   * autorise la confirmation sans refaire le geste. On la reconnaît au préfixe
   * canonique « Appel », jamais à une heuristique de texte libre.
   */
  useEffect(() => {
    if (rdv === undefined || rdv === null) return;
    setAppelEnregistre((rdv.notesAdmin ?? "").includes("Appel "));
  }, [rdv]);

  function recharger(): void {
    void getAppointment(id).then((result) => {
      if (result.ok) {
        setRdv(result.data);
        if (result.data !== null) {
          setDebutLocal(versSaisieLocale(result.data.startsAt));
          setDuree(String(result.data.durationMinutes));
          setNotes(result.data.notesAdmin ?? "");
          setKind(result.data.kind ?? "");
        }
      }
    });
  }

  function approuver(): void {
    setMessageErreur(undefined);
    setConfirmation(undefined);
    setEnvoi(true);
    void confirmAppointment(id).then((result) => {
      setEnvoi(false);
      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        setMessageErreur(result.error.message);
        return;
      }
      if (!result.data) {
        setMessageErreur(fr.agenda.introuvable);
        return;
      }
      setConfirmation(fr.agenda.demandeApprouvee);
      recharger();
    });
  }

  /**
   * Enregistre l'issue de l'appel dans la note administrative existante.
   *
   * ⚠️ PAS DE NOUVELLE COLONNE. Le schéma n'a pas de `contact_outcome`, et la
   * règle 9 interdit d'en ajouter sans décision humaine. La note est déjà
   * auditée par `trg_audit`, visible de l'accueil, et le préfixe « Appel » est
   * le seul contrat de reconnaissance. La date est écrite en heure locale du
   * poste, comme le reste de l'écran.
   */
  function enregistrerAppel(): void {
    if (rdv === null || rdv === undefined || issueAppel === "") {
      setMessageErreur(fr.agenda.demande.issueRequise);
      return;
    }
    const libelle = ISSUES_APPEL.find((issue) => issue.cle === issueAppel)?.libelle;
    if (libelle === undefined) {
      setMessageErreur(fr.agenda.demande.issueRequise);
      return;
    }

    setMessageErreur(undefined);
    setConfirmation(undefined);
    setEnvoi(true);

    const horodatage = new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date());
    const ligne = `Appel ${horodatage} — ${libelle}`;
    const notesAdmin = [rdv.notesAdmin, ligne]
      .filter((valeur): valeur is string => valeur !== null && valeur.trim() !== "")
      .join("\n");

    void updateAppointment(id, {
      startsAt: rdv.startsAt,
      durationMinutes: rdv.durationMinutes,
      kind: rdv.kind,
      notesAdmin,
    }).then((result) => {
      setEnvoi(false);
      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        setMessageErreur(result.error.message);
        return;
      }
      if (!result.data) {
        setMessageErreur(fr.agenda.introuvable);
        return;
      }
      setAppelEnregistre(true);
      setConfirmation(fr.agenda.demande.appelEnregistre);
      recharger();
    });
  }

  /**
   * Ouvre la séance et s'y rend.
   *
   * La porte est IDEMPOTENTE sur un même rendez-vous : rejouée, elle rend la
   * séance déjà ouverte au lieu de heurter l'index `one_open_consult` (026).
   * Un double clic ou un retour arrière ne produit donc pas d'erreur illisible,
   * et « Reprendre la séance » emprunte exactement le même chemin que
   * « Démarrer la séance ».
   */
  function demarrerLaSeance(): void {
    setMessageErreur(undefined);
    setConfirmation(undefined);

    const patientId = rdv?.patientId;
    if (patientId == null) {
      // Sans dossier rattaché, la note n'aurait aucun patient. Le bouton n'est
      // pas rendu dans ce cas ; ce garde existe pour le chemin que le typage
      // ne peut pas fermer.
      setMessageErreur(fr.agenda.patientNonRattache);
      return;
    }

    setEnvoi(true);
    void startConsultation({ patientId, appointmentId: id }).then((result) => {
      setEnvoi(false);
      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        setMessageErreur(result.error.message);
        return;
      }
      router.push(`/consultation/${result.data}`);
    });
  }

  function enregistrer(): void {
    setMessageErreur(undefined);
    setConfirmation(undefined);

    const debutIso = versIso(debutLocal);
    const dureeMinutes = Number.parseInt(duree, 10);
    if (debutIso === null || Number.isNaN(dureeMinutes)) {
      setMessageErreur(fr.erreurs["regle-metier"]);
      return;
    }

    setEnvoi(true);
    void updateAppointment(id, {
      startsAt: debutIso,
      durationMinutes: dureeMinutes,
      // `null` EFFACE, une propriété absente ne change rien. Vider le champ à
      // l'écran doit donc vider la note en base, pas la laisser telle quelle.
      notesAdmin: notes.trim() === "" ? null : notes.trim(),
      // `null` remet le type à « non renseigné ». Un rendez-vous mal typé doit
      // pouvoir redevenir vide plutôt que de garder une valeur fausse.
      kind: kind === "" ? null : kind,
    }).then((result) => {
      setEnvoi(false);
      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        setMessageErreur(result.error.message);
        return;
      }
      if (!result.data) {
        // Aucune ligne touchée : le rendez-vous a disparu du périmètre entre
        // l'affichage et l'envoi. On le dit plutôt que d'annoncer un succès.
        setMessageErreur(fr.agenda.introuvable);
        return;
      }
      setEdition(false);
      setConfirmation(fr.feedback.rendezVousEnregistre);
      recharger();
    });
  }

  function annulerLeRendezVous(): void {
    setMessageErreur(undefined);
    setConfirmation(undefined);

    if (motif.trim() === "") {
      setMessageErreur(fr.erreurs["regle-metier"]);
      return;
    }

    setEnvoi(true);
    void cancelAppointment(id, motif.trim()).then((result) => {
      setEnvoi(false);
      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        setMessageErreur(result.error.message);
        return;
      }
      if (!result.data) {
        setMessageErreur(fr.agenda.introuvable);
        return;
      }
      setAnnulationOuverte(false);
      setMotif("");
      setConfirmation(fr.feedback.rendezVousAnnule);
      recharger();
    });
  }

  if (utilisateur === undefined || rdv === undefined) {
    return (
      <main style={{ padding: "var(--s-8)", fontFamily: "var(--font-ui)", color: "var(--ink-500)" }}>
        {fr.etats.chargement}
      </main>
    );
  }

  return (
    <AppShell
      role={utilisateur?.role ?? "assistant"}
      nomComplet={utilisateur?.fullName ?? ""}
      onDeconnexion={deconnecter}
      titre={
        rdv == null
          ? fr.nav.ecrans.agenda
          : (nomPatient(rdv.lastName, rdv.firstName) ?? fr.agenda.patientNonRattache)
      }
      {...(rdv == null
        ? {}
        : (() => {
            const j = jourComplet(rdv.startsAt);
            return j === null ? {} : { sousTitre: j };
          })())}
      {...(rdv == null ? {} : { actions: <Statut statut={rdv.status} /> })}
    >
      {horsLigne || horsLigneSession ? <BandeauHorsLigne /> : null}

      {rdv === null ? (
        <div className="flex flex-col gap-6">
          {messageErreur !== undefined && !horsLigne ? (
            <BlocErreur message={messageErreur} />
          ) : (
            <EtatVide
              message={fr.agenda.introuvable}
              action={<LienBouton href="/agenda">{fr.agenda.retourALAgenda}</LienBouton>}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {/* Une confirmation est un FAIT ACQUIS : ton positif, `role="status"`
              pour qu'un lecteur d'écran l'annonce sans couper la parole. */}
          {confirmation !== undefined ? (
            <p
              role="status"
              className="rounded-md border border-positive bg-positive-bg px-4 py-3 font-ui text-body text-positive"
            >
              {confirmation}
            </p>
          ) : null}

          {messageErreur !== undefined && !horsLigne ? <BlocErreur message={messageErreur} /> : null}

          {/* ── Demande web : appeler, consigner, fixer, confirmer ────────── */}
          {rdv.status === "requested" ? (
            <section
              aria-label={fr.agenda.demande.titre}
              className="rounded-xl border border-attention bg-attention-bg p-4"
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 font-ui text-title font-semibold tracking-title text-ink-900">
                    {fr.agenda.demande.titre}
                  </h2>
                  <p className="m-0 mt-1 font-ui text-body text-ink-700">
                    {fr.agenda.demande.aide}
                  </p>
                </div>
                {rdv.phone !== null ? (
                  <a
                    href={`tel:${rdv.phone}`}
                    className="inline-flex min-h-target items-center gap-2 rounded-full border border-rule bg-card px-4 font-ui text-body font-semibold text-ink-900 no-underline shadow-douce transition duration-quick ease-out hover:border-ink-300 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
                  >
                    {fr.agenda.demande.appeler}
                    <span className="font-num tabular-nums">{rdv.phone}</span>
                  </a>
                ) : (
                  <span className="font-ui text-label text-ink-500">
                    {fr.agenda.demande.telephoneAbsent}
                  </span>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="font-ui text-label font-medium text-ink-700">
                  {fr.agenda.demande.appel}
                </span>
                {ISSUES_APPEL.map((issue) => (
                  <button
                    key={issue.cle}
                    type="button"
                    aria-pressed={issueAppel === issue.cle}
                    onClick={() => {
                      setIssueAppel(issue.cle);
                      setAppelEnregistre(false);
                    }}
                    className={[
                      "inline-flex min-h-target items-center justify-center rounded-full border px-3 py-1.5 font-ui text-label font-medium",
                      "transition duration-quick ease-out outline-none",
                      "focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
                      issueAppel === issue.cle
                        ? "border-attention bg-card text-attention-ink shadow-douce"
                        : "border-rule bg-transparent text-ink-700 hover:bg-card",
                    ].join(" ")}
                  >
                    {issue.libelle}
                  </button>
                ))}
                <Bouton
                  rang="secondaire"
                  taille="compact"
                  onClick={enregistrerAppel}
                  disabled={envoi || issueAppel === "" || appelEnregistre}
                >
                  {fr.agenda.demande.enregistrerAppel}
                </Bouton>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-attention pt-3">
                <Bouton
                  rang="secondaire"
                  taille="compact"
                  onClick={() => {
                    setEdition(true);
                    setAnnulationOuverte(false);
                  }}
                  disabled={envoi}
                >
                  {fr.agenda.demande.modifierCreneau}
                </Bouton>
                <Bouton
                  rang="principal"
                  taille="compact"
                  onClick={approuver}
                  disabled={envoi || !appelEnregistre || edition}
                >
                  {fr.agenda.demande.confirmer}
                </Bouton>
                {edition ? (
                  <span className="font-ui text-label text-attention-ink">
                    {fr.agenda.demande.enregistrerCreneauDabord}
                  </span>
                ) : !appelEnregistre ? (
                  <span className="font-ui text-label text-attention-ink">
                    {issueAppel === ""
                      ? fr.agenda.demande.issueRequise
                      : fr.agenda.demande.confirmerDabord}
                  </span>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* ── Lecture ──────────────────────────────────────────────────── */}
          {!edition ? (
            <Carte>
              <div className="p-6">
                {/* Huit champs, UNE surface. Huit cartes `bg-sunken` dans une
                    carte blanche faisaient huit boîtes pour huit paires
                    libellé/valeur : la hiérarchie disparaissait au profit du
                    quadrillage. Un simple filet supérieur sépare les lignes. */}
                <dl className="m-0 grid grid-cols-1 gap-x-8 gap-y-5 tablet:grid-cols-4">
                  <ChampAgenda libelle={fr.agenda.date} valeur={jourComplet(rdv.startsAt)} />
                  <ChampAgenda libelle={fr.agenda.heure} valeur={plage(rdv.startsAt, rdv.endsAt)} />
                  <ChampAgenda
                    libelle={fr.agenda.duree}
                    valeur={`${rdv.durationMinutes} ${fr.agenda.dureeUnite}`}
                  />
                  <ChampAgenda libelle={fr.agenda.praticienne} valeur={rdv.practitionerName} />
                  <ChampAgenda libelle={fr.patients.numeroDossier} valeur={rdv.recordNumber} />
                  <ChampAgenda libelle={fr.patients.telephone} valeur={rdv.phone} />
                  <ChampAgenda
                    libelle={fr.agenda.typeConsultation}
                    valeur={rdv.kind === null ? null : fr.agenda.types[rdv.kind]}
                  />
                  <ChampAgenda libelle={fr.agenda.origine} valeur={fr.agenda.origines[rdv.source]} />
                  <ChampAgenda
                    libelle={fr.agenda.notesAdministratives}
                    valeur={rdv.notesAdmin}
                  />
                </dl>
              </div>
            </Carte>
          ) : null}

          {/* ── Modification ─────────────────────────────────────────────── */}
          {edition ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                enregistrer();
              }}
              className="flex max-w-form flex-col gap-5"
            >
              <ChampTexte
                libelle={`${fr.agenda.date} · ${fr.agenda.heure}`}
                type="datetime-local"
                valeur={debutLocal}
                onChange={setDebutLocal}
              />

              <ChampTexte
                libelle={`${fr.agenda.duree} (${fr.agenda.dureeUnite})`}
                type="number"
                valeur={duree}
                onChange={setDuree}
              />

              <ChampSelection
                libelle={fr.agenda.typeConsultation}
                valeur={kind}
                onChange={(v) => setKind(v as ConsultationKind | "")}
                options={[
                  { valeur: "", libelle: fr.etats.texteAbsent },
                  ...TYPES_ORDONNES.map((valeur) => ({
                    valeur,
                    libelle: fr.agenda.types[valeur],
                  })),
                ]}
              />

              <ChampZoneTexte
                libelle={fr.agenda.notesAdministratives}
                valeur={notes}
                onChange={setNotes}
                lignes={3}
              />

              <BarreActions>
                <Bouton type="submit" rang="principal" disabled={envoi}>
                  {fr.actions.enregistrerLeRendezVous}
                </Bouton>
                <Bouton
                  rang="discret"
                  onClick={() => {
                    setEdition(false);
                    setDebutLocal(versSaisieLocale(rdv.startsAt));
                    setDuree(String(rdv.durationMinutes));
                    setNotes(rdv.notesAdmin ?? "");
                    setKind(rdv.kind ?? "");
                  }}
                >
                  {fr.actions.annuler}
                </Bouton>
              </BarreActions>
            </form>
          ) : null}

          {/* ── Annulation ───────────────────────────────────────────────── */}
          {annulationOuverte ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                annulerLeRendezVous();
              }}
              className="max-w-form rounded-lg border border-attention bg-attention-bg p-6"
            >
              <div className="flex flex-col gap-4">
                {/* On DIT que ce texte est visible de l'assistante. Sans cette
                    phrase, un motif clinique finirait dans un champ
                    administratif — ADR-017 protège la colonne, pas la
                    discipline de saisie. */}
                <ChampTexte
                  libelle={fr.agenda.motifAnnulation}
                  valeur={motif}
                  onChange={setMotif}
                  indication={fr.agenda.motifAnnulationIndication}
                />

                <BarreActions>
                  <Bouton type="submit" retrait disabled={envoi}>
                    {fr.actions.annulerLeRendezVous}
                  </Bouton>
                  <Bouton
                    rang="discret"
                    onClick={() => {
                      setAnnulationOuverte(false);
                      setMotif("");
                    }}
                  >
                    {fr.actions.annuler}
                  </Bouton>
                </BarreActions>
              </div>
            </form>
          ) : null}

          {/* ── Commandes ────────────────────────────────────────────────── */}
          {/* Les deux commandes disparaissent sur un rendez-vous terminé ou
              annulé. CE N'EST PAS LA PROTECTION — le déclencheur
              `trg_appt_transition` refuse en base, quel que soit l'appelant.
              C'est de l'honnêteté d'interface : proposer un bouton qui va
              échouer apprend à la praticienne que les commandes de cet écran ne
              font pas ce qu'elles disent. */}
          {!edition && !annulationOuverte
            && rdv.status !== "cancelled" && rdv.status !== "completed" ? (
            <BarreActions>
              {rdv.status === "requested" ? (
                /* La demande garde UNE commande basse : refuser. « Fixer le
                   créneau » et « Confirmer » vivent dans le panneau au-dessus ;
                   les répéter ici ferait deux chemins pour le même geste. */
                <Bouton retrait onClick={() => setAnnulationOuverte(true)}>
                  {fr.actions.annulerLeRendezVous}
                </Bouton>
              ) : (
                <>
                  {/* ENTRÉE VERS LA SÉANCE (S5). Jamais sur une demande non
                      confirmée : une séance ouverte sur un créneau seulement
                      souhaité produirait une note clinique sans rendez-vous. */}
                  {rdv.patientId !== null && rdv.practitionerId === utilisateur?.id ? (
                    <Bouton rang="principal" onClick={demarrerLaSeance} disabled={envoi}>
                      {rdv.status === "in_session"
                        ? fr.consultation.reprendre
                        : fr.actions.demarrerLaSeance}
                    </Bouton>
                  ) : rdv.patientId === null ? (
                    <span className="font-ui text-label text-ink-500">
                      {fr.agenda.patientNonRattache}
                    </span>
                  ) : utilisateur === undefined ? null : (
                    <span className="font-ui text-label text-ink-500">
                      {fr.agenda.seanceReserveeAutrePraticien}
                    </span>
                  )}

                  <Bouton rang="secondaire" onClick={() => setEdition(true)}>
                    {fr.actions.modifierLeRendezVous}
                  </Bouton>
                  <Bouton retrait onClick={() => setAnnulationOuverte(true)}>
                    {fr.actions.annulerLeRendezVous}
                  </Bouton>
                </>
              )}
            </BarreActions>
          ) : null}

          <div>
            <LienBouton href="/agenda" rang="discret">
              {fr.agenda.retourALAgenda}
            </LienBouton>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function ChampAgenda({
  libelle,
  valeur,
}: {
  readonly libelle: string;
  readonly valeur: string | null;
}): React.JSX.Element {
  const vide = valeur === null || valeur === "";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="font-ui text-label font-medium text-ink-500">{libelle}</dt>
      <dd
        className={[
          "m-0 font-ui text-body font-regular tabular-nums",
          "whitespace-pre-wrap break-words",
          vide ? "text-ink-500" : "font-medium text-ink-900",
        ].join(" ")}
      >
        {vide ? fr.etats.texteAbsent : valeur}
      </dd>
    </div>
  );
}
