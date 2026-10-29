"use client";

import * as React from "react";

/* Border Beam Panel — adapted from Motiq (MIT).
   The visual physics are kept; the tokens are mapped to MindCare's existing
   clinical palette so the card belongs to this product, not to a landing page.
   No clsx / tailwind-merge: the repository deliberately keeps a very small
   production dependency surface. */

type ClassValue = string | undefined | null | false;

function cn(...inputs: ClassValue[]): string {
  return inputs.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");
}

/* The component's own tokens. They resolve to MindCare tokens first and keep a
   literal fallback so the card still renders if a token is renamed. */
const MOTIQ_TOKENS = `@layer motiq{:root{--motiq-accent:var(--action-600);--motiq-accent-text:var(--action-700);--motiq-bg:var(--paper);--motiq-border:var(--rule);--motiq-border-strong:var(--ink-300);--motiq-fg:var(--ink-900);--motiq-fg-secondary:var(--ink-700);--motiq-muted:var(--ink-500);--motiq-secondary-accent:var(--aqua-600);--motiq-signature:var(--attention);--motiq-surface:var(--card);--motiq-surface-2:var(--sunken)}}`;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function useVisibilityPause<T extends Element>(
  ref: React.RefObject<T | null>,
  { threshold = 0.1 }: { threshold?: number } = {},
): boolean {
  const [onScreen, setOnScreen] = React.useState(true);
  const [tabVisible, setTabVisible] = React.useState(true);

  React.useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setOnScreen(entries.some((entry) => entry.isIntersecting)),
      { threshold },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, threshold]);

  React.useEffect(() => {
    const onVisibility = () => setTabVisible(document.visibilityState !== "hidden");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return onScreen && tabVisible;
}

export interface BorderBeamPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  /** One comet, or two opposed comets 180° apart. */
  beams?: 1 | 2;
  /** Comet colors. The second defaults to the rare coral signature. */
  colors?: [string, string?];
  /** Ring thickness in px. */
  thickness?: number;
  /** Resting angular velocity in deg/s. */
  idleSpeed?: number;
  /** Hover/focus angular velocity in deg/s. */
  hoverSpeed?: number;
  /** Blurred copy of the ring behind the panel, read as cast light. */
  glow?: boolean;
  /** Corner radius in px. */
  radius?: number;
  /** Velocity spring — the speed is sprung, so the comets coast. */
  spring?: { stiffness?: number; damping?: number };
  /** Deterministic starting angle (SSR-stable). */
  seed?: number;
  /** Park the loop while scrolled offscreen or the tab is hidden. */
  pauseWhenHidden?: boolean;
  /** Force the static, motion-free lit-border state. */
  reducedMotion?: boolean;
  /** Optional glossy inner highlight. */
  sheen?: boolean;
}

