import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { FlatCompat } from "@eslint/eslintrc";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const supabaseImportMessage =
  "Accès base de données interdit ici. Tout accès aux données passe exclusivement par src/services/*.";

const nodeModuleMessage =
  "createRequire/node:module interdit côté navigateur. Tout accès aux données passe exclusivement par src/services/*.";

// I3 — MÉCANISME PRINCIPAL : contrainte de résolution de module, pas une
// liste de formes syntaxiques. On tente d'abord `eslint-plugin-import-x` /
// `no-restricted-paths` (résolution via glob de chemin) : abandonné après
// vérification empirique — sur ce poste (pnpm + Windows), le paquet est
// physiquement stocké sous `node_modules/.pnpm/@supabase+supabase-js@…/…`,
// un segment démarrant par un point. `minimatch` (utilisé en interne par le
// plugin) exclut par défaut les segments de chemin commençant par `.` d'un
// motif `**`, sans option exposée par la règle pour l'activer. Le mécanisme
// ne se déclenche donc JAMAIS sur cette installation, plugin comme statique
// que dynamique confondus (vérifié par test direct : cf. commentaire dans le
// rapport de livraison). Un mécanisme qui ne mord jamais est pire qu'aucun
// mécanisme.
//
// Remplacé par une résolution réelle, indépendante du glob : on résout
// chaque spécificateur d'import via l'algorithme Node (`createRequire(...)
// .resolve`), on remonte au `package.json` le plus proche du fichier résolu,
// et on compare son champ `name`. C'est la contrainte de graphe de
// dépendances demandée — vérité du disque, pas motif du texte source — et
// elle est insensible à la syntaxe utilisée pour écrire le spécificateur
// (littéral simple, template literal sans expression).
function findPackageName(resolvedPath) {
  let dir = path.dirname(resolvedPath);
  for (let i = 0; i < 30; i += 1) {
    const pkgJsonPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
        if (typeof pkg.name === "string") {
          return pkg.name;
        }
      } catch {
        // package.json illisible : on continue de remonter, on ne devine pas.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

// Extrait un spécificateur d'import statique OU dynamique-sans-expression
// (couvre `"@x/y"` et `` `@x/y` ``). Une valeur réellement dynamique
// (variable, concaténation, `createRequire`, `Function("require")`) sort de
// la portée du lint statique par construction — dette assumée, documentée
// dans le rapport, jamais maquillée.
function extractStaticSpecifier(node) {
  if (!node) {
    return undefined;
  }
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked ?? "").join("");
  }
  return undefined;
}

function makeNoRestrictedModuleRule(isForbiddenPackageName, message) {
  return {
    meta: { type: "problem", schema: [] },
    create(context) {
      const requireFromFile = createRequire(
        context.filename.endsWith(path.sep)
          ? path.join(context.filename, "x.js")
          : context.filename,
      );

      function check(reportNode, specifierNode) {
        const specifier = extractStaticSpecifier(specifierNode);
        if (!specifier) {
          return;
        }
        let resolved;
        try {
          resolved = requireFromFile.resolve(specifier);
        } catch {
          return; // module introuvable : pas notre problème ici.
        }
        const pkgName = findPackageName(resolved);
        if (pkgName && isForbiddenPackageName(pkgName)) {
          context.report({ node: reportNode, message });
        }
      }

      return {
        ImportDeclaration(node) {
          check(node, node.source);
        },
        ExportNamedDeclaration(node) {
          check(node, node.source);
        },
        ExportAllDeclaration(node) {
          check(node, node.source);
        },
        ImportExpression(node) {
          check(node, node.source);
        },
        CallExpression(node) {
          if (
            node.callee.type === "Identifier" &&
            node.callee.name === "require" &&
            node.arguments.length === 1
          ) {
            check(node, node.arguments[0]);
          }
        },
      };
    },
  };
}

