"use client";

/**
 * DonutChart — composant d'anneau réutilisable, présentation seule.
 *
 * Fondé sur le composant 21st.dev fourni, adapté aux contraintes MindCare :
 *  · aucune arithmétique métier — pct/valeur arrivent déjà calculés ;
 *  · palette via design tokens (var(--…)), pas de hsl codé en dur ;
 *  · effets de survol sobres, pas de néon ;
 *  · animation d'entrée courte, non bouclée, coupée si prefers-reduced-motion ;
 *  · état vide calme, pas de SVG cassé ;
 *  · accessible sans survol (légende externe + libellés aria + focus clavier).
 *
 * Aucune lecture DB, aucun appel externe, aucune écriture — pure présentation
 * (règle constitutionnelle 7, ADR-020 : DbPort en écriture, pas un chart).
 */

import * as React from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DonutChartSegment {
  readonly value: number;
  readonly color: string; // ex. "var(--emeraude-600)" ou var(--chart-2)
  readonly label: string;
  readonly pct?: number; // pourcentage pré-calculé côté serveur quand disponible
  readonly valeurLisible?: string;
  readonly [key: string]: unknown;
}

interface DonutChartProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly data: readonly DonutChartSegment[];
  readonly totalValue?: number;
  readonly size?: number;
  readonly strokeWidth?: number;
  /** Durée de l'animation d'entrée d'un segment (s). Ignorée si reduced-motion. */
  readonly animationDuration?: number;
  readonly animationDelayPerSegment?: number;
  readonly highlightOnHover?: boolean;
  readonly centerContent?: React.ReactNode;
  readonly onSegmentHover?: (segment: DonutChartSegment | null) => void;
  /** Libellé lu quand la donnée est vide (sur-face calme). */
  readonly emptyLabel?: string;
  readonly emptyDescription?: string;
  readonly ariaLabel?: string;
}

// ---------------------------------------------------------------------------
// Composant
// ---------------------------------------------------------------------------

