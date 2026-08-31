/**
 * Contexte partagé des deux routes de la frontière de données.
 *
 * Chaque requête suit le même chemin, et l'ordre compte :
 *   1. le contrôle de démarrage (mémoïsé) — refuse de servir si l'allowlist ne
 *      correspond plus à la base ;
 *   2. la résolution de session — l'identité vient du COOKIE, jamais du corps ;
 *   3. `withCaller(userId)` — `SET LOCAL ROLE` + identité posée en base ;
 *   4. la RLS décide.
 *
 * ⚠️ L'IDENTITÉ NE VIENT JAMAIS DE LA REQUÊTE. Ni `practitioner_id`, ni
 * `cabinet_id`, ni un rôle ne sont acceptés depuis le client — ils viennent de
 * `auth.uid()` et `app.current_cabinet()` en base. C'est la règle 4 de
 * CLAUDE.md, et c'est ce qui fait qu'un client compromis ne peut pas élargir
 * son propre périmètre.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { NOM_COOKIE, resoudreSession } from "@/server/auth/session";
import { verifierAllowlist, verifierUneFois } from "@/server/db/frontiere";
import { withCaller } from "@/server/db/withCaller";
import { verifierDemarrage } from "@/server/demarrage";

export interface Contexte {
  readonly userId: string;
}

/** Réponse d'erreur uniforme : un code, jamais un détail de base. */
export function refus(code: string, statut: number): NextResponse {
  return NextResponse.json({ ok: false, code }, { status: statut });
}

/**
 * Prépare la requête : contrôle de démarrage puis identité.
 * Rend soit un `Contexte`, soit la réponse d'erreur à renvoyer telle quelle.
 */
export async function preparer(): Promise<Contexte | NextResponse> {
  try {
    // Les DEUX contrôles, mémoïsés ensemble : ils répondent à la même question
    // (« cette base est-elle en état de servir ? ») et doivent donc barrer la
    // route au même endroit.
    //
    // ⚠️ L'ORDRE COMPTE. Le schéma d'abord : sur une base partiellement migrée,
    // l'allowlist signalerait « fonctions absentes de pg_proc », ce qui est
    // vrai mais trompeur — on chercherait un défaut d'allowlist là où il manque
    // simplement des migrations. Le premier message doit désigner le bon organe.
    await verifierUneFois(async () => {
      const etat = await verifierDemarrage(process.cwd());
      if (!etat.ok) {
        throw new Error(
          `schema non servable (${etat.probleme ?? "inconnu"})` +
            (etat.migrationsManquantes !== undefined
              ? ` — manquantes : ${etat.migrationsManquantes.join(", ")}`
              : ""),
        );
      }
      // Le contrôle tourne SOUS IDENTITÉ NULLE : il ne lit que des catalogues
      // (`pg_proc`, `pg_class`), jamais une donnée du cabinet.
      await withCaller(null, (q) => verifierAllowlist(q));
    });
  } catch {
    // Allowlist incohérente ou base injoignable. Aucun détail ne sort : le
    // message nomme des fonctions et va au journal du serveur, pas au réseau.
    return refus("indisponible", 503);
  }

  const magasin = await cookies();
  const jeton = magasin.get(NOM_COOKIE)?.value;

  let userId: string | null;
  try {
    userId = await resoudreSession(jeton);
  } catch {
    return refus("indisponible", 503);
  }

  if (userId === null) {
    // 401 et non 403 : la session est absente ou expirée, pas refusée.
    // `src/services/errors.ts` traduit déjà ce cas en `non-authentifie`, que
    // l'interface distingue de `interdit`.
    return refus("non-authentifie", 401);
  }

  return { userId };
}
