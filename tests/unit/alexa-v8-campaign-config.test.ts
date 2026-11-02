import { afterEach, describe, expect, it, vi } from "vitest";

const loadConfig = async () => import("../../scripts/lib/alexa-v8-campaign-config.mjs").catch(() => null);

afterEach(() => vi.unstubAllEnvs());

describe("V8 campaign vector feature scope", () => {
  it("enables vector retrieval only while the live campaign callback runs", async () => {
    const api = await loadConfig();
    expect(api).not.toBeNull();
    if (!api) return;

    vi.stubEnv("KNOWLEDGE_VECTOR", "0");
    const result = await api.withV8KnowledgeVectorEnabled(async () => {
      expect(process.env.KNOWLEDGE_VECTOR).toBe("1");
      return "campaign-result";
    });

    expect(result).toBe("campaign-result");
    expect(process.env.KNOWLEDGE_VECTOR).toBe("0");
  });

  it("restores an unset vector flag when the campaign callback rejects", async () => {
    const api = await loadConfig();
    expect(api).not.toBeNull();
    if (!api) return;

    vi.stubEnv("KNOWLEDGE_VECTOR", "");
    await expect(api.withV8KnowledgeVectorEnabled(async () => {
      expect(process.env.KNOWLEDGE_VECTOR).toBe("1");
      throw new Error("synthetic campaign failure");
    })).rejects.toThrow("synthetic campaign failure");

    expect(process.env.KNOWLEDGE_VECTOR).toBe("");
  });
});
