/**
 * `POST /api/cabinet/appareils/revoquer` — retire l'accès d'un poste.
 *
 * La révocation est immédiate : le proxy TLS vérifie le jeton à CHAQUE requête
 * (`verifierJeton`), donc le poste révoqué est refusé dès son appel suivant,
 * sans attendre l'expiration de sa session (24 h). La session elle-même reste
 * en base mais ne peut plus être présentée.
 */

import { NextResponse } from "next/server";

import { preparer } from "@/app/api/db/_commun";
import { gestionPostesAutorisee } from "@/server/cabinet/porte";
import { hoteConfigure, revoquerPoste } from "@/server/cabinet/appareils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(requete: Request): Promise<NextResponse> {
  const ctx = await preparer();
  if (ctx instanceof NextResponse) return ctx;

  if (!(await gestionPostesAutorisee(ctx.userId))) {
    return NextResponse.json({ ok: false, code: "interdit" }, { status: 403 });
  }

  if (!hoteConfigure()) {
    return NextResponse.json({ ok: false, code: "indisponible" }, { status: 503 });
  }

  let deviceId: unknown;
  try {
    const corps = (await requete.json()) as Record<string, unknown>;
    deviceId = corps["deviceId"];
  } catch {
    return NextResponse.json({ ok: false, code: "regle-metier" }, { status: 400 });
  }

  if (typeof deviceId !== "string" || !UUID.test(deviceId)) {
    return NextResponse.json({ ok: false, code: "regle-metier" }, { status: 400 });
  }

  // Un poste déjà révoqué rend `true` (idempotent) : révoquer deux fois n'est
  // pas une erreur, c'est le même état voulu.
  const ok = revoquerPoste(deviceId);
  return NextResponse.json({ ok, ...(ok ? {} : { code: "introuvable" }) }, { status: ok ? 200 : 404 });
}
