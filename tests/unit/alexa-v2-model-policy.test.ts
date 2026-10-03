import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALEXA_PRIMARY_MODEL, ALEXA_PROVIDER_POLICY, isAlexaPrimaryModelId, isFreeAlexaModelId, normaliseAlexaModel } from "@/server/alexa/model-policy";

const freeCandidate = { id: "qwen/qwen3.8-27b:free", context_length: 32000,
  supported_parameters: ["response_format", "tools"], pricing: { prompt: "0", completion: "0", request: "0" } };

describe("Alexa single-model policy (décision humaine 2026-10-03 : qwen/qwen3.7-flash payant, primary-only)", () => {
  it("épingle le primary payant unique", () => {
    expect(ALEXA_PRIMARY_MODEL).toBe("qwen/qwen3.7-flash");
    expect(isAlexaPrimaryModelId("qwen/qwen3.7-flash")).toBe(true);
    expect(isAlexaPrimaryModelId("qwen/qwen3.8-27b:free")).toBe(false);
    expect(isAlexaPrimaryModelId("openrouter/auto")).toBe(false);
  });
  it("borne le prix au tarif du primary avec marge, sans collecte, avec ZDR", () => {
    expect(ALEXA_PROVIDER_POLICY).toEqual({ data_collection: "deny", zdr: true, require_parameters: true,
      max_price: { prompt: 0.05, completion: 0.2 } });
  });
  it("garde le détecteur :free pour la maintenance du pool (hors tour ordinaire)", () => {
    expect(isFreeAlexaModelId(freeCandidate.id)).toBe(true);
    expect(normaliseAlexaModel(freeCandidate)?.modelId).toBe(freeCandidate.id);
    for (const id of ["qwen/qwen3.7-flash", "qwen/qwen3.8-27b", "openrouter/auto", "openrouter/free", "qwen/foo:free:paid", "google/../gemma:free"])
      expect(isFreeAlexaModelId(id)).toBe(false);
  });
  it("aucun chemin texte Gemini : la passerelle et les seams texte l'ignorent", () => {
    // Décision humaine 2026-10-03 : Qwen payant seul. La voix Live temps réel
    // (`GEMINI_LIVE_MODEL`, `EvenementGemini`) n'est pas concernée par ce garde ;
    // `realPatientGemini: false` reste un drapeau explicite, pas un chemin de code.
    const gateway = readFileSync(join(process.cwd(), "src/server/alexa/model-gateway.ts"), "utf8");
    for (const seam of ["llmGemini", "preparerGemini", "gemini-free", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GeminiFree", "geminiFree", "generativelanguage"])
      expect(gateway).not.toContain(seam);
    const egress = readFileSync(join(process.cwd(), "src/server/egress/external-call.ts"), "utf8");
    for (const seam of ["llmGeminiGratuit", "geminiFreeProvider", "gemini-free-policy", "preparerGeminiGratuit", "GEMINI_FREE_TEXT_MODELS"])
      expect(egress).not.toContain(seam);
  });
});
