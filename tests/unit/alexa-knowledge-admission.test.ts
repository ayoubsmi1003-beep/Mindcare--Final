import { describe, expect, it } from "vitest";
import { parsePatientMention } from "@/server/alexa/patient-mention";
import { requestedMedicationNames } from "@/server/alexa/knowledge-evidence-content";
import { planKnowledgeQuery } from "@/server/alexa/knowledge-query";

/**
 * A generic medication question is a book lookup, never a patient identity.
 * Measured regression: « un patient sous lithium » was parsed as
 * `named: "lithium"`, then resolved as a patient and failed.
 */
const questions = [
  "Quelles précautions pour la sertraline ?",
  "Comment surveiller un patient sous lithium ?",
] as const;

describe("deterministic knowledge admission", () => {
  it.each(questions)("treats %s as a knowledge topic, not a patient", question => {
    expect(parsePatientMention(question).status).toBe("none");
    expect(requestedMedicationNames(question).length).toBeGreaterThan(0);
    expect(planKnowledgeQuery(question)).not.toBeNull();
  });

  it("still recognises a real named patient", () => {
    expect(parsePatientMention("Résume le dossier de Nadia Test")).toMatchObject({ status: "named" });
  });
});
