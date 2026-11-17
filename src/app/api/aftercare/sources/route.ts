import { z } from "zod";
import { NextResponse } from "next/server";
import { preparerAftercare as preparer, isAftercareSameOrigin } from "@/server/aftercare/context";
import { withCaller } from "@/server/db/withCaller";
import { AftercareObjectSchema, AftercareSubmissionSchema } from "@/services/aftercare-contracts";
import { aftercareSignature, aftercareTransportConfig } from "@/server/aftercare/transport";
import { postAftercareEnvelope } from "@/server/egress/external-call";

const Input = z.object({ bindingId: z.string().uuid(), reportId: z.string().uuid(), reportVersion: z.number().int().positive(), recordId: z.string().uuid(), version: z.number().int().positive() }).strict();
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const config = aftercareTransportConfig();
  if (!config) return reply({ code: "AFTERCARE_NOT_CONFIGURED" }, 503);
  if (!isAftercareSameOrigin(request)) return reply({ code: "FORBIDDEN" }, 403);
  const ctx = await preparer();
  if (ctx instanceof NextResponse) return ctx;
  try {
    const input = Input.parse(await request.json());
    const report = await withCaller(ctx.userId, async q => {
      const rows = await q.query<{ object: unknown }>("SELECT to_jsonb(o) AS object FROM app.read_aftercare_object($1::uuid,$2::uuid,$3::integer) o", [input.bindingId, input.reportId, input.reportVersion]);
      return AftercareObjectSchema.parse(rows[0]?.object);
    });
    const submission = AftercareSubmissionSchema.parse({ kind: report.kind, body: report.body });
    if ((submission.kind !== "report" && submission.kind !== "preparation") || !submission.body.selectedSources?.some(ref => ref.recordId === input.recordId && ref.version === input.version)) return reply({ code: "SOURCE_UNAVAILABLE" }, 403);
    const binding = await withCaller(ctx.userId, q => q.query<{ portal_patient_id: string }>("SELECT portal_patient_id FROM app.list_aftercare_bindings($1::uuid) WHERE id=$2::uuid AND revoked_at IS NULL", [report.patient_id, report.binding_id]));
    if (!binding[0]) return reply({ code: "SOURCE_UNAVAILABLE" }, 403);
    const url = new URL("/api/sanad/bridge/sources", config.url);
    const raw = JSON.stringify({ ...input, patientId: binding[0].portal_patient_id });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await postAftercareEnvelope(url.href, raw, { "Content-Type": "application/json", "X-Sanad-Clinic": config.clinic, "X-Sanad-Timestamp": timestamp, "X-Sanad-Signature": aftercareSignature(config.key, timestamp, url.pathname, raw) });
    if (!response.ok) return reply({ code: "SOURCE_UNAVAILABLE" }, response.status === 403 || response.status === 404 ? 404 : 503);
    const source = z.object({ id: z.string().uuid(), version: z.number().int().positive(), kind: z.string(), body: z.record(z.string(), z.unknown()) }).passthrough().parse(await response.json());
    if (source.id !== input.recordId || source.version !== input.version) return reply({ code: "SOURCE_UNAVAILABLE" }, 503);
    return reply({ ok: true, data: source }, 200);
  } catch { return reply({ code: "SOURCE_UNAVAILABLE" }, 422); }
}
