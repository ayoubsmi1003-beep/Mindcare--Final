/**
 * Nouveau rendez-vous.
 *
 * ⚠️ CET ÉCRAN NE VÉRIFIE AUCUN DROIT, ET C'EST VOULU. Il n'y a pas de
 * `if (role === …)` pour décider qui peut créer quoi : `app.create_appointment`
 * est `SECURITY INVOKER` et la policy `appt_clinical` / `appt_assistant` de la
 * migration 006 tranche, avec son `WITH CHECK`. Un formulaire qui filtrerait
 * lui-même donnerait l'illusion d'une règle, et cette illusion tomberait au
 * premier appelant qui ne passe pas par cet écran.
 *
 * ⚠️ LE TYPE DE CONSULTATION N'EST PAS DEMANDÉ, et son absence est délibérée.
 * `app.appointments` ne porte pas cette colonne, et la liste réellement employée
 * par la praticienne n'a pas été fournie. Proposer « première consultation /
 * suivi / urgence » serait une taxonomie clinique inventée dans un dossier
 * médical (I19) — le genre de donnée que personne ne relit parce qu'elle a l'air
 * juste. Le champ s'ajoutera par une migration isolée le jour où la liste
 * existe ; cet écran ne sera pas à reconstruire.
 *
 * `source` n'est pas demandé non plus : la base le dérive du rôle de l'appelant.
 * C'est le CANAL d'entrée du rendez-vous, pas son type ; le laisser saisir
 * inviterait à confondre les deux.
 *
 * La recherche de patient passe par `searchPatients`, donc par
 * `app.search_patients`, qui journalise chaque appel (ADR-019). C'est pourquoi
 * elle n'est lancée qu'à la validation explicite du champ, jamais à chaque
 * frappe : une recherche par caractère écrirait une ligne d'audit par lettre.
 */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { versIso } from "@/components/AgendaPieces";
import { BandeauHorsLigne, BlocErreur } from "@/components/EtatsEcran";
import { useSessionEcran } from "@/components/useSessionEcran";
import { fr } from "@/i18n/fr";
import { createAppointment } from "@/services/appointments";
import { searchPatients, type PatientListItem } from "@/services/patients";
import { listPractitioners, type Practitioner } from "@/services/practitioners";

const DUREE_PAR_DEFAUT = 30;

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

