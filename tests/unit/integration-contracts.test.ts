import { describe, expect, it } from "vitest";
import {
  appointmentRequestV1, integrationEventV1, notificationEventV1, phoneCanonical,
  socialContentVersionV1, workflowResultV1,
} from "@/shared/integrations/contracts";

const ID = "b5000000-0000-4000-8000-000000000001";
const request = {
  schemaVersion: 1, submissionId: ID, channel: "whatsapp", firstName: "Synthétique", lastName: "Demande",
  phone: "0554 00 00 01", locale: "darija", preferredDay: "2026-12-03", preferredPeriod: "morning",
  consent: { contact: true, whatsapp: true, policyVersion: 1 },
} as const;

describe("phoneCanonical (mirror of the website relay)", () => {
  it.each([["0554 00 00 01", "+213554000001"], ["+33 6 12 34 56 78", "+33612345678"], ["(0554) 00-00-01", "+213554000001"]])("%s → %s", (input, out) => {
    expect(phoneCanonical(input)).toBe(out);
  });
  it.each(["12345", "abc", "00213554000001", "+0554000001", "0554 00 00 01 ext 2", "+2130554000001"])("rejects %s", input => {
    expect(() => phoneCanonical(input)).toThrow("INVALID_INPUT");
  });
});

describe("appointmentRequestV1", () => {
  it("accepts a WhatsApp request and canonicalises the phone", () => {
    const parsed = appointmentRequestV1.parse(request);
    expect(parsed.phone).toBe("+213554000001");
    expect(appointmentRequestV1.parse({ ...request, channel: "web", locale: "fr", preferredPeriod: "afternoon", preferredTime: "14:30" }).channel).toBe("web");
  });
  it.each([
    ["missing name", { ...request, firstName: undefined }],
    ["blank name", { ...request, lastName: "   " }],
    ["invisible character in a name", { ...request, firstName: "Ali​" }],
    ["bidi override in a name", { ...request, lastName: "‮Demande" }],
    ["spreadsheet formula as a name", { ...request, lastName: "=HYPERLINK(1)" }],
    ["invalid phone", { ...request, phone: "12" }],
    ["impossible date", { ...request, preferredDay: "2026-02-30" }],
    ["time outside opening window", { ...request, preferredTime: "18:00" }],
    ["time contradicts period", { ...request, preferredTime: "14:00" }],
    ["consent not given", { ...request, consent: { ...request.consent, contact: false } }],
    ["unknown channel", { ...request, channel: "sms" }],
    ["English locale is not storable (intake_lang)", { ...request, locale: "en" }],
  ])("rejects %s", (_label, input) => {
    expect(appointmentRequestV1.safeParse(input).success).toBe(false);
  });
  it("refuses any extra field, so no clinical free text can ride along", () => {
    expect(appointmentRequestV1.safeParse({ ...request, reason: "insomnie depuis 3 mois" }).success).toBe(false);
    expect(appointmentRequestV1.safeParse({ ...request, consent: { ...request.consent, note: "x" } }).success).toBe(false);
  });
});

describe("events and notifications carry references only", () => {
  const event = { eventId: ID, type: "AppointmentRequestCreated", schemaVersion: 1, occurredAt: "2026-11-26T10:00:00+01:00", producer: "mindcare-core", correlationId: ID, cabinetRef: ID, payload: { appointmentId: ID, channel: "WHATSAPP" } };
  it("accepts a refs-only event", () => {
    expect(integrationEventV1.parse(event).type).toBe("AppointmentRequestCreated");
  });
  it.each([
    ["a phone number as text", { phone: "+213554000001" }],
    ["a phone number as integer", { phone: 554000001 }],
    ["free text", { note: "le patient a dit que" }],
    ["a nested object", { patient: { name: "x" } }],
  ])("rejects %s in the payload", (_label, payload) => {
    expect(integrationEventV1.safeParse({ ...event, payload }).success).toBe(false);
    expect(notificationEventV1.safeParse({ notificationId: ID, kind: "appointment_request", recipientRole: "owner", createdAt: event.occurredAt, payload }).success).toBe(false);
  });
  it("a failed workflow must name its error, a successful one must not", () => {
    const base = { executionId: ID, workflow: "social-draft", correlationId: ID, attempt: 1, finishedAt: event.occurredAt };
    expect(workflowResultV1.safeParse({ ...base, outcome: "failed" }).success).toBe(false);
    expect(workflowResultV1.safeParse({ ...base, outcome: "failed", errorCode: "UNAVAILABLE" }).success).toBe(true);
    expect(workflowResultV1.safeParse({ ...base, outcome: "succeeded", errorCode: "UNAVAILABLE" }).success).toBe(false);
  });
});

describe("socialContentVersionV1", () => {
  const slide = (position: number) => ({ position, assetSha256: "a".repeat(64), mimeType: "image/png", altText: "Visuel" });
  const version = { contentId: ID, version: 1, platform: "instagram", format: "carousel", caption: "Légende", hashtags: ["#santé_mentale"], slides: [slide(1), slide(2)], contentHash: "b".repeat(64) };
  it("accepts an ordered carousel", () => { expect(socialContentVersionV1.parse(version).slides).toHaveLength(2); });
  it("rejects slides out of order", () => { expect(socialContentVersionV1.safeParse({ ...version, slides: [slide(2), slide(1)] }).success).toBe(false); });
  it("rejects a one-slide carousel and a multi-slide image", () => {
    expect(socialContentVersionV1.safeParse({ ...version, slides: [slide(1)] }).success).toBe(false);
    expect(socialContentVersionV1.safeParse({ ...version, format: "image" }).success).toBe(false);
  });
});
