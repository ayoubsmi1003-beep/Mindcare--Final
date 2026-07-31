import type { Config } from "tailwindcss";

// I10 — la palette par défaut de Tailwind est désactivée. Toute valeur est un
// alias vers un token CSS défini dans src/styles/tokens.css (livré en T1.2).
// Ce fichier ne définit aucune valeur littérale, à trois exceptions près,
// documentées à chaque endroit où elles apparaissent :
//   1. `screens` — les breakpoints sont évalués à la compilation CSS et
//      n'acceptent pas `var(--…)` (limite technique de Tailwind, pas un choix).
//   2. `outlineWidth`/`outlineOffset` et les cibles tactiles `minWidth`/
//      `minHeight` — valeurs fixées explicitement par le plancher
//      d'accessibilité, WORKING-CONTEXT §4.4, pas inventées ici.
//   3. les échelles utilitaires sans équivalent design (zIndex, opacity,
//      borderWidth) — un jeu minimal fermé, faute de token dédié.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["class"],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      ink: {
        900: "var(--ink-900)",
        700: "var(--ink-700)",
        500: "var(--ink-500)",
        300: "var(--ink-300)",
        100: "var(--ink-100)",
      },
      paper: "var(--paper)",
      card: "var(--card)",
      sunken: "var(--sunken)",
      rule: "var(--rule)",
      teal: {
        900: "var(--teal-900)",
        700: "var(--teal-700)",
        600: "var(--teal-600)",
        400: "var(--teal-400)",
        100: "var(--teal-100)",
        50: "var(--teal-050)",
      },
      attention: {
        DEFAULT: "var(--attention)",
        bg: "var(--attention-bg)",
      },
      critical: {
        DEFAULT: "var(--critical)",
        bg: "var(--critical-bg)",
      },
      positive: {
        DEFAULT: "var(--positive)",
        bg: "var(--positive-bg)",
      },
      night: {
        bg: "var(--night-bg)",
        card: "var(--night-card)",
        rule: "var(--night-rule)",
        ink: "var(--night-ink)",
      },
    },
    spacing: {
      // "0" est la valeur nulle universelle, pas une décision de design : pas
      // de token dédié dans §3 (qui ne définit que --s-1 à --s-16).
      0: "0px",
      1: "var(--s-1)",
      2: "var(--s-2)",
      3: "var(--s-3)",
      4: "var(--s-4)",
      5: "var(--s-5)",
      6: "var(--s-6)",
      8: "var(--s-8)",
      10: "var(--s-10)",
      12: "var(--s-12)",
      16: "var(--s-16)",
    },
    borderRadius: {
      // "none" est la valeur nulle universelle : pas de token dédié dans §3
      // (qui ne définit que --r-sm à --r-full).
      none: "none",
      sm: "var(--r-sm)",
      md: "var(--r-md)",
      lg: "var(--r-lg)",
      xl: "var(--r-xl)",
      full: "var(--r-full)",
    },
    fontFamily: {
      ui: ["var(--font-ui)"],
      doc: ["var(--font-doc)"],
      ar: ["var(--font-ar)"],
      num: ["var(--font-num)"],
    },
    transitionTimingFunction: {
      out: "var(--e-out)",
      in: "var(--e-in)",
      soft: "var(--e-soft)",
      spring: "var(--e-spring)",
    },
    transitionDuration: {
      instant: "var(--d-instant)",
      quick: "var(--d-quick)",
      normal: "var(--d-normal)",
      slow: "var(--d-slow)",
      scene: "var(--d-scene)",
    },
    // Même échelle que transitionDuration : pas de nouvelle valeur, un délai
    // n'est jamais qu'une durée appliquée avant transition.
    transitionDelay: {
      instant: "var(--d-instant)",
      quick: "var(--d-quick)",
      normal: "var(--d-normal)",
      slow: "var(--d-slow)",
      scene: "var(--d-scene)",
    },
    // Aucune animation par défaut n'est spécifiée par 04-DESIGN-SYSTEM à ce
    // jour : on ferme l'accès à `animate-spin`/`animate-pulse` etc. sans
    // inventer de remplacement tant que rien n'est demandé.
    keyframes: {},
    animation: {},
    // Échelle typographique §3 — taille/interligne/interlettrage par rôle de
    // texte, jamais par valeur libre (`text-xl`, `text-[15px]` fermés).
    // Source unique : src/styles/tokens.css (T1.2). Ce fichier ne fixe AUCUNE
    // valeur ici, seulement les noms de variables consommées.
    fontSize: {
      display: [
        "var(--text-display-size)",
        {
          lineHeight: "var(--text-display-leading)",
          letterSpacing: "var(--text-display-tracking)",
        },
      ],
      title: [
        "var(--text-title-size)",
        {
          lineHeight: "var(--text-title-leading)",
          letterSpacing: "var(--text-title-tracking)",
        },
      ],
      heading: [
        "var(--text-heading-size)",
        {
          lineHeight: "var(--text-heading-leading)",
          letterSpacing: "var(--text-heading-tracking)",
        },
      ],
      body: [
        "var(--text-body-size)",
        {
          lineHeight: "var(--text-body-leading)",
          letterSpacing: "var(--text-body-tracking)",
        },
      ],
      notes: [
        "var(--text-notes-size)",
        {
          lineHeight: "var(--text-notes-leading)",
          letterSpacing: "var(--text-notes-tracking)",
        },
      ],
      label: [
        "var(--text-label-size)",
        {
          lineHeight: "var(--text-label-leading)",
          letterSpacing: "var(--text-label-tracking)",
        },
      ],
      eyebrow: [
        "var(--text-eyebrow-size)",
        {
          lineHeight: "var(--text-eyebrow-leading)",
          letterSpacing: "var(--text-eyebrow-tracking)",
        },
      ],
      num: [
        "var(--text-num-size)",
        {
          lineHeight: "var(--text-num-leading)",
          letterSpacing: "var(--text-num-tracking)",
        },
      ],
    },
    // Graisses utilisées par l'échelle ci-dessus uniquement.
    fontWeight: {
      regular: "var(--weight-regular)",
      medium: "var(--weight-medium)",
      semibold: "var(--weight-semibold)",
    },
    // lineHeight/letterSpacing en classes autonomes (hors fontSize) — mêmes
    // variables que ci-dessus, pas de nouvelle échelle parallèle.
    lineHeight: {
      display: "var(--text-display-leading)",
      title: "var(--text-title-leading)",
      heading: "var(--text-heading-leading)",
      body: "var(--text-body-leading)",
      notes: "var(--text-notes-leading)",
      label: "var(--text-label-leading)",
      eyebrow: "var(--text-eyebrow-leading)",
      num: "var(--text-num-leading)",
      arabic: "var(--text-arabic-leading)",
    },
    letterSpacing: {
      display: "var(--text-display-tracking)",
      title: "var(--text-title-tracking)",
      heading: "var(--text-heading-tracking)",
      body: "var(--text-body-tracking)",
      notes: "var(--text-notes-tracking)",
      label: "var(--text-label-tracking)",
      eyebrow: "var(--text-eyebrow-tracking)",
      num: "var(--text-num-tracking)",
    },
    // Ombres — valeurs définies en T1.2 (04-DESIGN-SYSTEM §4.1), pas ici.
    boxShadow: {
      none: "none",
      lift0: "var(--lift-0)",
      lift1: "var(--lift-1)",
      lift2: "var(--lift-2)",
      lift3: "var(--lift-3)",
    },
    // Le verre décore le mobilier, jamais la donnée (§4 règle 2). Ses valeurs
    // viennent de --glass-*, définies en T1.2 (04-DESIGN-SYSTEM §4.4).
    blur: {
      none: "none",
      glass: "var(--glass-blur)",
    },
    backdropBlur: {
      none: "none",
      glass: "var(--glass-blur)",
    },
    // Exception documentée : les breakpoints Tailwind sont résolus à la
    // compilation CSS, `var(--…)` y est inopérant. Ruptures du §3 : 1024/1280,
    // cible 1920×1080.
    screens: {
      tablet: "1024px",
      desktop: "1280px",
    },
    // Exception documentée : plancher d'accessibilité fixé explicitement par
    // WORKING-CONTEXT §4.4 (`outline: 2px solid var(--teal-600); outline-
    // offset: 2px`), pas une valeur inventée par cet agent.
    outlineWidth: {
      DEFAULT: "2px",
    },
    outlineOffset: {
      DEFAULT: "2px",
    },
    ringWidth: {
      DEFAULT: "2px",
      0: "0px",
    },
    // Exception documentée : cibles tactiles fixées explicitement par
    // WORKING-CONTEXT §4.4 (≥36px, 44px sur le formulaire QR).
    minWidth: {
      target: "36px",
      "target-lg": "44px",
    },
    minHeight: {
      target: "36px",
      "target-lg": "44px",
    },
    maxHeight: {
      none: "none",
      full: "100%",
    },
    // Largeurs de grille §3 — source unique tokens.css, aucune valeur ici.
    maxWidth: {
      none: "none",
      nav: "var(--grid-nav-width)",
      main: "var(--grid-main-max)",
      context: "var(--grid-context-width)",
    },
    // Pas de token dédié dans 04-DESIGN-SYSTEM à ce jour : échelle utilitaire
    // minimale, fermée, non extensible en syntaxe arbitraire.
    opacity: {
      0: "0",
      disabled: ".5",
      100: "1",
    },
    borderWidth: {
      0: "0px",
      DEFAULT: "1px",
      2: "2px",
    },
    extend: {},
  },
  plugins: [],
};

export default config;
