import { z } from "zod";
import { NextResponse } from "next/server";
import { preparerAftercare as preparer, isAftercareSameOrigin } from "@/server/aftercare/context";
import { withCaller } from "@/server/db/withCaller";
import { AftercareBindingSchema, AftercareObjectSchema } from "@/services/aftercare-contracts";
import { aftercareTransportConfig, postAftercareControl, registerAftercareBinding } from "@/server/aftercare/transport";
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
      const opened = await withCaller(ctx.userId, async q => AftercareObjectSchema.parse((await q.query<{ object: unknown }>("SELECT to_jsonb(o) AS object FROM app.read_aftercare_object($1::uuid,$2::uuid,$3::integer) o", [binding.id, input.objectId, input.version]))[0]?.object));
      delivered = await postAftercareControl("/read", { bindingId: binding.id, patientId: binding.portal_patient_id, objectId: opened.object_id, version: opened.version, readAt: opened.read_at }, config);
    } else delivered = await registerAftercareBinding(binding.id, config);
    return delivered ? reply({ ok: true, data: true }, 200) : reply({ ok: false, code: "indisponible" }, 503);
  } catch { return reply({ ok: false, code: "indisponible" }, 503); }
}
