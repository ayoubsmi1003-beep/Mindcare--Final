import { z } from "zod";

/** Interpretation is a suggestion. It grants no SQL, identity or mutation authority. */
export const semanticRequestSchema = z.object({
  language: z.enum(["fr", "ar", "mixed"]),
  domain: z.enum(["patient", "knowledge", "application", "general", "memory", "action", "hybrid", "ambiguous"]),
  operation: z.enum(["search", "profile", "summary", "history", "treatments", "documents", "finance", "appointments", "explain", "compare", "translate", "time", "navigate", "propose", "recall"]),
  output: z.enum(["count", "list", "fact", "explanation"]),
  patient: z.object({ kind: z.enum(["name", "current", "previous", "next", "ordinal"]), value: z.string().max(160) }).strict().nullable(),
  field: z.enum(["phone", "identity_card", "email"]).nullable(),
  query: z.string().max(500).nullable(),
  count: z.number().int().min(1).max(100),
  missing: z.array(z.enum(["patient", "content", "destination", "date", "operation"])).max(5),
}).strict();
export type SemanticRequest = z.infer<typeof semanticRequestSchema>;
export type EvidenceOrigin = "PATIENT_DB" | "KNOWLEDGE_RAG" | "APP_STATE" | "MEMORY" | "GENERAL_MODEL";
export interface SourceStep { tool: string; operation: SemanticRequest["operation"]; field: SemanticRequest["field"]; dependsOn: number[] }
export interface SourcePlan { sources: EvidenceOrigin[]; steps: SourceStep[]; cloud: boolean; maxAttempts: 1; deadlineMs: number }

export function buildSourcePlan(request: SemanticRequest): SourcePlan {
  const sources: EvidenceOrigin[] = request.domain === "hybrid" ? ["PATIENT_DB", "KNOWLEDGE_RAG"]
    : request.domain === "patient" ? ["PATIENT_DB"] : request.domain === "knowledge" ? ["KNOWLEDGE_RAG"]
      : request.domain === "application" || request.domain === "action" ? ["APP_STATE"]
        : request.domain === "memory" ? ["MEMORY"] : request.domain === "general" ? ["GENERAL_MODEL"] : [];
  const tools: Partial<Record<SemanticRequest["operation"], string>> = {
    search: "search_patients", profile: "get_patient", summary: "clinical_context", history: "clinical_context",
    treatments: "clinical_context", documents: "get_patient_documents", finance: "patient_finance", appointments: "list_agenda",
    time: "local_clock", navigate: "navigation", propose: "proposal", recall: "conversation_reference",
  };
  const steps: SourceStep[] = request.missing.length || request.domain === "ambiguous" ? []
    : [{ tool: request.domain === "knowledge" ? "knowledge_retrieval" : tools[request.operation] ?? "answer",
      operation: request.operation, field: request.field, dependsOn: [] }];
  if (request.domain === "hybrid" && steps.length) steps.push({ tool: "knowledge_retrieval", operation: "explain", field: null, dependsOn: [0] });
  return { sources, steps, cloud: request.domain === "general" || request.domain === "knowledge", maxAttempts: 1, deadlineMs: 90_000 };
}

export type SourceResult<T> = { state: "ok" | "empty"; origin: EvidenceOrigin; data: T; complete: boolean }
  | { state: "incomplete" | "unavailable" | "stale"; origin: EvidenceOrigin };
export const sourceAnswerSchema = z.object({ sentences: z.array(z.object({ text: z.string().min(1).max(10000),
  origin: z.enum(["PATIENT_DB", "KNOWLEDGE_RAG", "APP_STATE", "MEMORY", "GENERAL_MODEL"]),
  evidence: z.array(z.string().max(200)).max(20) }).strict()).max(100) }).strict();
export type SourceAnswer = z.infer<typeof sourceAnswerSchema>;
export type ValidationResult = { status: "allowed"; answer: SourceAnswer } | { status: "limited" | "rejected"; reason: string };

export const sourcePlanSchema = z.object({
  sources: z.array(z.enum(["PATIENT_DB", "KNOWLEDGE_RAG", "APP_STATE", "MEMORY", "GENERAL_MODEL"])).max(5),
  steps: z.array(z.object({ tool: z.enum(["search_patients", "get_patient", "clinical_context", "get_patient_documents", "patient_finance", "list_agenda", "local_clock", "navigation", "proposal", "conversation_reference", "knowledge_retrieval", "answer"]),
    operation: semanticRequestSchema.shape.operation, field: semanticRequestSchema.shape.field, dependsOn: z.array(z.number().int().min(0).max(2)).max(2) }).strict()).max(3),
  cloud: z.boolean(), maxAttempts: z.literal(1), deadlineMs: z.literal(90000),
}).strict().superRefine((plan,ctx)=>{
  plan.steps.forEach((step,index)=>{if(step.dependsOn.some(dependency=>dependency>=index))ctx.addIssue({code:"custom",message:"InvalidDependency",path:["steps",index]});});
  if(plan.cloud&&plan.sources.some(source=>source==="PATIENT_DB"||source==="MEMORY"||source==="APP_STATE"))ctx.addIssue({code:"custom",message:"PrivateCloudForbidden"});
});
export const patientResolutionSchema = z.discriminatedUnion("status",[
  z.object({status:z.literal("resolved"),patientId:z.uuid(),identityTokens:z.array(z.string()).max(8)}).strict(),
  z.object({status:z.literal("ambiguous"),candidates:z.array(z.object({patientId:z.uuid(),label:z.string().max(400)}).strict()).max(100)}).strict(),
  z.object({status:z.enum(["absent","unavailable","cancelled"])}).strict(),
]);
export const sourceResultSchema = z.discriminatedUnion("state",[
  z.object({state:z.enum(["ok","empty"]),origin:sourceAnswerSchema.shape.sentences.element.shape.origin,data:z.unknown(),complete:z.boolean()}).strict(),
  z.object({state:z.enum(["incomplete","unavailable","stale"]),origin:sourceAnswerSchema.shape.sentences.element.shape.origin}).strict(),
]);
export const privacyAdmissionSchema = z.object({payloadSha256:z.string().regex(/^[a-f0-9]{64}$/u),byteLength:z.number().int().positive().max(128000),
  purpose:z.enum(["public_question","approved_medical_passages"]),provider:z.string().min(1).max(160),containsPatientContext:z.literal(false)}).strict();
export const validationResultSchema = z.discriminatedUnion("status",[
  z.object({status:z.literal("allowed"),answer:sourceAnswerSchema}).strict(),
  z.object({status:z.enum(["limited","rejected"]),reason:z.string().min(1).max(200)}).strict(),
]);
