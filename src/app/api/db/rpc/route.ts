/**
 * `POST /api/db/rpc` — l'unique voie du navigateur vers une fonction SQL.
 *
 * Trois bornes, dans cet ordre, et aucune n'est « la sécurité » (voir l'en-tête
 * de `src/server/db/frontiere.ts`) :
 *   1. le nom doit être dans l'allowlist ENGENDRÉE depuis `src/services/**` ;
 *   2. les arguments sont validés (scalaires, clés en snake_case, bornes) ;
 *   3. l'appel est NOMMÉ et PARAMÉTRÉ — `SELECT * FROM app.fn(a := $1)`.
 *
 * Ce qui décide vraiment de ce que l'appelant obtient reste la RLS, évaluée
 * sous l'identité que `withCaller` a posée à partir du cookie.
 */

import { NextResponse } from "next/server";

import { EntreeRpc, rpcAutorise } from "@/server/db/frontiere";
import { faireePgPort } from "@/server/db/pgPort";
import { withCaller } from "@/server/db/withCaller";

import { preparer, refus } from "../_commun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Le code applicatif décide du statut HTTP, pas l'inverse. `src/services/
 * errors.ts` reste la référence : c'est lui qui a classé les SQLSTATE, et il
 * continue de le faire côté client à partir du code rendu ici.
 */
function statutPour(code: string): number {
  switch (code) {
    case "interdit":
      return 403;
    case "introuvable":
      return 404;
    case "conflit":
      return 409;
    case "regle-metier":
      return 422;
    case "non-authentifie":
      return 401;
    case "indisponible":
      return 503;
    default:
      return 500;
  }
}

export async function POST(requete: Request): Promise<NextResponse> {
  const ctx = await preparer();
  if (ctx instanceof NextResponse) return ctx;

  let brut: unknown;
  try {
    brut = await requete.json();
  } catch {
    return refus("regle-metier", 400);
  }

  const analyse = EntreeRpc.safeParse(brut);
  if (!analyse.success) return refus("regle-metier", 400);

  const { name, args } = analyse.data;

  // REFUS DE RECONNAISSANCE. Un nom hors allowlist rend exactement la même
  // chose qu'une fonction qui existe mais dont la RLS ne rend rien :
  // `introuvable`. Distinguer les deux dirait à un appelant quelles fonctions
  // existent — le même oracle d'existence qu'ADR-003 interdit sur les patients.
  if (!rpcAutorise(name)) return refus("introuvable", 404);

  const resultat = await withCaller(ctx.userId, async (q) => {
    const port = faireePgPort(q, "api.rpc");
    return port.rpc<Record<string, unknown>>(name, args);
  }).catch(() => null);

  if (resultat === null) return refus("indisponible", 503);
  if (!resultat.ok) {
    // SQLSTATE 42883 — « function does not exist » avec CES types d'arguments.
    // L'allowlist borne les NOMS, pas les signatures : elle ne peut pas savoir
    // que `dashboard_today` exige `p_day`. Un appel mal formé est donc une
    // erreur de REQUÊTE, et la rendre en 500 « inattendu » enverrait chercher
    // une panne de serveur là où c'est l'appelant qui s'est trompé — le défaut
    // que `errors.ts` décrit déjà : « une erreur qui désigne le mauvais organe
    // coûte plus cher que pas d'erreur du tout ».
    if (resultat.error.technical === "42883") return refus("regle-metier", 422);

    return NextResponse.json(
      { ok: false, code: resultat.error.code },
      { status: statutPour(resultat.error.code) },
    );
  }

  return NextResponse.json({ ok: true, data: resultat.data });
}
