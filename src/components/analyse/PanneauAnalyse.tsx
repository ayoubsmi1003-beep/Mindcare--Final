"use client";

/**
 * LE PANNEAU DE L'ÉCRAN STATISTIQUES — le cadre de verre, et rien de plus.
 *
 * ⚠️ LA PASTILLE PORTE UNE TEINTE DE DOMAINE, PAS UN STATUT. « ambre » sur la
 * qualité du dossier ne dit pas « alerte » : le rouge reste réservé à la perte
 * de donnée. Une teinte distingue un sujet d'un autre, elle ne juge pas.
 *
 * ⚠️ LE VERRE EST UN CADRE, JAMAIS UN FOND DE VALEUR. Ce composant ne rend
 * aucun chiffre : il pose un titre, une question et une pastille. Les valeurs
 * sont dans ses enfants, sur des plaques opaques (`.plaque-analyse`).
 */

import type { ReactNode } from "react";

import { Icone, type NomIcone } from "@/components/ui/Icones";
import { cn } from "@/lib/utils";

export type TeinteAnalyse = "emeraude" | "aqua" | "azure" | "violet" | "ambre" | "corail";

export interface PanneauAnalyseProps {
  readonly titre: string;
  /** La question à laquelle le panneau répond. Une phrase, jamais un slogan. */
  readonly question?: string;
  readonly icone: NomIcone;
  readonly teinte: TeinteAnalyse;
  /** Le supplément d'en-tête : un écart, une légende, un lien. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  /** Le décalage d'entrée, en ms. 40 ms par panneau, jamais plus. */
  readonly delai?: number;
  /** Le pied du panneau : une note de méthode, une action. */
  readonly pied?: ReactNode;
}

export function PanneauAnalyse({
  titre,
  question,
  icone,
  teinte,
  actions,
  children,
  className,
  delai = 0,
  pied,
}: PanneauAnalyseProps): React.JSX.Element {
  return (
    <section
      className={cn(
        "verre-panneau verre-liseret analyse-monte flex h-full min-w-0 flex-col gap-4 p-5",
        className,
      )}
      style={{ ["--delai" as string]: `${delai}ms` }}
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="icone-lueur" data-teinte={teinte} aria-hidden="true">
            <Icone nom={icone} taille={20} />
          </span>
          <span className="flex min-w-0 flex-col">
            <h2 className="min-w-0 font-ui text-heading font-bold leading-tight tracking-heading text-ink-900">
              {titre}
            </h2>
            {question === undefined ? null : (
              <p className="min-w-0 font-ui text-label leading-snug text-ink-500">{question}</p>
            )}
          </span>
        </div>
        {actions === undefined ? null : <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>

      {pied === undefined ? null : (
        <footer className="font-ui text-label text-ink-500">{pied}</footer>
      )}
    </section>
  );
}

/**
 * L'écart à la période précédente — un chiffre, sa direction, et la raison.
 *
 * ⚠️ AUCUNE FLÈCHE QUAND ELLE NE VEUT RIEN DIRE. Dénominateur nul, période
 * précédente absente, métrique de stock : la pastille l'écrit, elle n'invente
 * pas un « +0 % ».
 */
export function EcartPastille({
  pct,
  absolu,
  comparaison,
  taille = "normal",
}: {
  readonly pct: number | null;
  readonly absolu: number;
  readonly comparaison: string;
  readonly taille?: "normal" | "petit";
}): React.JSX.Element {
  const neutre = pct === null || pct === 0;
  const positif = pct !== null && pct > 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-ui font-semibold",
        taille === "petit" ? "text-eyebrow" : "text-label",
        neutre
          ? "bord-verre verre-clair-fort text-ink-500"
          : positif
            ? "border-positive/25 bg-positive-bg text-positive"
            : "border-attention/25 bg-attention-bg text-attention-ink",
      )}
      title={
        pct === null
          ? `Aucune comparaison possible avec ${comparaison}.`
          : `${absolu > 0 ? "+" : ""}${absolu} par rapport à ${comparaison}.`
      }
    >
      {pct === null ? (
        <span>{comparaison}</span>
      ) : (
        <>
          <span aria-hidden="true">{pct > 0 ? "↑" : pct < 0 ? "↓" : "→"}</span>
          <span className="font-num tabular-nums">{pct > 0 ? "+" : ""}{pct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %</span>
        </>
      )}
    </span>
  );
}
