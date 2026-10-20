import { createHash, randomUUID } from "node:crypto";
import { classifierIntent, construirePromptClassifieur, INTENT_PROMPT_VERSION } from "@/server/jarvis/classifieur-intentions";
import { classerCharge, messagePorteUnSignalPatient } from "@/server/egress/classification";
import { llm } from "@/server/egress/external-call";
import { confianceSuffisante } from "@/shared/jarvis/intentions";
import { semanticRoutingInstruction } from "@/i18n/alexa-understanding";
import { parsePatientMention } from "./patient-mention";
import { requestsPatientScope, type RequestPlan } from "./request-plan";

export interface PublicQuestionAdmission { readonly text: string }
const issued = new WeakSet<object>();
export function isIssuedPublicQuestion(value: PublicQuestionAdmission | undefined, text: string): boolean {
  return !!value && issued.has(value) && Object.isFrozen(value) && value.text === text;
}
export interface SemanticPlan { readonly plan: RequestPlan; readonly publicAdmission?: PublicQuestionAdmission;
  /** Delivery: unclassified non-patient question answered by the LLM with open admission (all content guards still run). */
  readonly openGeneral?: true }

/** Existing ontology/classifier, current C4 question only. No dossier, names, UI or history. */
export async function understandPublicTurn(text: string, baseline: RequestPlan, signal: AbortSignal): Promise<SemanticPlan | null> {
  if (baseline.clarification || !["clarify", "knowledge"].includes(baseline.intent)
    || /\b(?:dsm|taylor|maudsley|stahl)\b/iu.test(text)
    || text.length > 1000 || parsePatientMention(text).status !== "none" || requestsPatientScope(text)
    || messagePorteUnSignalPatient(text) || classerCharge(text, null).decision !== "AUTORISER") return null;
  const prompt = `${construirePromptClassifieur()}\n${semanticRoutingInstruction}`;
  const runId = randomUUID();
  const result = await classifierIntent(text, { conversationId: runId, turnId: runId, runId }, {
    async completer(messages, options) {
      const projected = [{ role: "system" as const, content: prompt }, ...messages.filter(message => message.role === "user")];
      if (classerCharge(projected, null).decision !== "AUTORISER") return { texte: null, modele: "unavailable" };
      const answer = await llm({ purpose: "jarvis", messages: projected, promptVersion: `${INTENT_PROMPT_VERSION}-alexa-v2`,
        promptHash: createHash("sha256").update(prompt).digest("hex"), sessionToken: runId,
        timeoutMs: options.timeoutMs, maxOutputTokens: 450, preferSmallFreeModel: true,
        besoin: { json: true, streaming: false, outils: false, tache: "intentions" }, signal });
      return answer.ok ? { texte: answer.data, modele: answer.inference?.model ?? "unknown" } : { texte: null, modele: "unavailable" };
    },
  }, { timeoutMs: 15000 });
  signal.throwIfAborted();
  if (result.statut !== "valide" || !confianceSuffisante(result.intent) || result.intent.entities.patientMention
    || result.intent.references.homonymePossible || result.intent.references.pronomSansAntecedent) return null;
  const { name, entities } = result.intent;
  if (name === "GENERAL_KNOWLEDGE" && entities.knowledgeSource) {
    if (entities.knowledgeSource === "approved_books") return { plan: { intent: "knowledge", count: 1, language: baseline.language } };
    const admission = Object.freeze({ text }); issued.add(admission);
    return { plan: { intent: "general", count: 1, language: baseline.language }, publicAdmission: admission };
  }
  if (name === "SEARCH_PATIENT" && entities.patientFilter) return {
    plan: { intent: "patient_search", count: 100, language: baseline.language, patientFilter: entities.patientFilter },
  };
  return null;
}
