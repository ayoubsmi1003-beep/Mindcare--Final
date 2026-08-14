/**
 * `_shared/cors.ts` — qui a le droit d'appeler une Edge Function DEPUIS un
 * navigateur. Source UNIQUE de l'allowlist d'origines.
 *
 * ═══ POURQUOI CE FICHIER EXISTE ═══
 * TROUVÉ AU NAVIGATEUR, PAS À LA RELECTURE. Sans réponse à la requête préalable
 * `OPTIONS`, le navigateur bloque l'appel AVANT qu'une seule ligne de la
 * fonction ne s'exécute : le routage d'ADR-023, l'allowlist d'outils, la trace
 * de franchissement — rien n'est atteint. L'écran affichait « Jarvis est
 * indisponible », ce qui était vrai et n'apprenait rien sur la cause. Les 24
 * contrôles hors ligne d'ADR-023 étaient verts pendant ce temps : ils testent
 * le routage, qui n'était jamais appelé.
 *
 * ═══ POURQUOI PAS `Access-Control-Allow-Origin: *` ═══
 * Le JWT reste exigé, donc `*` ne suffirait pas à faire écrire un tiers. Mais
 * `*` autorise n'importe quelle page ouverte dans le navigateur de la
 * praticienne connectée à SOLLICITER cette fonction et à en LIRE la réponse —
 * laquelle peut nommer une patiente. La règle 1 de `CLAUDE.md` ne distingue pas
 * la sortie par le réseau de la sortie par un onglet voisin.
 *
 * ═══ POURQUOI UN SEUL FICHIER ═══
 * Une allowlist recopiée dans deux fonctions est deux allowlists : la seconde
 * cesse d'être mise à jour et personne ne s'en aperçoit, parce que le symptôme
 * est un écran qui dit « indisponible » — le même mot que dix autres causes.
 *
 * ⚠️ AVANT LA MISE EN SERVICE AU CABINET : poser `CORS_ORIGINS` sur l'origine
 * réelle. Le repli ci-dessous est le poste de développement et rien d'autre.
 */

const ORIGINES_PAR_DEFAUT = "http://localhost:3000";

function originesAutorisees(): readonly string[] {
  return (Deno.env.get("CORS_ORIGINS") ?? ORIGINES_PAR_DEFAUT)
    .split(",")
    .map((origine) => origine.trim())
    .filter((origine) => origine.length > 0);
}

/**
 * Rend les en-têtes CORS, ou un objet VIDE si l'origine n'est pas autorisée.
 *
 * L'objet vide n'est pas un oubli : sans `Access-Control-Allow-Origin`, le
 * navigateur bloque de lui-même. On ne renvoie donc jamais d'erreur bavarde qui
 * confirmerait à un appelant non autorisé que la fonction existe.
 */
export function enTetesCors(req: Request): Record<string, string> {
  const origine = req.headers.get("Origin");
  if (origine === null || !originesAutorisees().includes(origine)) return {};

  return {
    "Access-Control-Allow-Origin": origine,
    /**
     * `Vary: Origin` est OBLIGATOIRE dès qu'une réponse dépend de l'origine :
     * sans lui, un cache intermédiaire peut resservir à une origine la réponse
     * mise en cache pour une autre.
     */
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Réponse à la requête préalable. Elle ne porte ni JWT ni corps : elle demande
 * seulement au serveur s'il accepte l'appel qui va suivre. Elle se traite AVANT
 * toute autre vérification — placée après un test de méthode, elle repart en
 * « méthode non supportée » et le navigateur bloque l'appel réel.
 *
 * Rend `null` quand la méthode n'est pas `OPTIONS`, pour que l'appelante écrive
 * une garde d'une seule ligne.
 */
export function reponsePrealable(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;

  const entetes = enTetesCors(req);
  return new Response(null, {
    status: Object.keys(entetes).length > 0 ? 204 : 403,
    headers: entetes,
  });
}
