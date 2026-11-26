/**
 * Traiter une demande web/WhatsApp (235) — l'accueil a appelé la personne.
 *
 * ⚠️ AUCUNE DÉCISION ICI. « Accepter » appelle `accept_appointment_request` :
 * la base rattache le dossier (porte auditée, cloison praticien), pose l'horaire
 * et confirme sous verrou, en UNE transaction. « Refuser » annule avec motif.
 * Rien d'optimiste : l'écran attend la réponse de la porte, puis recharge.
 * Les dossiers proposés viennent de l'appariement existant (116, 9 derniers chiffres).
 */
"use client";

import { useCallback, useEffect, useState } from "react";

import { fr } from "@/i18n/fr";
import { heure, jour, versIso, versSaisieLocale } from "@/components/AgendaPieces";
import { BarreActions, Bouton, LienBouton } from "@/components/ui/Bouton";
import { ChampSelection, ChampTexte, ChampZoneTexte } from "@/components/ui/Champs";
import { Dialogue } from "@/components/ui/Dialogue";
import { BlocErreur, EtatVide, Squelette } from "@/components/ui/Etats";
import { accepterDemande, candidatsPourDemande, refuserDemande } from "@/services/appointment-requests";
import type { CandidatPatient } from "@/services/communication/appariement";
import type { RdvAccueil } from "@/services/reception";

const t = fr.reception.demandesExternes;

type Dossiers = { readonly etat: "chargement" } | { readonly etat: "erreur" } | { readonly etat: "pret"; readonly liste: readonly CandidatPatient[] };

export function libellePreference(rdv: RdvAccueil): string | null {
  if (!rdv.preferredDay || !rdv.preferredPeriod) return null;
  const jourLisible = jour(`${rdv.preferredDay}T12:00:00`);
  if (jourLisible === null) return null;
  const base = rdv.preferredTime ? t.preferenceHeure.replace("{heure}", rdv.preferredTime) : t.preferenceJour;
  return base.replace("{periode}", t.periodes[rdv.preferredPeriod]).replace("{jour}", jourLisible);
}

