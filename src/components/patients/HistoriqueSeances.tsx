"use client";

import { useEffect, useState } from "react";

import { BlocErreur, EtatVide, Squelette, Bouton } from "@/components/ui";
import { CarteSeancePasse } from "@/components/consultation/CarteSeancePasse";
import { cliniqueUi } from "@/i18n/clinical-ui";
import { listPatientTimeline, type TimelineEvent } from "@/services/patients";

const PAGE = 8;
const AUTO = 5;

/**
 * Les séances passées, dans le fil du dossier.
 *
 * Plus de `<select>` : le résumé de chaque séance est le contenu principal, et
 * le détail (SOAP + analyse) s'ouvre sur place. Les trois dernières sont
 * chargées automatiquement ; les plus anciennes le sont au geste, pour ne pas
 * lire cinquante dossiers à l'ouverture.
 */
export function HistoriqueSeances({ patientId }: { readonly patientId: string }): React.JSX.Element {
  const [evenements, setEvenements] = useState<readonly TimelineEvent[] | undefined>(undefined);
  const [visible, setVisible] = useState(PAGE);
  const [erreur, setErreur] = useState<string | undefined>(undefined);

  useEffect(() => {
    let actif = true;
    setEvenements(undefined);
    setErreur(undefined);
    void listPatientTimeline(patientId, null, 50).then((result) => {
      if (!actif) return;
      if (!result.ok) {
        setErreur(result.error.message);
        setEvenements([]);
        return;
      }
      setEvenements(
        result.data.evenements.filter(
          (event) => event.eventType === "consultation" && event.labelKey === "consultation_close",
        ),
      );
    });
    return () => {
      actif = false;
    };
  }, [patientId]);

  if (erreur !== undefined) return <BlocErreur message={erreur} />;
  if (evenements === undefined) return <Squelette lignes={4} />;
  if (evenements.length === 0) return <EtatVide message={cliniqueUi.seances.vide} icone="resume" />;

  const affiches = evenements.slice(0, visible);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {affiches.map((evenement, index) => (
          <CarteSeancePasse
            key={evenement.eventId}
            evenement={evenement}
            chargementAuto={index < AUTO}
            ouverteParDefaut={false}
          />
        ))}
      </div>
      {visible < evenements.length ? (
        <div>
          <Bouton rang="secondaire" onClick={() => setVisible((n) => n + PAGE)}>
            {cliniqueUi.seances.afficherPlus}
          </Bouton>
        </div>
      ) : (
        <p className="m-0 font-ui text-label text-ink-500">{cliniqueUi.seances.fin}</p>
      )}
    </div>
  );
}
