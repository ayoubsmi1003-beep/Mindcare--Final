"use client";

import { useEffect, useState } from "react";

import { BlocErreur, EtatVide, Squelette } from "@/components/ui";
import {
  DetailSeanceAccordion,
  type DetailSeanceChargee,
} from "@/components/consultation/DetailSeanceAccordion";
import { fr } from "@/i18n/fr";
import { getConsultation } from "@/services/consultations";
import { chargerAnalyse } from "@/services/jarvis";
import { listPatientTimeline, type TimelineEvent } from "@/services/patients";

import { heure, jourLong } from "./format";

/**
 * Les séances précédentes, derrière un menu déroulant.
 *
 * Une date, un choix, puis la synthèse de la séance et ses notes originales.
 * Le chargement du détail reste paresseux : le dossier ne lit que la séance
 * réellement choisie, et la porte `get_consultation` journalise cet accès.
 */
export function HistoriqueSeances({ patientId }: { readonly patientId: string }): React.JSX.Element {
  const [evenements, setEvenements] = useState<readonly TimelineEvent[] | undefined>(undefined);
  const [selection, setSelection] = useState("");
  const [details, setDetails] = useState<Readonly<Record<string, DetailSeanceChargee>>>({});
  const [erreur, setErreur] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setEvenements(undefined);
    setErreur(undefined);
    void listPatientTimeline(patientId, null, 50).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setErreur(result.error.message);
        setEvenements([]);
        return;
      }
      const consultations = result.data.evenements.filter(
        (event) => event.eventType === "consultation" && event.labelKey === "consultation_close",
      );
      setEvenements(consultations);
      setSelection((current) => current !== "" ? current : consultations[0]?.eventId ?? "");
    });
    return () => { active = false; };
  }, [patientId]);

  useEffect(() => {
    if (selection === "" || details[selection] !== undefined) return;
    let active = true;
    void Promise.all([getConsultation(selection), chargerAnalyse(selection)]).then(([seance, analyse]) => {
      if (!active) return;
      setDetails((previous) => ({
        ...previous,
        [selection]: {
          seance: seance.ok ? seance.data : null,
          analyse: analyse.ok ? analyse.data : null,
          erreur: seance.ok ? undefined : seance.error.message,
        },
      }));
    });
    return () => { active = false; };
  }, [selection, details]);

  if (erreur !== undefined) return <BlocErreur message={erreur} />;
  if (evenements === undefined) return <Squelette lignes={4} />;
  if (evenements.length === 0) return <EtatVide message={fr.consultation.historiqueVide} icone="documents" />;

  const detail = selection === "" ? undefined : details[selection];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="historique-seance-select" className="font-ui text-label font-medium text-ink-500">
          Choisir une séance
        </label>
        <select
          id="historique-seance-select"
          value={selection}
          onChange={(event) => setSelection(event.target.value)}
          className="min-h-target w-full rounded-xl border border-rule bg-card px-3 py-2 font-ui text-body text-ink-900 outline-none transition-colors duration-quick focus-visible:border-action-600 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
        >
          {evenements.map((event) => (
            <option key={event.eventId} value={event.eventId}>
              {[jourLong(event.occurredAt) ?? fr.etats.texteAbsent, heure(event.occurredAt), event.practitionerName]
                .filter((part): part is string => part !== null && part !== "")
                .join(" · ")}
            </option>
          ))}
        </select>
      </div>

      {detail === undefined ? <Squelette lignes={4} /> : <DetailSeanceAccordion detail={detail} />}
    </div>
  );
}
