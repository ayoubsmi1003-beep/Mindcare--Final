import { describe, expect, it } from "vitest";

const loadTranscript = async () => import("../../scripts/lib/alexa-v8-answer-transcript.mjs").catch(() => null);

describe("Alexa V8 answer transcript projection", () => {
  it("writes only the resolved question and visible answer sentences", async () => {
    const api = await loadTranscript();
    expect(api).not.toBeNull();
    if (!api) return;

    const row = api.createV8AnswerTranscriptRow({
      caseId: "ADV-001",
      turnIndex: 0,
      prompt: "Question synthétique",
      observation: {
        events: [
          { type: "stage", stage: "knowledge" },
          { type: "sentence", text: "Réponse synthétique.", sources: [{ id: "private-source-id", label: "Source locale" }] },
          { type: "done", patientId: "private-patient-id" },
        ],
        queries: [{ name: "private-query", args: { secret: "private" } }],
      },
    });

    expect(row).toEqual({
      caseId: "ADV-001",
      turnNumber: 1,
      question: "Question synthétique",
      answer: "Réponse synthétique.",
    });
    expect(JSON.stringify(row)).not.toContain("private");
  });

  it("retains an empty answer when the turn emitted no visible sentence", async () => {
    const api = await loadTranscript();
    expect(api).not.toBeNull();
    if (!api) return;

    expect(api.createV8AnswerTranscriptRow({
      caseId: "ADV-002",
      turnIndex: 1,
      prompt: "Question sans réponse visible",
      observation: { events: [{ type: "done" }] },
    })).toEqual({
      caseId: "ADV-002",
      turnNumber: 2,
      question: "Question sans réponse visible",
      answer: "",
    });
  });
});
