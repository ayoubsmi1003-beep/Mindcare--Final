/**
 * Les sÃ©ances prÃ©cÃ©dentes, DANS la consultation en cours.
 *
 * âš ï¸ CE PANNEAU NE DÃ‰MONTE JAMAIS LA SÃ‰ANCE EN COURS, ET C'EST SA RAISON
 * D'ÃŠTRE. Jusqu'ici, relire ce qui s'Ã©tait dit la fois d'avant imposait de
 * quitter l'Ã©cran (`/patients/[id]`, onglet chronologie, puis
 * `/consultation/[autre]`), donc d'abandonner la saisie en cours et de revenir
 * par le bouton Retour. Une praticienne qui a un patient en face ne fait pas ce
 * trajet : elle s'en passe, et dÃ©cide sans l'information.
 *
 * Ici, l'historique est un ONGLET. Le travail clinique reste montÃ© dans
 * l'onglet Â« SÃ©ance Â» â€” React ne le dÃ©monte pas, la saisie, la dictÃ©e en cours,
 * le compte Ã  rebours du verrou et l'analyse survivent au va-et-vient.
 *
 * âš ï¸ AUCUNE PORTE NOUVELLE. Trois portes dÃ©jÃ  en place et dÃ©jÃ  journalisantes :
 *   Â· `list_patient_timeline` (047) rend `event_id` = l'id de la consultation
 *     pour les Ã©vÃ©nements de type `consultation` â€” c'est ce qui permet de
 *     passer d'une DATE Ã  une SÃ‰ANCE sans inventer de requÃªte ;
 *   Â· `get_consultation` (026) rend la note de cette sÃ©ance-lÃ  ;
 *   Â· `get_consultation_analysis` rend l'analyse enregistrÃ©e, s'il y en a une.
 *
 * âš ï¸ CHAQUE OUVERTURE DE DÃ‰TAIL LAISSE UNE TRACE, ET C'EST VOULU (rÃ¨gle 6).
 * `get_consultation` journalise sa lecture. Relire une sÃ©ance passÃ©e est un
 * accÃ¨s au dossier, pas une navigation gratuite : la trace est la contrepartie
 * normale du confort qu'apporte ce panneau.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

import {
  Badge,
  BlocErreur,
  Bouton,
  EtatVide,
  Squelette,
} from "@/components/ui";
import { Icone } from "@/components/ui/Icones";
import { jourLong, heure } from "@/components/patients/format";
import { fr } from "@/i18n/fr";
import { listPatientTimeline, type TimelineEvent } from "@/services/patients";
import { getConsultation } from "@/services/consultations";
import { chargerAnalyse } from "@/services/jarvis";

import {
  DetailSeanceAccordion,
  type DetailSeanceChargee,
} from "./DetailSeanceAccordion";

/**
 * Une page suffit : c'est un rappel avant de recevoir, pas un export du
 * dossier. La chronologie complÃ¨te reste Ã  sa place, dans l'Ã©cran Patient.
 */
const NOMBRE_SEANCES = 12;

export function PanneauHistorique({
  patientId,
  consultationActuelleId,
}: {
  readonly patientId: string | null;
  /** La sÃ©ance en cours ne figure pas dans son propre historique. */
  readonly consultationActuelleId: string;
}): React.JSX.Element {
  const [evenements, setEvenements] = useState<readonly TimelineEvent[] | undefined>(undefined);
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [details, setDetails] = useState<Readonly<Record<string, DetailSeanceChargee>>>({});

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
      // porte partagÃ©e, la restreindre changerait l'Ã©cran Patient.
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
    // note, et les enchaÃ®ner doublerait l'attente pour rien.
    void Promise.all([getConsultation(eventId), chargerAnalyse(eventId)]).then(
      ([resSeance, resAnalyse]) => {
        const detail: DetailSeanceChargee = {
          seance: resSeance.ok ? resSeance.data : null,
          // Une analyse illisible n'est pas une erreur d'Ã©cran : la plupart
          // des sÃ©ances n'en ont jamais eu.
          analyse: resAnalyse.ok ? resAnalyse.data : null,
          erreur: resSeance.ok ? undefined : resSeance.error.message,
        };
        setDetails((precedent) => ({ ...precedent, [eventId]: detail }));
      },
    );
  }

  // Une sÃ©ance sans dossier rattachÃ© n'a pas d'historique Ã  montrer â€” et ce
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

      {/*
        Liste accordÃ©on : une ligne par sÃ©ance â€” pastille icÃ´ne, date,
        praticienne, statut, chevron. La DATE reste le bouton, la cible est
        la ligne entiÃ¨re (Â« cliquer une date Â»). Une seule sÃ©ance dÃ©pliÃ©e Ã 
        la fois : le contenu long se lit sans noyer l'Ã©cran.
      */}
      <div className="flex w-full flex-col -space-y-px">
        {evenements.map((e) => {
          const estOuvert = ouvert === e.eventId;
          const detail = details[e.eventId];
          const close = e.labelKey === "consultation_close";
          const sousTitre = [
            heure(e.occurredAt),
            e.practitionerName,
          ]
            .filter((m): m is string => m !== null && m !== "")
            .join(" Â· ");
          return (
            <div
              key={e.eventId}
              className="border border-rule bg-card px-4 first:rounded-t-2xl last:rounded-b-2xl"
            >
              <button
                type="button"
                onClick={() => basculer(e.eventId)}
                aria-expanded={estOuvert}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 py-3 text-left outline-none transition-colors duration-quick hover:bg-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600"
              >
                <span
                  aria-hidden="true"
                  className={[
                    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-douce",
                    close
                      ? "border-azure-100 bg-tuile-azur text-azure-700"
                      : "border-ambre-100 bg-tuile-ambre text-ambre-700",
                  ].join(" ")}
                >
                  <Icone nom={close ? "agenda" : "horloge"} taille={20} />
                </span>
                <span className="flex min-w-28 flex-1 flex-col items-start gap-0.5 text-left">
                  <span className="truncate font-num text-body font-semibold tabular-nums text-ink-900">
                    {jourLong(e.occurredAt) ?? fr.etats.texteAbsent}
                  </span>
                  {sousTitre === "" ? null : (
                    <span className="truncate font-ui text-label tabular-nums text-ink-500">
                      {sousTitre}
                    </span>
                  )}
                </span>
                <span className="shrink-0">
                  <Badge ton={close ? "neutre" : "attention"}>
                    {close
                      ? fr.patients.chronologie.consultationClose
                      : fr.patients.chronologie.consultationOuverte}
                  </Badge>
                </span>
                <span
                  aria-hidden="true"
                  className={[
                    "shrink-0 text-ink-500 transition-transform duration-quick",
                    estOuvert ? "rotate-90" : "",
                  ].join(" ")}
                >
                  <Icone nom="chevron" taille={20} />
                </span>
              </button>

              {estOuvert ? (
                <div className="border-t border-rule py-4">
                  {detail === undefined ? (
                    <Squelette lignes={4} />
                  ) : (
                    <DetailSeanceAccordion detail={detail} />
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
