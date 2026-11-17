import { z } from "zod";
import { NextResponse } from "next/server";
import { preparerAftercare as preparer, isAftercareSameOrigin } from "@/server/aftercare/context";
import { withCaller } from "@/server/db/withCaller";
import { AftercareBindingSchema } from "@/services/aftercare-contracts";
import { aftercareSignature, aftercareTransportConfig } from "@/server/aftercare/transport";
import { postAftercareEnvelope } from "@/server/egress/external-call";
const uuid = z.string().uuid();
const Scope = z.enum(["emotional-support", "care-coordination", "legal-representation"]);
const Base = { patientId: uuid, bindingId: uuid };
const Input = z.discriminatedUnion("action", [z.object({ ...Base, action: z.literal("list") }).strict(), z.object({ ...Base, action: z.literal("verify"), relationshipId: uuid, evidenceRef: z.string().min(1).max(200).regex(/^[A-Za-z0-9_./:-]+$/), scopes: z.array(Scope).min(1).max(3), requestId: uuid, confirmed: z.literal(true) }).strict()]);
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
    const payload = await withCaller(ctx.userId, async q => {
      const rows = await q.query<{ binding: unknown }>("SELECT to_jsonb(b) AS binding FROM app.list_aftercare_bindings($1::uuid) b WHERE id=$2::uuid AND revoked_at IS NULL", [input.patientId, input.bindingId]);
      const binding = AftercareBindingSchema.parse(rows[0]?.binding);
      if (binding.cabinet_id !== config.clinic) throw new Error("Unavailable");
      if (input.action === "list") return { bindingId: binding.id, patientId: binding.portal_patient_id, action: "list" };
      const approved = await q.query<{ approval: unknown }>("SELECT app.approve_aftercare_support_verification($1::uuid,$2::uuid,$3::text,$4::text[],$5::uuid,$6::boolean) AS approval", [binding.id, input.relationshipId, input.evidenceRef, input.scopes, input.requestId, input.confirmed]);
      return approved[0]?.approval;
    });
    const url = new URL("/api/sanad/bridge/support", config.url), raw = JSON.stringify(payload), timestamp = String(Math.floor(Date.now() / 1000));
    const response = await postAftercareEnvelope(url.href, raw, { "Content-Type": "application/json", "X-Sanad-Clinic": config.clinic, "X-Sanad-Timestamp": timestamp, "X-Sanad-Signature": aftercareSignature(config.key, timestamp, url.pathname, raw) });
    if (!response.ok) return reply({ ok: false, code: "indisponible" }, 503);
    const Relationship = z.object({ id: uuid, recipientName: z.string().max(200), relationship: z.string().max(100), acceptedAt: z.string().nullable(), verifiedAt: z.string().nullable(), verifiedScopes: z.array(Scope) }).passthrough();
    const data = input.action === "list" ? z.object({ relationships: z.array(Relationship).max(100) }).parse(await response.json()) : Relationship.parse(await response.json());
    return reply({ ok: true, data }, 200);
  } catch { return reply({ ok: false, code: "indisponible" }, 503); }
}
