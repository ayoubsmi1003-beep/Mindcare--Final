/**
 * `garde-origine` — REFUSE DE DÉMARRER SUR UNE ORIGINE QUE PERSONNE N'A AUTORISÉE.
 *
 * ═══ LE DÉFAUT QUE CE FICHIER EMPÊCHE DE REVENIR ═══
 *
 * TROUVÉ AU NAVIGATEUR LE 2026-08-27. Quand le port 3000 est déjà pris — un
 * `pnpm dev` oublié dans un autre terminal, et c'est tout ce qu'il faut —
 * Next.js NE S'ARRÊTE PAS : il glisse sur le port suivant et l'annonce sur une
 * ligne d'avertissement que personne ne lit.
 *
 *     ⚠ Port 3000 is in use by process 18628, using available port 3002 instead.
 *
 * À partir de là, l'origine du navigateur est `http://localhost:3002`. Or
 * l'allowlist de `supabase/functions/_shared/cors.ts` ne contient QUE
 * `http://localhost:3000`. La requête préalable part, revient en 403 SANS
 * `Access-Control-Allow-Origin`, et le navigateur bloque l'appel réel. Mesuré :
 *
 *     OPTIONS jarvis-analyze-session, Origin http://localhost:3000  →  204
 *     OPTIONS jarvis-analyze-session, Origin http://localhost:3002  →  403
 *
 * Ce que voit alors la praticienne — et ce qu'a vu le développeur pendant des
 * heures — est un `TypeError: Failed to fetch` levé dans `supabase.ts`, plus un
 * `FunctionsFetchError` pour l'analyse de séance. AUCUN des deux ne nomme
 * l'origine, et pour cause : le navigateur refuse par conception de dire à
 * JavaScript pourquoi une requête inter-origines a échoué. La cause est donc
 * STRUCTURELLEMENT invisible depuis le code applicatif — c'est pourquoi la
 * garde est ici, avant le démarrage, et non dans un `catch`.
 *
 * ═══ POURQUOI ON NE CORRIGE PAS EN ÉLARGISSANT L'ALLOWLIST ═══
 *
 * Ajouter 3001, 3002, 3003 « au cas où » reviendrait à autoriser une poignée
 * d'origines supplémentaires à SOLLICITER les fonctions et à LIRE leurs
 * réponses — lesquelles nomment des patientes. `cors.ts` explique pourquoi
 * l'allowlist est étroite ; la bonne réponse à un port qui glisse est de
 * l'empêcher de glisser, pas d'élargir la porte.
 *
 * Le port se règle par `PORT`. En changer suppose de poser `CORS_ORIGINS` sur
 * le projet Supabase EN MÊME TEMPS — c'est exactement ce que le message
 * ci-dessous rappelle.
 */
import { connect } from "node:net";

const PORT = Number(process.env["PORT"] ?? "3000");

/**
 * Le port est-il libre ? On tente de S'Y CONNECTER, et NON de l'écouter.
 *
 * ⚠️ LA SONDE PAR `listen()` NE MARCHE PAS SOUS WINDOWS, et elle échoue du
 * mauvais côté : elle rend « libre ». Node pose `SO_REUSEADDR`, que Windows
 * interprète — contrairement à Linux — comme l'autorisation de se lier à un
 * port DÉJÀ écouté par un autre processus. Mesuré sur ce poste : le serveur de
 * développement écoutait bel et bien sur 3000 (`netstat` le montrait, `curl`
 * rendait 307), et la sonde `listen` réussissait quand même. Une garde qui
 * laisse passer le cas exact qu'elle surveille est pire que pas de garde : elle
 * fait croire que la question a été posée.
 *
 * Une connexion acceptée, elle, prouve que QUELQU'UN répond — ce qui est
 * précisément la condition qui fera glisser Next.js sur le port suivant.
 */
const libre = await new Promise((resoudre) => {
  const sonde = connect({ port: PORT, host: "127.0.0.1" });
  const conclure = (valeur) => {
    sonde.destroy();
    resoudre(valeur);
  };
  sonde.setTimeout(1_000);
  sonde.once("connect", () => conclure(false));
  sonde.once("timeout", () => conclure(true));
  sonde.once("error", () => conclure(true));
});

if (libre) process.exit(0);

console.error(`
╔══════════════════════════════════════════════════════════════════════════╗
║  DÉMARRAGE REFUSÉ — le port ${PORT} est déjà occupé.
╚══════════════════════════════════════════════════════════════════════════╝

  Next.js glisserait silencieusement sur le port suivant. L'origine du
  navigateur cesserait alors de correspondre à l'allowlist CORS des Edge
  Functions, et TOUT appel à Jarvis échouerait sur un « Failed to fetch »
  qui ne nomme jamais sa cause — le navigateur ne la révèle pas.

  Libérer le port :

      netstat -ano | grep ":${PORT} "        (relever le PID)
      taskkill /PID <pid> /F

  Ou servir ailleurs, EN POSANT L'ORIGINE CORRESPONDANTE sur le projet
  Supabase — les deux vont ensemble, jamais l'une sans l'autre :

      PORT=3005 pnpm dev
      pnpm exec supabase secrets set CORS_ORIGINS=http://localhost:3005 \\
        --project-ref ftxaseynjvjevwybdoii
`);
process.exit(1);
