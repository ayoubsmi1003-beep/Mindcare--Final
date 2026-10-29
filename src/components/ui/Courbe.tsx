"use client";

/**
 * LA COURBE — une série continue, lisible au clavier, honnête sur les trous.
 *
 * ═══ POURQUOI ELLE N'EST PAS DANS `Graphes.tsx` ════════════════════════════
 *
 * `Graphes.tsx` est un god-file de 59 Ko, déjà consommé par Finances, et l'un
 * des fichiers que la découpe Phase 6 doit ouvrir. Y ajouter une seconde
 * grammaire de courbe aurait rendu cette découpe plus coûteuse sans rien
 * apporter. Ce fichier est un FRÈRE : mêmes jetons, mêmes familles, aucun
 * accès à la base, aucune arithmétique métier.
 *
 * ═══ LA COURBE EST MONOTONE, ET C'EST UNE DÉCISION ═════════════════════════
 *
 * Une spline de Catmull-Rom classique DÉPASSE les valeurs mesurées : entre
 * deux mois à 40 et 60 séances, elle peut dessiner 68, un chiffre qu'aucune
 * donnée ne soutient. L'interpolation monotone de Fritsch–Carlson ne dépasse
 * jamais les extrema locaux. Les seuls points interactifs restent les points
 * RÉELS — l'infobulle ne montre jamais une valeur interpolée.
 *
 * ═══ LES TROUS ═════════════════════════════════════════════════════════════
 *
 * `valeur: null` (ou `couvert: false` avant les premières données) COUPE le
 * tracé. Relier deux points séparés par un trou inventerait une activité qui
 * n'a pas eu lieu. Un zéro mesuré, lui, est un point comme un autre.
 *
 * ═══ L'ACCESSIBILITÉ ═══════════════════════════════════════════════════════
 *
 * Le SVG est `aria-hidden`. Un tableau équivalent, masqué visuellement, porte
 * les valeurs réelles pour un lecteur d'écran. Le conteneur est focusable :
 * les flèches parcourent les points, l'infobulle suit, et `Échap` la referme.
 */

import * as React from "react";

import { analyse } from "@/i18n/analyse";
import {
  indicesEtiquettes,
  indexLePlusProche,
  plafondLisible,
} from "@/lib/analyse-series";
import { cn } from "@/lib/utils";

import { couleurTrait, type Famille } from "./Graphes";

export interface PointCourbe {
  /** Identifiant stable (date ISO du seau). Jamais un nom de patient. */
  readonly cle: string;
  /** Libellé court de l'axe des abscisses. */
  readonly libelle: string;
  /** Libellé long de l'infobulle. */
  readonly titre: string;
  readonly valeur: number | null;
  /** Un second tracé facultatif, sur le MÊME axe (ex. absences). */
  readonly secondaire?: number | null;
  readonly couvert: boolean;
}

export interface CourbeProps {
  readonly points: readonly PointCourbe[];
  readonly famille?: Famille;
  readonly familleSecondaire?: Famille;
  readonly hauteur?: number;
  readonly libellePrimaire: string;
  readonly libelleSecondaire?: string;
  readonly ariaLabel: string;
  readonly onPoint?: (cle: string) => void;
  /**
   * Le plafond de l'axe, quand l'unité a un maximum naturel (un pourcentage :
   * 100). Sans lui, une courbe de taux se recadre sur sa plus haute valeur et
   * une hausse de 14 % à 55 % occupe toute la hauteur — visuellement vraie,
   * cliniquement trompeuse.
   */
  readonly plafond?: number;
}

/** Une série découpée en segments continus — un trou ferme le segment. */
interface Segment {
  readonly index: readonly number[];
}

function decouper(points: readonly PointCourbe[], champ: "valeur" | "secondaire"): Segment[] {
  const segments: Segment[] = [];
  let courant: number[] = [];
  points.forEach((p, i) => {
    const v = p[champ] ?? null;
    if (v === null || !p.couvert) {
      if (courant.length > 0) segments.push({ index: courant });
      courant = [];
      return;
    }
    courant.push(i);
  });
  if (courant.length > 0) segments.push({ index: courant });
  return segments;
}

/**
 * Interpolation monotone (Fritsch–Carlson). Ne dépasse JAMAIS les extrema
 * locaux : c'est la seule raison d'utiliser une courbe plutôt qu'une ligne
 * brisée sur des comptes.
 */
