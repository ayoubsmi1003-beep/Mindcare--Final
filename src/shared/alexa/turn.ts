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
  z.object({ target: z.enum(["agenda", "patients", "dashboard"]) }).strict(),
]);
export type AlexaNavigation = z.infer<typeof alexaNavigationSchema>;
export function alexaNavigationPath(value: unknown): string | null {
  const parsed = alexaNavigationSchema.safeParse(value);
  if (!parsed.success) return null;
  const navigation = parsed.data;
  return navigation.target === "patient" ? `/patients/${encodeURIComponent(navigation.patientId)}` : navigation.target === "dashboard" ? "/tableauDeBord" : `/${navigation.target}`;
}
export interface AlexaSource { id: string; type: "consultation" | "diagnostic" | "scale" | "treatment" | "knowledge" | "appointment"; label: string; version?: string; provenance?: Readonly<Record<string, string | number | null>> }
export type AlexaEvent =
  | { type: "stage"; stage: "identity" | "context" | "knowledge" | "analysis" | "validation" }
  | { type: "sentence"; text: string; kind: "fact" | "inference" | "knowledge"; sources: AlexaSource[] }
  | { type: "done"; patientId: string | null; patientScope?: "preserve" | "replace"; sourceRevision: string | null; coverage: { requested: number; returned: number; complete: boolean; hasMore: boolean } | null; limited: boolean; persiste?: boolean; navigation?: AlexaNavigation }
  | { type: "error"; code: "unavailable" | "cancelled" | "stale" | "invalid"; message: string; partial?: boolean };