const isSupabasePackage = (name) => name === "@supabase/supabase-js" || name === "@supabase/ssr" || name.startsWith("@supabase/");

const localPlugin = {
  rules: {
    "no-supabase-resolution": makeNoRestrictedModuleRule(
      isSupabasePackage,
      supabaseImportMessage,
    ),
  },
};

// I10 — aucune valeur en dur (couleur, dimension, durée) : tokens uniquement.
// Dé-ancré de toute position JSX : la valeur est interdite où qu'elle apparaisse
// dans src/**, pas seulement en attribut className/style direct.
const designTokenSyntax = [
  {
    // valeur littérale en dur assignée à une propriété d'objet (dimension, durée, %),
    // indépendamment du fait que l'objet soit inline dans un JSX ou déclaré ailleurs.
    selector:
      "Property > Literal[value=/^-?\\d+(\\.\\d+)?(px|em|rem|ms|s|%)$/]",
    message:
      "Valeur en dur interdite dans un style. Utilise les tokens CSS (var(--nom-du-token)).",
  },
  {
    // syntaxe Tailwind arbitraire (`p-[17px]`, `bg-[#123456]`, `duration-[250ms]`),
    // dans n'importe quelle chaîne de src/**, pas seulement un attribut className.
    selector: "Literal[value=/-\\[[^\\]]+\\]/]",
    message:
      "Valeur Tailwind arbitraire interdite. Utilise les classes mappées sur les tokens.",
  },
  {
    selector: "TemplateElement[value.raw=/-\\[[^\\]]+\\]/]",
    message:
      "Valeur Tailwind arbitraire interdite. Utilise les classes mappées sur les tokens.",
  },
  {
    // couleur hex n'importe où dans la chaîne (attribut, texte composé), 3 à 8 chiffres.
    selector: "Literal[value=/#[0-9A-Fa-f]{3,8}/]",
    message:
      "Couleur hexadécimale interdite. Utilise les tokens CSS (var(--nom-du-token)).",
  },
  {
    selector: "TemplateElement[value.raw=/#[0-9A-Fa-f]{3,8}/]",
    message:
      "Couleur hexadécimale interdite. Utilise les tokens CSS (var(--nom-du-token)).",
  },
  {
    // Littéral NUMÉRIQUE en dur dans un attribut `style={{ ... }}` (React le
    // sérialise en `px`) — c'est la forme exacte que la règle de dimension
    // ci-dessus (Literal string finissant par une unité) laisse passer.
    // Scopé volontairement au sous-arbre `style={{ }}` (via `raw`, qui existe
    // pour tout Literal et évite toute ambiguïté string/number côté esquery) :
    // un `Property > Literal` numérique hors contexte de style
    // (`{ maxRetries: 3 }`, `{ status: 200 }`) n'est pas une dimension et ne
    // doit pas être signalé — un sélecteur non scopé produirait du bruit et
    // finirait désactivé, ce qui protégerait moins que ce compromis serré.
    selector:
      "JSXAttribute[name.name='style'] Property > Literal[raw=/^-?\\d+(\\.\\d+)?$/]",
    message:
      "Valeur numérique en dur interdite dans style={{ }} (React la sérialise en px). Utilise les tokens CSS (var(--nom-du-token)).",
  },
  {
    // rgb()/rgba()/hsl()/hsla() n'importe où dans la chaîne — même trou que
    // le hex : la règle couleur ne cherchait que `#...`.
    selector: "Literal[value=/(rgb|rgba|hsl|hsla)\\(/]",
    message:
      "Couleur rgb()/rgba()/hsl()/hsla() interdite. Utilise les tokens CSS (var(--nom-du-token)).",
  },
  {
    selector: "TemplateElement[value.raw=/(rgb|rgba|hsl|hsla)\\(/]",
    message:
      "Couleur rgb()/rgba()/hsl()/hsla() interdite. Utilise les tokens CSS (var(--nom-du-token)).",
  },
];

