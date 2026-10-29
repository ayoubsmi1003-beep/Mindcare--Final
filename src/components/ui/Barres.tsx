"use client";

/**
 * LES BARRES — comparaison groupée et classement horizontal.
 *
 * Même contrat que `Courbe` : aucun accès à la base, aucune arithmétique
 * métier, jetons uniquement, tableau équivalent pour les lecteurs d'écran.
 *
 * ⚠️ LES BARRES SONT EN HTML, PAS EN SVG. Deux raisons mesurables : les coins
 * arrondis d'une colonne SVG étirée se déforment (`preserveAspectRatio="none"`
 * transforme un rayon de 6 px en ovale), et une barre HTML porte nativement le
 * survol, le focus et la transition sans recalculer de tracé. Les valeurs
 * viennent toutes de la porte : ici on ne calcule qu'une HAUTEUR.
 */

import * as React from "react";

import { analyse } from "@/i18n/analyse";
import { formaterNombre, indicesEtiquettes, positionRelative } from "@/lib/analyse-series";
import { cn } from "@/lib/utils";

import { couleurTrait, type Famille } from "./Graphes";

/* ═══════════════════════════════════════════════════════════════════════════
 * BARRES GROUPÉES — deux séries, une catégorie
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface CategorieBarre {
  readonly cle: string;
  readonly libelle: string;
  /** Le libellé long de l'infobulle. */
  readonly titre: string;
}

export interface SerieBarres {
  readonly cle: string;
  readonly libelle: string;
  readonly famille: Famille;
  readonly valeurs: readonly (number | null)[];
}