class Spring {
  x: number;
  v = 0;
  target: number;
  k: number;
  d: number;
  constructor(value: number, k: number, d: number) {
    this.x = value;
    this.target = value;
    this.k = k;
    this.d = d;
  }
  step(dt: number): number {
    const acceleration = this.k * (this.target - this.x) - this.d * this.v;
    this.v += acceleration * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const PARKED_ANGLE = 40;

function comet(tail: string, head: string, tip: string, midAlpha: number, start: number): string {
  return [
    `color-mix(in srgb, ${tail} 4%, transparent) ${start + 18}deg`,
    `color-mix(in srgb, ${tail} ${midAlpha}%, transparent) ${start + 46}deg`,
    `${head} ${start + 56}deg`,
    `${tip} ${start + 60}deg`,
    `transparent ${start + 63}deg`,
  ].join(", ");
}

function ringGradient(beams: 1 | 2, colors: [string, string?] | undefined): string {
  const tail0 = colors?.[0] ?? "var(--motiq-accent, var(--action-600))";
  const head0 = colors?.[1] ?? "var(--motiq-secondary-accent, var(--aqua-600))";
  const stops = [
    "transparent 0deg",
    comet(tail0, head0, `color-mix(in srgb, ${head0} 22%, white)`, 55, 0),
  ];
  if (beams === 2) {
    const coral = "var(--motiq-signature, var(--attention))";
    stops.push("transparent 198deg", comet(coral, coral, `color-mix(in srgb, ${coral} 26%, white)`, 50, 198));
  }
  stops.push("transparent 360deg");
  return `conic-gradient(from var(--mk-beam-a, 0deg), ${stops.join(", ")})`;
}

function BorderBeamPanelBase({
  children,
  beams = 2,
  colors,
  thickness = 1.5,
  idleSpeed = 30,
  hoverSpeed = 150,
  glow = true,
  radius = 24,
  spring,
  seed = 1,
  pauseWhenHidden = true,
  reducedMotion,
  sheen = true,
  className,
  style,
  ...props
}: BorderBeamPanelProps): React.JSX.Element {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const cls = `mk-beam-${uid}`;
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  const systemReduced = useReducedMotion();
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);
  const staticMode = reducedMotion === true || (hydrated && systemReduced);
  const onScreen = useVisibilityPause(rootRef, { threshold: 0.05 });
  const paused = pauseWhenHidden && !onScreen;
  const animate = !staticMode && !paused;

  const stiffness = spring?.stiffness ?? 30;
  const damping = spring?.damping ?? 11;

  const startAngle = React.useMemo(() => ((seed * 137.508) % 360 + 360) % 360, [seed]);

  const speedRef = React.useRef(new Spring(idleSpeed, stiffness, damping));
  const angleRef = React.useRef(startAngle);
  const liveRef = React.useRef({ idleSpeed, hoverSpeed });
  liveRef.current = { idleSpeed, hoverSpeed };

  React.useEffect(() => {
    speedRef.current.k = stiffness;
    speedRef.current.d = damping;
  }, [stiffness, damping]);

  const paint = React.useCallback((angle: number) => {
    rootRef.current?.style.setProperty("--mk-beam-a", `${(((angle % 360) + 360) % 360).toFixed(2)}deg`);
  }, []);

  React.useEffect(() => {
    if (!animate) return;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      if (!last) last = now;
      const dt = clamp((now - last) / 1000, 0, 0.05);
      last = now;
      angleRef.current += speedRef.current.step(dt) * dt;
      paint(angleRef.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, paint]);

  React.useEffect(() => {
    if (!staticMode) return;
    angleRef.current = PARKED_ANGLE;
    speedRef.current.x = speedRef.current.target = liveRef.current.idleSpeed;
    speedRef.current.v = 0;
    paint(PARKED_ANGLE);
  }, [staticMode, paint]);

  const surge = React.useCallback(() => {
    speedRef.current.target = liveRef.current.hoverSpeed;
  }, []);
  const settle = React.useCallback(() => {
    speedRef.current.target = liveRef.current.idleSpeed;
  }, []);

  const gradient = React.useMemo(() => ringGradient(beams, colors), [beams, colors]);

  const css = `
.${cls} .mk-beam-ring, .${cls} .mk-beam-glow {
  position: absolute;
  inset: -1px;
  border-radius: ${radius}px;
  pointer-events: none;
  background: ${gradient};
}
.${cls} .mk-beam-ring {
  padding: ${Math.max(1, thickness)}px;
  -webkit-mask: linear-gradient(white 0 0) content-box, linear-gradient(white 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(white 0 0) content-box, linear-gradient(white 0 0);
  mask-composite: exclude;
  z-index: 2;
}
.${cls} .mk-beam-glow { filter: blur(16px); opacity: 0.28; z-index: 0; }
.${cls} .mk-beam-sheen {
  position: absolute;
  inset: 0;
  border-radius: ${Math.max(0, radius - 1)}px;
  pointer-events: none;
  z-index: 1;
  background:
    radial-gradient(120% 70% at 12% 0%, color-mix(in srgb, white 70%, transparent), transparent 58%),
    linear-gradient(180deg, color-mix(in srgb, white 30%, transparent), transparent 38%);
  opacity: .55;
}
@media (forced-colors: active) {
  .${cls} .mk-beam-ring, .${cls} .mk-beam-glow, .${cls} .mk-beam-sheen { display: none; }
  .${cls} { border-color: CanvasText; }
}`.trim();

  return (
    <div
      ref={rootRef}
      data-motion={staticMode ? "static" : "animated"}
      data-paused={paused ? "true" : "false"}
      onPointerEnter={surge}
      onPointerLeave={settle}
      onFocus={surge}
      onBlur={settle}
      className={cn(
        "relative w-full border border-rule bg-card",
        cls,
        className,
      )}
      style={{
        borderRadius: `${radius}px`,
        isolation: "isolate",
        ["--mk-beam-a" as string]: `${startAngle.toFixed(2)}deg`,
        ...style,
      }}
      {...props}
    >
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {glow ? <div aria-hidden="true" className="mk-beam-glow" /> : null}
      <div aria-hidden="true" className="mk-beam-ring" />
      {sheen ? <div aria-hidden="true" className="mk-beam-sheen" /> : null}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

export function BorderBeamPanel(props: BorderBeamPanelProps): React.JSX.Element {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: MOTIQ_TOKENS }} />
      <BorderBeamPanelBase {...props} />
    </>
  );
}

export default BorderBeamPanel;
