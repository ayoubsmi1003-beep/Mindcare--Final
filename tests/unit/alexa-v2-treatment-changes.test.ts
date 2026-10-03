import { expect, it } from "vitest";
import { planRequest } from "@/shared/alexa/request-plan";
import { localResponse } from "@/server/alexa/local-response";
import type { ClinicalContext } from "@/shared/alexa/clinical";

it.each(["la dernière modification du traitement", "quel est le dernier changement du médicament ?", "آخر تغيير في العلاج"])("routes recorded treatment changes as a read: %s", text => {
  expect(planRequest(text, null).intent).toBe("treatment_changes");
});
it("keeps a command to change treatment in the confirmation pipeline", () => {
  expect(planRequest("modifie le traitement", null).intent).toBe("proposal");
});
it("renders the latest actual treatment snapshot without replacing it with current state", () => {
  const context: ClinicalContext = { patientId: "p", consultations: [], diagnoses: [], scales: [], sourceRevision: "r", coverage: { requested: 1, returned: 0, complete: true, hasMore: false }, treatments: {
    current: [{ id: "t", medication: "Sertraline", dose: "100", doseUnit: "mg", status: "active", frequency: "daily", timing: [], instructions: null, startDate: "2026-01-01", endDate: null, version: 3 }],
    historyComplete: true, history: [{ id: "h", treatmentId: "t", version: 2, action: "update", occurredAt: "2026-01-02T10:00:00Z", previous: { dose: "25", doseUnit: "mg", status: "active", frequency: null, timing: [], instructions: null, startDate: null, endDate: null }, next: { dose: "50", doseUnit: "mg", status: "paused", frequency: null, timing: [], instructions: null, startDate: null, endDate: null }, reason: null, notes: null }],
  } };
  const answer = localResponse(context, planRequest("dernier changement du traitement", null), []);
  expect(answer[0]?.text).toContain("25"); expect(answer[0]?.text).toContain("50");
  expect(answer[0]?.text).not.toContain("100"); expect(answer[0]?.text).toContain("en pause");
  expect(answer[0]?.sources).toMatchObject([{ id: "h", type: "treatment", version: "2" }]);
});
