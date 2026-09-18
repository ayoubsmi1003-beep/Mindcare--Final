/**
 * Les séances précédentes, DANS la consultation en cours.
 *
 * ⚠️ CE PANNEAU NE DÉMONTE JAMAIS LA SÉANCE EN COURS, ET C'EST SA RAISON
 * D'ÊTRE. Jusqu'ici, relire ce qui s'était dit la fois d'avant imposait de
 * quitter l'écran (`/patients/[id]`, onglet chronologie, puis
 * `/consultation/[autre]`), donc d'abandonner la saisie en cours et de revenir
 * par le bouton Retour. Une praticienne qui a un patient en face ne fait pas ce
 * trajet : elle s'en passe, et décide sans l'information.
 *
 * Ici, l'historique est un ONGLET. Le travail clinique reste monté dans
 * l'onglet « Séance » — React ne le démonte pas, la saisie, la dictée en cours,
 * le compte à rebours du verrou et l'analyse survivent au va-et-vient.
 *
 * ⚠️ AUCUNE PORTE NOUVELLE. Trois portes déjà en place et déjà journalisantes :
 *   · `list_patient_timeline` (047) rend `event_id` = l'id de la consultation
 *     pour les événements de type `consultation` — c'est ce qui permet de
 *     passer d'une DATE à une SÉANCE sans inventer de requête ;
 *   · `get_consultation` (026) rend la note de cette séance-là ;
 *   · `get_consultation_analysis` rend l'analyse enregistrée, s'il y en a une.
 *
 * ⚠️ CHAQUE OUVERTURE DE DÉTAIL LAISSE UNE TRACE, ET C'EST VOULU (règle 6).
 * `get_consultation` journalise sa lecture. Relire une séance passée est un
 * accès au dossier, pas une navigation gratuite : la trace est la contrepartie
 * normale du confort qu'apporte ce panneau.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

import {
  Badge,
  BlocErreur,
  Bouton,
  Carte,
  Champ,
  EtatVide,
  Squelette,
} from "@/components/ui";
import { jourLong, heure } from "@/components/patients/format";
import { fr } from "@/i18n/fr";
import { listPatientTimeline, type TimelineEvent } from "@/services/patients";
import {
  CHAMPS_SOAP,
  getConsultation,
  type ChampSoap,
  type Consultation,
} from "@/services/consultations";
import { chargerAnalyse, type AnalyseSeance } from "@/services/jarvis";

/**
 * Les quatre intitulés SOAP, relus.
 *
 * `LIBELLES_SOAP` de la page de consultation porte AUSSI une `indication`
 * (« Ce que le patient rapporte »), qui guide une SAISIE. Ici on relit : une
 * consigne de rédaction n'aurait aucun sens sous une note signée il y a six
 * mois. Mêmes clés `fr`, donc aucune chaîne en dur (ADR-008).
 */
const TITRES_SOAP: Readonly<Record<ChampSoap, string>> = {
  subjective: fr.consultation.subjective,
  objective: fr.consultation.objective,
  assessment: fr.consultation.assessment,
  plan: fr.consultation.plan,
};

/**
 * Une page suffit : c'est un rappel avant de recevoir, pas un export du
 * dossier. La chronologie complète reste à sa place, dans l'écran Patient.
 */
const NOMBRE_SEANCES = 12;

interface Detail {
  readonly seance: Consultation | null;
  readonly analyse: AnalyseSeance | null;
  readonly erreur: string | undefined;
}