const DonutChart = React.forwardRef<HTMLDivElement, DonutChartProps>(
  (
    {
      data,
      totalValue: propTotalValue,
      size = 200,
      strokeWidth = 20,
      animationDuration = 0.85,
      animationDelayPerSegment = 0.06,
      highlightOnHover = true,
      centerContent,
      onSegmentHover,
      emptyLabel = "Rien à représenter sur cette période.",
      emptyDescription,
      ariaLabel,
      className,
      ...props
    },
    ref,
  ) => {
    const [hoveredSegment, setHoveredSegment] = React.useState<DonutChartSegment | null>(null);
    const [mounted, setMounted] = React.useState(false);
    const [reducedMotion, setReducedMotion] = React.useState(false);

    // Réduit les animations si l'utilisateur le demande — SSRE-safe : défaut false,
    // corrigé après montage côté client.
    React.useEffect(() => {
      const m = window.matchMedia("(prefers-reduced-motion: reduce)");
      const update = (): void => setReducedMotion(m.matches);
      update();
      m.addEventListener("change", update);
      return () => m.removeEventListener("change", update);
    }, []);

    // Déclencheur d'entrée : le prochain frame passe l'offset de `circumference`
    // à sa position cible — c'est la transition CSS qui anime, pas une boucle JS.
    React.useEffect(() => {
      if (reducedMotion) {
        setMounted(true);
        return;
      }
      const id = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(id);
    }, [reducedMotion]);

    const internalTotalValue = React.useMemo(
      () => propTotalValue ?? data.reduce((sum, s) => sum + s.value, 0),
      [data, propTotalValue],
    );

    const isEmpty =
      data.length === 0 ||
      internalTotalValue === 0 ||
      data.every((s) => s.value === 0);

    React.useEffect(() => {
      onSegmentHover?.(hoveredSegment);
    }, [hoveredSegment, onSegmentHover]);

    const handleMouseLeave = React.useCallback(() => {
      setHoveredSegment(null);
    }, []);

    const radius = size / 2 - strokeWidth / 2;
    const circumference = 2 * Math.PI * radius;

    // Couverture : on laisse le parent décider si le chart lui-même porte un
    // label d'ensemble (le tableau équivalent reste en dehors, comme pour Aire).
    const svgAriaLabel =
      ariaLabel ??
      (isEmpty
        ? emptyLabel
        : `${String(data.length)} part(s), total ${String(internalTotalValue)}`);

    let cumulativePct = 0;

    // État vide — un anneau muet, pas un SVG troué, pas de donnée inventée.
    if (isEmpty) {
      return (
        <div
          ref={ref}
          className={cn("relative flex items-center justify-center", className)}
          style={{ width: size, height: size }}
          role="img"
          aria-label={svgAriaLabel}
          {...props}
        >
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className="overflow-visible"
            aria-hidden="true"
            focusable="false"
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="transparent"
              stroke="var(--border)"
              strokeWidth={strokeWidth}
              strokeDasharray={`4 8`}
              opacity={0.55}
            />
          </svg>
          <div
            className="absolute flex flex-col items-center justify-center gap-1 px-6 text-center"
            style={{ width: size - strokeWidth * 2.2, height: size - strokeWidth * 2.2 }}
          >
            <span className="font-ui text-eyebrow font-medium uppercase tracking-eyebrow text-ink-500">
              {emptyLabel}
            </span>
            {emptyDescription ? (
              <span className="font-ui text-label leading-label text-ink-500">{emptyDescription}</span>
            ) : null}
          </div>
        </div>
      );
    }

    const dur = reducedMotion ? 0 : animationDuration;
    const delayStep = reducedMotion ? 0 : animationDelayPerSegment;

    return (
      <div
        ref={ref}
        className={cn("relative flex items-center justify-center", className)}
        style={{ width: size, height: size }}
        onMouseLeave={handleMouseLeave}
        role="img"
        aria-label={svgAriaLabel}
        {...props}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="overflow-visible -rotate-90"
          aria-hidden="true"
          focusable="false"
        >
          {/* Fond — jeton, pas de couleur en dur, lisible en clair et sombre. */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="var(--sunken)"
            strokeWidth={strokeWidth}
          />

          {data.map((segment, index) => {
            if (segment.value === 0) return null;

            const rawPct = segment.pct;
            const pct =
              typeof rawPct === "number"
                ? rawPct
                : internalTotalValue === 0
                  ? 0
                  : (segment.value / internalTotalValue) * 100;
            const arc = (pct / 100) * circumference;
            const offset = (cumulativePct / 100) * circumference;
            const targetOffset = -offset;
            // L'arc très petit (<1.2% du cercle) garde un trait minimal lisible —
            // en dessous, strokeLinecap="round" le ferait disparaître.
            const visibleArc = pct > 0 && pct < 1 ? Math.max(arc, 1.2) : arc;
            const gap = circumference - visibleArc;

            const isActive = hoveredSegment !== null && hoveredSegment.label === segment.label;

            const dashArray = `${visibleArc} ${gap}`;
            // Avant montage l'offset vaut la circonférence entière : le segment
            // entre par rotation, pas par apparition brutale.
            const currentOffset = mounted ? targetOffset : circumference;
            const opacity = mounted ? 1 : 0;

            // On fige cumulative pour ce segment AVANT d'ajouter sa part.
            cumulativePct += pct;

            const ariaSegLabel =
              segment.pct !== undefined
                ? `${segment.label} : ${segment.valeurLisible ?? String(segment.value)} · ${pct.toFixed(1)} %`
                : `${segment.label} : ${segment.valeurLisible ?? String(segment.value)}`;

            return (
              <circle
                key={segment.label || String(index)}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="transparent"
                stroke={segment.color}
                strokeWidth={strokeWidth}
                strokeDasharray={dashArray}
                strokeLinecap={pct >= 99.5 ? "butt" : "round"}
                role={highlightOnHover ? "graphics-symbol" : undefined}
                aria-label={highlightOnHover ? ariaSegLabel : undefined}
                tabIndex={highlightOnHover ? 0 : undefined}
                // Le focus clavier suit exactement le survol souris.
                onMouseEnter={() => {
                  if (highlightOnHover) setHoveredSegment(segment);
                }}
                onFocus={() => {
                  if (highlightOnHover) setHoveredSegment(segment);
                }}
                onBlur={() => {
                  // On ne vide qu'en quittant le chart entier — un Blur isolé
                  // entre deux segments créerait un scintillement du centre.
                  // Le onMouseLeave/onBlur du conteneur s'en charge ; ici on
                  // laisse la valeur telle quelle et le prochain focus la remplace.
                }}
                style={{
                  strokeDashoffset: currentOffset,
                  opacity,
                  // Animation d'entrée — une seule, courte, sans rebond.
                  transition: reducedMotion
                    ? "none"
                    : `stroke-dashoffset ${dur}s cubic-bezier(0.16,1,0.3,1) ${index * delayStep}s, opacity 0.28s ease-out ${index * delayStep}s, transform 0.18s ease-out, filter 0.18s ease-out`,
                  // Survol — subtil, pas de glow néon : légère élévation + luminosité.
                  // `transform` est isolé par `transform-box: fill-box` implicite du SVG.
                  transform: isActive ? "scale(1.02)" : "scale(1)",
                  transformOrigin: "center",
                  filter: isActive
                    ? `brightness(1.08) drop-shadow(0 1px 6px color-mix(in oklch, ${segment.color} 22%, transparent))`
                    : "none",
                  cursor: highlightOnHover ? "pointer" : "default",
                  outline: "none",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setHoveredSegment(null);
                }}
              />
            );
          })}
        </svg>

        {centerContent ? (
          <div
            className="pointer-events-none absolute flex flex-col items-center justify-center text-center"
            style={{
              width: size - strokeWidth * 2.2,
              height: size - strokeWidth * 2.2,
            }}
          >
            {centerContent}
          </div>
        ) : null}
      </div>
    );
  },
);

DonutChart.displayName = "DonutChart";

export { DonutChart };
