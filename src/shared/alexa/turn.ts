import { z } from "zod";

export const turnInput = z.object({
  text: z.string().trim().min(1).max(4000),
  conversationId: z.string().min(1).max(100),
  clientTurnId: z.uuid(),
  appContext: z.object({ patientId: z.uuid().nullable(), page: z.string().max(200) }).strict(),
  patientName: z.string().trim().min(2).max(80).optional(),
}).strict();
export type TurnInput = z.infer<typeof turnInput>;
export const alexaNavigationSchema = z.union([
  z.object({ target: z.literal("patient"), patientId: z.uuid() }).strict(),
  z.object({ target: z.literal("document"), documentId: z.uuid(), print: z.boolean().optional() }).strict(),
  z.object({ target: z.enum(["agenda", "patients", "dashboard", "documents", "finances", "parametres", "jarvis"]) }).strict(),
]);
export type AlexaNavigation = z.infer<typeof alexaNavigationSchema>;
export const alexaProposalSchema = z.object({actionId:z.uuid().optional(),tool:z.string().min(1).max(80),args:z.record(z.string().max(80),z.union([z.string().max(200_000),z.number().finite(),z.boolean(),z.null()]))}).strict();
export type AlexaProposal = z.infer<typeof alexaProposalSchema>;
export function alexaNavigationPath(value: unknown): string | null {
  const parsed = alexaNavigationSchema.safeParse(value);
  if (!parsed.success) return null;
  const navigation = parsed.data;
  if (navigation.target === "document") return `/documents?document=${encodeURIComponent(navigation.documentId)}${navigation.print === true ? "&print=1" : ""}`;
  return navigation.target === "patient" ? `/patients/${encodeURIComponent(navigation.patientId)}` : navigation.target === "dashboard" ? "/tableauDeBord" : `/${navigation.target}`;
}
export interface AlexaSource { id: string; type: "patient" | "consultation" | "diagnostic" | "scale" | "treatment" | "knowledge" | "appointment" | "document" | "query"; label: string; version?: string; excerpt?:string; provenance?: Readonly<Record<string, string | number | null>> }
const sourceEvidenceSchema=z.object({
  id:z.string().min(1).max(200),
  type:z.enum(['patient','consultation','diagnostic','scale','treatment','knowledge','appointment','document','query']),
  label:z.string().max(3000),version:z.string().max(1000).optional(),excerpt:z.string().max(30000).optional(),
  provenance:z.record(z.string().max(100),z.union([z.string().max(16000),z.number().finite(),z.null()])).optional(),
});
const sourceEvidenceListSchema=z.array(sourceEvidenceSchema).max(2048);
/** Shared admission for optional evidence details, compatible with existing source references. */
export function validAlexaSources(value:unknown):value is AlexaSource[]{return sourceEvidenceListSchema.safeParse(value).success;}
export type AlexaEvent =
  | ({ type: "proposal" } & AlexaProposal)
  | { type: "stage"; stage: "identity" | "context" | "knowledge" | "analysis" | "validation" }
  | { type: "sentence"; text: string; kind: "fact" | "inference" | "knowledge"; sources: AlexaSource[]; links?: import('./answer-links').AlexaAnswerLink[] }
  | { type: "done"; patientId: string | null; patientScope?: "preserve" | "replace"; sourceRevision: string | null; coverage: { requested: number; returned: number; complete: boolean; hasMore: boolean } | null; limited: boolean; status?: import("./agent").AgentTerminal; parts?: import("./agent").RequestPart[]; tokensIn?: number; tokensOut?: number; speechAllowed?: boolean; persiste?: boolean; navigation?: AlexaNavigation }
  | { type: "error"; code: "unavailable" | "cancelled" | "stale" | "invalid"; message: string; partial?: boolean };
