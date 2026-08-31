import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

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
};

export default nextConfig;
