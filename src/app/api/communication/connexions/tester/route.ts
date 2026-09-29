/**
 * `GET /api/communication/connexions/tester?canal=` — vérification live.
 *
 * Lecture seule : interroge le compte Composio connecté et rend le bilan
 * (connecté + capacités une par une). Aucun envoi, aucune publication,
 * aucune écriture provider — le « juste vérifier » de l'opérateur.
 */
import { NextResponse } from "next/server";

import { testerConnexion } from "@/server/communication/connexions-test";
import { SchemaConnexionTest } from "@/server/communication/schemas";

import { preparer, refus } from "../../../db/_commun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(requete: Request): Promise<NextResponse> {
  const ctx = await preparer();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(requete.url);
  const analyse = SchemaConnexionTest.safeParse({
    canal: url.searchParams.get("canal") ?? undefined,
  });
  if (!analyse.success) return refus("regle-metier", 400);

  try {
    const bilan = await testerConnexion(analyse.data.canal);
    return NextResponse.json({ ok: true, data: bilan });
  } catch {
    return refus("indisponible", 503);
  }
}
