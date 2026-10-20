import { describe, expect, it } from "vitest";
import { semanticRequestSchema, buildSourcePlan } from "@/shared/alexa/semantic-request";

describe("Alexa semantic authority boundary", () => {
  const request = { language: "fr", domain: "patient", operation: "search", output: "count", patient: null,
    field: "phone", query: null, count: 20, missing: [] };
  it("accepts a local missing-phone count and produces a bounded audited read", () => {
    const parsed = semanticRequestSchema.parse(request);
    expect(buildSourcePlan(parsed)).toMatchObject({ sources: ["PATIENT_DB"], cloud: false,
      steps: [{ tool: "search_patients", operation: "search", field: "phone" }] });
  });
  it("rejects SQL, invented tools, unknown properties and model patient IDs", () => {
    for (const value of [{ ...request, sql: "select * from app.patients" }, { ...request, operation: "delete_patient" },
      { ...request, patient: { kind: "id", value: "model-invented" } }, { ...request, count: 100000 }])
      expect(semanticRequestSchema.safeParse(value).success).toBe(false);
  });
  it("keeps hybrid patient knowledge local and preserves both source origins", () => {
    const parsed = semanticRequestSchema.parse({ ...request, operation: "treatments", domain: "hybrid", output: "explanation",
      patient: { kind: "name", value: "Ahmed" }, field: null });
    expect(buildSourcePlan(parsed)).toMatchObject({ sources: ["PATIENT_DB", "KNOWLEDGE_RAG"], cloud: false });
  });
  it("a missing slot never creates a read plan", () => {
    expect(buildSourcePlan(semanticRequestSchema.parse({ ...request, missing: ["patient"] })).steps).toEqual([]);
  });
});
