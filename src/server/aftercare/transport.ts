import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AftercareEnvelopeSchema } from "@/services/aftercare-contracts";
import { withAftercareTransport, type Querier } from "@/server/db/withCaller";
import { postAftercareEnvelope } from "@/server/egress/external-call";

const uuid = z.string().uuid();
const Ack = z.object({ schemaVersion: z.literal(2), eventId: uuid, correlationId: uuid, status: z.enum(["applied", "duplicate", "stale"]), technicalOnly: z.literal(true) }).strict();
export interface AftercareTransportConfig { clinic: string; key: string; url: string }
export function aftercareTransportConfig(env: NodeJS.ProcessEnv = process.env): AftercareTransportConfig | null {
  try {
    if (env.AFTERCARE_ENABLED !== "synthetic" || !uuid.safeParse(env.AFTERCARE_CLINIC_ID).success || !env.AFTERCARE_BRIDGE_KEY || env.AFTERCARE_BRIDGE_KEY.length < 32) return null;
    const url = new URL(env.AFTERCARE_BRIDGE_URL ?? "");
    if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/api/sanad/bridge") return null;
    return { clinic: env.AFTERCARE_CLINIC_ID!, key: env.AFTERCARE_BRIDGE_KEY, url: url.href };
  } catch { return null; }
}
export function aftercareSignature(key: string, timestamp: string, pathname: string, raw: string): string {
  return createHmac("sha256", key).update(`${timestamp}\nPOST\n${pathname}\n${raw}`).digest("hex");
}
export function verifyAftercareSignature(request: Request, raw: string, config: AftercareTransportConfig, now = Date.now()): boolean {
  const timestamp = request.headers.get("x-sanad-timestamp") ?? "";
  const signature = request.headers.get("x-sanad-signature") ?? "";
  if (request.headers.get("x-sanad-clinic") !== config.clinic || !/^\d{1,12}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(aftercareSignature(config.key, timestamp, new URL(request.url).pathname, raw), "hex"));
}
type Transaction = <T>(fn: (q: Querier) => Promise<T>) => Promise<T>;
export class AftercareControlError extends Error {
  constructor(readonly status: number, readonly remoteCode: string) { super("AftercareControlRejected"); }
}
export async function postAftercareControl(path: "/binding" | "/read", body: unknown, config: AftercareTransportConfig): Promise<boolean> {
  const url = new URL(`/api/sanad/bridge${path}`, config.url), raw = JSON.stringify(body), timestamp = String(Math.floor(Date.now() / 1000));
  const response = await postAftercareEnvelope(url.href, raw, { "Content-Type": "application/json", "X-Sanad-Clinic": config.clinic, "X-Sanad-Timestamp": timestamp, "X-Sanad-Signature": aftercareSignature(config.key, timestamp, url.pathname, raw) });
  if (!response.ok) {
    let remoteCode = "UNAVAILABLE";
    try { const parsed = z.object({ error: z.enum(["UNAUTHENTICATED", "FORBIDDEN", "INVALID_INPUT", "CONFLICT", "UNAVAILABLE"]) }).parse(await response.json()); remoteCode = parsed.error; } catch { /* Never return raw remote response content. */ }
    throw new AftercareControlError(response.status, remoteCode);
  }
  return true;
}
export async function registerAftercareBinding(binding: string, config: AftercareTransportConfig, transaction: Transaction = withAftercareTransport): Promise<boolean> {
  const rows = await transaction(q => q.query<{ registration: unknown }>("SELECT app.aftercare_binding_registration($1::uuid,$2::uuid) AS registration", [config.clinic, binding]));
  const registration = z.object({ bindingId: uuid, patientId: uuid, consentVersion: z.number().int().positive(), relationship: z.enum(["self", "guardian"]), verifiedBy: uuid, revoked: z.boolean() }).strict().parse(rows[0]?.registration);
  return postAftercareControl("/binding", registration, config);
}
export async function receiveAftercare(request: Request, config = aftercareTransportConfig(), transaction: Transaction = withAftercareTransport): Promise<Response> {
  const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!config) return reply({ code: "AFTERCARE_NOT_CONFIGURED" }, 503);
  if (Number(request.headers.get("content-length")) > 262144) return reply({ code: "INVALID_EVENT" }, 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 262144) return reply({ code: "INVALID_EVENT" }, 413);
  if (!verifyAftercareSignature(request, raw, config)) return reply({ code: "INVALID_SIGNATURE" }, 401);
  try {
    const event = AftercareEnvelopeSchema.parse(JSON.parse(raw));
    if (event.source !== "sanad") return reply({ code: "INVALID_EVENT" }, 422);
    const ack = await transaction(async q => {
      const rows = await q.query<{ ack: unknown }>("SELECT app.ingest_aftercare_event($1::uuid,$2::jsonb) AS ack", [config.clinic, JSON.stringify(event)]);
      return Ack.parse(rows[0]?.ack);
    });
    return reply(ack, 200);
  } catch { return reply({ code: "EVENT_REJECTED" }, 422); }
}
export async function dispatchAftercareOutbox(config = aftercareTransportConfig(), transaction: Transaction = withAftercareTransport): Promise<{ delivered: number; pending: number }> {
  if (!config) throw new Error("AFTERCARE_NOT_CONFIGURED");
  const envelopes = await transaction(q => q.query<{ envelope: unknown }>("SELECT app.pending_aftercare_events($1::uuid,25) AS envelope", [config.clinic]));
  let delivered = 0;
  for (const row of envelopes) {
    const event = AftercareEnvelopeSchema.parse(row.envelope);
    const raw = JSON.stringify(event);
    const timestamp = String(Math.floor(Date.now() / 1000));
    try {
      if (!await registerAftercareBinding(event.bindingId, config, transaction)) continue;
      const response = await postAftercareEnvelope(config.url, raw, { "Content-Type": "application/json", "X-Sanad-Timestamp": timestamp, "X-Sanad-Clinic": config.clinic, "X-Sanad-Signature": aftercareSignature(config.key, timestamp, new URL(config.url).pathname, raw) });
      if (!response.ok) continue;
      const ack = Ack.parse(await response.json());
      if (ack.eventId !== event.eventId || ack.correlationId !== event.correlationId) continue;
      await transaction(q => q.query("SELECT app.ack_aftercare_event($1::uuid,$2::uuid,$3::text)", [config.clinic, event.eventId, ack.status]));
      delivered++;
    } catch { /* The same durable event stays pending for an explicit retry. */ }
  }
  return { delivered, pending: envelopes.length - delivered };
}
