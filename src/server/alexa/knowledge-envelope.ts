import { KNOWLEDGE_SYNTHESIS_PROMPT } from "@/i18n/alexa-knowledge";
import { isIssuedKnowledgeResult, type readKnowledge } from "./knowledge-adapter";

export const ALEXA_KNOWLEDGE_TRANSFORM = "alexa-approved-knowledge-v1";
export type KnowledgeTask = "criteria" | "explain" | "compare" | "treatment";
export type KnowledgeFocus = "retrieved-sections" | "hamilton" | "major-depressive-disorder" | "depressive-disorders";
const issuedEnvelopes = new WeakSet<object>();

/** Project only immutable, approved C4 book evidence. No question, identity, UUID, app state or history. */
export function knowledgeMessages(result: Awaited<ReturnType<typeof readKnowledge>>, task: KnowledgeTask, language: "fr" | "ar", focus: KnowledgeFocus) {
  if (!isIssuedKnowledgeResult(result) || result.etat !== "ok" || result.preuves.length === 0
    || !["criteria", "explain", "compare", "treatment"].includes(task) || !["fr", "ar"].includes(language)
    || !["retrieved-sections", "hamilton", "major-depressive-disorder", "depressive-disorders"].includes(focus)) return null;
  const data = { task, language, focus, passages: result.preuves.map((proof, index) => ({ index: index + 1,
    title: proof.titre, section: proof.section, version: proof.version, text: proof.extrait })) };
  const content = JSON.stringify(data);
  if (content.length > 16000 || result.preuves.reduce((total, proof) => total + proof.extrait.length, 0) > 8000) return null;
  const messages = Object.freeze([
    Object.freeze({ role: "system" as const, content: KNOWLEDGE_SYNTHESIS_PROMPT }),
    Object.freeze({ role: "user" as const, content }),
  ]);
  issuedEnvelopes.add(messages);
  return messages;
}

/** The receipt alone cannot authorize forged, mutable or replayed clinical messages. */
export function isIssuedKnowledgeEnvelope(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && Object.isFrozen(value) && issuedEnvelopes.has(value)
    && value.every(message => Object.isFrozen(message));
}
