import { describe, it, expect } from "vitest";
import { inferLocalSemantic } from "@/server/alexa/local-model";
import { semanticRequestSchema } from "@/shared/alexa/semantic-request";

// Explicit opt-in. Real pinned model and llama.cpp; no mock, transport replacement or answer fixture.
describe.skipIf(process.env["MINDCARE_LOCAL_MODEL_ACCEPTANCE"] !== "1")("Qwen local semantic qualification", () => {
  it.each([
    ["Combien de patients n’ont pas de numéro de téléphone ?", { domain: "patient", operation: "search", output: "count", field: "phone" }],
    ["Les patients sans email, lesquels ?", { domain: "patient", operation: "search", output: "list", field: "email" }],
    ["Comment signer une consultation ?", { domain: "application", operation: "explain" }],
    ["Donne le traitement de Karim Djilali", { domain: "patient", operation: "treatments", patient: { kind: "name", value: "Karim Djilali" } }],
    ["شحال كاين مريض بلا رقم الهاتف؟", { domain: "patient", operation: "search", output: "count", field: "phone" }],
    ["chkon les patients bla carte d’identité ?", { domain: "patient", operation: "search", output: "list", field: "identity_card" }],
    ["Quelle heure est-il à Alger ?", { domain: "general", operation: "time" }],
    ["Lis son traitement et explique les effets indésirables dans les références médicales", { domain: "hybrid", operation: "treatments" }],
  ])("%s", async (text, expected) => {
    const value = await inferLocalSemantic(text, null, AbortSignal.timeout(85000));
    const parsed = semanticRequestSchema.parse(value);
    expect(parsed).toMatchObject(expected);
    expect(parsed.missing).toEqual([]);
  }, 90000);
});
