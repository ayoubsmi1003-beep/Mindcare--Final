import { describe, expect, it } from "vitest";
import { planRequest } from "@/shared/alexa/request-plan";

describe("reviewed public and clinical routing boundary", () => {
  it.each(["Qu’est-ce que la pneumonie ?", "ما هو باركينسون؟", "Quels sont les symptômes du diabète ?", "Quelle est la définition du diabète ?", "Quels sont les symptômes du Parkinson ?"])("keeps a clinical topic on approved books even after patient work: %s", text => {
    expect(planRequest(text, {intent:"notes",count:5}).intent).toBe("knowledge");
  });
  it.each(["Pourquoi karim belkacem habite à Alger ?", "لماذا كريم بلقاسم يعيش في الجزائر؟", "Pourquoi est-ce que Mohamed est divorcé ?"])("clarifies unverified personal/public text locally: %s", text => {
    expect(planRequest(text, null).intent).toBe("clarify");
  });
});
