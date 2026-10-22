/**
 * `POST /api/cabinet/invitation` — un code d'appairage à usage unique.
 *
 * ═══ POURQUOI ICI, ET PLUS DANS LE PROCESSUS PRINCIPAL ═════════════════════
 *
 * L'ancien parcours demandait une élévation UAC pour écrire dans
 * `%ProgramData%\MindCare\private`. Le backend tourne déjà sous SYSTEM : il peut
 * écrire ce fichier sans aucune fenêtre administrateur. Le médecin clique, un
 * code s'affiche — c'est tout.
 *
 * ═══ CE QUE LA ROUTE NE FAIT PAS ════════════════════════════════════════════
 *
 * Elle ne crée aucun appareil : le jeton n'est remis qu'au poste qui présente
 * le code sur le canal UDP chiffré, et une seule fois (`178`). Elle n'accorde
 * aucun accès clinique — la session et la RLS restent obligatoires.
 */

import { NextResponse } from "next/server";

import { preparer } from "@/app/api/db/_commun";
import { gestionPostesAutorisee } from "@/server/cabinet/porte";
import { CabinetNonConfigure, creerInvitation } from "@/server/cabinet/invitation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const ctx = await preparer();
  if (ctx instanceof NextResponse) return ctx;

  if (!(await gestionPostesAutorisee(ctx.userId))) {
    return NextResponse.json({ ok: false, code: "interdit" }, { status: 403 });
  }

  try {
    const invitation = creerInvitation();
    return NextResponse.json({ ok: true, data: invitation });
  } catch (cause) {
    if (cause instanceof CabinetNonConfigure) {
      // Le poste n'est pas un hôte de cabinet configuré (développement web,
      // poste client). Le dire explicitement vaut mieux qu'un 500 opaque.
      return NextResponse.json({ ok: false, code: "indisponible" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, code: "indisponible" }, { status: 503 });
  }
}
