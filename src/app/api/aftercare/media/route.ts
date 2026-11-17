import { z } from "zod";
import { NextResponse } from "next/server";
import { preparerAftercare as preparer, isAftercareSameOrigin } from "@/server/aftercare/context";
import { withCaller } from "@/server/db/withCaller";
import { AftercareBindingSchema, AftercareObjectSchema } from "@/services/aftercare-contracts";
import { aftercareSignature, aftercareTransportConfig } from "@/server/aftercare/transport";
import { postAftercareEnvelope } from "@/server/egress/external-call";
const Input = z.object({ bindingId: z.string().uuid(), objectId: z.string().uuid(), version: z.number().int().positive(), mediaId: z.string().uuid() }).strict();
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  const reject = (status: number) => NextResponse.json({ ok: false, code: "indisponible" }, { status });
  const config = aftercareTransportConfig(); if (!config) return reject(503);
  if (!isAftercareSameOrigin(request)) return reject(403);
  const ctx = await preparer(); if (ctx instanceof NextResponse) return ctx;
  try {
    const input = Input.parse(await request.json());
    const binding = await withCaller(ctx.userId, async q => {
      const opened = AftercareObjectSchema.parse((await q.query<{ object: unknown }>("SELECT to_jsonb(o) AS object FROM app.read_aftercare_object($1::uuid,$2::uuid,$3::integer) o", [input.bindingId, input.objectId, input.version]))[0]?.object);
      const ids = z.array(z.string().uuid()).max(5).parse(opened.body.mediaIds);
      if (!ids.includes(input.mediaId)) throw new Error("Unavailable");
      return AftercareBindingSchema.parse((await q.query<{ binding: unknown }>("SELECT to_jsonb(b) AS binding FROM app.list_aftercare_bindings($1::uuid) b WHERE id=$2::uuid AND revoked_at IS NULL", [opened.patient_id, opened.binding_id]))[0]?.binding);
    });
    if (binding.cabinet_id !== config.clinic) return reject(403);
    const url = new URL("/api/sanad/bridge/media", config.url), raw = JSON.stringify({ ...input, patientId: binding.portal_patient_id }), timestamp = String(Math.floor(Date.now() / 1000));
    const response = await postAftercareEnvelope(url.href, raw, { "Content-Type": "application/json", "X-Sanad-Clinic": config.clinic, "X-Sanad-Timestamp": timestamp, "X-Sanad-Signature": aftercareSignature(config.key, timestamp, url.pathname, raw) });
    const type = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!response.ok || !["image/jpeg", "image/png", "image/webp", "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"].includes(type) || Number(response.headers.get("content-length")) > 10485760) return reject(503);
    const bytes = await response.arrayBuffer(); if (bytes.byteLength > 10485760) return reject(503);
    return new Response(bytes, { headers: { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename="${input.mediaId}"` } });
  } catch { return reject(422); }
}
