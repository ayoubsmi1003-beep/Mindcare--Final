import { z } from "zod";
import { NextResponse } from "next/server";
import { preparerAftercare as preparer, isAftercareSameOrigin } from "@/server/aftercare/context";
import { withCaller } from "@/server/db/withCaller";
import { AftercareBindingSchema } from "@/services/aftercare-contracts";
import { AftercareControlError, aftercareTransportConfig, postAftercareControl, registerAftercareBinding } from "@/server/aftercare/transport";
const Input = z.object({ patientId: z.string().uuid(), bindingId: z.string().uuid(), objectId: z.string().uuid().optional(), version: z.number().int().positive().optional() }).strict().refine(p => Boolean(p.objectId) === Boolean(p.version));
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const config = aftercareTransportConfig();
  if (!config) return reply({ ok: false, code: "indisponible" }, 503);
  if (!isAftercareSameOrigin(request)) return reply({ ok: false, code: "interdit" }, 403);
  const ctx = await preparer(); if (ctx instanceof NextResponse) return ctx;
  try {
    const input = Input.parse(await request.json());
    const binding = await withCaller(ctx.userId, async q => {
      const rows = await q.query<{ binding: unknown }>("SELECT to_jsonb(b) AS binding FROM app.list_aftercare_bindings($1::uuid) b WHERE id=$2::uuid", [input.patientId, input.bindingId]);
      return AftercareBindingSchema.parse(rows[0]?.binding);
    });
    if (binding.cabinet_id !== config.clinic) return reply({ ok: false, code: "interdit" }, 403);
    let delivered: boolean;
    if (input.objectId && input.version) {
      const receipt = await withCaller(ctx.userId, async q => {
        const row = (await q.query<{ receipt: unknown }>("SELECT app.get_aftercare_read_receipt($1::uuid,$2::uuid,$3::integer) AS receipt", [binding.id, input.objectId, input.version]))[0];
        return z.object({ bindingId: z.string().uuid(), patientId: z.string().uuid(), objectId: z.string().uuid(), version: z.number().int().positive(), readAt: z.string().datetime({ offset: true }) }).strict().parse(row?.receipt);
      });
      delivered = await postAftercareControl("/read", receipt, config);
    } else delivered = await registerAftercareBinding(binding.id, config);
    return delivered ? reply({ ok: true, data: true }, 200) : reply({ ok: false, code: "indisponible" }, 503);
  } catch (cause) {
    return reply({ ok: false, code: "indisponible", stage: cause instanceof AftercareControlError ? "portal" : "receipt", ...(cause instanceof AftercareControlError ? { remoteStatus: cause.status, remoteCode: cause.remoteCode } : {}) }, 503);
  }
}