export function cheminMonotone(pts: readonly { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  const premier = pts[0];
  if (premier === undefined) return "";
  if (pts.length === 1) return `M ${premier.x} ${premier.y}`;

  const n = pts.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a === undefined || b === undefined) continue;
    const d = b.x - a.x === 0 ? 1e-6 : b.x - a.x;
    dx[i] = d;
    m[i] = (b.y - a.y) / d;
  }

  const t: number[] = new Array<number>(n).fill(0);
  t[0] = m[0] ?? 0;
  t[n - 1] = m[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i += 1) {
    const m0 = m[i - 1] ?? 0;
    const m1 = m[i] ?? 0;
    if (m0 * m1 <= 0) {
      t[i] = 0;
    } else {
      const w1 = 2 * (dx[i] ?? 0) + (dx[i - 1] ?? 0);
      const w2 = (dx[i] ?? 0) + 2 * (dx[i - 1] ?? 0);
      t[i] = (w1 + w2) / (w1 / m0 + w2 / m1);
    }
  }

  let d = `M ${premier.x} ${premier.y}`;
  for (let i = 0; i < n - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a === undefined || b === undefined) continue;
    const h = dx[i] ?? 0;
    const c1x = a.x + h / 3;
    const c1y = a.y + ((t[i] ?? 0) * h) / 3;
    const c2x = b.x - h / 3;
    const c2y = b.y - ((t[i + 1] ?? 0) * h) / 3;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  }
  return d;
}