export function DialogueDemande({
  rdv,
  horsLigne,
  onFermer,
  onTraitee,
}: {
  readonly rdv: RdvAccueil | null;
  /** Lien dégradé : toute écriture est bloquée AVEC sa raison (UX_CONTRACT, HORS LIGNE). */
  readonly horsLigne: boolean;
  readonly onFermer: () => void;
  readonly onTraitee: (message: string) => void;
}): React.JSX.Element | null {
  const [dossiers, setDossiers] = useState<Dossiers>({ etat: "chargement" });
  const [patientId, setPatientId] = useState("");
  const [horaire, setHoraire] = useState("");
  const [refus, setRefus] = useState(false);
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>();

  const charger = useCallback(async (telephone: string | null | undefined) => {
    setDossiers({ etat: "chargement" });
    if (!telephone) { setDossiers({ etat: "pret", liste: [] }); return; }
    const result = await candidatsPourDemande(telephone);
    if (!result.ok) { setDossiers({ etat: "erreur" }); return; }
    setDossiers({ etat: "pret", liste: result.data });
    if (result.data.length === 1 && result.data[0]) setPatientId(result.data[0].patientId);
  }, []);

  useEffect(() => {
    if (rdv === null) return;
    setPatientId(""); setRefus(false); setMotif(""); setErreur(undefined);
    setHoraire(versSaisieLocale(rdv.startsAt));
    void charger(rdv.phone);
  }, [rdv, charger]);

  if (rdv === null) return null;

  const preference = libellePreference(rdv);
  const nom = [rdv.lastName, rdv.firstName].filter(Boolean).join(" ") || fr.agenda.patientNonRattache;
  const horaireIso = versIso(horaire);

  async function accepter(): Promise<void> {
    if (rdv === null || horsLigne || horaireIso === null || patientId === "") return;
    setEnvoi(true); setErreur(undefined);
    const result = await accepterDemande(rdv.id, patientId, horaireIso);
    setEnvoi(false);
    if (!result.ok) { setErreur(result.error.message); return; }
    if (result.data) onTraitee(t.acceptee);
  }

  async function refuser(): Promise<void> {
    if (rdv === null || horsLigne || motif.trim() === "") return;
    setEnvoi(true); setErreur(undefined);
    const result = await refuserDemande(rdv.id, motif.trim());
    setEnvoi(false);
    if (!result.ok) { setErreur(result.error.message); return; }
    if (result.data) onTraitee(t.refusee);
  }

  return (
    <Dialogue
      ouvert
      titre={t.titre}
      sousTitre={fr.agenda.origines[rdv.source]}
      busy={envoi}
      onFermer={onFermer}
      pied={
        <BarreActions>
          <Bouton rang="discret" onClick={onFermer} disabled={envoi}>{fr.actions.annuler}</Bouton>
          {refus ? (
            <Bouton rang="secondaire" retrait onClick={() => void refuser()} chargement={envoi} disabled={horsLigne || motif.trim() === ""}>{t.confirmerRefus}</Bouton>
          ) : (
            <>
              <Bouton rang="secondaire" retrait onClick={() => setRefus(true)} disabled={envoi || horsLigne}>{t.refuser}</Bouton>
              <Bouton rang="principal" onClick={() => void accepter()} chargement={envoi} disabled={horsLigne || patientId === "" || horaireIso === null}>{t.accepter}</Bouton>
            </>
          )}
        </BarreActions>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="m-0 flex flex-col gap-2 font-ui text-body">
          <dt className="text-ink-500">{t.dossier}</dt>
          <dd className="m-0 flex flex-col gap-0.5 text-ink-900">
            <span className="font-medium">{nom}</span>
            {rdv.patientId === null ? <span className="text-label text-ink-500">{t.nomDeclare}</span> : null}
          </dd>
          <dt className="text-ink-500">{t.telephone}</dt>
          <dd className="m-0 font-num tabular-nums text-ink-900">{rdv.phone ?? fr.etats.texteAbsent}</dd>
          <dt className="text-ink-500">{t.preference}</dt>
          <dd className="m-0 flex flex-col gap-0.5 text-ink-900">
            <span>{preference ?? heure(rdv.startsAt) ?? fr.etats.texteAbsent}</span>
            <span className="text-label text-ink-500">{t.preferenceAide}</span>
          </dd>
        </dl>

        {horsLigne ? <p role="status" className="rounded-md border border-attention bg-attention-bg px-3 py-2 font-ui text-label text-attention-ink">{fr.collaboration.connexion.horsLigneDetail}</p> : null}
        {erreur !== undefined ? <BlocErreur message={erreur} /> : null}

        {refus ? (
          <ChampZoneTexte libelle={t.motif} indication={t.motifAide} valeur={motif} onChange={setMotif} lignes={3} disabled={envoi} />
        ) : dossiers.etat === "chargement" ? (
          <Squelette lignes={2} />
        ) : dossiers.etat === "erreur" ? (
          <BlocErreur message={t.erreurDossiers} action={<Bouton rang="secondaire" onClick={() => void charger(rdv.phone)}>{fr.actions.reessayer}</Bouton>} />
        ) : dossiers.liste.length === 0 ? (
          <EtatVide message={t.aucunDossier} action={<LienBouton href="/patients/nouveau">{t.creerDossier}</LienBouton>} />
        ) : (
          <>
            <ChampSelection
              libelle={t.choisirDossier}
              valeur={patientId}
              onChange={setPatientId}
              options={[{ valeur: "", libelle: "—" }, ...dossiers.liste.map(c => ({ valeur: c.patientId, libelle: c.libelle }))]}
              disabled={envoi}
            />
            <ChampTexte
              libelle={t.horaire}
              type="datetime-local"
              valeur={horaire}
              onChange={setHoraire}
              indication={t.horaireAide}
              {...(horaireIso === null ? { erreur: t.horaireInvalide } : {})}
              disabled={envoi}
            />
          </>
        )}
      </div>
    </Dialogue>
  );
}