// I9 — interdit le MOTIF de double assertion lui-même (structurel : une
// TSAsExpression dont l'expression directe est une autre TSAsExpression),
// donc résiste au cas où la valeur de départ est déjà typée
// (`no-unnecessary-type-assertion` ne voit alors rien d'anormal).
const typeAssertionSyntax = [
  {
    selector: "TSAsExpression > TSAsExpression",
    message:
      "Double assertion de type interdite (`x as T as U`). Type le flux de données correctement au lieu de forcer un cast en deux temps.",
  },
];

const config = [
  {
    // supabase/functions/** N'EST PAS exclu : c'est le code qui touche
    // SERVICE_ROLE et les API externes, il doit être le plus vérifié, pas le moins.
    ignores: [".next/**", "node_modules/**"],
  },
  {
    linterOptions: {
      // I3/I9 — un commentaire eslint-disable ne doit jamais pouvoir éteindre
      // une règle de sécurité. Pas d'échappatoire par la syntaxe des commentaires.
      noInlineConfig: true,
      reportUnusedDisableDirectives: true,
    },
  },
  ...compat.extends("next/core-web-vitals"),
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      local: localPlugin,
    },
    rules: {
      // I9 — pas de `any`, pas d'échappatoire de type, y compris via double
      // assertion ou accès non typé (règles type-aware).
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": true,
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
        },
      ],
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        {
          assertionStyle: "as",
          objectLiteralTypeAssertions: "never",
        },
      ],

      // I3 — mécanisme PRINCIPAL : résolution réelle du module (cf. commentaire
      // au-dessus de `findPackageName`), pas une liste de formes AST à deviner.
      "local/no-supabase-resolution": "error",
      // I3 — seconde ligne, pattern-based (filet, pas mécanisme principal).
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@supabase/supabase-js", message: supabaseImportMessage },
            { name: "@supabase/ssr", message: supabaseImportMessage },
            { name: "node:module", message: nodeModuleMessage },
            { name: "module", message: nodeModuleMessage },
          ],
          patterns: [
            { group: ["@supabase/supabase-js/*"], message: supabaseImportMessage },
            { group: ["@supabase/ssr/*"], message: supabaseImportMessage },
          ],
        },
      ],
      // I9 — le motif de double assertion est interdit partout, y compris
      // dans les fichiers de config racine.
      "no-restricted-syntax": ["error", ...typeAssertionSyntax],
    },
  },
  {
    // I10 (tokens, dé-ancré du JSX) ne s'applique qu'au code applicatif sous
    // src/** : `tailwind.config.ts` et les autres fichiers de config racine
    // contiennent légitimement les valeurs littérales d'exception documentées
    // en tête de `tailwind.config.ts` (screens, plancher d'accessibilité,
    // échelles utilitaires sans token dédié) — ce ne sont pas des tokens de
    // design, ce sont les valeurs QUE les tokens serviront à nommer.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...typeAssertionSyntax,
        ...designTokenSyntax,
      ],
    },
  },
  // BLOQUANT 1 (revue sécurité) — `files: ["**/*.ts", "**/*.tsx"]` ci-dessus
  // n'attache I3/I9/I10 qu'aux extensions TypeScript : un `.js`/`.jsx`/`.mjs`/
  // `.cjs` sous `src/` passait `pnpm lint` en silence (prouvé empiriquement :
  // import Supabase + valeurs en dur dans `src/lib/__probe.js`, exit 0).
  // Choix (a) : élargir les règles NON type-aware à ces extensions, et
  // interdire purement l'EXISTENCE de `.js`/`.jsx` sous `src/` — un projet en
  // TS strict n'en a aucun besoin légitime, ça ferme le vecteur à la racine.
  // (b) — inclure le JS dans le programme TS via `allowJs: true` — est écarté :
  // ça affaiblirait `tsconfig.json` pour tout le projet afin de couvrir un cas
  // qui ne devrait juste jamais exister. Les règles type-aware
  // (`no-unsafe-*`, `no-unnecessary-type-assertion`) restent volontairement
  // hors de ce bloc : elles exigent un fichier dans le programme TS
  // (`tsconfig.json` a `allowJs: false`), les y attacher ferait planter le
  // parsing au lieu de lever une erreur de règle.
  {
    // `eslint.config.js` lui-même utilise légitimement `createRequire`/
    // `node:module` (cf. `findPackageName` plus haut) pour IMPLÉMENTER I3 —
    // il ne s'exécute jamais côté navigateur. Impossible à distinguer par un
    // motif générique : exclusion nominative plutôt qu'affaiblir la règle.
    files: ["**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"],
    ignores: ["eslint.config.js"],
    plugins: {
      "@typescript-eslint": tsPlugin,
      local: localPlugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": true,
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
        },
      ],
      "local/no-supabase-resolution": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@supabase/supabase-js", message: supabaseImportMessage },
            { name: "@supabase/ssr", message: supabaseImportMessage },
            { name: "node:module", message: nodeModuleMessage },
            { name: "module", message: nodeModuleMessage },
          ],
          patterns: [
            { group: ["@supabase/supabase-js/*"], message: supabaseImportMessage },
            { group: ["@supabase/ssr/*"], message: supabaseImportMessage },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...typeAssertionSyntax],
    },
  },
  {
    // Ferme le vecteur à la racine plutôt que de le rattraper : aucun fichier
    // JavaScript légitime sous `src/` dans un projet TS strict. Le fichier
    // est signalé en erreur dès qu'il existe (sélecteur `Program`, présent
    // dans tout fichier JS/TS non vide), sans attendre qu'il contienne une
    // violation précise.
    //
    // `.mjs`/`.cjs` sont dans la liste, et ce n'est pas de la précaution :
    // sans eux le trou restait grand ouvert. `designTokenSyntax` (I10) n'est
    // attaché qu'à `src/**/*.ts(x)` ; prouvé empiriquement, un `src/**.mjs`
    // contenant `#123456`, `p-[17px]` et `{ width: "17px" }` passait `pnpm
    // lint` à zéro erreur. Interdire le fichier ferme I10 en même temps que
    // le reste, sans dupliquer les sélecteurs de tokens sur chaque extension.
    // `.mts`/`.cts` sont dans la liste pour la même raison : `**/*.ts` ne les
    // matche PAS, et l'`include` de `tsconfig.json` non plus. Un `src/lib/db.mts`
    // ne serait donc ni typé ni linté. Qu'il survive ou non au bundling de Next
    // n'est pas la question — on ne laisse pas une extension muette sous `src/`.
    files: [
      "src/**/*.js",
      "src/**/*.jsx",
      "src/**/*.mjs",
      "src/**/*.cjs",
      "src/**/*.mts",
      "src/**/*.cts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program",
          message:
            "Extension interdite sous src/ (.js/.jsx/.mjs/.cjs/.mts/.cts) : le projet est en TypeScript strict (I9), et les règles de tokens (I10) ne couvrent que .ts/.tsx. Renomme en .ts/.tsx.",
        },
        ...typeAssertionSyntax,
      ],
    },
  },
  {
    // src/services/* est la seule porte d'accès autorisée à Supabase (I3).
    // I9/I10 restent pleinement appliquées : parler à la base ne dispense
    // ni des types, ni des tokens.
    files: ["src/services/**/*.ts", "src/services/**/*.tsx"],
    rules: {
      "no-restricted-imports": "off",
      "local/no-supabase-resolution": "off",
    },
  },
  {
    // Le code serveur qui touche SERVICE_ROLE et les API externes n'a pas
    // besoin d'accéder à Supabase depuis src/services (il n'est pas dans src/),
    // mais node:module doit y rester autorisé (Deno edge functions).
    files: ["supabase/functions/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
      "local/no-supabase-resolution": "off",
    },
  },
];

export default config;
