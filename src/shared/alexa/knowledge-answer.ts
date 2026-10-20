import { z } from "zod";

/** One contract for provider constraints and local validation. */
export const knowledgeAnswerSchema = z.object({
  coverage: z.enum(["supported", "partial", "insufficient"]),
  sentences: z.array(z.object({
    text: z.string().min(1).max(1600),
    evidence: z.array(z.object({
      index: z.number().int().min(1).max(5),
      quote: z.string().min(20).max(1200),
    }).strict()).min(1).max(5),
  }).strict()).max(5),
}).strict();

export const knowledgeAnswerJsonSchema = z.toJSONSchema(knowledgeAnswerSchema, { target: "draft-7" });
export type LlmOutputContract = "alexa-knowledge-v1";
