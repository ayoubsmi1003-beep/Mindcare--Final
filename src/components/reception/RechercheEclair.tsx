/**
 * RechercheEclair — dropdown absolu, ne pousse pas le layout.
 * Même porte search_patients, debounce 250ms, plafond 8.
 */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fr } from "@/i18n/fr";
import { searchPatients, type PatientListItem } from "@/services/patients";

const PLAFOND = 8;

export function ResultatsRecherche({ requete, onFermer }: { readonly requete: string; readonly onFermer: () => void }): React.JSX.Element {
  const [resultats, setResultats] = useState<readonly PatientListItem[] | undefined>(undefined);
  const [erreur, setErreur] = useState<string | undefined>(undefined);

  useEffect(() => {
    const propre = requete.trim();
    if (propre.length < 2) {
      setResultats(undefined);
      setErreur(undefined);
      return;
    }
    let annule = false;
    const t = setTimeout(() => {
      void searchPatients({ query: propre, limit: PLAFOND }).then((r) => {
        if (annule) return;
        if (!r.ok) {
          setErreur(r.error.message);
          setResultats(undefined);
          return;
        }
        setErreur(undefined);
        setResultats(r.data.rows);
      });
    }, 250);
    return () => {
      annule = true;
      clearTimeout(t);
    };
  }, [requete]);

  useEffect(() => {
    function esc(e: KeyboardEvent): void {
      if (e.key === "Escape") onFermer();
    }
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFermer]);

  if (erreur !== undefined) {
    return (
      <div className="absolute inset-x-0 top-full z-20 mt-2 rounded-lg border border-rule bg-card p-3 shadow-lift3">
        <p role="status" className="font-ui text-body text-ink-500">{erreur}</p>
      </div>
    );
  }
  if (resultats === undefined) return <span aria-hidden="true" className="hidden" />;
  if (resultats.length === 0) {
    return (
      <div className="absolute inset-x-0 top-full z-20 mt-2 rounded-lg border border-rule bg-card p-3 shadow-lift3">
        <p role="status" className="font-ui text-body text-ink-500">{fr.patients.rechercheSansResultat}</p>
      </div>
    );
  }

  return (
    <div className="absolute inset-x-0 top-full z-20 mt-2 max-h-liste overflow-y-auto rounded-lg border border-rule bg-card p-2 shadow-lift3">
      <ul role="list" className="m-0 flex list-none flex-col gap-1.5 p-0">
        {resultats.map((p) => (
          <li key={p.id}>
            <Link
              href={`/patients/${p.id}`}
              onClick={onFermer}
              className="flex min-h-target items-center gap-3 rounded-md border border-rule bg-card px-3 py-2 no-underline outline-none hover:border-brand-600 hover:shadow-lift1 focus-visible:outline focus-visible:outline-action-600"
            >
              <span className="min-w-0 flex-1 truncate font-ui text-body font-medium text-ink-900">
                {[p.lastName, p.firstName].filter(Boolean).join(" ") || fr.etats.texteAbsent}
              </span>
              <span className="shrink-0 font-num text-label tabular-nums text-ink-500">{p.phone}</span>
              <span className="hidden shrink-0 font-num text-label tabular-nums text-ink-500 desktop:inline">{p.recordNumber}</span>
              <span className="shrink-0 font-ui text-label font-medium text-action-600">{fr.reception.recherche.ouvrirFiche} →</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
