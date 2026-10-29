"use client";

/**
 * LE TIROIR DE DÉTAIL — le seul endroit de l'écran qui nomme une patiente.
 *
 * ⚠️ IL S'OUVRE SUR UN GESTE, JAMAIS AU CHARGEMENT. La porte de détail écrit
 * une trace de lecture `liste` AVANT de rendre un nom (ADR-019). Un écran
 * d'agrégats qui préchargerait des noms produirait une trace de lecture pour
 * une consultation qui n'a pas eu lieu — exactement ce que la règle interdit.
 *
 * ⚠️ LE VERRE EST ICI UNE SURFACE FLOTTANTE, comme le panneau Jarvis. C'est
 * le seul cas où le verre porte des valeurs, et il est opaque à 0.94 : les
 * noms et les dates restent lisibles sur ce qui défile derrière.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { analyse } from "@/i18n/analyse";
import { formaterDate, formaterHeure } from "@/lib/analyse-series";
import {
  getAnalyseDetail,
  type CleDetail,
  type DetailAnalyse,
  type LigneAnalyse,
} from "@/services/analyse";

export interface DemandeDetail {
  readonly kind: CleDetail;
  readonly cle: string | null;
  readonly titre: string;
  readonly grain?: "jour" | "semaine" | "mois";
}

interface Etat {
  readonly statut: "chargement" | "charge" | "erreur";
  readonly donnees?: DetailAnalyse | null;
}

const PAR_PAGE = 50;

export function DrawerAnalyse({
  demande,
  du,
  au,
  onFermer,
}: {
  readonly demande: DemandeDetail | null;
  readonly du: string;
  readonly au: string;
  readonly onFermer: () => void;
}): React.JSX.Element | null {
  const [etat, setEtat] = useState<Etat>({ statut: "chargement" });
  const [page, setPage] = useState(0);
  const fermerRef = useRef<HTMLButtonElement | null>(null);
  const panneauRef = useRef<HTMLDivElement | null>(null);

  const charger = useCallback(
    async (d: DemandeDetail, offset: number) => {
      setEtat({ statut: "chargement" });
      const r = await getAnalyseDetail(d.kind, d.cle, du, au, offset, d.grain ?? "jour");
      if (!r.ok) {
        setEtat({ statut: "erreur" });
        return;
      }
      setEtat({ statut: "charge", donnees: r.data });
    },
    [du, au],
  );

  // Une nouvelle demande repart de la première page.
  useEffect(() => {
    setPage(0);
  }, [demande]);

  useEffect(() => {
    if (demande === null) return;
    void charger(demande, page * PAR_PAGE);
  }, [demande, page, charger]);

  // Le fond ne défile pas sous le tiroir, et le focus entre dedans.
  useEffect(() => {
    if (demande === null) return;
    const ancien = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    fermerRef.current?.focus();
    return () => {
      document.body.style.overflow = ancien;
    };
  }, [demande]);

  useEffect(() => {
    if (demande === null) return;
    function auClavier(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        onFermer();
        return;
      }
      if (e.key !== "Tab") return;
      const racine = panneauRef.current;
      if (racine === null) return;
      const cibles = racine.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (cibles.length === 0) return;
      const premier = cibles[0];
      const dernier = cibles[cibles.length - 1];
      if (premier === undefined || dernier === undefined) return;
      if (e.shiftKey && document.activeElement === premier) {
        e.preventDefault();
        dernier.focus();
      } else if (!e.shiftKey && document.activeElement === dernier) {
        e.preventDefault();
        premier.focus();
      }
    }
    document.addEventListener("keydown", auClavier);
    return () => document.removeEventListener("keydown", auClavier);
  }, [demande, onFermer]);

  if (demande === null) return null;

  const total = etat.donnees?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));
  const courante = Math.min(page + 1, pages);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      {/* Le voile : il ferme au clic, et il est annoncé comme tel. */}
      <button
        type="button"
        aria-label={analyse.detail.fermer}
        onClick={onFermer}
        className="absolute inset-0 cursor-default bg-night-bg/45 backdrop-blur-[3px]"
        tabIndex={-1}
      />

      <div
        ref={panneauRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titre-detail-analyse"
        className="verre-panneau verre-liseret relative flex h-full w-full max-w-[34rem] flex-col rounded-none border-y-0 border-r-0 border-l bord-verre bg-[rgba(250,253,251,0.96)] p-0 shadow-[-28px_0_64px_-32px_rgba(10,31,12,0.45)]"
      >
        <header className="flex items-start justify-between gap-4 border-b bord-verre px-6 py-5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-ui text-eyebrow uppercase tracking-eyebrow text-ink-500">
              {analyse.detail.titre}
            </p>
            <h2
              id="titre-detail-analyse"
              className="min-w-0 truncate font-ui text-title font-bold tracking-title text-ink-900"
            >
              {demande.titre}
            </h2>
            <p className="font-num text-label tabular-nums text-ink-500">
              {etat.statut === "charge" ? `${total} ${analyse.detail.resultats}` : "…"}
            </p>
          </div>
          <button
            ref={fermerRef}
            type="button"
            onClick={onFermer}
            className="min-h-9 shrink-0 rounded-full border bord-verre verre-clair-fort px-3 font-ui text-label font-medium text-ink-700 transition hover:bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600"
          >
            {analyse.detail.fermer}
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {etat.statut === "chargement" ? (
            <p className="py-10 text-center font-ui text-body text-ink-500">
              {analyse.detail.chargement}
            </p>
          ) : null}

          {etat.statut === "erreur" ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="font-ui text-body text-ink-700">{analyse.detail.erreur}</p>
              <button
                type="button"
                onClick={() => void charger(demande, page * PAR_PAGE)}
                className="min-h-9 rounded-full bg-action-600 px-4 font-ui text-label font-semibold text-on-brand transition hover:bg-action-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600"
              >
                {analyse.detail.reessayer}
              </button>
            </div>
          ) : null}

          {etat.statut === "charge" && total === 0 ? (
            <p className="py-10 text-center font-ui text-body text-ink-500">{analyse.detail.vide}</p>
          ) : null}

          {etat.statut === "charge" && total > 0 ? (
            <ul className="flex flex-col divide-y divide-rule">
              {(etat.donnees?.lignes ?? []).map((l) => (
                <LigneDetailAnalyse key={`${l.patientId}-${l.evenementLe}-${l.consultationId ?? l.rendezVousId ?? ""}`} ligne={l} />
              ))}
            </ul>
          ) : null}
        </div>

        {total > PAR_PAGE ? (
          <footer className="flex items-center justify-between gap-3 border-t bord-verre px-6 py-3">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="min-h-8 rounded-full border bord-verre verre-clair-fort px-3 font-ui text-label text-ink-700 transition hover:bg-card disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600"
            >
              {analyse.detail.precedent}
            </button>
            <span className="font-num text-label tabular-nums text-ink-500">
              {analyse.detail.page} {courante} {analyse.detail.sur} {pages}
            </span>
            <button
              type="button"
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="min-h-8 rounded-full border bord-verre verre-clair-fort px-3 font-ui text-label text-ink-700 transition hover:bg-card disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600"
            >
              {analyse.detail.suivant}
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}

function LigneDetailAnalyse({ ligne }: { readonly ligne: LigneAnalyse }): React.JSX.Element {
  const date = new Date(ligne.evenementLe);
  const valide = !Number.isNaN(date.getTime());
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-ui text-body font-medium text-ink-900">{ligne.nom}</span>
        <span className="flex flex-wrap items-baseline gap-x-2 font-num text-label tabular-nums text-ink-500">
          {ligne.numero === null ? null : <span>{ligne.numero}</span>}
          {valide ? (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {formaterDate(ligne.evenementLe)} {formaterHeure(ligne.evenementLe)}
              </span>
            </>
          ) : null}
          {ligne.valeur === null ? null : (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-ink-700">{ligne.valeur}</span>
            </>
          )}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {ligne.consultationId === null ? null : (
          <Link
            href={`/consultation/${ligne.consultationId}`}
            className="rounded-full border bord-verre verre-clair-fort px-2.5 py-1 font-ui text-eyebrow font-medium text-action-700 transition hover:bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600"
          >
            {analyse.detail.ouvrirSeance}
          </Link>
        )}
        <Link
          href={`/patients/${ligne.patientId}`}
          className="rounded-full border bord-verre verre-clair-fort px-2.5 py-1 font-ui text-eyebrow font-medium text-action-700 transition hover:bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600"
        >
          {analyse.detail.ouvrirDossier}
        </Link>
      </div>
    </li>
  );
}
