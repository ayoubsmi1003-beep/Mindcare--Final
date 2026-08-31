/**
 * `POST /api/auth/sign-out` — la révocation.
 *
 * DEUX GESTES, ET IL FAUT LES DEUX. On détruit la ligne de `auth.sessions` ET
 * on efface le cookie. Chacun seul laisse un défaut :
 *   · effacer le seul cookie laisserait le jeton valide en base — quiconque en
 *     a gardé une copie (un journal de serveur mandataire, un historique)
 *     resterait connecté ;
 *   · détruire la seule ligne laisserait le navigateur renvoyer un jeton mort à
 *     chaque requête, donc une déconnexion qui ne se voit qu'au rechargement.
 *
 * `POST` et non `GET` : une déconnexion modifie l'état, et un `GET` serait
 * déclenchable par une simple balise `<img>` sur une page tierce — une CSRF de
 * déconnexion, bénigne mais gratuite à éviter.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { NOM_COOKIE, fermerSession } from "@/server/auth/session";

export async function POST(): Promise<NextResponse> {
  const magasin = await cookies();
  const jeton = magasin.get(NOM_COOKIE)?.value;

  try {
    await fermerSession(jeton);
  } catch {
    // La base est injoignable. On efface QUAND MÊME le cookie : laisser
    // l'utilisatrice « connectée » parce que la déconnexion a échoué est le
    // pire des deux résultats. La session expirera d'elle-même en base.
  }

  magasin.delete(NOM_COOKIE);
  return NextResponse.json({ ok: true, data: null });
}
