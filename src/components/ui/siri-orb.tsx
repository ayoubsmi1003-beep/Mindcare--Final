"use client";

import * as React from "react";

import "@/styles/siri-orb.css";

function cn(...classes: Array<string | undefined | null | false>): string {
  return classes.filter(Boolean).join(" ");
}

const SIZE_THRESHOLD_SMALL = 50;
const SIZE_THRESHOLD_TINY = 30;
const SIZE_THRESHOLD_MEDIUM = 100;
const BLUR_MULTIPLIER_SMALL = 0.008;
const BLUR_MIN_SMALL = 1;
const BLUR_MULTIPLIER_LARGE = 0.015;
const BLUR_MIN_LARGE = 4;
const CONTRAST_MULTIPLIER_SMALL = 0.004;
const CONTRAST_MIN_SMALL = 1.2;
const CONTRAST_MULTIPLIER_LARGE = 0.008;
const CONTRAST_MIN_LARGE = 1.5;
const DOT_SIZE_MULTIPLIER_SMALL = 0.004;
const DOT_SIZE_MIN_SMALL = 0.05;
const DOT_SIZE_MULTIPLIER_LARGE = 0.008;
const DOT_SIZE_MIN_LARGE = 0.1;
const SHADOW_MULTIPLIER_SMALL = 0.004;
const SHADOW_MIN_SMALL = 0.5;
const SHADOW_MULTIPLIER_LARGE = 0.008;
const SHADOW_MIN_LARGE = 2;
const MASK_RADIUS_TINY = "0%";
const MASK_RADIUS_SMALL = "5%";
const MASK_RADIUS_MEDIUM = "15%";
const MASK_RADIUS_LARGE = "25%";
const CONTRAST_TINY = 1.1;
const CONTRAST_MULTIPLIER_FINAL = 1.2;
const CONTRAST_MIN_FINAL = 1.3;

export interface SiriOrbProps {
  readonly animationDuration?: number;
  readonly className?: string;
  readonly colors?: {
    readonly bg?: string;
    readonly c1?: string;
    readonly c2?: string;
    readonly c3?: string;
  };
  readonly size?: string;
  /**
   * État Alexa V10 — même orbe émeraude, seul le mouvement/halo change :
   * idle | ecoute | traitement | parole | confirmation.
   */
  readonly etat?: "idle" | "ecoute" | "traitement" | "parole" | "confirmation";
}

const DUREE_PAR_ETAT: Record<NonNullable<SiriOrbProps["etat"]>, number> = {
  idle: 20,
  ecoute: 6,
  traitement: 3,
  parole: 8,
  confirmation: 2,
};

export const SiriOrb: React.FC<SiriOrbProps> = ({
  size = "192px",
  className,
  colors,
  animationDuration,
  etat = "idle",
}) => {
  /* Défaut sauge — références aux jetons (jamais de littéral couleur en
     TSX) : cœur nuit, primary, vert moyen, sauge claire. */
  const defaultColors = {
    bg: "var(--chart-5)",
    c1: "var(--primary)",
    c2: "var(--chart-2)",
    c3: "var(--accent)",
  };

  const finalColors = { ...defaultColors, ...colors };

  const sizeValue = Number.parseInt(size.replace("px", ""), 10);

  const blurAmount =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * BLUR_MULTIPLIER_SMALL, BLUR_MIN_SMALL)
      : Math.max(sizeValue * BLUR_MULTIPLIER_LARGE, BLUR_MIN_LARGE);

  const contrastAmount =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * CONTRAST_MULTIPLIER_SMALL, CONTRAST_MIN_SMALL)
      : Math.max(sizeValue * CONTRAST_MULTIPLIER_LARGE, CONTRAST_MIN_LARGE);

  const dotSize =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * DOT_SIZE_MULTIPLIER_SMALL, DOT_SIZE_MIN_SMALL)
      : Math.max(sizeValue * DOT_SIZE_MULTIPLIER_LARGE, DOT_SIZE_MIN_LARGE);

  const shadowSpread =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * SHADOW_MULTIPLIER_SMALL, SHADOW_MIN_SMALL)
      : Math.max(sizeValue * SHADOW_MULTIPLIER_LARGE, SHADOW_MIN_LARGE);

  const getMaskRadius = (value: number): string => {
    if (value < SIZE_THRESHOLD_TINY) return MASK_RADIUS_TINY;
    if (value < SIZE_THRESHOLD_SMALL) return MASK_RADIUS_SMALL;
    if (value < SIZE_THRESHOLD_MEDIUM) return MASK_RADIUS_MEDIUM;
    return MASK_RADIUS_LARGE;
  };

  const maskRadius = getMaskRadius(sizeValue);

  const getFinalContrast = (value: number): number => {
    if (value < SIZE_THRESHOLD_TINY) return CONTRAST_TINY;
    if (value < SIZE_THRESHOLD_SMALL) {
      return Math.max(contrastAmount * CONTRAST_MULTIPLIER_FINAL, CONTRAST_MIN_FINAL);
    }
    return contrastAmount;
  };

  const finalContrast = getFinalContrast(sizeValue);

  const orbStyle: React.CSSProperties & Record<string, string | number> = {
    width: size,
    height: size,
    "--bg": finalColors.bg,
    "--c1": finalColors.c1,
    "--c2": finalColors.c2,
    "--c3": finalColors.c3,
    "--animation-duration": `${String(animationDuration ?? DUREE_PAR_ETAT[etat])}s`,
    "--blur-amount": `${String(blurAmount)}px`,
    "--contrast-amount": String(finalContrast),
    "--dot-size": `${String(dotSize)}px`,
    "--shadow-spread": `${String(shadowSpread)}px`,
    "--mask-radius": maskRadius,
  };

  return <div className={cn("siri-orb", className)} style={orbStyle} data-etat={etat} role="img" aria-label={`Alexa — ${etat}`} />;
};

export const Component = SiriOrb;

export default SiriOrb;
