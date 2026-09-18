import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // Perf pass: zod est le seul gros lib côté client (validation partout).
  // `optimizePackageImports` évite d'embarquer tout zod quand seule une
  // poignée de schémas est importée par route.
  experimental: { optimizePackageImports: ["zod"] },
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },

  /**
   * ═══ `pg` N'EST PAS EMPAQUETÉ — IL EST REQUIS À L'EXÉCUTION ═══════════════
   *
   * LE SYMPTÔME. `pnpm dev` échouait au démarrage :
   *
   *   ○ Compiling /instrumentation ...
   *   ⨯ pg-connection-string/index.js:88
   *     Module not found: Can't resolve 'fs'
   *     trace : pg/esm/index.mjs → src/server/db/pool.ts
   *             → withCaller.ts → demarrage.ts → src/instrumentation.ts
   *
   * puis « Can't resolve 'pg-native' » en boucle, et TOUTES les requêtes en 500
   * — y compris `/api/auth/session`, `/api/db/rpc`, `/patients` et
   * `/meta.json`. L'échec d'UNE unité de compilation empoisonnait le serveur
   * entier.
   *
   * LA CAUSE. Next compile `instrumentation.ts` comme sa PROPRE unité, et le
   * compilateur y empaquetait `pg`. Or `pg` n'est pas empaquetable :
   *
   *   · `pg-connection-string` fait `require('fs')` À L'INTÉRIEUR d'une
   *     condition (ne charge `fs` que s'il y a un certificat TLS à lire).
   *     Webpack ne peut pas savoir que la branche est morte ici : il tente de
   *     résoudre `fs` statiquement, et échoue dans cette unité ;
   *   · `pg/lib/native/index.js` fait `require('pg-native')`, une liaison
   *     native OPTIONNELLE, dans un `try/catch`. Absente par conception —
   *     `pg` retombe sur son implémentation JavaScript. Webpack ne voit que
   *     l'échec de résolution, d'où l'avertissement répété.
   *
   * Les deux symptômes ont donc UNE seule cause : on empaquetait un module
   * qui doit être chargé par Node, pas assemblé par webpack.
   *
   * LE CORRECTIF. `serverExternalPackages` dit à Next de laisser `pg` en
   * `require` à l'exécution, côté serveur. C'est le mécanisme prévu pour
   * exactement ce cas, et il est plus JUSTE que les contournements écartés :
   *
   *   · `resolve.fallback.fs = false` MENTIRAIT — il prétendrait que `fs`
   *     n'existe pas, alors qu'il existe et que `pg` s'en sert légitimement
   *     quand on lui donne un certificat. On casserait TLS sans le savoir ;
   *   · installer `pg-native` ajouterait une dépendance native à compiler sur
   *     le poste du cabinet, pour une fonctionnalité dont on ne veut pas ;
   *   · retirer le contrôle de démarrage supprimerait le symptôme en perdant
   *     l'avertissement précoce sur un schéma incomplet.
   *
   * CE QUE ÇA NE CHANGE PAS, ET C'EST L'ESSENTIEL. `pg` reste STRICTEMENT
   * serveur. Cette option ne concerne que la compilation SERVEUR : elle ne
   * rend `pg` accessible à aucun code client. La frontière reste
   * navigateur → `/api/*` → `withCaller` → PostgreSQL, et `src/server/**`
   * n'est toujours importé par aucun composant. Le contrôle 2b de
   * `preflight.sh` continue de vérifier que rien de tout cela n'atteint
   * `.next/static/`.
   */
  serverExternalPackages: ["pg"],

  /**
   * ═══ SORTIE AUTONOME, UNIQUEMENT QUAND ON EMPAQUETTE ═════════════════════
   *
   * §I du plan : le paquet Electron embarque le backend Next.js EXISTANT,
   * pas une réécriture. `output: "standalone"` produit `.next/standalone/` —
   * `server.js` plus le sous-ensemble EXACT de `node_modules` que le serveur
   * atteint réellement. C'est ce qui permet de livrer le backend sans
   * embarquer les 900 Mio de `node_modules` du dépôt, et sans lui donner
   * accès à ce qu'il n'utilise pas (les scripts de mesure, Playwright, les
   * outils de checkpoint) : la liste blanche de §I commence ici, au traçage.
   *
   * ⚠️ CONDITIONNÉ À UNE VARIABLE, ET C'EST DÉLIBÉRÉ. Le plan pose que le
   * DÉVELOPPEMENT NE CHANGE PAS. `pnpm build` et `pnpm start` doivent produire
   * et servir exactement ce qu'ils produisaient hier ; seul
   * `pnpm build:desktop` (qui pose `MINDCARE_PAQUET=1`) demande la sortie
   * autonome. Une option globale aurait fait porter à toute l'équipe le coût
   * d'un mode dont seul l'installateur a besoin.
   */
  ...(process.env["MINDCARE_PAQUET"] === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
