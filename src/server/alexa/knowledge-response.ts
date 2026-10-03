import type { AlexaEvent } from "@/shared/alexa/turn";
import type { AlexaLanguage } from "@/shared/alexa/request-plan";
import { dialogue } from "@/i18n/alexa-dialogue";
import type { readKnowledge } from "./knowledge-adapter";
import { localDisplay } from "./local-response";

export type KnowledgeResult = Awaited<ReturnType<typeof readKnowledge>>;
type SentenceEvent = Extract<AlexaEvent, { type: "sentence" }>;

/** Book excerpts remain attributed evidence, never an individualized clinical conclusion. */
export function knowledgeResponseEvents(result: KnowledgeResult, language: AlexaLanguage,
  mixed = false, identities: readonly string[] = []): SentenceEvent[] {
  const copy = dialogue(language);
  const message = (text: string): SentenceEvent => ({ type: "sentence", text, kind: "knowledge", sources: [] });
  const omissions = "omittedLongPassages" in result && result.omittedLongPassages ? [message(copy.longKnowledge)] : [];
  if (result.etat !== "ok") return [message(result.etat === "faible" ? copy.weakKnowledge
    : result.etat === "panne" ? copy.knowledgeUnavailable : copy.noKnowledge), ...omissions];
  return [
    ...(mixed ? [message(copy.separateKnowledge)] : []),
    ...result.preuves.map((proof): SentenceEvent => ({ type: "sentence",
      text: localDisplay(proof.extrait, identities), kind: "knowledge",
      sources: [{ id: proof.chunkId, type: "knowledge",
        label: localDisplay([proof.titre, proof.section, proof.version].filter(Boolean).join(" · "), identities),
        version: proof.version, provenance: { sourceId: proof.sourceId, chunkId: proof.chunkId,
          versionChunk: proof.versionChunk, unitId: proof.unitId, parentTexteHash: proof.parentTexteHash,
          enfantIndex: proof.enfantIndex, enfantsTotal: proof.enfantsTotal } }],
    })),
    ...omissions,
  ];
}
