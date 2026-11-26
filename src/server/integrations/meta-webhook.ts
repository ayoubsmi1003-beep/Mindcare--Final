/**
 * Meta webhook verification (WhatsApp Cloud API, Pages, Instagram) — for the future
 * integration gateway. NOT wired into the clinic server: the clinic has no public ingress
 * (docs/integrations/WEBHOOK-SECURITY.md). Meta signs the raw body with the app secret in
 * `X-Hub-Signature-256: sha256=<hex>` and sends no timestamp, so replay protection is the
 * caller's job (dedupe on the provider message id).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const META_WEBHOOK_MAX_BYTES = 256 * 1024;

/** GET subscription handshake: returns the challenge to echo, or null to answer 403. */
export function verifyMetaChallenge(params: URLSearchParams, verifyToken: string): string | null {
  const mode = params.get("hub.mode"), token = params.get("hub.verify_token"), challenge = params.get("hub.challenge");
  if (verifyToken.length < 16 || mode !== "subscribe" || token === null || challenge === null || !/^[A-Za-z0-9_-]{1,128}$/.test(challenge)) return null;
  const given = Buffer.from(token), expected = Buffer.from(verifyToken);
  return given.length === expected.length && timingSafeEqual(given, expected) ? challenge : null;
}

/** POST delivery: true only if the raw (unparsed) body was signed with the app secret. */
export function verifyMetaSignature(rawBody: Buffer, header: string | null, appSecret: string): boolean {
  if (appSecret.length < 16 || header === null || rawBody.byteLength > META_WEBHOOK_MAX_BYTES) return false;
  const hex = /^sha256=([a-fA-F0-9]{64})$/.exec(header)?.[1];
  if (hex === undefined) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return timingSafeEqual(Buffer.from(hex.toLowerCase(), "hex"), expected);
}
