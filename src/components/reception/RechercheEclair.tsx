/**
 * La recherche éclair — `/` y met le focus, Entrée liste, Échap referme.
 *
 * UN SEUL chemin de recherche patient : `searchPatients` (ADR-019), la porte
 * auditée. Aucun second index, aucun filtre local sur une table interdite.
 * Les résultats sont des liens vers la fiche existante — le cockpit ne
 * duplique pas la fiche patient.
 */

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fr } from "@/i18n/fr";

import { searchPatients, type PatientListItem } from "@/services/patients";

const PLAFOND_RESULTATS = 8;

export function ResultatsRecherche({
  requete,
  onFermer,
}: {
  readonly requete: string;
  readonly onFermer: () => void;
}): React.JSX.Element {
  const [resultats, setResultats] = useState<readonly PatientListItem[] | undefined>(undefined);
  const [erreur, setErreur] = useState<string | undefined>(undefined);

  useEffect(() => {
    const requetePropre = requete.trim();
    if (requetePropre.length < 2) {
      setResultats(undefined);
      setErreur(undefined);
      return;
    }

    let annule = false;
    const minuteur = setTimeout(() => {
      void searchPatients({ query: requetePropre, limit: PLAFOND_RESULTATS }).then((result) => {
        if (annule) return;
        if (!result.ok) {
          // Hors ligne : on le dit sans bloquer le reste du cockpit (I20).
          setErreur(result.error.message);
          setResultats(undefined);
          return;
        }
        setErreur(undefined);
        setResultats(result.data.rows);
      });
    }, 250);

    return () => {
      annule = true;
      clearTimeout(minuteur);
    };
  }, [requete]);

  useEffect(() => {
    function surEscape(evenement: KeyboardEvent): void {
      if (evenement.key === "Escape") onFermer();
    }
    window.addEventListener("keydown", surEscape);
    return () => window.removeEventListener("keydown", surEscape);
  }, [onFermer]);

  if (erreur !== undefined) {
    return (
      <p role="status" className="rounded-md border border-rule bg-sunken px-4 py-2 font-ui text-label text-ink-500">
        {erreur}
      </p>
    );
  }

  if (resultats === undefined) {
    return <div className="h-1" aria-hidden="true" />;
  }

  if (resultats.length === 0) {
    return (
      <p role="status" className="rounded-md border border-rule bg-sunken px-4 py-2 font-ui text-body text-ink-500">
        {fr.patients.rechercheSansResultat}
      </p>
    );
  }

  return (
    <ul
      role="list"
      className="m-0 flex list-none flex-wrap gap-2 rounded-md border border-rule bg-card p-2"
    >
      {resultats.map((patient) => (
        <li key={patient.id}>
          <Link
            href={`/patients/${patient.id}`}
            onClick={onFermer}
            className={[
              "flex min-h-target items-center gap-3 rounded-md border border-rule bg-card px-3 py-1 no-underline",
              "outline-none transition duration-instant ease-out hover:border-brand-600",
              "focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
            ].join(" ")}
          >
            <span className="font-ui text-body font-medium text-ink-900">
              {[patient.lastName, patient.firstName].filter(Boolean).join(" ") ||
                fr.etats.texteAbsent}
            </span>
            <span className="font-num text-label tabular-nums text-ink-500">{patient.phone}</span>
            <span className="font-ui text-label text-action-700 underline">
              {fr.reception.recherche.ouvrirFiche}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
