import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { META_WEBHOOK_MAX_BYTES, verifyMetaChallenge, verifyMetaSignature } from "@/server/integrations/meta-webhook";

const SECRET = "test-app-secret-not-real-0001";
const TOKEN = "test-verify-token-not-real";
const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));
const sign = (raw: Buffer, secret = SECRET) => "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");

describe("verifyMetaSignature", () => {
  it("accepts the exact signed raw body", () => { expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true); });
  it("accepts upper-case hex", () => { expect(verifyMetaSignature(body, sign(body).toUpperCase().replace("SHA256=", "sha256="), SECRET)).toBe(true); });
  it.each([
    ["a tampered body", Buffer.from(body.toString().replace("[]", "[1]")), sign(body)],
    ["another secret", body, sign(body, "another-secret-not-real-01")],
    ["a missing header", body, null],
    ["a missing prefix", body, sign(body).slice("sha256=".length)],
    ["the sha1 scheme", body, "sha1=" + "a".repeat(40)],
    ["a truncated digest", body, sign(body).slice(0, -2)],
    ["a non-hex digest", body, "sha256=" + "z".repeat(64)],
  ])("rejects %s", (_label, raw, header) => { expect(verifyMetaSignature(raw, header, SECRET)).toBe(false); });
  it("rejects an oversized body before computing anything", () => {
    const big = Buffer.alloc(META_WEBHOOK_MAX_BYTES + 1, 0x20);
    expect(verifyMetaSignature(big, sign(big), SECRET)).toBe(false);
  });
  it("refuses to run with a weak secret", () => { expect(verifyMetaSignature(body, sign(body, "short"), "short")).toBe(false); });
});

describe("verifyMetaChallenge", () => {
  const params = (extra: Record<string, string>) => new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": TOKEN, "hub.challenge": "1158201444", ...extra });
  it("echoes the challenge for the right token", () => { expect(verifyMetaChallenge(params({}), TOKEN)).toBe("1158201444"); });
  it.each([
    ["a wrong token", { "hub.verify_token": "wrong-token-of-another-app" }],
    ["a wrong mode", { "hub.mode": "unsubscribe" }],
    ["a challenge with markup", { "hub.challenge": "<script>" }],
  ])("refuses %s", (_label, extra) => { expect(verifyMetaChallenge(params(extra), TOKEN)).toBeNull(); });
  it("refuses when the configured token is weak", () => { expect(verifyMetaChallenge(params({ "hub.verify_token": "short" }), "short")).toBeNull(); });
});
