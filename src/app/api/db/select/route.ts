/**
 * `POST /api/db/select` — lecture directe des trois relations non gardées.
 *
 * POURQUOI `POST` POUR UNE LECTURE. La spécification est un objet (colonnes,
 * filtres, tri) : la sérialiser en chaîne de requête produirait une URL longue,
 * journalisée par tout mandataire — donc des valeurs de filtre dans des
 * journaux. Un `POST` garde la spécification dans le corps. La route ne modifie
 * rien et reste idempotente du point de vue de l'appelant.
 *
 * TROIS RELATIONS, PAS UNE DE PLUS : `profiles`, `notifications`, `deployment`.
 * Tout le reste — patients, rendez-vous, consultations, documents, paiements —
 * passe obligatoirement par une porte SQL (ADR-019), donc par `/api/db/rpc`.
 * Cette liste vient de l'allowlist engendrée ; elle n'est pas reconduite ici à
 * la main, et elle se réduira d'elle-même si un service cesse de lire en direct.
 */

import { NextResponse } from "next/server";

import { EntreeSelect, selectAutorise } from "@/server/db/frontiere";
import { faireePgPort } from "@/server/db/pgPort";
import { withCaller } from "@/server/db/withCaller";

import { preparer, refus } from "../_commun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(requete: Request): Promise<NextResponse> {
  const ctx = await preparer();
  if (ctx instanceof NextResponse) return ctx;

  let brut: unknown;
  try {
    brut = await requete.json();
  } catch {
    return refus("regle-metier", 400);
  }

  const analyse = EntreeSelect.safeParse(brut);
  if (!analyse.success) return refus("regle-metier", 400);

  const spec = analyse.data;

  // La relation ET chaque colonne citée — colonnes de filtre et de tri
  // comprises, parce qu'elles finissent dans le SQL au même titre que
  // `columns`. Une borne qui oublierait `filters` aurait un trou.
  if (!selectAutorise(spec)) return refus("introuvable", 404);

  // `SelectSpec.columns` est un TUPLE NON VIDE, et zod rend un `string[]`.
  // On le reconstruit par déstructuration plutôt que par double assertion
  // (interdite, I9) : le compilateur vérifie alors réellement que la première
  // colonne existe, au lieu qu'on le lui affirme.
  const [premiere, ...reste] = spec.columns;
  if (premiere === undefined) return refus("regle-metier", 400);
  const colonnes: readonly [string, ...string[]] = [premiere, ...reste];

  const resultat = await withCaller(ctx.userId, async (q) => {
    const port = faireePgPort(q, "api.select");
    // `exactOptionalPropertyTypes` est actif : poser `filters: undefined` n'est
    // PAS équivalent à ne pas poser `filters`. On étale donc les clés
    // conditionnellement — même motif que `toAppError` dans errors.ts.
    return port.select<Record<string, unknown>>({
      relation: spec.relation,
      columns: colonnes,
      ...(spec.filters !== undefined && { filters: spec.filters }),
      ...(spec.order !== undefined && { order: spec.order }),
      ...(spec.limit !== undefined && { limit: spec.limit }),
      ...(spec.offset !== undefined && { offset: spec.offset }),
    });
  }).catch(() => null);

  if (resultat === null) return refus("indisponible", 503);
  if (!resultat.ok) {
    return NextResponse.json({ ok: false, code: resultat.error.code }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: resultat.data });
}
