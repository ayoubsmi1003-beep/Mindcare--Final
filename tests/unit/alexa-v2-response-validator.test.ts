import { describe, expect, it } from "vitest";
import { createSafeClinicalPayload } from "@/server/alexa/privacy-boundary";
import { validateAlexaResponse } from "@/server/alexa/response-validator";

function fixture(text = "résume le traitement") {
  const result = createSafeClinicalPayload({ patientId: "local-only-scope", consultations: [{ id: "local-note", startedAt: "2026-01-01T09:00:00Z", notes: [{}] }],
    treatments: { current: [{ id: "local-medication", medication: "sertraline", dose: 50, doseUnit: "mg", status: "active", frequency: "daily" }] },
    coverage: { requested: 1, complete: true } }, text, [], "test-key");
  if (!result.ok) throw new Error("fixture refused");
  return result.payload;
}

describe("clinical response publication uses source-bound server text", () => {
  it.each(["Lithium 50 mg.", "Sertraline 50 g.", "Sertraline 50 mg arrêtée."])("never publishes the unsupported claim: %s", (text) => {
    const payload = fixture();
    const result = validateAlexaResponse({ sentences: [{ text, evidence: [payload.facts[1]!.evidence], kind: "fact" }] }, payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answer.sentences[0]!.text).toBe("Traitement enregistré : sertraline, 50 mg, actif, une fois par jour.");
    expect(result.answer.sentences[0]!.text).not.toBe(text);
  });
  it("does not infer symptoms or safety from note presence", () => {
    const payload = fixture("résume la consultation");
    const result = validateAlexaResponse({ sentences: [{ text: "Aucun risque suicidaire et amélioration clinique.", evidence: [payload.facts[0]!.evidence], kind: "fact" }] }, payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answer.sentences[0]!.text).toBe("Consultation 1 : note disponible. Aucun contenu clinique libre n’a été analysé.");
    expect(result.answer.sentences[0]!.text).not.toContain("suicidaire");
  });
  it("refuses unsupported clinical interpretation even when labelled inference", () => {
    const payload = fixture();
    expect(validateAlexaResponse({ sentences: [{ text: "Amélioration probable.", evidence: [payload.facts[0]!.evidence], kind: "inference" }] }, payload).ok).toBe(false);
  });
  it("renders Arabic from typed facts without model-owned clinical prose", () => {
    const payload = fixture("لخص العلاج");
    const result = validateAlexaResponse({ sentences: [{ text: "دواء آمن.", evidence: [payload.facts[1]!.evidence], kind: "fact" }] }, payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answer.sentences[0]!.text).toBe("العلاج المسجل: sertraline، 50 mg، نشط، مرة يوميا.");
  });
});
