/**
 * `GET /api/auth/session` — « qui est connecté ? ».
 *
 * Alimente `DbPort.getSession()`, que `authz.getCurrentUser()` appelle au
 * chargement de chaque écran.
 *
 * ⚠️ ELLE ÉCRIT, MALGRÉ SON `GET`. `auth.resolve_session` fait glisser
 * `last_seen_at` : c'est ce glissement qui donne la fenêtre d'inactivité de 8 h.
 * Conséquence pratique à ne pas manquer : cette route ne doit JAMAIS être mise
 * en cache, ni par Next, ni par un mandataire. `dynamic = "force-dynamic"` le
 * dit à Next ; sans cela, Next peut la rendre statiquement au build et servir
 * éternellement la même réponse — c'est-à-dire l'identité de la personne qui a
 * lancé la compilation.
 *
 * Le `GET` reste correct malgré l'écriture : rien n'est créé ni supprimé, et
 * l'appel est idempotent du point de vue de l'appelant.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { NOM_COOKIE, resoudreSession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const magasin = await cookies();
  const jeton = magasin.get(NOM_COOKIE)?.value;

  let userId: string | null;
  try {
    userId = await resoudreSession(jeton);
  } catch {
    // Base injoignable. On rend `indisponible` et NON « pas de session » : la
    // différence compte, parce que « pas de session » ferait basculer l'écran
    // vers la page de connexion et donnerait à croire que la session a expiré,
    // alors que c'est la base qui est tombée. Le dépôt distingue déjà les deux
    // (`hors-ligne` contre `non-authentifie`) dans src/services/errors.ts.
    return NextResponse.json({ ok: false, code: "indisponible" }, { status: 503 });
  }

  if (userId === null) {
    // Le cookie ne vaut plus rien : on l'efface, sinon il repartira à chaque
    // requête et la purge de `auth.sessions` ne servirait à rien côté client.
    if (jeton !== undefined) magasin.delete(NOM_COOKIE);
    return NextResponse.json({ ok: true, data: null });
  }

  return NextResponse.json({ ok: true, data: { userId } });
}
