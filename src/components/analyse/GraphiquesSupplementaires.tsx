"use client";

/**
 * LES DEUX FORMES QUI MANQUAIENT — pyramide des âges et histogramme de durées.
 *
 * Même contrat que `Courbe` et `Barres` : aucune lecture de base, aucune
 * arithmétique métier, jetons uniquement, tableau équivalent pour les lecteurs
 * d'écran. Les comptes arrivent de `app.analysis_extra`.
 */

import * as React from "react";

import { analyse } from "@/i18n/analyse";
import { formaterNombre, positionRelative } from "@/lib/analyse-series";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════════════
 * PYRAMIDE DES ÂGES
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface BandeAge {
  readonly bande: string;
  readonly f: number;
  readonly m: number;
  readonly nr: number;
}

export function PyramideAges({
  bandes,
  ariaLabel,
}: {
  readonly bandes: readonly BandeAge[];
  readonly ariaLabel: string;
}): React.JSX.Element {
  const total = bandes.reduce((s, b) => s + b.f + b.m + b.nr, 0);
  // ⚠️ UN SEUL SEXE RENSEIGNÉ NE FAIT PAS UNE PYRAMIDE. Avec 158 « non
  // renseigné » et un seul homme, la version appariée n'affichait qu'une barre
  // de 1 et masquait toute la population. On bascule en barres simples tant que
  // le sexe n'est pas connu pour au moins 80 % des dossiers.
  const connus = bandes.reduce((s, b) => s + b.f + b.m, 0);
  const avecSexe = connus > 0 && connus >= total * 0.8;
  const max = Math.max(
    1,
    ...bandes.map((b) => (avecSexe ? Math.max(b.f, b.m) : b.f + b.m + b.nr)),
  );

  if (bandes.every((b) => b.f + b.m + b.nr === 0)) {
    return (
      <p className="py-8 text-center font-ui text-body text-ink-500">
        {analyse.supplementaires.ages.vide}
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      {bandes.map((b, i) => {
        const total = b.f + b.m + b.nr;
        const pctF = positionRelative(b.f, max) ?? 0;
        const pctM = positionRelative(b.m, max) ?? 0;
        const pctTotal = positionRelative(total, max) ?? 0;

        return (
          <div
            key={b.bande}
            className={cn(
              "grid items-center gap-2",
              avecSexe ? "grid-cols-[1fr_auto_1fr]" : "grid-cols-[auto_1fr_auto]",
            )}
            title={`${b.bande} · ${formaterNombre(total)} dossier${total > 1 ? "s" : ""}`}
          >
            {avecSexe ? (
              <span className="flex h-4 justify-end">
                <span
                  className="analyse-pousse h-full rounded-l-[4px] bg-emeraude-600"
                  style={{ width: `${Math.max(pctF, b.f > 0 ? 2 : 0)}%`, ["--delai" as string]: `${i * 30}ms` }}
                />
              </span>
            ) : (
              <span className="w-16 shrink-0 text-right font-num text-eyebrow tabular-nums text-ink-500">
                {b.bande === "non renseigné" ? "n.r." : b.bande}
              </span>
            )}

            <span
              className={cn(
                "text-center font-num text-eyebrow tabular-nums text-ink-500",
                avecSexe ? "w-14" : "hidden",
              )}
            >
              {b.bande === "non renseigné" ? "n.r." : b.bande}
            </span>

            {avecSexe ? (
              <span className="flex h-4">
                <span
                  className="analyse-pousse h-full rounded-r-[4px] bg-aqua-600"
                  style={{ width: `${Math.max(pctM, b.m > 0 ? 2 : 0)}%`, ["--delai" as string]: `${i * 30}ms` }}
                />
              </span>
            ) : (
              <>
                <span className="relative flex h-4 min-w-0 items-center">
                  <span
                  className="analyse-pousse absolute inset-y-0 left-0 rounded-[4px]"
                  style={{
                    width: `${Math.max(pctTotal, 1.5)}%`,
                    backgroundImage: "linear-gradient(90deg, var(--emeraude-600), var(--aqua-500))",
                    ["--delai" as string]: `${i * 30}ms`,
                  }}
                />
                </span>
                <span className="w-10 shrink-0 text-right font-num text-label font-semibold tabular-nums text-ink-900">
                  {formaterNombre(total)}
                </span>
              </>
            )}
          </div>
        );
      })}

      {avecSexe ? (
        <ul className="mt-1 flex flex-wrap items-center gap-4">
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] bg-emeraude-600" />
            <span className="font-ui text-label text-ink-700">{analyse.supplementaires.ages.femmes}</span>
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] bg-aqua-600" />
            <span className="font-ui text-label text-ink-700">{analyse.supplementaires.ages.hommes}</span>
          </li>
        </ul>
      ) : (
        <p className="mt-1 font-ui text-label text-ink-500">{analyse.supplementaires.ages.nonRenseigne}</p>
      )}

      <table className="cache-visuellement">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Bande d&rsquo;âge</th>
            <th scope="col">{analyse.supplementaires.ages.femmes}</th>
            <th scope="col">{analyse.supplementaires.ages.hommes}</th>
            <th scope="col">{analyse.supplementaires.ages.nonRenseigne}</th>
          </tr>
        </thead>
        <tbody>
          {bandes.map((b) => (
            <tr key={`t-${b.bande}`}>
              <th scope="row">{b.bande}</th>
              <td>{b.f}</td>
              <td>{b.m}</td>
              <td>{b.nr}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * HISTOGRAMME DES DURÉES
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface BarreHistogramme {
  readonly cle: string;
  readonly n: number;
}

const BORNES: Record<string, readonly [number, number]> = {
  "0-15": [0, 15],
  "16-30": [15, 30],
  "31-45": [30, 45],
  "46-60": [45, 60],
  "61-90": [60, 90],
  "90+": [90, Number.POSITIVE_INFINITY],
};

export function Histogramme({
  barres,
  mediane,
  ariaLabel,
}: {
  readonly barres: readonly BarreHistogramme[];
  readonly mediane: number | null;
  readonly ariaLabel: string;
}): React.JSX.Element {
  const total = barres.reduce((s, b) => s + b.n, 0);
  const max = Math.max(1, ...barres.map((b) => b.n));

  if (total === 0) {
    return (
      <p className="py-8 text-center font-ui text-body text-ink-500">
        {analyse.supplementaires.durees.vide}
      </p>
    );
  }

  const indexMediane =
    mediane === null
      ? -1
      : barres.findIndex((b) => {
          const bornes = BORNES[b.cle];
          if (bornes === undefined) return false;
          return mediane >= bornes[0] && mediane < bornes[1];
        });

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="relative flex h-36 items-end gap-1.5">
        {barres.map((b, i) => {
          const pct = positionRelative(b.n, max) ?? 0;
          return (
            <div key={b.cle} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <div
                className="analyse-pousse w-full rounded-t-[5px]"
                style={{
                  height: `${Math.max(pct, b.n > 0 ? 3 : 0)}%`,
                  backgroundImage: "linear-gradient(0deg, var(--emeraude-600), var(--aqua-500))",
                  ["--delai" as string]: `${i * 40}ms`,
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.45)",
                }}
                title={`${b.cle} min · ${b.n} séance${b.n > 1 ? "s" : ""}`}
              />
            </div>
          );
        })}

        {indexMediane >= 0 ? (
          <span
            className="pointer-events-none absolute inset-y-0 z-10 flex flex-col items-center"
            style={{ left: `${((indexMediane + 0.5) * 100) / barres.length}%` }}
            aria-hidden="true"
          >
            <span
              className={[
                "mb-0.5 whitespace-nowrap rounded-full border bord-verre verre-clair-fort px-2 py-0.5 font-num text-eyebrow font-semibold tabular-nums text-ink-900 shadow-douce",
                // ⚠️ LE CHIP NE DOIT PAS SORTIR DU PANNEAU. Centré sur la
                // dernière colonne, il débordait de 40 px à droite. Près d'un
                // bord, il s'aligne sur ce bord au lieu de se centrer.
                indexMediane >= barres.length - 2
                  ? "absolute right-0 top-0"
                  : indexMediane <= 0
                    ? "absolute left-0 top-0"
                    : "relative",
              ].join(" ")}
            >
              {analyse.supplementaires.durees.mediane} {mediane} {analyse.supplementaires.durees.minutes}
            </span>
            <span className="w-px flex-1 border-l border-dashed border-ink-300" />
          </span>
        ) : null}
      </div>

      <div className="flex gap-1.5" aria-hidden="true">
        {barres.map((b) => (
          <span
            key={`l-${b.cle}`}
            className="min-w-0 flex-1 truncate text-center font-num text-eyebrow tabular-nums text-ink-500"
          >
            {b.cle}
          </span>
        ))}
      </div>

      <table className="cache-visuellement">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Minutes</th>
            <th scope="col">Séances</th>
          </tr>
        </thead>
        <tbody>
          {barres.map((b) => (
            <tr key={`t-${b.cle}`}>
              <th scope="row">{b.cle}</th>
              <td>{b.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
