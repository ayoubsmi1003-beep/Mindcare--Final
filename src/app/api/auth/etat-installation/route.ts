/**
 * `GET /api/auth/etat-installation` — « faut-il montrer le premier lancement ? »
 *
 * Même forme que `/api/auth/session` : appelable sans cookie, jamais mise en
 * cache (l'état passe de « non provisionné » à « provisionné » une fois pour
 * toutes, un cache périmé montrerait l'écran de configuration indéfiniment).
 */

import { NextResponse } from "next/server";

import { etatProvisionnement } from "@/server/auth/provisioning";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const etat = await etatProvisionnement();
    return NextResponse.json({ ok: true, data: etat });
  } catch {
    return NextResponse.json({ ok: false, code: "indisponible" }, { status: 503 });
  }
}
