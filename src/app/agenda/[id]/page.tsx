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
 * de trois champs ; `patient_id`, `practitioner_id` et `status` en sont exclus
 * pour qu'une modification de routine ne puisse pas réattribuer un rendez-vous
 * d'une praticienne à l'autre (ADR-003). Ajouter le champ à ce formulaire ne
 * l'ouvrirait pas — la porte lèverait une exception, et c'est le but.
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
  heure,
  jourComplet,
  nomPatient,
  Statut,
  versIso,
  versSaisieLocale,
} from "@/components/AgendaPieces";
import { BandeauHorsLigne, BlocErreur, Champ } from "@/components/EtatsEcran";
import { useSessionEcran } from "@/components/useSessionEcran";
import { fr } from "@/i18n/fr";
import {
  cancelAppointment,
  getAppointment,
  updateAppointment,
  type AgendaEntry,
} from "@/services/appointments";

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

  const [annulationOuverte, setAnnulationOuverte] = useState(false);
  const [motif, setMotif] = useState("");

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
      }
    });
    return () => {
      annule = true;
    };
  }, [id, utilisateur]);

  function recharger(): void {
    void getAppointment(id).then((result) => {
      if (result.ok) {
        setRdv(result.data);
        if (result.data !== null) {
          setDebutLocal(versSaisieLocale(result.data.startsAt));
          setDuree(String(result.data.durationMinutes));
          setNotes(result.data.notesAdmin ?? "");
        }
      }
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
    >
      {horsLigne || horsLigneSession ? <BandeauHorsLigne /> : null}

      {rdv === null ? (
        <>
          {messageErreur !== undefined && !horsLigne ? (
            <BlocErreur message={messageErreur} />
          ) : (
            <p style={{ color: "var(--ink-500)", fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-leading)" }}>
              {fr.agenda.introuvable}
            </p>
          )}
          <p style={{ marginTop: "var(--s-4)" }}>
            <Link href="/agenda" style={{ color: "var(--teal-700)", fontSize: "var(--text-body-size)" }}>
              {fr.agenda.retourALAgenda}
            </Link>
          </p>
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--s-4)", flexWrap: "wrap" }}>
            <h1
              style={{
                fontSize: "var(--text-display-size)",
                lineHeight: "var(--text-display-leading)",
                letterSpacing: "var(--text-display-tracking)",
                fontWeight: "var(--weight-semibold)",
                color: "var(--ink-900)",
                margin: "var(--size-0)",
                overflowWrap: "anywhere",
              }}
            >
              {nomPatient(rdv.lastName, rdv.firstName) ?? fr.agenda.patientNonRattache}
            </h1>
            <Statut statut={rdv.status} />
          </div>

          {confirmation !== undefined ? (
            <p
              role="status"
              style={{
                marginTop: "var(--s-4)",
                padding: "var(--s-3) var(--s-4)",
                borderRadius: "var(--r-md)",
                background: "var(--positive-bg)",
                color: "var(--positive)",
                fontSize: "var(--text-body-size)",
                lineHeight: "var(--text-body-leading)",
              }}
            >
              {confirmation}
            </p>
          ) : null}

          {messageErreur !== undefined && !horsLigne ? <BlocErreur message={messageErreur} /> : null}

          {/* ── Lecture ──────────────────────────────────────────────────── */}
          {!edition ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fit, minmax(var(--card-column-min), 1fr))`,
                gap: "var(--s-5)",
                marginTop: "var(--s-6)",
                padding: "var(--s-5)",
                borderRadius: "var(--r-lg)",
                border: "var(--rule-width) solid var(--rule)",
                background: "var(--card)",
              }}
            >
              <Champ libelle={fr.agenda.date} valeur={jourComplet(rdv.startsAt)} />
              <Champ
                libelle={fr.agenda.heure}
                valeur={
                  heure(rdv.startsAt) === null
                    ? null
                    : `${heure(rdv.startsAt) ?? ""} – ${heure(rdv.endsAt) ?? ""}`
                }
              />
              <Champ
                libelle={fr.agenda.duree}
                valeur={`${rdv.durationMinutes} ${fr.agenda.dureeUnite}`}
              />
              <Champ libelle={fr.agenda.praticienne} valeur={rdv.practitionerName} />
              <Champ libelle={fr.patients.numeroDossier} valeur={rdv.recordNumber} />
              <Champ libelle={fr.agenda.origine} valeur={fr.agenda.origines[rdv.source]} />
              <Champ libelle={fr.agenda.notesAdministratives} valeur={rdv.notesAdmin} />
            </div>
          ) : null}

          {/* ── Modification ─────────────────────────────────────────────── */}
          {edition ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                enregistrer();
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--s-5)",
                maxWidth: "var(--width-form)",
                marginTop: "var(--s-6)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
                <label htmlFor="debut" style={libelleStyle}>
                  {fr.agenda.date} · {fr.agenda.heure}
                </label>
                <input
                  id="debut"
                  type="datetime-local"
                  value={debutLocal}
                  onChange={(event) => setDebutLocal(event.target.value)}
                  style={champStyle}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
                <label htmlFor="duree" style={libelleStyle}>
                  {fr.agenda.duree} ({fr.agenda.dureeUnite})
                </label>
                <input
                  id="duree"
                  type="number"
                  min={5}
                  max={240}
                  step={5}
                  value={duree}
                  onChange={(event) => setDuree(event.target.value)}
                  style={{ ...champStyle, fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-num)" }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
                <label htmlFor="notes" style={libelleStyle}>
                  {fr.agenda.notesAdministratives}
                </label>
                <textarea
                  id="notes"
                  rows={3}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  style={{ ...champStyle, minHeight: "var(--target-comfort)", resize: "vertical" }}
                />
              </div>

              <div style={{ display: "flex", gap: "var(--s-4)", flexWrap: "wrap" }}>
                <button
                  type="submit"
                  disabled={envoi}
                  style={{
                    minHeight: "var(--target-min)",
                    padding: "var(--s-2) var(--s-5)",
                    borderRadius: "var(--r-md)",
                    border: "none",
                    background: envoi ? "var(--teal-400)" : "var(--teal-600)",
                    color: "var(--card)",
                    fontSize: "var(--text-body-size)",
                    lineHeight: "var(--text-body-leading)",
                    fontWeight: "var(--weight-semibold)",
                    fontFamily: "var(--font-ui)",
                    cursor: envoi ? "default" : "pointer",
                  }}
                >
                  {fr.actions.enregistrerLeRendezVous}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEdition(false);
                    setDebutLocal(versSaisieLocale(rdv.startsAt));
                    setDuree(String(rdv.durationMinutes));
                    setNotes(rdv.notesAdmin ?? "");
                  }}
                  style={{
                    minHeight: "var(--target-min)",
                    padding: "var(--s-2) var(--s-5)",
                    borderRadius: "var(--r-md)",
                    border: "var(--rule-width) solid var(--rule)",
                    background: "var(--card)",
                    color: "var(--ink-700)",
                    fontSize: "var(--text-body-size)",
                    lineHeight: "var(--text-body-leading)",
                    fontFamily: "var(--font-ui)",
                    cursor: "pointer",
                  }}
                >
                  {fr.actions.annuler}
                </button>
              </div>
            </form>
          ) : null}

          {/* ── Annulation ───────────────────────────────────────────────── */}
          {annulationOuverte ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                annulerLeRendezVous();
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--s-3)",
                maxWidth: "var(--width-form)",
                marginTop: "var(--s-6)",
                padding: "var(--s-5)",
                borderRadius: "var(--r-lg)",
                border: "var(--rule-width) solid var(--attention)",
                background: "var(--attention-bg)",
              }}
            >
              <label htmlFor="motif" style={libelleStyle}>
                {fr.agenda.motifAnnulation}
              </label>
              {/* On DIT que ce texte est visible de l'assistante. Sans cette
                  phrase, un motif clinique finirait dans un champ administratif
                  — ADR-017 protège la colonne, pas la discipline de saisie. */}
              <p style={{ margin: "var(--size-0)", color: "var(--ink-700)", fontSize: "var(--text-label-size)", lineHeight: "var(--text-label-leading)" }}>
                {fr.agenda.motifAnnulationIndication}
              </p>
              <input
                id="motif"
                type="text"
                value={motif}
                onChange={(event) => setMotif(event.target.value)}
                style={champStyle}
              />
              <div style={{ display: "flex", gap: "var(--s-4)", flexWrap: "wrap" }}>
                <button
                  type="submit"
                  disabled={envoi}
                  style={{
                    minHeight: "var(--target-min)",
                    padding: "var(--s-2) var(--s-5)",
                    borderRadius: "var(--r-md)",
                    border: "none",
                    background: "var(--attention)",
                    color: "var(--card)",
                    fontSize: "var(--text-body-size)",
                    lineHeight: "var(--text-body-leading)",
                    fontWeight: "var(--weight-semibold)",
                    fontFamily: "var(--font-ui)",
                    cursor: envoi ? "default" : "pointer",
                  }}
                >
                  {fr.actions.annulerLeRendezVous}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnnulationOuverte(false);
                    setMotif("");
                  }}
                  style={{
                    minHeight: "var(--target-min)",
                    padding: "var(--s-2) var(--s-5)",
                    borderRadius: "var(--r-md)",
                    border: "var(--rule-width) solid var(--rule)",
                    background: "var(--card)",
                    color: "var(--ink-700)",
                    fontSize: "var(--text-body-size)",
                    lineHeight: "var(--text-body-leading)",
                    fontFamily: "var(--font-ui)",
                    cursor: "pointer",
                  }}
                >
                  {fr.actions.annuler}
                </button>
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
            <div style={{ display: "flex", gap: "var(--s-4)", flexWrap: "wrap", marginTop: "var(--s-6)" }}>
              <button
                type="button"
                onClick={() => setEdition(true)}
                style={{
                  minHeight: "var(--target-min)",
                  padding: "var(--s-2) var(--s-5)",
                  borderRadius: "var(--r-md)",
                  border: "var(--rule-width) solid var(--rule)",
                  background: "var(--card)",
                  color: "var(--ink-900)",
                  fontSize: "var(--text-body-size)",
                  lineHeight: "var(--text-body-leading)",
                  fontFamily: "var(--font-ui)",
                  cursor: "pointer",
                }}
              >
                {fr.actions.modifierLeRendezVous}
              </button>
              <button
                type="button"
                onClick={() => setAnnulationOuverte(true)}
                style={{
                  minHeight: "var(--target-min)",
                  padding: "var(--s-2) var(--s-5)",
                  borderRadius: "var(--r-md)",
                  border: "var(--rule-width) solid var(--attention)",
                  background: "var(--card)",
                  color: "var(--attention)",
                  fontSize: "var(--text-body-size)",
                  lineHeight: "var(--text-body-leading)",
                  fontFamily: "var(--font-ui)",
                  cursor: "pointer",
                }}
              >
                {fr.actions.annulerLeRendezVous}
              </button>
            </div>
          ) : null}

          <p style={{ marginTop: "var(--s-8)" }}>
            <Link href="/agenda" style={{ color: "var(--teal-700)", fontSize: "var(--text-body-size)" }}>
              {fr.agenda.retourALAgenda}
            </Link>
          </p>
        </>
      )}
    </AppShell>
  );
}
