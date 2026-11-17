import { NextResponse } from "next/server";
import { isAftercareQualification, preparerAftercare, isAftercareSameOrigin } from "@/server/aftercare/context";
import { EntreeRpc } from "@/server/db/frontiere";
import { withCaller } from "@/server/db/withCaller";
import { faireePgPort } from "@/server/db/pgPort";
const gates = new Set(["verify_aftercare_binding", "revoke_aftercare_binding", "list_aftercare_bindings", "list_aftercare_objects", "read_aftercare_object", "publish_aftercare_object", "list_aftercare_clinical_sources", "publish_aftercare_clinical_snapshot"]);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  if (!isAftercareQualification()) return new Response(null, { status: 404 });
  if (!isAftercareSameOrigin(request)) return new Response(null, { status: 403 });
  const ctx = await preparerAftercare(); if (ctx instanceof NextResponse) return ctx;
  try {
    const input = EntreeRpc.parse(await request.json());
    if (!gates.has(input.name)) return new Response(null, { status: 404 });
    const result = await withCaller(ctx.userId, q => faireePgPort(q, "aftercare.qualification").rpc(input.name, input.args));
    return NextResponse.json(result.ok ? { ok: true, data: result.data } : { ok: false, code: result.error.code }, { status: result.ok ? 200 : result.error.code === "interdit" ? 403 : 422, headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ ok: false, code: "regle-metier" }, { status: 422 }); }
}
