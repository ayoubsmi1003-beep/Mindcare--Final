import { z } from "zod";
import type { SafeClinicalPayload } from "./privacy-boundary";
import { classerCharge } from "@/server/egress/classification";
import { alexaClinical } from "@/i18n/alexa-clinical";

export const AlexaAnswerSchema = z.object({ sentences: z.array(z.object({ text: z.string().trim().min(1).max(700),
  evidence: z.array(z.string()).min(1).max(20), kind: z.enum(["fact", "inference", "knowledge"]) }).strict()).min(1).max(12) }).strict();
export type AlexaAnswer = z.infer<typeof AlexaAnswerSchema>;
export type ValidatedAlexaAnswer = { readonly ok: true; readonly answer: AlexaAnswer } | { readonly ok: false; readonly reason: "invalid-response" };
const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

function renderFact(fact: SafeClinicalPayload["facts"][number], language: SafeClinicalPayload["language"]): string {
  const phrases = alexaClinical[language];
  if (fact.kind === "consultation") return phrases.consultation(fact.rank, fact.notePresent, fact.diagnosisCodes);
  const dose = fact.dose === null ? phrases.missingDose : `${fact.dose} ${phrases.units[fact.doseUnit]}`;
  return phrases.medication(fact.medication, dose, phrases.status[fact.status], phrases.frequency[fact.frequency]);
}

/** Model prose is untrusted and never published. It may select known facts only. */
export function validateAlexaResponse(value: unknown, payload: SafeClinicalPayload, identityTokens: readonly string[] = []): ValidatedAlexaAnswer {
  const parsed = AlexaAnswerSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "invalid-response" };
  const facts = new Map(payload.facts.map((fact) => [fact.evidence, fact]));
  const selected = new Set<string>();
  for (const sentence of parsed.data.sentences) {
    if (sentence.evidence.some((ref) => !facts.has(ref)) || sentence.kind !== "fact") return { ok: false, reason: "invalid-response" };
    const text = fold(sentence.text);
    if (classerCharge([{ role: "user", content: sentence.text }], null).decision === "BLOQUER") return { ok: false, reason: "invalid-response" };
    if (/[0-9a-f]{8}-[0-9a-f-]{27,}|\be-[a-z0-9_-]{16}\b|\bs-[a-z0-9_-]{43}\b|\b0[5-7]\d{8}\b|\b\S+@\S+\.\S+|https?:\/\//i.test(sentence.text)
      || identityTokens.some((token) => token.trim().length > 1 && text.includes(fold(token)))) return { ok: false, reason: "invalid-response" };
    // A generated number must occur in a cited typed fact. This covers dose hallucinations.
    const numbers = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
    const permitted = sentence.evidence.flatMap((ref) => {
      const fact = facts.get(ref)!;
      return fact.kind === "medication" ? fact.dose === null ? [] : [String(fact.dose)]
        : [String(fact.rank), ...fact.diagnosisCodes.flatMap((code) => code.match(/\d+(?:[.,]\d+)?/g) ?? [])];
    });
    if (numbers.some((number) => !permitted.includes(number.replace(",", ".")))) return { ok: false, reason: "invalid-response" };
    if (/\b(?:rue|adresse|telephone|habite|ne le|nee le)\b/.test(text)) return { ok: false, reason: "invalid-response" };
    for (const ref of sentence.evidence) selected.add(ref);
  }
  if (selected.size > 12) return { ok: false, reason: "invalid-response" };
  return { ok: true, answer: { sentences: [...selected].map((ref) => ({ text: renderFact(facts.get(ref)!, payload.language), evidence: [ref], kind: "fact" })) } };
}