export function BarresComparees({
  categories,
  series,
  hauteur = 190,
  ariaLabel,
  etiquettesMax,
  onCategorie,
}: {
  readonly categories: readonly CategorieBarre[];
  readonly series: readonly SerieBarres[];
  readonly hauteur?: number;
  readonly ariaLabel: string;
  /** Au-delà de ce nombre, seules quelques abscisses sont écrites. */
  readonly etiquettesMax?: number;
  readonly onCategorie?: (cle: string) => void;
}): React.JSX.Element {
  const [actif, setActif] = React.useState<number | null>(null);
  const visibles =
    etiquettesMax === undefined
      ? null
      : new Set(indicesEtiquettes(categories.length, etiquettesMax));

  const max = Math.max(
    1,
    ...series.flatMap((s) => s.valeurs.map((v) => (v === null ? 0 : v))),
  );

  const palette = ["bg-emeraude-600", "bg-aqua-600", "bg-azure-600", "bg-violet-600"];
  // ⚠️ L'ÉCART S'ADAPTE AU NOMBRE DE COLONNES. 24 heures dans un panneau de
  // 300 px avec `gap-4` : 23 gouttières de 16 px = 368 px, plus larges que le
  // panneau — les barres s'écrasaient à ZÉRO et le panneau paraissait vide.
  const ecart = categories.length > 14 ? "gap-1" : categories.length > 8 ? "gap-2" : "gap-4";

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className={cn("flex items-end", ecart)} style={{ height: hauteur }}>
        {categories.map((cat, i) => {
          const survole = actif === i;
          return (
            <div
              key={cat.cle}
              className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-1.5"
              onPointerEnter={() => setActif(i)}
              onPointerLeave={() => setActif(null)}
              onFocus={() => setActif(i)}
              onBlur={() => setActif(null)}
              tabIndex={onCategorie === undefined ? -1 : 0}
              role={onCategorie === undefined ? undefined : "button"}
              aria-label={onCategorie === undefined ? undefined : `${cat.titre} — ${analyse.actions.voirDossiers}`}
              onClick={() => onCategorie?.(cat.cle)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && onCategorie !== undefined) {
                  e.preventDefault();
                  onCategorie(cat.cle);
                }
              }}
            >
              {series.map((s, si) => {
                const valeur = s.valeurs[i] ?? null;
                const pct = positionRelative(valeur, max);
                return (
                  <div key={`${cat.cle}-${s.cle}`} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                    <div
                      className={cn(
                        "analyse-pousse w-full rounded-t-[5px] transition duration-quick ease-soft",
                        palette[si % palette.length],
                        survole ? "opacity-100" : "opacity-[0.88]",
                      )}
                      style={{
                        height: pct === null || pct === 0 ? "2px" : `${Math.max(2, pct)}%`,
                        ["--delai" as string]: `${i * 18 + si * 30}ms`,
                        boxShadow: survole
                          ? "inset 0 1px 0 rgba(255,255,255,0.55), 0 -6px 16px -6px rgba(27,94,32,0.45)"
                          : "inset 0 1px 0 rgba(255,255,255,0.45)",
                      }}
                    />
                  </div>
                );
              })}

              {survole ? (
                <div className="verre-bulle absolute bottom-full left-1/2 z-20 mb-2 w-max min-w-[9rem] -translate-x-1/2 px-3 py-2">
                  <p className="font-ui text-label font-semibold text-ink-900">{cat.titre}</p>
                  {series.map((s) => (
                    <div key={`b-${s.cle}`} className="mt-0.5 flex items-baseline justify-between gap-4">
                      <span className="font-ui text-label text-ink-500">{s.libelle}</span>
                      <span className="font-num text-body font-semibold tabular-nums text-ink-900">
                        {s.valeurs[i] === null ? "—" : formaterNombre(s.valeurs[i] ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className={cn("flex", ecart)} aria-hidden="true">
        {categories.map((c, i) => (
          <span
            key={`l-${c.cle}`}
            className="min-w-0 flex-1 truncate text-center font-num text-eyebrow tabular-nums text-ink-500"
            style={{ opacity: visibles === null || visibles.has(i) ? 1 : 0 }}
          >
            {c.libelle}
          </span>
        ))}
      </div>

      {series.length > 1 ? <LegendeSeries series={series} /> : null}

      <table className="cache-visuellement">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Période</th>
            {series.map((s) => (
              <th key={`th-${s.cle}`} scope="col">
                {s.libelle}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((c, i) => (
            <tr key={`tr-${c.cle}`}>
              <th scope="row">{c.titre}</th>
              {series.map((s) => (
                <td key={`td-${c.cle}-${s.cle}`}>{s.valeurs[i] ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LegendeSeries({
  series,
}: {
  readonly series: readonly Pick<SerieBarres, "cle" | "libelle" | "famille">[];
}): React.JSX.Element {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {series.map((s) => (
        <li key={`leg-${s.cle}`} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-[3px]"
            style={{ backgroundColor: couleurTrait(s.famille) }}
          />
          <span className="font-ui text-label text-ink-700">{s.libelle}</span>
        </li>
      ))}
    </ul>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * BARRES CLASSÉES — un libellé, une valeur, un rang
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface LigneRang {
  readonly cle: string;
  readonly libelle: string;
  readonly valeur: number;
  readonly detail?: string;
}

export function BarresRang({
  lignes,
  famille = "emeraude",
  ariaLabel,
  onLigne,
}: {
  readonly lignes: readonly LigneRang[];
  readonly famille?: Famille;
  readonly ariaLabel: string;
  readonly onLigne?: (cle: string) => void;
}): React.JSX.Element {
  const max = Math.max(1, ...lignes.map((l) => l.valeur));
  const trait = couleurTrait(famille);

  if (lignes.length === 0) {
    return <p className="py-6 text-center font-ui text-body text-ink-500">{analyse.etats.vide}</p>;
  }

  return (
    <ul className="flex min-w-0 flex-col gap-2.5">
      {lignes.map((l, i) => {
        const pct = positionRelative(l.valeur, max) ?? 0;
        return (
          <li key={l.cle} className="min-w-0">
            <button
              type="button"
              disabled={onLigne === undefined}
              onClick={() => onLigne?.(l.cle)}
              className={cn(
                "group flex w-full min-w-0 flex-col gap-1 rounded-md px-1 py-0.5 text-left",
                onLigne === undefined ? "cursor-default" : "transition hover:bg-white/60",
              )}
            >
              <span className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-ui text-label font-medium text-ink-900">
                  {l.libelle}
                </span>
                <span className="shrink-0 font-num text-label font-semibold tabular-nums text-ink-900">
                  {formaterNombre(l.valeur)}
                  {l.detail === undefined ? null : (
                    <span className="ml-1.5 font-ui font-normal text-ink-500">· {l.detail}</span>
                  )}
                </span>
              </span>
              <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-white/70">
                <span
                  className="analyse-pousse absolute inset-y-0 left-0 block rounded-full"
                  style={{
                    width: `${Math.max(1.5, pct)}%`,
                    backgroundImage: `linear-gradient(90deg, ${trait} 0%, color-mix(in oklab, ${trait} 55%, white) 100%)`,
                    ["--delai" as string]: `${i * 40}ms`,
                    transformOrigin: "left center",
                  }}
                />
              </span>
            </button>
          </li>
        );
      })}
      <li className="cache-visuellement">
        <table>
          <caption>{ariaLabel}</caption>
          <tbody>
            {lignes.map((l) => (
              <tr key={`r-${l.cle}`}>
                <th scope="row">{l.libelle}</th>
                <td>{l.valeur}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </li>
    </ul>
  );
}