export function Courbe({
  points,
  famille = "emeraude",
  familleSecondaire = "ambre",
  hauteur = 248,
  libellePrimaire,
  libelleSecondaire,
  ariaLabel,
  onPoint,
  plafond,
}: CourbeProps): React.JSX.Element {
  const id = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const zoneRef = React.useRef<HTMLDivElement | null>(null);
  const [largeur, setLargeur] = React.useState(720);
  const [actif, setActif] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = zoneRef.current;
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

  const utiles = points.filter((p) => p.valeur !== null && p.couvert);
  if (utiles.length === 0) {
    return (
      <p className="px-1 py-8 text-center font-ui text-body text-ink-500">
        {analyse.graphiques.aucunPoint}
      </p>
    );
  }

  const margeG = 40;
  const margeD = 14;
  const margeH = 16;
  const margeB = 26;
  const largeurTrace = Math.max(80, largeur - margeG - margeD);
  const hauteurTrace = Math.max(60, hauteur - margeH - margeB);

  const valeurs = points.flatMap((p) =>
    [p.valeur, p.secondaire ?? null].filter((v): v is number => v !== null),
  );
  const max = plafond ?? plafondLisible(Math.max(1, ...valeurs));
  const x = (i: number): number =>
    points.length === 1
      ? margeG + largeurTrace / 2
      : margeG + (i * largeurTrace) / (points.length - 1);
  const y = (v: number): number => margeH + hauteurTrace - (v / max) * hauteurTrace;

  const primaire = decouper(points, "valeur");
  const secondaire = decouper(points, "secondaire");

  const chemin = (segments: Segment[], champ: "valeur" | "secondaire"): string =>
    segments
      .map((seg) =>
        cheminMonotone(
          seg.index.map((i) => {
            const p = points[i];
            return { x: x(i), y: y((p?.[champ] ?? 0) as number) };
          }),
        ),
      )
      .join(" ");

  const aire = (segments: Segment[], champ: "valeur" | "secondaire"): string =>
    segments
      .map((seg) => {
        const ids = seg.index;
        const premier = ids[0];
        const dernier = ids[ids.length - 1];
        if (premier === undefined || dernier === undefined) return "";
        const ligne = cheminMonotone(
          ids.map((i) => ({ x: x(i), y: y((points[i]?.[champ] ?? 0) as number) })),
        );
        return `${ligne} L ${x(dernier)} ${margeH + hauteurTrace} L ${x(premier)} ${margeH + hauteurTrace} Z`;
      })
      .join(" ");

  const graduations = [0, 0.25, 0.5, 0.75, 1].map((r) => Math.round(max * r));
  const etiquettes = indicesEtiquettes(points.length, largeur >= 620 ? 7 : 4);
  const actifPoint = actif === null ? null : points[actif];

  function deplacer(e: React.PointerEvent<HTMLDivElement>): void {
    const el = zoneRef.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    setActif(indexLePlusProche(e.clientX - r.left - margeG, largeurTrace, points.length));
  }

  function clavier(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setActif((prec) => {
        const base = prec ?? -1;
        const suivant = e.key === "ArrowRight" ? base + 1 : base - 1;
        return Math.max(0, Math.min(points.length - 1, suivant));
      });
    }
    if (e.key === "Escape") setActif(null);
    if ((e.key === "Enter" || e.key === " ") && actif !== null && onPoint !== undefined) {
      e.preventDefault();
      onPoint(points[actif]?.cle ?? "");
    }
  }

  const bulleAGauche = actif !== null && x(actif) > largeur * 0.62;

  return (
    <div className="relative flex min-w-0 flex-col gap-1">
      <div
        ref={zoneRef}
        className="relative w-full shrink-0 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600"
        style={{ height: hauteur }}
        tabIndex={0}
        role="group"
        aria-label={ariaLabel}
        aria-describedby={`courbe-${id}-aide`}
        onPointerMove={deplacer}
        onPointerLeave={() => setActif(null)}
        onKeyDown={clavier}
        onBlur={() => setActif(null)}
      >
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${largeur} ${hauteur}`}
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient id={`aire-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={couleurTrait(famille)} stopOpacity="0.26" />
              <stop offset="55%" stopColor={couleurTrait(famille)} stopOpacity="0.08" />
              <stop offset="100%" stopColor={couleurTrait(famille)} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`aire2-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={couleurTrait(familleSecondaire)} stopOpacity="0.18" />
              <stop offset="100%" stopColor={couleurTrait(familleSecondaire)} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grille : quatre filets, pointillés courts. Assez pour situer une
              valeur, jamais assez pour concurrencer la courbe. */}
          {graduations.map((g) => (
            <line
              key={`g-${g}`}
              x1={margeG}
              x2={margeG + largeurTrace}
              y1={y(g)}
              y2={y(g)}
              stroke="var(--border)"
              strokeWidth="1"
              strokeDasharray="2 7"
              strokeOpacity={g === 0 ? 1 : 0.75}
            />
          ))}

          {secondaire.length > 0 ? (
            <path d={aire(secondaire, "secondaire")} fill={`url(#aire2-${id})`} />
          ) : null}
          <path d={aire(primaire, "valeur")} fill={`url(#aire-${id})`} />

          {/* Les valeurs d'axe, à gauche du tracé. */}
          {graduations.map((g) => (
            <text
              key={`t-${g}`}
              x={margeG - 10}
              y={y(g) + 4}
              textAnchor="end"
              className="fill-ink-500"
              style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}
            >
              {g}
            </text>
          ))}

          {secondaire.length > 0 ? (
            <path
              d={chemin(secondaire, "secondaire")}
              fill="none"
              stroke={couleurTrait(familleSecondaire)}
              strokeWidth="1.6"
              strokeOpacity="0.7"
              strokeLinecap="round"
              strokeDasharray="5 5"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}

          <path
            className="analyse-trace"
            style={{ ["--longueur" as string]: "2400" }}
            d={chemin(primaire, "valeur")}
            fill="none"
            stroke={couleurTrait(famille)}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Le repère actif : un trait vertical, un point cerclé de blanc. */}
          {actif !== null && points[actif]?.valeur !== null ? (
            <g>
              <line
                x1={x(actif)}
                x2={x(actif)}
                y1={margeH}
                y2={margeH + hauteurTrace}
                stroke={couleurTrait(famille)}
                strokeWidth="1"
                strokeDasharray="3 4"
                strokeOpacity="0.55"
              />
              <circle
                cx={x(actif)}
                cy={y(points[actif]?.valeur ?? 0)}
                r="5"
                fill={couleurTrait(famille)}
                stroke="#fff"
                strokeWidth="2.5"
              />
            </g>
          ) : null}

          {/* Le dernier point, toujours marqué : c'est la valeur d'arrivée. */}
          {(() => {
            const dernier = [...points].reverse().find((p) => p.valeur !== null && p.couvert);
            if (dernier === undefined || actif !== null) return null;
            const i = points.indexOf(dernier);
            return (
              <circle
                cx={x(i)}
                cy={y(dernier.valeur ?? 0)}
                r="4"
                fill={couleurTrait(famille)}
                stroke="#fff"
                strokeWidth="2.5"
              />
            );
          })()}
        </svg>

        {actifPoint !== undefined && actifPoint !== null ? (
          <div
            className={cn(
              "verre-bulle absolute top-2 z-10 min-w-[9.5rem] px-3 py-2",
              bulleAGauche ? "" : "",
            )}
            style={{
              left: Math.min(Math.max(x(actif ?? 0) - (bulleAGauche ? 150 : 0), 4), largeur - 160),
            }}
          >
            <p className="font-ui text-label font-semibold text-ink-900">{actifPoint.titre}</p>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="font-ui text-label text-ink-500">{libellePrimaire}</span>
              <span className="font-num text-body font-semibold tabular-nums text-ink-900">
                {actifPoint.valeur ?? "—"}
              </span>
            </div>
            {libelleSecondaire !== undefined && actifPoint.secondaire !== undefined ? (
              <div className="mt-0.5 flex items-baseline justify-between gap-3">
                <span className="font-ui text-label text-ink-500">{libelleSecondaire}</span>
                <span className="font-num text-body font-semibold tabular-nums text-ink-700">
                  {actifPoint.secondaire ?? "—"}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* L'axe des abscisses, en HTML : du vrai texte, net, sélectionnable. */}
      <div className="relative h-6 w-full" aria-hidden="true">
        {points.map((p, i) => {
          if (!etiquettes.includes(i)) return null;
          const gauche = points.length === 1 ? 50 : (i * 100) / (points.length - 1);
          return (
            <span
              key={`x-${p.cle}`}
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap font-num text-eyebrow tabular-nums text-ink-500"
              style={{
                left: `${gauche}%`,
                transform: `translateX(${gauche < 4 ? "0" : gauche > 96 ? "-100%" : "-50%"})`,
              }}
            >
              {p.libelle}
            </span>
          );
        })}
      </div>

      <p id={`courbe-${id}-aide`} className="cache-visuellement">
        {analyse.graphiques.astuce}
      </p>

      <table className="cache-visuellement">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">{analyse.graphiques.legende}</th>
            <th scope="col">{libellePrimaire}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={`r-${p.cle}`}>
              <th scope="row">{p.titre}</th>
              <td>{p.valeur ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