export function PanneauHistorique({
  patientId,
  consultationActuelleId,
}: {
  readonly patientId: string | null;
  /** La séance en cours ne figure pas dans son propre historique. */
  readonly consultationActuelleId: string;
}): React.JSX.Element {
  const [evenements, setEvenements] = useState<readonly TimelineEvent[] | undefined>(undefined);
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [details, setDetails] = useState<Readonly<Record<string, Detail>>>({});

  const charger = useCallback((): void => {
    if (patientId === null) return;
    setErreur(undefined);
    setEvenements(undefined);
    void listPatientTimeline(patientId, null, 50).then((r) => {
      if (!r.ok) {
        setErreur(r.error.message);
        setEvenements([]);
        return;
      }
      // Le filtrage est ici et non en base : `list_patient_timeline` est une
      // porte partagée, la restreindre changerait l'écran Patient.
      setEvenements(
        r.data.evenements
          .filter((e) => e.eventType === "consultation" && e.eventId !== consultationActuelleId)
          .slice(0, NOMBRE_SEANCES),
      );
    });
  }, [patientId, consultationActuelleId]);

  useEffect(charger, [charger]);

  function basculer(eventId: string): void {
    if (ouvert === eventId) {
      setOuvert(null);
      return;
    }
    setOuvert(eventId);
    if (details[eventId] !== undefined) return;

    // Les deux lectures partent ENSEMBLE : l'analyse n'est pas une suite de la
    // note, et les enchaîner doublerait l'attente pour rien.
    void Promise.all([getConsultation(eventId), chargerAnalyse(eventId)]).then(
      ([resSeance, resAnalyse]) => {
        setDetails((precedent) => ({
          ...precedent,
          [eventId]: {
            seance: resSeance.ok ? resSeance.data : null,
            // Une analyse illisible n'est pas une erreur d'écran : la plupart
            // des séances n'en ont jamais eu.
            analyse: resAnalyse.ok ? resAnalyse.data : null,
            erreur: resSeance.ok ? undefined : resSeance.error.message,
          },
        }));
      },
    );
  }

  // Une séance sans dossier rattaché n'a pas d'historique à montrer — et ce
  // n'est pas une panne (le LEFT JOIN de 026 laisse ce cas exister).
  if (patientId === null) {
    return <EtatVide message={fr.consultation.historiqueSansDossier} icone="patients" />;
  }

  if (erreur !== undefined) {
    return <BlocErreur message={erreur} action={<Bouton onClick={charger}>{fr.actions.reessayer}</Bouton>} />;
  }

  if (evenements === undefined) return <Squelette lignes={5} />;

  if (evenements.length === 0) {
    return <EtatVide message={fr.consultation.historiqueVide} icone="documents" />;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="font-ui text-label font-medium text-ink-500">{fr.consultation.historiqueIndication}</p>

      {/* V10 — timeline 21st.dev : rail vertical + pastille date, cartes premium */}
      <ol className="relative flex flex-col gap-3 pl-6 before:absolute before:bottom-2 before:left-2 before:top-2 before:w-px before:bg-rule">
        {evenements.map((e) => {
          const estOuvert = ouvert === e.eventId;
          const detail = details[e.eventId];
          return (
            <li key={e.eventId} className="relative">
              <span
                aria-hidden="true"
                className={[
                  "absolute -left-6 top-5 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-card shadow-douce",
                  estOuvert ? "bg-action-600" : "bg-ink-300",
                ].join(" ")}
              />
              <Carte niveau="secondaire">
                {/*
                  La DATE est le bouton. Pas une ligne avec un chevron discret
                  au bout : la cible est la ligne entière, parce que le geste
                  décrit dans la demande est « cliquer une date ».
                */}
                <button
                  type="button"
                  onClick={() => basculer(e.eventId)}
                  aria-expanded={estOuvert}
                  className="flex w-full flex-wrap items-baseline justify-between gap-3 rounded-lg p-4 text-left transition-colors duration-quick hover:bg-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600"
                >
                  <span className="flex min-w-0 flex-wrap items-baseline gap-3">
                    <span className="font-num text-body font-semibold tabular-nums text-ink-900">
                      {jourLong(e.occurredAt) ?? fr.etats.texteAbsent}
                    </span>
                    <span className="font-num text-label tabular-nums text-ink-500">
                      {heure(e.occurredAt) ?? ""}
                    </span>
                    {e.practitionerName === null ? null : (
                      <span className="truncate font-ui text-label text-ink-500">
                        {e.practitionerName}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <Badge ton={e.labelKey === "consultation_close" ? "neutre" : "attention"}>
                      {e.labelKey === "consultation_close"
                        ? fr.patients.chronologie.consultationClose
                        : fr.patients.chronologie.consultationOuverte}
                    </Badge>
                    <span className="font-ui text-label text-action-600">
                      {estOuvert ? fr.consultation.historiqueReplier : fr.consultation.historiqueLire}
                    </span>
                  </span>
                </button>

                {estOuvert ? (
                  <div className="border-t border-rule px-4 pb-4 pt-4">
                    {detail === undefined ? (
                      <Squelette lignes={4} />
                    ) : (
                      <DetailSeance detail={detail} />
                    )}
                  </div>
                ) : null}
              </Carte>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Le détail d'une séance passée — la note d'abord, l'analyse ensuite.
 *
 * ⚠️ TOUT EST EN LECTURE SEULE, SANS EXCEPTION. Aucun champ n'écrit, aucun
 * bouton ne reprend un fragment dans l'éditeur de la séance en cours. Une note
 * signée est immuable (`trg_note_immutable`, 008) et une note d'une AUTRE
 * séance n'a rien à faire dans celle-ci : la recopie, si elle a lieu, est un
 * geste de la praticienne, pas un raccourci de l'écran.
 */
function DetailSeance({ detail }: { readonly detail: Detail }): React.JSX.Element {
  if (detail.erreur !== undefined) {
    return <BlocErreur message={detail.erreur} />;
  }

  // `get_consultation` rend zéro ligne pour « introuvable » ET pour « hors
  // périmètre » : un seul message pour les deux, sinon l'écran devient un
  // oracle d'existence sur le dossier d'une consœur (ADR-003).
  if (detail.seance === null) {
    return <EtatVide message={fr.consultation.introuvable} />;
  }

  const note = detail.seance.note;

  return (
    <div className="flex flex-col gap-6">
      {note === null ? (
        <EtatVide message={fr.consultation.historiqueSansNote} />
      ) : (
        <div className="flex flex-col gap-4">
          {CHAMPS_SOAP.map((champ) => (
            <Champ key={champ} libelle={TITRES_SOAP[champ]} valeur={note.soap[champ]} />
          ))}
        </div>
      )}

      {detail.analyse === null ? null : (
        <div className="flex flex-col gap-3 border-t border-rule pt-4">
          <p className="font-ui text-label font-medium uppercase tracking-label text-ink-500">
            {fr.consultation.historiqueAnalyse}
          </p>
          {/* I7 — la mention accompagne toute surface d'aide à la décision,
              y compris relue des mois plus tard. */}
          <p className="font-ui text-label text-ink-500">{fr.disclaimer}</p>
          {detail.analyse.evolution.length === 0 ? (
            <EtatVide message={fr.consultation.evolutionAucune} />
          ) : (
            <ul className="flex list-disc flex-col gap-2 pl-5 font-ui text-body text-ink-900">
              {detail.analyse.evolution.map((ligne) => (
                <li key={ligne}>{ligne}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
