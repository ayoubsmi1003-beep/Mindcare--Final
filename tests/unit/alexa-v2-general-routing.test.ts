import { describe, expect, it } from "vitest";
import { planRequest } from "@/shared/alexa/request-plan";

describe("Alexa general model versus approved clinical books", () => {
  it.each(["Pourquoi le ciel est bleu ?", "Combien font sept fois huit ?", "كيف يعمل الحاسوب؟", "Explain how a rainbow forms."])("routes a public nonclinical question to the general model: %s", text => {
    expect(planRequest(text, null).intent).toBe("general");
  });
  it.each(["Explique les critères de la dépression selon le DSM-5", "Quelle est la différence entre dépression et anxiété ?", "Les effets de la sertraline", "Parle-moi du trouble bipolaire"])("keeps clinical general questions on the governed books path: %s", text => {
    expect(planRequest(text, null).intent).toBe("knowledge");
  });
  it.each(["Quel est son diagnostic ?", "traitement du Belkacem Mohamed", "notes du dossier", "les cinq dernières consultations"])("retains existing local patient reads: %s", text => {
    expect(["diagnoses", "treatments", "notes", "history"]).toContain(planRequest(text, null).intent);
  });
  it("keeps an unsupported named request local instead of sending its name to a general model", () => {
    expect(planRequest("Bonjour à «Mohamed Belkacem»", null).intent).toBe("clarify");
  });
});
