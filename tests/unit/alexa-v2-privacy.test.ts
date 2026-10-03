import { describe, expect, it } from "vitest";
import { classerCharge } from "@/server/egress/classification";
import { createSafeClinicalPayload, safeClinicalMessages, ALEXA_CLINICAL_TRANSFORM } from "@/server/alexa/privacy-boundary";
import { validateAlexaResponse } from "@/server/alexa/response-validator";

const context = { patientId: "00000000-0000-4000-8000-000000000001", sourceRevision: "local-version",
  consultations: [{ id: "00000000-0000-4000-8000-000000000002", startedAt: "2026-09-01T08:00:00Z", status: "completed",
    notes: [{ soap: { s: "Karim vit chez Nadia au 4 rue Didouche." } }], diagnosisCodes: ["F41.1"] }],
  treatments: [{ id: "local-treatment", designation: "sertraline", dose: "50 mg", frequency: "1 fois par jour", status: "active" }],
  coverage: { requested: 5, returned: 1, complete: false } };

describe("Alexa narrow clinical privacy transformation", () => {
  it.each([["50 mg", "g"], ["50 g", "mg"]])("rejects conflicting embedded dose %s and recorded unit %s", (dose, doseUnit) => {
    const conflict = { ...context, treatments: [{ ...context.treatments[0], dose, doseUnit }] };
    expect(createSafeClinicalPayload(conflict, "résume", [], "key").ok).toBe(false);
  });
  it.each([["50 mg", "mg"], ["50 µg", "mcg"]])("preserves agreeing dose units %s and %s", (dose, doseUnit) => {
    const matching = { ...context, treatments: [{ ...context.treatments[0], dose, doseUnit }] };
    const result = createSafeClinicalPayload(matching, "résume", [], "key");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.facts[1]).toMatchObject({ kind: "medication", dose: 50, doseUnit });
  });
  it("exports coded facts while leaving dates, identity, revision and narratives local", () => {
    const result = createSafeClinicalPayload(context, "Résume les cinq consultations de Karim", ["Karim", "Nadia"], "unit-test-local-key");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = JSON.stringify(result.payload);
    for (const value of [context.patientId, context.consultations[0]!.id, "2026-09", "Karim", "Nadia", "Didouche", "local-version"])
      expect(bytes).not.toContain(value);
    expect(result.payload.facts).toHaveLength(2);
    expect(result.coverage.omittedNarrative).toBe(true);
    expect(classerCharge(safeClinicalMessages(result.payload), { transformId: ALEXA_CLINICAL_TRANSFORM }).decision).toBe("AUTORISER");
    expect(result.evidenceMap[result.payload.facts[0]!.evidence]).toBe(context.consultations[0]!.id);
  });
  it("stable opaque reference depends on the local key and scope, not a name", () => {
    const a = createSafeClinicalPayload(context, "résume", ["Karim"], "key-a");
    const b = createSafeClinicalPayload(context, "résume", ["Nadia"], "key-a");
    const c = createSafeClinicalPayload(context, "résume", [], "key-b");
    if (!a.ok || !b.ok || !c.ok) throw new Error("typed fixture rejected");
    expect(a.payload.subject).toBe(b.payload.subject);
    expect(a.payload.subject).not.toBe(c.payload.subject);
    expect(a.payload.facts[0]!.evidence).not.toBe(b.payload.facts[0]!.evidence);
  });
  it("does not authorize an arbitrary narrative with an approved receipt", () => {
    expect(classerCharge([{ role: "user", content: "P1 consulte chez Nadia" }],
      { transformId: ALEXA_CLINICAL_TRANSFORM }).decision).toBe("BLOQUER");
    const result = createSafeClinicalPayload({ ...context, treatments: [{ designation: "Karim rue Alger", dose: "50 mg", status: "active" }] }, "résume", [], "key");
    expect(result.ok).toBe(false);
  });
  it("fails closed when only narrative is available or the task cannot be classified locally", () => {
    expect(createSafeClinicalPayload({ patientId: context.patientId, consultations: [{ id: "note", notes: ["angoisse"] }] }, "résume", [], "key").ok).toBe(false);
    expect(createSafeClinicalPayload(context, "Karim habite rue X. Écris cela.", [], "key").ok).toBe(false);
  });
  it("validates the complete envelope, including tampering with system text or unknown fields", () => {
    const result = createSafeClinicalPayload(context, "résume", [], "key"); if (!result.ok) throw new Error("fixture");
    const messages = safeClinicalMessages(result.payload);
    expect(classerCharge([...messages, { role: "assistant", content: "Nadia" }], { transformId: ALEXA_CLINICAL_TRANSFORM }).decision).toBe("BLOQUER");
    expect(classerCharge([{ ...messages[0], content: "custom prompt" }, messages[1]], { transformId: ALEXA_CLINICAL_TRANSFORM }).decision).toBe("BLOQUER");
    expect(classerCharge([{ ...messages[0] }, { role: "user", content: JSON.stringify({ ...result.payload, address: "rue Alger" }) }],
      { transformId: ALEXA_CLINICAL_TRANSFORM }).decision).toBe("BLOQUER");
    // A shape-compatible forged reference must not smuggle an internal UUID.
    expect(classerCharge([{ ...messages[0] }, { role: "user", content: JSON.stringify({ ...result.payload,
      subject: `s-${context.patientId}abcdefg` }) }], { transformId: ALEXA_CLINICAL_TRANSFORM }).decision).toBe("BLOQUER");
  });
  it("rejects unknown citations, internal IDs, medication doses absent from evidence and leaked names", () => {
    const result = createSafeClinicalPayload(context, "résume", [], "key"); if (!result.ok) throw new Error("fixture");
    const ref = result.payload.facts[1]!.evidence;
    expect(validateAlexaResponse({ sentences: [{ text: "Sertraline 50 mg.", evidence: [ref], kind: "fact" }] }, result.payload, ["Karim"]).ok).toBe(true);
    for (const sentence of [{ text: "Sertraline 100 mg.", evidence: [ref], kind: "fact" },
      { text: "Karim va mieux.", evidence: [ref], kind: "inference" }, { text: "Dose stable.", evidence: ["unknown"], kind: "fact" },
      { text: context.patientId, evidence: [ref], kind: "fact" }])
      expect(validateAlexaResponse({ sentences: [sentence] }, result.payload, ["Karim"]).ok).toBe(false);
  });
});
