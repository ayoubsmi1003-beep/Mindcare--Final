"use client";

import { useCallback, useEffect, useState } from "react";

import { BlocErreur, Bouton, EtatVide, Squelette } from "@/components/ui";
import { CarteSeancePasse } from "@/components/consultation/CarteSeancePasse";
import { cliniqueUi } from "@/i18n/clinical-ui";
import { fr } from "@/i18n/fr";
import { listPatientTimeline, type TimelineEvent } from "@/services/patients";

/**
 * Les séances précédentes, DANS la consultation en cours.
 *
 * Le panneau ne démonte jamais la séance en cours : c'est sa raison d'être.
 * Chaque carte charge son résumé à la demande (les trois dernières tout de
 * suite, les plus anciennes au geste), et les lectures restent journalisées
 * par `get_consultation` / `get_consultation_analysis`.
 */
const NOMBRE_SEANCES = 12;
const AUTO = 5;

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

  const charger = useCallback((): void => {
    if (patientId === null) return;
    setErreur(undefined);
    setEvenements(undefined);
    void listPatientTimeline(patientId, null, 50).then((result) => {
      if (!result.ok) {
        setErreur(result.error.message);
        setEvenements([]);
        return;
      }
      setEvenements(
        result.data.evenements
          .filter(
            (event) =>
              event.eventType === "consultation" &&
              event.labelKey === "consultation_close" &&
              event.eventId !== consultationActuelleId,
          )
          .slice(0, NOMBRE_SEANCES),
      );
    });
  }, [patientId, consultationActuelleId]);

  useEffect(charger, [charger]);

  if (patientId === null) {
    return <EtatVide message={fr.consultation.historiqueSansDossier} icone="patients" />;
  }

  if (erreur !== undefined) {
    return <BlocErreur message={erreur} action={<Bouton onClick={charger}>{fr.actions.reessayer}</Bouton>} />;
  }

  if (evenements === undefined) return <Squelette lignes={5} />;

  if (evenements.length === 0) {
    return <EtatVide message={fr.consultation.historiqueVide} icone="resume" />;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 font-ui text-label font-medium text-ink-500">{cliniqueUi.seances.sousTitre}</p>
      {evenements.map((evenement, index) => (
        <CarteSeancePasse
          key={evenement.eventId}
          evenement={evenement}
          chargementAuto={index < AUTO}
        />
      ))}
    </div>
  );
}
