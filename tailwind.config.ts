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
  // `darkMode` est délibérément ABSENT, et les couleurs `night.*` ne sont pas
  // exposées : 04-DESIGN-SYSTEM ne définit que 4 jetons nocturnes, sans rampe
  // d'encre ni contrastes vérifiés. Les laisser disponibles rendrait
  // `dark:bg-night-bg` fonctionnel tout en laissant le texte sur --ink-900 :
  // encre presque noire sur fond presque noir, sans qu'aucune règle ne tire.
  // Détail et condition de réouverture : src/styles/tokens.css, § THÈME SOMBRE.
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
      // ADR-022 — la rampe de marque a remplacé `teal.*`, dont le nom n'existe
      // plus nulle part (contrôle 2 du checkpoint V3). Ce n'était pas un
      // renommage cosmétique : `--teal-600` était une ESTIMATION du teal du
      // logo, et elle était fausse.
      brand: {
        900: "var(--brand-900)",
        800: "var(--brand-800)",
        700: "var(--brand-700)",
        600: "var(--brand-600)",
        500: "var(--brand-500)",
        400: "var(--brand-400)",
        200: "var(--brand-200)",
        100: "var(--brand-100)",
        50: "var(--brand-050)",
      },
      // Jetons de RÔLE. Un composant écrit `text-ai-600`, jamais
      // `text-violet-500` : la palette dit quelle couleur existe, le rôle dit à
      // quoi elle sert. C'est cette couche qui rend un usage abusif visible en
      // revue — voir le bloc « JETONS DE RÔLE » de tokens.css.
      //
      // `violet.*` et `azure.*` ne sont DÉLIBÉRÉMENT PAS exposés : les laisser
      // disponibles permettrait d'écrire `bg-violet-500` sur une surface qui
      // n'a rien à voir avec Jarvis, et la couche de rôle ne servirait plus à
      // rien. Une contrainte contournable n'est pas une contrainte.
      action: {
        900: "var(--action-900)",
        700: "var(--action-700)",
        600: "var(--action-600)",
        500: "var(--action-500)",
        100: "var(--action-100)",
        50: "var(--action-050)",
      },
      ai: {
        600: "var(--ai-600)",
        500: "var(--ai-500)",
        100: "var(--ai-100)",
        50: "var(--ai-050)",
      },
      info: {
        600: "var(--info-600)",
        400: "var(--info-400)",
        100: "var(--info-100)",
        50: "var(--info-050)",
      },
      // Encre posée SUR la marque : UNE SEULE, le blanc pur. Il n'existe
      // délibérément pas de blanc atténué — sur la partie claire d'un dégradé
      // de marque, aucun alpha inférieur à 1 ne passe 4.5:1. Le calcul est
      // écrit dans tokens.css. La hiérarchie se fait à la taille et à la
      // graisse, jamais en baissant le contraste.
      "on-brand": {
        DEFAULT: "var(--on-brand)",
        surface: "var(--on-brand-surface)",
        "surface-hover": "var(--on-brand-surface-hover)",
      },
      // Les couches de profondeur. `ambient` est le sol de la page : teinté,
      // jamais blanc pur, c'est ce qui détache une carte sans bordure.
      layer: {
        ambient: "var(--layer-ambient)",
        surface: "var(--layer-surface)",
        raised: "var(--layer-raised)",
      },
      // Le verre décore le mobilier flottant (§4.1) — panneau Jarvis, en-tête
      // collant du dossier. Sa TEINTE vient de --glass-panel ; le FILTRE
      // complet reste posé en style inline (voir PanneauJarvis), les
      // utilitaires n'injectant qu'un blur nu.
      glass: {
        panel: "var(--glass-panel)",
      },
      attention: {
        // L'ACCENT — bordure, liseré, point de légende. Ne porte pas de texte
        // sur `attention.bg` : mesuré à 3.34:1, sous le plancher. Voir
        // `--attention-ink` dans tokens.css.
        DEFAULT: "var(--attention)",
        bg: "var(--attention-bg)",
        ink: "var(--attention-ink)",
      },
      critical: {
        DEFAULT: "var(--critical)",
        bg: "var(--critical-bg)",
      },
      positive: {
        DEFAULT: "var(--positive)",
        bg: "var(--positive-bg)",
      },
      // ── V7 — LA COUCHE CHROME ────────────────────────────────────────
      // Le second neutre. Rail, barre supérieure, panneaux d'outil. C'est
      // cette séparation chrome / contenu qui fait qu'un instrument se lit
      // comme un instrument : le cadre recule, la matière avance. Les quatre
      // encres sont MESURÉES sur --chrome-900 (15.6 / 9.00 / 4.72:1) et
      // tirées de la teinte de marque — aucune n'est un gris.
      chrome: {
        900: "var(--chrome-900)",
        800: "var(--chrome-800)",
        700: "var(--chrome-700)",
        600: "var(--chrome-600)",
        rule: "var(--chrome-rule)",
        ink: "var(--chrome-ink)",
        "ink-soft": "var(--chrome-ink-soft)",
        "ink-faint": "var(--chrome-ink-faint)",
        actif: "var(--chrome-actif-bg)",
        survol: "var(--chrome-survol-bg)",
        // Surfaces translucides NOMMÉES : Tailwind ne peut pas injecter
        // d'alpha dans un `var()`, donc `bg-chrome-ink/10` ne marcherait pas.
        // C'est exactement pourquoi `bg-white/10` était mort 37 fois.
        voile: "var(--chrome-voile)",
        "voile-faible": "var(--chrome-voile-faible)",
      },
      // Le sol du contenu, neutre-froid — remplace le lavage teinté de marque.
      canevas: "var(--canevas)",
      "tete-tableau": "var(--tete-tableau-bg)",
      // Le voile derriere un dialogue — le jeton existait, aucune classe ne
      // le consommait, et `backdrop-blur-sm` (inexistant) tenait sa place.
      voile: "var(--voile)",
      // ── V7 — LE MODE SÉANCE ──────────────────────────────────────────
      // `night.*` était retiré faute de rampe spécifiée. Elle l'est
      // désormais : --night-ink-soft complète les quatre jetons d'origine
      // (7.46:1 sur --night-bg), et ces couleurs servent UN écran, la
      // consultation ouverte. Ce n'est toujours pas un thème sombre global :
      // `darkMode` reste absent, il n'y a pas de variante `dark:`.
      night: {
        bg: "var(--night-bg)",
        card: "var(--night-card)",
        rule: "var(--night-rule)",
        ink: "var(--night-ink)",
        "ink-soft": "var(--night-ink-soft)",
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
      // V7 — les pas qui MANQUAIENT. `theme.spacing` remplace l'échelle de
      // Tailwind au lieu de l'étendre : tout pas absent d'ici rend `h-9`,
      // `p-7`, `gap-14` SILENCIEUSEMENT morts, sans erreur de build. 41
      // classes de dimension inertes dans l'arbre venaient de ce trou.
      7: "var(--s-7)",
      9: "var(--s-9)",
      11: "var(--s-11)",
      14: "var(--s-14)",
      18: "var(--s-18)",
      20: "var(--s-20)",
      24: "var(--s-24)",
      32: "var(--s-32)",
      px: "var(--s-px)",
      "0.5": "var(--s-0-5)",
      "1.5": "var(--s-1-5)",
      "2.5": "var(--s-2-5)",
      "3.5": "var(--s-3-5)",
      40: "var(--s-40)",
      64: "var(--s-64)",
      72: "var(--s-72)",
    },
    borderRadius: {
      // "none" est la valeur nulle universelle : pas de token dédié dans §3
      // (qui ne définit que --r-sm à --r-full).
      none: "none",
      sm: "var(--r-sm)",
      md: "var(--r-md)",
      lg: "var(--r-lg)",
      DEFAULT: "var(--r-md)",
      xl: "var(--r-xl)",
      // `rounded-2xl` était mort dans 12 endroits, dont l'en-tête héros de
      // Surfaces.tsx lui-même — il rendait donc un angle droit.
      "2xl": "var(--r-2xl)",
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
    // UNE SEULE animation, et seulement parce qu'un squelette de chargement en
    // a besoin. L'échelle reste fermée : pas de `animate-spin`, pas de
    // `animate-bounce`. Un écran clinique n'a rien qui doive tourner.
    //
    // `respire` ne déplace rien et ne change aucune couleur — il fait varier la
    // seule opacité d'un bloc `sunken`, entre les deux valeurs déjà ouvertes par
    // l'échelle `opacity` du bas de ce fichier (1 et .5). Une donnée affichée ne
    // bouge jamais (§4 règle 5) ; un squelette n'est pas une donnée, c'est
    // l'aveu qu'il n'y en a pas encore.
    //
    // `prefers-reduced-motion: reduce` est déjà respecté globalement par
    // src/styles/tokens.css, qui ramène toute animation à une durée nulle.
    keyframes: {
      respire: {
        "0%, 100%": { opacity: "1" },
        "50%": { opacity: ".5" },
      },
    },
    animation: {
      none: "none",
      respire: "respire var(--d-scene) var(--e-soft) infinite",
    },
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
      // V7 — LA MÉTRIQUE. Les trois jetons --text-metric-* existaient dans
      // tokens.css sans aucune classe pour les consommer : `text-metric`
      // n'émettait rien. Réservé aux valeurs qui se lisent d'un coup d'œil à
      // distance — le chrono de séance, un total. Jamais du texte courant.
      metric: [
        "var(--text-metric-size)",
        {
          lineHeight: "var(--text-metric-leading)",
          letterSpacing: "var(--text-metric-tracking)",
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
    // Graisses V2 — hiérarchie verrouillée: 400 corps / 500 label / 600 emphase / 700 page / 800 display-metrics
    fontWeight: {
      regular: "var(--weight-regular)",
      medium: "var(--weight-medium)",
      semibold: "var(--weight-semibold)",
      bold: "var(--weight-bold)",
      extrabold: "var(--weight-extrabold)",
    },
    // lineHeight/letterSpacing en classes autonomes (hors fontSize) — mêmes
    // variables que ci-dessus, pas de nouvelle échelle parallèle.
    lineHeight: {
      metric: "var(--text-metric-leading)",
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
      metric: "var(--text-metric-tracking)",
      display: "var(--text-display-tracking)",
      title: "var(--text-title-tracking)",
      heading: "var(--text-heading-tracking)",
      body: "var(--text-body-tracking)",
      notes: "var(--text-notes-tracking)",
      label: "var(--text-label-tracking)",
      eyebrow: "var(--text-eyebrow-tracking)",
      num: "var(--text-num-tracking)",
    },
    // Ombres — valeurs définies en T1.2 (04-DESIGN-SYSTEM §4.4), pas ici.
    boxShadow: {
      none: "none",
      lift0: "var(--lift-0)",
      lift1: "var(--lift-1)",
      lift2: "var(--lift-2)",
      lift3: "var(--lift-3)",
      // La lueur, et ses trois usages : entrée de navigation active, orbe
      // Jarvis, carte de confirmation. La liste est fermée — si tout brille,
      // plus rien n'est spécial. Interdite derrière une valeur clinique au même
      // titre qu'un dégradé : elle module le contraste.
      "glow-brand": "var(--glow-brand)",
      "glow-ai": "var(--glow-ai)",
      // v9 — l'entrée active du rail : la lueur de marque ET le filet interne,
      // composés en un seul jeton (`--glow-nav`) parce que deux utilitaires
      // `shadow-*` ne s'additionnent pas.
      "glow-nav": "var(--glow-nav)",
      // Le filet interne haut d'une surface élevée sur fond coloré : la lumière
      // rasante qui donne l'épaisseur sans ajouter d'ombre.
      sheen: "var(--layer-sheen)",
    },
    // LES TROIS DÉGRADÉS D'ADR-022, ET LES FAMILLES D'AGRÉGAT D'ADR-025.
    //
    // `backgroundImage` est remplacé, pas étendu : les dégradés utilitaires de
    // Tailwind (`bg-gradient-to-*`, qui s'assortissent de `from-`/`via-`/`to-`)
    // permettraient d'en composer un quatrième en trois classes, sans qu'aucune
    // relecture ne le distingue d'un dégradé du système. La liste fermée
    // d'ADR-022 ne tient que si l'outil ne sait pas en fabriquer d'autre.
    //
    // v9 ajoute les jetons d'ADR-025 étendu : l'atmosphère du sol, le reflet
    // des en-têtes de lieu, le disque des états vides et les six tuiles
    // d'agrégat — tous définis dans tokens.css au sein des familles existantes,
    // tous interdits derrière une donnée clinique nominative (§4.2).
    backgroundImage: {
      "grad-brand": "var(--grad-brand)",
      "grad-orb": "var(--grad-orb)",
      "grad-auth": "var(--grad-auth)",
      atmosphere: "var(--atmosphere)",
      "grad-hero-reflet": "var(--grad-hero-reflet)",
      "grad-empty": "var(--grad-empty)",
      "grad-tile-brand": "var(--grad-tile-brand)",
      "grad-tile-info": "var(--grad-tile-info)",
      "grad-tile-ai": "var(--grad-tile-ai)",
      "grad-tile-amber": "var(--grad-tile-amber)",
      "grad-tile-positive": "var(--grad-tile-positive)",
      "grad-tile-coral": "var(--grad-tile-coral)",
      "grad-avatar": "var(--grad-avatar)",
    },
    // Le verre décore le mobilier, jamais la donnée (§4 règle 2). Ses valeurs
    // viennent de --glass-*, définies en T1.2 (04-DESIGN-SYSTEM §4.1).
    // On consomme ici --glass-blur-radius et NON --glass-blur : ces utilitaires
    // injectent leur valeur dans `blur(…)`, et --glass-blur est le filtre
    // complet (`saturate(180%) blur(20px)`). Lui passer le filtre produirait
    // `blur(saturate(180%) blur(20px))` — déclaration invalide, ignorée en
    // silence par le navigateur. Le filtre complet s'applique en CSS, pas par
    // utilitaire. Les deux variables ont la même source : src/styles/tokens.css.
    blur: {
      none: "none",
      glass: "var(--glass-blur-radius)",
    },
    backdropBlur: {
      none: "none",
      glass: "var(--glass-blur-radius)",
    },
    // Exception documentée : les breakpoints Tailwind sont résolus à la
    // compilation CSS, `var(--…)` y est inopérant. Ruptures du §3 : 1024/1280,
    // cible 1920×1080.
    screens: {
      tablet: "1024px",
      desktop: "1280px",
      // V7 — `lg:` et `xl:` étaient utilisés dans 8 endroits (dont
      // `lg:p-8` sur l'en-tête héros et `lg:grid-cols-2` sur Documents) et
      // n'existaient pas : les variantes tombaient dans le vide. On les
      // déclare aux mêmes ruptures que tablet/desktop plutôt que d'inventer
      // une seconde échelle concurrente.
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1600px",
    },
    // Exception documentée : plancher d'accessibilité fixé explicitement par
    // WORKING-CONTEXT §4.4 (`outline: 2px solid var(--action-600); outline-
    // offset: 2px`), pas une valeur inventée par cet agent.
    outlineWidth: {
      2: "2px",
      DEFAULT: "2px",
    },
    outlineOffset: {
      2: "2px",
      DEFAULT: "2px",
    },
    // L'anneau sert deux etats : le focus d'un champ compose (`focus-within`)
    // et l'ecoute active de l'orbe. Sans ces echelles, `ring-2` et `ring-4`
    // n'emettaient rien et les deux etats etaient invisibles.
    // `ringColor` n'est PAS redefini : Tailwind le derive de `theme.colors`,
    // qui est deja la palette de jetons. Le redefinir avec la forme fonction
    // rendrait `any` et ferait tomber `no-unsafe-return`.
    ringOffsetWidth: { 0: "0px", 2: "2px" },
    ringWidth: {
      0: "0px",
      1: "1px",
      2: "2px",
      4: "4px",
      DEFAULT: "2px",
    },
    // Exception documentée : cibles tactiles fixées explicitement par
    // WORKING-CONTEXT §4.4 (≥36px, 44px sur le formulaire QR).
    minWidth: {
      // ⚠️ `0` EST STRUCTUREL, EXACTEMENT COMME `minHeight.0`.
      // Un enfant de flex a `min-width: auto` par defaut : il refuse de
      // descendre sous la largeur de son contenu, et un conteneur
      // `overflow-x-auto` grandit alors au lieu de faire defiler. `min-w-0`
      // etait ecrit a six endroits du depot — dont la colonne de contenu de
      // la coquille — et n'existait pas.
      0: "var(--size-0)",
      full: "var(--size-full)",
      target: "36px",
      "target-lg": "44px",
      // Pas une exception : `--card-column-min` est un jeton déclaré dans
      // tokens.css. Il donne au tableau de l'agenda une largeur en dessous de
      // laquelle il défile au lieu d'écraser ses colonnes.
      card: "var(--card-column-min)",
      chart: "var(--chart-min-width)",
    },
    minHeight: {
      // ⚠️ `0` EST INDISPENSABLE, ET SON ABSENCE A COÛTÉ UNE ENQUÊTE.
      //
      // Cette échelle REMPLACE celle de Tailwind : tant que `0` n'y figurait
      // pas, la classe `min-h-0` n'existait pas — elle ne produisait AUCUNE
      // règle CSS, en silence, sans avertissement de build ni erreur de type.
      // Or `min-height: auto` est la valeur par défaut d'un enfant flex ou
      // grille, et elle lui INTERDIT de descendre sous la hauteur de son
      // contenu. Résultat mesuré le 2026-08-20 : la grille de l'agenda, plus
      // haute que la fenêtre, faisait grandir sa colonne jusqu'à 1359 px — et
      // le rail de navigation, à côté, la suivait. Le bouton « Se déconnecter »
      // se retrouvait à 1342 px dans une fenêtre de 1080.
      //
      // Ce n'est pas une valeur de design : c'est la valeur nulle universelle,
      // au même titre que `spacing.0` et `borderRadius.none`, tous deux déjà
      // présents ici pour la même raison. Une classe qui n'existe pas est plus
      // dangereuse qu'une classe fausse : rien ne la signale.
      0: "0px",
      target: "36px",
      "target-lg": "44px",
      // v9 — la hauteur de la fenêtre, jeton `--size-viewport` déjà déclaré :
      // l'écran de connexion centre sa scène dans le viewport sans qu'aucune
      // valeur en dur ne réapparaisse.
      viewport: "var(--size-viewport)",
    },
    maxHeight: {
      none: "none",
      full: "100%",
      // La hauteur au-dela de laquelle une liste de resultats defile au lieu
      // de couvrir l'ecran (recherche eclair de la reception).
      liste: "var(--liste-max)",
    },
    // Grilles fluides — aucune valeur littérale, `--card-column-min` est déjà
    // le jeton nommé pour la largeur minimale d'une colonne de carte (il
    // existait pour sortir ce `240px` d'un `minmax()` en dur).
    //
    // `auto-fit` plutôt qu'un nombre de colonnes figé assorti de points de
    // rupture : la même grille rend quatre colonnes sur le poste du cabinet
    // (1920), deux sur un portable, une sur un écran étroit, sans qu'aucun
    // champ ne passe jamais sous sa largeur lisible. Un point de rupture de
    // moins est une occasion de moins de le régler pour un seul écran.
    gridTemplateColumns: {
      // V7 — LES COLONNES NUMÉRIQUES, qui manquaient. `grid-cols-*` étant
      // REMPLACÉ et non étendu, `grid-cols-2` n'existait pas : Documents
      // écrivait `grid-cols-1 lg:grid-cols-2` (deux no-ops) et retombait sur
      // un `style={{gridTemplateColumns}}` en dur pour compenser. Un incident
      // de production documenté dans ce fichier a la même origine.
      1: "repeat(1, minmax(0, 1fr))",
      2: "repeat(2, minmax(0, 1fr))",
      3: "repeat(3, minmax(0, 1fr))",
      4: "repeat(4, minmax(0, 1fr))",
      5: "repeat(5, minmax(0, 1fr))",
      6: "repeat(6, minmax(0, 1fr))",
      12: "repeat(12, minmax(0, 1fr))",
      // V7 — LES COMPOSITIONS D'ÉCRAN. Chaque écran compose selon son travail
      // (le bento est un outil, pas l'identité du produit) : ces gabarits
      // nomment les compositions retenues, une par famille d'écran.
      "espace-liste": "minmax(0, 22rem) minmax(0, 1fr)",
      "espace-travail": "minmax(0, 1fr) minmax(0, 21rem)",
      "espace-jour": "minmax(0, 1.6fr) minmax(0, 1fr)",
      "espace-document": "minmax(0, 20rem) minmax(0, 1fr) minmax(0, 26rem)",
      fiche: "repeat(auto-fit, minmax(var(--card-column-min), 1fr))",
      // La coquille : navigation fixe + contenu fluide. Sous la rupture
      // `tablet`, le rail se REPLIE en icônes (`app-compact`) au lieu de passer
      // au-dessus du contenu — §3 enfin tenu, cf. `--grid-nav-compact`.
      app: "var(--grid-nav-width) minmax(0, 1fr)",
      "app-compact": "var(--grid-nav-compact) minmax(0, 1fr)",
      // La rangée d'analyse des Finances : Évolution / Anatomie / Attention.
      // Trois fractions INÉGALES, nommées ici plutôt qu'écrites en syntaxe
      // arbitraire dans l'écran (I10). `minmax(0, …)` autorise chaque panneau
      // à se comprimer sous la largeur de son contenu — sans lui, un tableau
      // interne impose sa largeur et fait déborder la page.
      finance: "minmax(0, 40fr) minmax(0, 32fr) minmax(0, 28fr)",
      // warning: `gridTemplateColumns` est REMPLACE, pas etendu : `grid-cols-1`,
      // `grid-cols-2`... de Tailwind N'EXISTENT PAS dans ce depot. Une classe
      // absente ne produit aucune erreur — elle ne fait simplement RIEN, et la
      // grille retombe en une colonne. C'est exactement le defaut mesure sur la
      // rangee de tuiles des Finances : cinq tuiles empilees au lieu d'une
      // rangee, et une page qui defilait de 761 px.
      un: "minmax(0, 1fr)",
      deux: "repeat(2, minmax(0, 1fr))",
      trois: "repeat(3, minmax(0, 1fr))",
      // Le pouls financier : cinq tuiles de largeur egale, jamais moins.
      pouls: "repeat(5, minmax(0, 1fr))",
      // Le poste d'accueil (Reception Console) : 3 colonnes
      // 44% agenda / 28% attente+attention / 28% encaissements+notifs.
      // Nommée ici plutôt qu'en syntaxe arbitraire (I10), même motif que
      // `finance`. `minmax(0,…)` autorise chaque colonne à se comprimer.
      cockpit: "minmax(0, 2fr) minmax(0, 1fr)",
      reception: "minmax(0, 1.35fr) minmax(0, 0.85fr) minmax(0, 0.8fr)",
      // Pulse réception : 4 tuiles carrées
      receptionPulse: "repeat(4, minmax(0, 1fr))",
      quatre: "repeat(4, minmax(0, 1fr))",
      // Bento reception
      receptionMiddle: "minmax(0, 1.85fr) minmax(0, 1fr)",
      receptionBottom: "minmax(0, 1fr) minmax(0, 1.45fr) minmax(0, 1fr)",
    },
    // Largeurs de grille §3 — source unique tokens.css, aucune valeur ici.
    maxWidth: {
      none: "none",
      full: "var(--size-full)",
      nav: "var(--grid-nav-width)",
      main: "var(--grid-main-max)",
      context: "var(--grid-context-width)",
      // v9 — les compositions de connexion : la carte, puis la scène à deux
      // colonnes qui l'accompagne.
      form: "var(--width-form)",
      auth: "var(--width-auth)",
    },
    // Pas de token dédié dans 04-DESIGN-SYSTEM à ce jour : échelle utilitaire
    // minimale, fermée, non extensible en syntaxe arbitraire.
    // `filigrane` (v9) est la valeur nommée du décor des en-têtes de lieu —
    // `--op-filigrane` dans tokens.css, pas une valeur libre.
    opacity: {
      0: "0",
      disabled: ".5",
      filigrane: "var(--op-filigrane)",
      100: "1",
    },
    borderWidth: {
      4: "4px",
      0: "0px",
      DEFAULT: "1px",
      2: "2px",
      // Jeton déclaré, pas une valeur libre : `--kind-accent-width` existe pour
      // le liseré gauche d'une carte de rendez-vous, distinct de `--rule-width`.
      kind: "var(--kind-accent-width)",
    },
    // V7 — `extend` (et non un remplacement) pour les métriques de coquille :
    // `height`/`width` ne sont PAS redéfinis plus haut, ils dérivent donc de
    // `spacing` plus les valeurs par défaut de Tailwind (`full`, `screen`,
    // fractions). Les écraser ici ferait disparaître `w-full` de toute
    // l'application. On ajoute, on ne remplace pas.
    extend: {
      height: {
        topbar: "var(--topbar-hauteur)",
        rang: "var(--rang-hauteur)",
        "rang-dense": "var(--rang-hauteur-dense)",
      },
      minHeight: {
        topbar: "var(--topbar-hauteur)",
        rang: "var(--rang-hauteur)",
      },
      width: {
        rail: "var(--rail-largeur)",
        "rail-compact": "var(--rail-compact)",
      },
      maxWidth: {
        rail: "var(--rail-largeur)",
        // La mesure de lecture d'un texte clinique long (note, résumé).
        // 65-75ch est le plancher de lisibilité ; en dessous le texte hache,
        // au-dessus l'œil perd la ligne suivante.
        lecture: "70ch",
      },
      gridTemplateRows: {
        coquille: "var(--topbar-hauteur) minmax(0, 1fr)",
      },
      zIndex: {
        // Une echelle minimale et fermee : le contenu, ce qui flotte au-dessus
        // de lui dans une carte (liste deroulante), et le mobilier de la
        // coquille. `z-20` etait ecrit et n'existait pas.
        0: "0",
        10: "10",
        20: "20",
        // --z-panneau existait comme jeton mais n'avait aucune classe : il
        // était posé en `style={{ zIndex }}` inline.
        panneau: "var(--z-panneau)",
      },
    },
  },
  plugins: [],
};

export default config;
