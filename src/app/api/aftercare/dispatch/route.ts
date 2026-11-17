import { NextResponse } from "next/server";
import { z } from "zod";
import { preparerAftercare as preparer, isAftercareSameOrigin } from "@/server/aftercare/context";
import { withCaller } from "@/server/db/withCaller";
import { aftercareTransportConfig, dispatchAftercareOutbox } from "@/server/aftercare/transport";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  if (!aftercareTransportConfig()) return NextResponse.json({ code: "AFTERCARE_NOT_CONFIGURED" }, { status: 503 });
  if (!isAftercareSameOrigin(request)) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
  const ctx = await preparer();
  if (ctx instanceof NextResponse) return ctx;
  try {
    const { patientId } = z.object({ patientId: z.string().uuid() }).strict().parse(await request.json());
    const rows = await withCaller(ctx.userId, q => q.query<{ allowed: boolean }>("SELECT EXISTS(SELECT 1 FROM app.list_aftercare_bindings($1::uuid) WHERE revoked_at IS NULL) AS allowed", [patientId]));
    if (!rows[0]?.allowed) return NextResponse.json({ ok: false, code: "interdit" }, { status: 403 });
    return NextResponse.json({ ok: true, data: await dispatchAftercareOutbox() }, { headers: { "Cache-Control": "no-store" } });
  }
  catch { return NextResponse.json({ code: "DELIVERY_UNAVAILABLE" }, { status: 503 }); }
}
