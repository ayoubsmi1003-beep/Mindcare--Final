import { describe, expect, it } from "vitest";
import { aftercareSignature, aftercareTransportConfig, receiveAftercare, verifyAftercareSignature } from "@/server/aftercare/transport";
const clinic = "b0000000-0000-4000-8000-000000000001";
const config = { clinic, key: "synthetic-test-key-kept-in-memory-only", url: "http://127.0.0.1:12345/api/sanad/bridge" };
describe("Aftercare signed boundary", () => {
  it("fails closed for absent or nonloopback activation", async () => {
    expect(aftercareTransportConfig({})).toBeNull();
    for (const url of ["https://example.org/api/sanad/bridge", "http://localhost/api/sanad/bridge", "http://127.0.0.1/api/sanad/bridge?leak=1", "http://127.0.0.1/api/other"]) expect(aftercareTransportConfig({ AFTERCARE_ENABLED: "synthetic", AFTERCARE_CLINIC_ID: clinic, AFTERCARE_BRIDGE_KEY: config.key, AFTERCARE_BRIDGE_URL: url })).toBeNull();
    expect((await receiveAftercare(new Request("http://127.0.0.1/api/aftercare/bridge", { method: "POST", body: "{}" }), null)).status).toBe(503);
  });
  it("authenticates exact raw bytes, clinic, path and 300 second freshness", () => {
    const timestamp = "1800000000", raw = '{ "synthetic": true }';
    const headers = { "X-Sanad-Timestamp": timestamp, "X-Sanad-Clinic": clinic, "X-Sanad-Signature": aftercareSignature(config.key, timestamp, "/api/aftercare/bridge", raw) };
    const request = new Request("http://127.0.0.1/api/aftercare/bridge", { method: "POST", headers });
    expect(verifyAftercareSignature(request, raw, config, 1800000000_000)).toBe(true);
    expect(verifyAftercareSignature(request, raw.replace(" ", ""), config, 1800000000_000)).toBe(false);
    expect(verifyAftercareSignature(request, raw, { ...config, clinic: "b0000000-0000-4000-8000-000000000002" }, 1800000000_000)).toBe(false);
    expect(verifyAftercareSignature(request, raw, config, 1800000301_000)).toBe(false);
    expect(verifyAftercareSignature(new Request("http://127.0.0.1/wrong", { headers }), raw, config, 1800000000_000)).toBe(false);
  });
  it("rejects signatures before entering any SQL transaction", async () => {
    const response = await receiveAftercare(new Request("http://127.0.0.1/api/aftercare/bridge", { method: "POST", body: "{}" }), config, async () => { throw new Error("Must never reach SQL"); });
    expect(response.status).toBe(401);
  });
});
