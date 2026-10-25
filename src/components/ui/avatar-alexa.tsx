"use client";

import { useId } from "react";

import "./avatar-alexa.css";

/**
 * AvatarAlexa — l'orbe Alexa vert (port 21st.dev, sans `motion`).
 *
 * Couleur verte imposée, forme cercle. `taille` règle les yeux ;
 * `diametre` (union fermée → classe CSS) règle le diamètre.
 * Présentation seule, l'état vit dans les machines vocales.
 */

const YEUX: Record<
  "sm" | "md" | "lg",
  { eye: string; eyeGap: string; eyeY: string }
> = {
  sm: { eye: "w-1 h-1.5", eyeGap: "gap-1.5", eyeY: "-translate-y-0.5" },
  md: { eye: "w-1.5 h-2.5", eyeGap: "gap-2.5", eyeY: "-translate-y-0.5" },
  lg: { eye: "w-2 h-3", eyeGap: "gap-3.5", eyeY: "-translate-y-1" },
};

export type DiametreAvatar = 16 | 18 | 28 | 32 | 56 | 112 | 132;

const CLASSE_DIAMETRE: Record<DiametreAvatar, string> = {
  16: "ava-d16",
  18: "ava-d18",
  28: "ava-d28",
  32: "ava-d32",
  56: "ava-d56",
  112: "ava-d112",
  132: "ava-d132",
};

export interface AvatarAlexaProps {
  readonly blinking?: boolean;
  readonly taille?: "sm" | "md" | "lg";
  readonly diametre?: DiametreAvatar;
  readonly className?: string;
}

function Oeil({
  blinking,
  delay,
  sizeClass,
}: {
  readonly blinking: boolean;
  readonly delay: string;
  readonly sizeClass: string;
}): React.JSX.Element {
  return (
    <div
      className={["ava-iris rounded-full", sizeClass, blinking ? "ava-eye-blink" : ""]
        .filter(Boolean)
        .join(" ")}
      style={blinking ? { animationDelay: delay } : undefined}
    />
  );
}

export function AvatarAlexa({
  blinking = true,
  taille = "md",
  diametre = 32,
  className = "",
}: AvatarAlexaProps): React.JSX.Element {
  const uid = useId().replace(/\W/g, "");
  const yeux = YEUX[taille] ?? YEUX.md;

  return (
    <div
      aria-label="Avatar Alexa"
      role="img"
      className={["ava-orb relative flex cursor-pointer items-center justify-center overflow-hidden rounded-full transition-transform duration-300 active:scale-x-110 active:scale-y-125", CLASSE_DIAMETRE[diametre], className]
        .filter(Boolean)
        .join(" ")}
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-20 mix-blend-overlay"
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id={`ava-n-${uid}`} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="4" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter={`url(#ava-n-${uid})`} />
      </svg>

      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-20 mix-blend-overlay"
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id={`ava-g-${uid}`} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="3.2" numOctaves="1" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter={`url(#ava-g-${uid})`} />
      </svg>

      <div aria-hidden="true" className="ava-shine pointer-events-none absolute inset-0" />

      <div aria-hidden="true" className="ava-ombre pointer-events-none absolute inset-0 blur-xs" />

      <div className={["relative z-10 flex items-center", yeux.eyeGap, yeux.eyeY].join(" ")}>
        <Oeil blinking={blinking} delay="0ms" sizeClass={yeux.eye} />
        <Oeil blinking={blinking} delay="60ms" sizeClass={yeux.eye} />
      </div>
    </div>
  );
}

export default AvatarAlexa;
