/**
 * `GET /api/cabinet/appareils` — les postes appairés du cabinet.
 *
 * Réservée au médecin (`app.autoriser_gestion_postes`), et à la machine hôte :
 * `electron/main/proxy-cabinet.ts` refuse cette route depuis le LAN, même avec
 * une session valide. Un poste appairé ne doit pas pouvoir lister ni révoquer
 * les autres.
 */

import { NextResponse } from "next/server";

import { preparer } from "@/app/api/db/_commun";
import { gestionPostesAutorisee } from "@/server/cabinet/porte";
import { hoteConfigure, listerPostes, posteCourant } from "@/server/cabinet/appareils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(requete: Request): Promise<NextResponse> {
  const ctx = await preparer();
  if (ctx instanceof NextResponse) return ctx;

  if (!(await gestionPostesAutorisee(ctx.userId))) {
    return NextResponse.json({ ok: false, code: "interdit" }, { status: 403 });
  }

  if (!hoteConfigure()) {
    // Développement web ou poste non configuré : le dossier privé n'existe
    // pas. On le dit, plutôt que de rendre une liste vide qui ferait croire à
    // un cabinet sans poste.
    return NextResponse.json({ ok: false, code: "indisponible" }, { status: 503 });
  }

  const jeton = requete.headers.get("x-mindcare-device") ?? undefined;
  const courant = posteCourant(jeton);

  return NextResponse.json({
    ok: true,
    data: listerPostes().map((poste) => ({ ...poste, current: poste.deviceId === courant })),
  });
}
