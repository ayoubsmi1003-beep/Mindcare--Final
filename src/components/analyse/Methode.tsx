"use client";

/**
 * LA MÉTHODE — ce que compte chaque chiffre, et ce qu'il ne compte pas.
 *
 * Ce panneau n'est pas une note de bas de page décorative : sans lui, « 387
 * séances sans note » ne dit ni quelle fenêtre, ni quel périmètre, ni pourquoi
 * la comparaison est absente. Un tableau de bord clinique qui ne peut pas
 * expliquer un chiffre ne devrait pas l'afficher.
 */

import { analyse } from "@/i18n/analyse";
import { formaterDate, formaterNombre } from "@/lib/analyse-series";
import type { ApercuAnalyse } from "@/services/analyse";

export function Methode({ apercu }: { readonly apercu: ApercuAnalyse }): React.JSX.Element {
  const t = analyse.panneaux.methode;
  const premiere = apercu.couverture.premiere_activite;
  const derniere = apercu.couverture.derniere_activite;

  return (
    <details
      className="verre-panneau verre-liseret analyse-monte group p-0"
      style={{ ["--delai" as string]: "440ms" }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600">
        <span className="flex min-w-0 items-center gap-3">
          <span className="icone-lueur" data-teinte="emeraude" aria-hidden="true">
            <span className="font-ui text-body font-bold">i</span>
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-ui text-heading font-bold tracking-heading text-ink-900">
              {t.titre}
            </span>
            <span className="truncate font-ui text-label text-ink-500">{t.resume}</span>
          </span>
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 font-ui text-title text-ink-500 transition group-open:rotate-45"
        >
          +
        </span>
      </summary>

      <div className="grid grid-cols-1 gap-5 border-t border-white/70 px-5 py-5 tablet:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <h3 className="font-ui text-label font-semibold text-ink-900">{t.periode}</h3>
          <p className="font-ui text-label text-ink-500">
            {formaterDate(apercu.periode.du)} → {formaterDate(apercu.periode.au)} ·{" "}
            {formaterNombre(apercu.periode.jours)} jours ·{" "}
            {apercu.periode.granularite === "jour"
              ? "seaux journaliers"
              : apercu.periode.granularite === "semaine"
                ? "seaux hebdomadaires"
                : "seaux mensuels"}
          </p>
          <p className="font-ui text-label text-ink-500">
            {t.comparaison} :{" "}
            <span className="font-num tabular-nums">
              {apercu.periode.precedente_du} → {apercu.periode.precedente_au}
            </span>
          </p>
          {premiere === null ? null : (
            <p className="font-ui text-label text-ink-500">
              {t.premiereActivite} : <span className="font-num tabular-nums">{formaterDate(premiere)}</span>
              {derniere === null ? null : (
                <>
                  {" · "}
                  {t.derniereActivite} :{" "}
                  <span className="font-num tabular-nums">{formaterDate(derniere)}</span>
                </>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <h3 className="font-ui text-label font-semibold text-ink-900">{t.comparaison}</h3>
          <p className="font-ui text-label leading-relaxed text-ink-500">{t.comparaisonTexte}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <h3 className="font-ui text-label font-semibold text-ink-900">{t.source}</h3>
          <p className="font-ui text-label leading-relaxed text-ink-500">{t.sourceTexte}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <h3 className="font-ui text-label font-semibold text-ink-900">{t.limites}</h3>
          <p className="font-ui text-label leading-relaxed text-ink-500">{t.limitesTexte}</p>
        </div>
      </div>
    </details>
  );
}
