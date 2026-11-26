import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { submitAppointmentRequest } from "@/server/integrations/appointment-intake";

// Launched only by scripts/checkpoint-appointment-requests.mjs --ts, on its fresh native
// cluster; never against a supplied URL. NOT RUN (skipped) otherwise.
const active = process.env.APPOINTMENT_REQUESTS_NATIVE_TEST === "synthetic";
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const request = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1, submissionId: randomUUID(), channel: "web", firstName: "Synthétique", lastName: "Entrée TS",
  phone: "0555 00 08 88", locale: "fr", preferredDay: day(5), preferredPeriod: "afternoon", preferredTime: "14:00",
  consent: { contact: true, whatsapp: false, policyVersion: 1 }, ...over,
});

describe.skipIf(!active)("submitAppointmentRequest — real gate, real pool, mindcare_app", () => {
  it("canonicalises the phone, stores the request and answers RECEIVED", async () => {
    const input = request();
    await expect(submitAppointmentRequest(input)).resolves.toEqual({ ok: true, receipt: { submissionId: input.submissionId, delivery: "RECEIVED", duplicate: false } });
    await expect(submitAppointmentRequest(input)).resolves.toMatchObject({ ok: true, receipt: { duplicate: true } });
  });
  it("maps the gate's refusals to contract codes without leaking SQL text", async () => {
    const input = request();
    await submitAppointmentRequest(input);
    await expect(submitAppointmentRequest({ ...input, lastName: "Changé" })).resolves.toEqual({ ok: false, error: "CONFLICT" });
    await expect(submitAppointmentRequest(request({ preferredDay: day(90) }))).resolves.toEqual({ ok: false, error: "INVALID_INPUT" });
    await expect(submitAppointmentRequest(request({ reason: "texte libre" }))).resolves.toEqual({ ok: false, error: "INVALID_INPUT" });
  });
});