export default function PageNouveauRendezVous(): React.JSX.Element {
  const router = useRouter();
  const { utilisateur, horsLigne: horsLigneSession, deconnecter } = useSessionEcran();

  const [praticiennes, setPraticiennes] = useState<readonly Practitioner[]>([]);
  const [praticienneId, setPraticienneId] = useState("");

  const [saisiePatient, setSaisiePatient] = useState("");
  const [requetePatient, setRequetePatient] = useState<string | undefined>(undefined);
  const [resultats, setResultats] = useState<readonly PatientListItem[] | undefined>(undefined);
  const [patient, setPatient] = useState<PatientListItem | undefined>(undefined);

  const [debutLocal, setDebutLocal] = useState("");
  const [duree, setDuree] = useState(String(DUREE_PAR_DEFAUT));
  const [notes, setNotes] = useState("");

  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);
  const [horsLigne, setHorsLigne] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (utilisateur === undefined) return;
    let annule = false;
    void listPractitioners().then((result) => {
      if (annule) return;
      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        setMessageErreur(result.error.message);
        return;
      }
      setPraticiennes(result.data);
      // Pré-sélection de la praticienne connectée quand elle en est une. Une
      // assistante n'apparaît pas dans la liste : le champ reste à choisir.
      const soi = result.data.find((p) => p.id === utilisateur?.id);
      setPraticienneId(soi?.id ?? result.data[0]?.id ?? "");
    });
    return () => {
      annule = true;
    };
  }, [utilisateur]);

  useEffect(() => {
    if (requetePatient === undefined) return;
    let annule = false;
    void searchPatients(requetePatient === "" ? {} : { query: requetePatient }).then((result) => {
      if (annule) return;
      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        setMessageErreur(result.error.message);
        setResultats(undefined);
        return;
      }
      setHorsLigne(false);
      setMessageErreur(undefined);
      setResultats(result.data.rows);
    });
    return () => {
      annule = true;
    };
  }, [requetePatient]);

  function enregistrer(): void {
    setMessageErreur(undefined);

    // VALIDATION LOCALE MINIMALE, et il faut savoir ce qu'elle est : un confort
    // de saisie, pas une règle. Les bornes réelles (durée 5–240, patient
    // existant, droit d'écrire) sont appliquées en base et le resteront.
    const debutIso = versIso(debutLocal);
    const dureeMinutes = Number.parseInt(duree, 10);
    if (patient === undefined || praticienneId === "" || debutIso === null
        || Number.isNaN(dureeMinutes)) {
      setMessageErreur(fr.erreurs["regle-metier"]);
      return;
    }

    setEnvoi(true);
    void createAppointment({
      patientId: patient.id,
      practitionerId: praticienneId,
      startsAt: debutIso,
      durationMinutes: dureeMinutes,
      ...(notes.trim() === "" ? {} : { notesAdmin: notes.trim() }),
    }).then((result) => {
      setEnvoi(false);
      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        setMessageErreur(result.error.message);
        return;
      }
      // `push` et non `replace` : revenir en arrière depuis la fiche du RDV créé
      // doit ramener à l'agenda, pas à un formulaire déjà envoyé.
      router.push(`/agenda/${result.data}`);
    });
  }

  if (utilisateur === undefined) {
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
      <h1
        style={{
          fontSize: "var(--text-display-size)",
          lineHeight: "var(--text-display-leading)",
          letterSpacing: "var(--text-display-tracking)",
          fontWeight: "var(--weight-semibold)",
          color: "var(--ink-900)",
          margin: "var(--size-0)",
        }}
      >
        {fr.agenda.nouveau}
      </h1>

      {horsLigne || horsLigneSession ? <BandeauHorsLigne /> : null}
      {messageErreur !== undefined && !horsLigne ? <BlocErreur message={messageErreur} /> : null}

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
        {/* ── Patient ─────────────────────────────────────────────────────── */}
        <fieldset style={{ border: "none", margin: "var(--size-0)", padding: "var(--size-0)", display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
          <label htmlFor="recherche-patient" style={libelleStyle}>
            {fr.agenda.patient}
          </label>

          {patient === undefined ? (
            <>
              <div style={{ display: "flex", gap: "var(--s-3)" }}>
                <input
                  id="recherche-patient"
                  type="search"
                  value={saisiePatient}
                  placeholder={fr.patients.rechercherIndication}
                  onChange={(event) => setSaisiePatient(event.target.value)}
                  onKeyDown={(event) => {
                    // La recherche journalise : elle se déclenche sur une
                    // intention explicite, jamais à chaque frappe.
                    if (event.key === "Enter") {
                      event.preventDefault();
                      setRequetePatient(saisiePatient.trim());
                    }
                  }}
                  style={champStyle}
                />
                <button
                  type="button"
                  onClick={() => setRequetePatient(saisiePatient.trim())}
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
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                  }}
                >
                  {fr.patients.rechercher}
                </button>
              </div>

              {resultats !== undefined && resultats.length === 0 ? (
                <p style={{ color: "var(--ink-500)", fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-leading)" }}>
                  {requetePatient === "" ? fr.patients.listeVide : fr.patients.rechercheSansResultat}
                </p>
              ) : null}

              {resultats !== undefined && resultats.length > 0 ? (
                <ul style={{ listStyle: "none", margin: "var(--size-0)", padding: "var(--size-0)", display: "flex", flexDirection: "column", gap: "var(--s-1)" }}>
                  {resultats.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setPatient(p)}
                        style={{
                          width: "var(--size-full)",
                          minHeight: "var(--target-min)",
                          padding: "var(--s-2) var(--s-4)",
                          borderRadius: "var(--r-md)",
                          border: "var(--rule-width) solid var(--rule)",
                          background: "var(--card)",
                          color: "var(--ink-900)",
                          fontSize: "var(--text-body-size)",
                          lineHeight: "var(--text-body-leading)",
                          fontFamily: "var(--font-ui)",
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        {p.lastName} {p.firstName} · {p.recordNumber}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--s-3)", flexWrap: "wrap" }}>
              <span style={{ fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-leading)", fontWeight: "var(--weight-medium)", color: "var(--ink-900)", overflowWrap: "anywhere" }}>
                {patient.lastName} {patient.firstName} · {patient.recordNumber}
              </span>
              <button
                type="button"
                onClick={() => {
                  setPatient(undefined);
                  setResultats(undefined);
                  setRequetePatient(undefined);
                }}
                style={{
                  minHeight: "var(--target-min)",
                  padding: "var(--s-1) var(--s-3)",
                  borderRadius: "var(--r-md)",
                  border: "var(--rule-width) solid var(--rule)",
                  background: "var(--card)",
                  color: "var(--ink-700)",
                  fontSize: "var(--text-label-size)",
                  lineHeight: "var(--text-label-leading)",
                  fontFamily: "var(--font-ui)",
                  cursor: "pointer",
                }}
              >
                {fr.patients.rechercher}
              </button>
            </div>
          )}
        </fieldset>

        {/* ── Praticienne ─────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
          <label htmlFor="praticienne" style={libelleStyle}>
            {fr.agenda.praticienne}
          </label>
          <select
            id="praticienne"
            value={praticienneId}
            onChange={(event) => setPraticienneId(event.target.value)}
            style={champStyle}
          >
            {praticiennes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
        </div>

        {/* ── Date et heure ───────────────────────────────────────────────── */}
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

        {/* ── Durée ───────────────────────────────────────────────────────── */}
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

        {/* ── Notes administratives ───────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
          <label htmlFor="notes" style={libelleStyle}>
            {fr.agenda.notesFacultatives}
          </label>
          <textarea
            id="notes"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            style={{ ...champStyle, minHeight: "var(--target-comfort)", resize: "vertical" }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--s-4)", flexWrap: "wrap" }}>
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

          <Link
            href="/agenda"
            style={{
              color: "var(--teal-700)",
              fontSize: "var(--text-body-size)",
              lineHeight: "var(--text-body-leading)",
            }}
          >
            {fr.agenda.retourALAgenda}
          </Link>
        </div>
      </form>
    </AppShell>
  );
}
