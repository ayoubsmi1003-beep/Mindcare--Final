/**
 * `POST /api/communication/automations/evaluer` — déclenche un balayage.
 *
 * Session requise. Pas de planificateur dans le dépôt (pas de cron) : cette
 * route EST le point d'entrée (appel manuel ou travailleur Phase 7+). Chaque
 * exécution est idempotente par nature (handoff déjà requis → la porte
 * ré-enregistre sans effet de bord externe) et journalisée en base.
 */
import { NextResponse } from "next/server";

import { evaluerAutomations } from "@/server/communication/automation";
import { SchemaAutomationEval } from "@/server/communication/schemas";
import { withCaller } from "@/server/db/withCaller";

import { preparer, refus } from "../../../db/_commun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(requete: Request): Promise<NextResponse> {
  const ctx = await preparer();
  if (ctx instanceof NextResponse) return ctx;

  let brut: unknown = {};
  try {
    const texte = await requete.text();
    brut = texte.trim() === "" ? {} : (JSON.parse(texte) as unknown);
  } catch {
    return refus("regle-metier", 400);
  }
  const analyse = SchemaAutomationEval.safeParse(brut);
  if (!analyse.success) return refus("regle-metier", 400);

  try {
    const bilan = await withCaller(ctx.userId, (q) =>
      evaluerAutomations(q, {
        seuilMinutes: analyse.data.seuilMinutes ?? 60,
        maintenantIso: new Date().toISOString(),
      }),
    );
    return NextResponse.json({ ok: true, data: bilan });
  } catch {
    return refus("indisponible", 503);
  }
}
