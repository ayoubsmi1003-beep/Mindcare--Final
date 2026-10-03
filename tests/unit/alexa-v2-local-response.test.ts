import { expect, it } from "vitest";
import { localResponse } from "@/server/alexa/local-response";
import { planRequest } from "@/shared/alexa/request-plan";
import { dialogue } from "@/i18n/alexa-dialogue";
import type { ClinicalContext } from "@/shared/alexa/clinical";

function context(complete: boolean, hasMore: boolean): ClinicalContext {
  return { patientId: "11111111-1111-4111-8111-111111111111", sourceRevision: "a".repeat(64),
    consultations: [{ id: "22222222-2222-4222-8222-222222222222", startedAt: "2026-01-01T10:00:00Z", endedAt: "2026-01-01T11:00:00Z", notes: [] }],
    diagnoses: [], scales: [], treatments: { current: [], history: [], historyComplete: true },
    coverage: { requested: 1, returned: 1, complete, hasMore } };
}

it("does not label the requested last consultation incomplete merely because older consultations exist", () => {
  const answer = localResponse(context(true, true), planRequest("dernière consultation", null), []);
  expect(answer.map(item => item.text)).not.toContain(dialogue("fr").partial);
});

it("does not label a complete treatment read partial because consultation notes are missing", () => {
  const answer = localResponse(context(false, true), planRequest("traitement actuel", null), []);
  expect(answer.map(item => item.text)).not.toContain(dialogue("fr").partial);
});

it("still declares truncated treatment history and missing requested consultation content", () => {
  const truncated = context(true, false);
  truncated.treatments.historyComplete = false;
  expect(localResponse(truncated, planRequest("traitement actuel", null), []).map(item => item.text)).toContain(dialogue("fr").partial);
  expect(localResponse(context(false, false), planRequest("dernière consultation", null), []).map(item => item.text)).toContain(dialogue("fr").partial);
});
