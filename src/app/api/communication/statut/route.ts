/**
 * `GET /api/communication/statut?canal=` — statut des connexions externes.
 *
 * En-têtes seuls (statut + capacités), aucun secret — il n'y en a pas en
 * base (`external_connections` ne porte ni token ni clé, 112). Session
 * requise, périmètre RLS.
 */
import { NextResponse } from "next/server";

import { SchemaStatutQuery } from "@/server/communication/schemas";
import { faireePgPort } from "@/server/db/pgPort";
import { withCaller } from "@/server/db/withCaller";

import { preparer, refus } from "../../db/_commun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(requete: Request): Promise<NextResponse> {
  const ctx = await preparer();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(requete.url);
  const analyse = SchemaStatutQuery.safeParse({
    canal: url.searchParams.get("canal") ?? undefined,
  });
  if (!analyse.success) return refus("regle-metier", 400);

  const resultat = await withCaller(ctx.userId, async (q) => {
    const port = faireePgPort(q, "api.communication.statut");
    return port.rpc<Record<string, unknown>>("comm_connection_status", {
      p_canal: analyse.data.canal ?? null,
    });
  }).catch(() => null);

  if (resultat === null) return refus("indisponible", 503);
  if (!resultat.ok) return refus("indisponible", 503);
  return NextResponse.json({ ok: true, data: resultat.data });
}
