"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { traitements as t } from "@/i18n/traitements";

import type { PointPosologie } from "./modele-traitements";

function dateCourte(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(date);
}

function valeurCourte(valeur: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(valeur);
}

/**
 * Un escalier, pas une interpolation.
 *
 * La posologie reste constante entre deux modifications : dessiner une pente
 * inventerait une valeur intermédiaire qui n'a jamais été prescrite. Chaque
 * palier est donc horizontal, chaque changement est vertical, et les seuls
 * points interactifs sont les points RÉELS.
 */
export function CourbePosologie({
  points,
  unite,
  hauteur = 260,
}: {
  readonly points: readonly PointPosologie[];
  readonly unite: string;
  readonly hauteur?: number;
}): React.JSX.Element {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const zone = useRef<HTMLDivElement>(null);
  const [largeur, setLargeur] = useState(720);
  const [actif, setActif] = useState<number | null>(null);

  useEffect(() => {
    const el = zone.current;
    if (el === null) return;
    const mesurer = (): void => {
      const l = el.getBoundingClientRect().width;
      if (l > 0) setLargeur(l);
    };
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const trie = useMemo(
    () => [...points].sort((a, b) => a.date.localeCompare(b.date)),
    [points],
  );

  if (trie.length === 0) {
    return <p className="px-1 py-8 text-center font-ui text-body text-ink-500">{t.evolution.aucunPoint}</p>;
  }

  const margeG = 52;
  const margeD = 16;
  const margeH = 16;
  const margeB = 30;
  const largeurTrace = Math.max(80, largeur - margeG - margeD);
  const hauteurTrace = Math.max(80, hauteur - margeH - margeB);
  const valeurs = trie.map((p) => p.valeur);
  const minBrut = Math.min(...valeurs);
  const maxBrut = Math.max(...valeurs);
  const marge = Math.max(1, (maxBrut - minBrut) * 0.18);
  const min = Math.max(0, minBrut - marge);
  const max = maxBrut + marge;
  const etendue = max - min || 1;

  const temps = trie.map((p) => {
    const v = Date.parse(p.date);
    return Number.isNaN(v) ? null : v;
  });
  const tempsValides = temps.filter((v): v is number => v !== null);
  const tMin = tempsValides.length > 0 ? Math.min(...tempsValides) : 0;
  const tMax = tempsValides.length > 0 ? Math.max(...tempsValides) : 1;
  const x = (index: number): number => {
    if (trie.length === 1) return margeG + largeurTrace / 2;
    const tempsPoint = temps[index];
    if (tempsPoint === null || tempsPoint === undefined) return margeG + (index * largeurTrace) / (trie.length - 1);
    if (tMax === tMin) return margeG + largeurTrace / 2;
    return margeG + ((tempsPoint - tMin) / (tMax - tMin)) * largeurTrace;
  };
  const y = (valeur: number): number => margeH + hauteurTrace - ((valeur - min) / etendue) * hauteurTrace;

  const marches: string[] = [];
  const aires: string[] = [];
  for (let i = 0; i < trie.length; i += 1) {
    const point = trie[i];
    if (point === undefined) continue;
    if (i === 0) {
      marches.push(`M ${x(i)} ${y(point.valeur)}`);
    } else {
      const precedent = trie[i - 1];
      if (precedent === undefined) continue;
      marches.push(`L ${x(i)} ${y(precedent.valeur)}`);
      marches.push(`L ${x(i)} ${y(point.valeur)}`);
    }
  }
  for (let i = 0; i < trie.length; i += 1) {
    const point = trie[i];
    if (point === undefined) continue;
    if (i === 0) {
      aires.push(`M ${x(i)} ${y(point.valeur)}`);
    } else {
      const precedent = trie[i - 1];
      if (precedent === undefined) continue;
      aires.push(`L ${x(i)} ${y(precedent.valeur)}`);
      aires.push(`L ${x(i)} ${y(point.valeur)}`);
    }
  }
  if (trie.length > 0) {
    aires.push(`L ${x(trie.length - 1)} ${margeH + hauteurTrace} L ${x(0)} ${margeH + hauteurTrace} Z`);
  }

  const graduations = [0, 1, 2, 3, 4].map((i) => min + ((max - min) * i) / 4);
  const etiquettes = new Set<number>();
  const pas = Math.max(1, Math.ceil(trie.length / 6));
  for (let i = 0; i < trie.length; i += pas) etiquettes.add(i);
  etiquettes.add(trie.length - 1);

  function deplacer(e: React.PointerEvent<HTMLDivElement>): void {
    const el = zone.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let meilleur = 0;
    let distance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < trie.length; i += 1) {
      const d = Math.abs(x(i) - px);
      if (d < distance) {
        distance = d;
        meilleur = i;
      }
    }
    setActif(meilleur);
  }

  function clavier(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setActif((i) => Math.min(trie.length - 1, (i ?? -1) + 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setActif((i) => Math.max(0, (i ?? trie.length) - 1));
    } else if (e.key === "Escape") {
      setActif(null);
    }
  }

  const actifPoint = actif === null ? null : trie[actif];
  const bulleAGauche = actif !== null && x(actif) > largeur * 0.62;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div
        ref={zone}
        className="relative w-full shrink-0 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600"
        style={{ height: hauteur }}
        tabIndex={0}
        role="group"
        aria-label={`${t.evolution.posologieTitre} — ${unite}`}
        onPointerMove={deplacer}
        onPointerLeave={() => setActif(null)}
        onKeyDown={clavier}
        onBlur={() => setActif(null)}
      >
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${largeur} ${hauteur}`} aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={`posologie-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--emeraude-600)" stopOpacity="0.24" />
              <stop offset="100%" stopColor="var(--emeraude-600)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {graduations.map((g) => (
            <g key={`g-${g}`}>
              <line
                x1={margeG}
                x2={margeG + largeurTrace}
                y1={y(g)}
                y2={y(g)}
                stroke="var(--border)"
                strokeWidth="1"
                strokeDasharray="2 7"
                strokeOpacity="0.8"
              />
              <text x={margeG - 10} y={y(g) + 4} textAnchor="end" className="fill-ink-500 text-eyebrow">
                {valeurCourte(g)}
              </text>
            </g>
          ))}

          <path d={aires.join(" ")} fill={`url(#posologie-${id})`} />
          <path
            d={marches.join(" ")}
            fill="none"
            stroke="var(--emeraude-600)"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {trie.map((point, i) => (
            <circle
              key={point.cle}
              cx={x(i)}
              cy={y(point.valeur)}
              r={actif === i ? 6 : 4}
              fill="var(--emeraude-600)"
              stroke="var(--card)"
              strokeWidth="2.5"
            />
          ))}

          {actif === null ? null : (
            <line
              x1={x(actif)}
              x2={x(actif)}
              y1={margeH}
              y2={margeH + hauteurTrace}
              stroke="var(--emeraude-600)"
              strokeWidth="1"
              strokeDasharray="3 4"
              strokeOpacity="0.55"
            />
          )}
        </svg>

        {actifPoint === undefined || actifPoint === null ? null : (
          <div
            className="verre-bulle absolute top-2 z-10 w-40 px-3 py-2"
            style={{ left: Math.min(Math.max(x(actif ?? 0) - (bulleAGauche ? 150 : 0), 4), Math.max(4, largeur - 160)) }}
          >
            <p className="m-0 font-ui text-label font-semibold text-ink-900">{actifPoint.titre}</p>
            <p className="m-0 mt-1 font-num text-body font-semibold tabular-nums text-ink-900">
              {actifPoint.libelle}
            </p>
          </div>
        )}
      </div>

      <div className="relative h-6 w-full" aria-hidden="true">
        {trie.map((point, i) => {
          if (!etiquettes.has(i)) return null;
          const gauche = trie.length === 1 ? 50 : ((x(i) - margeG) / largeurTrace) * 100;
          return (
            <span
              key={`x-${point.cle}`}
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap font-num text-eyebrow tabular-nums text-ink-500"
              style={{ left: `${gauche}%`, transform: `translateX(${gauche < 4 ? "0" : gauche > 96 ? "-100%" : "-50%"})` }}
            >
              {dateCourte(point.date)}
            </span>
          );
        })}
      </div>

      <table className="cache-visuellement">
        <caption>{t.evolution.posologieTitre}</caption>
        <thead>
          <tr>
            <th scope="col">{t.evolution.date}</th>
            <th scope="col">{`${t.evolution.valeur} (${unite})`}</th>
          </tr>
        </thead>
        <tbody>
          {trie.map((point) => (
            <tr key={`table-${point.cle}`}>
              <th scope="row">{point.titre}</th>
              <td>{point.libelle}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
