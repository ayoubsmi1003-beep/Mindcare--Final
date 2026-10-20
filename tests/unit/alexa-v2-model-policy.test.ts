import { describe, expect, it } from "vitest";
import { ALEXA_PRIMARY_MODEL, ALEXA_PROVIDER_POLICY, isAlexaPrimaryModelId, isFreeAlexaModelId, normaliseAlexaModel } from "@/server/alexa/model-policy";

const freeCandidate = { id: "qwen/qwen3.8-27b:free", context_length: 32000,
  supported_parameters: ["response_format", "tools"], pricing: { prompt: "0", completion: "0", request: "0" } };

describe("Alexa free-only policy (instruction humaine 2026-10-04)", () => {
  it("épingle une préférence gratuite sans admettre un modèle payant", () => {
    expect(ALEXA_PRIMARY_MODEL).toBe("qwen/qwen3.8-27b:free");
    expect(isAlexaPrimaryModelId("qwen/qwen3.7-flash")).toBe(false);
    expect(isAlexaPrimaryModelId("qwen/qwen3.8-27b:free")).toBe(true);
    expect(isAlexaPrimaryModelId("openrouter/auto")).toBe(false);
  });
  it("interdit toute facturation et conserve les protections de données", () => {
    expect(ALEXA_PROVIDER_POLICY).toEqual({ data_collection: "deny", zdr: true, require_parameters: true,
      max_price: { prompt: 0, completion: 0 }, sort: "latency" });
  });
  it("admet uniquement les :free explicites à prix catalogue nul", () => {
    expect(isFreeAlexaModelId(freeCandidate.id)).toBe(true);
    expect(normaliseAlexaModel(freeCandidate)?.modelId).toBe(freeCandidate.id);
    for (const id of ["qwen/qwen3.7-flash", "qwen/qwen3.8-27b", "openrouter/auto", "openrouter/free", "qwen/foo:free:paid", "google/../gemma:free"])
      expect(isFreeAlexaModelId(id)).toBe(false);
  });
  it("refuse un supplément de prix même sous un suffixe :free", () => {
    expect(normaliseAlexaModel({ ...freeCandidate, pricing: { prompt: "0", completion: "0", request: "0.001" } })).toBeNull();
    expect(normaliseAlexaModel({ ...freeCandidate, pricing: { prompt: "0.001", completion: "0" } })).toBeNull();
  });
});
