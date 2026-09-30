import { z } from "zod";

/** Memory-only wire protocol through the existing same-origin DbPort. */
export const EvenementLive = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), sessionId: z.guid() }),
  z.object({ type: z.literal("thinking") }),
  z.object({ type: z.literal("audio"), data: z.string().min(4).max(1_000_000), sampleRate: z.literal(24000) }),
  z.object({ type: z.literal("turn_complete") }),
  z.object({ type: z.literal("interrupted") }),
  z.object({ type: z.literal("closed") }),
  z.object({ type: z.literal("error") }),
]);
export type EvenementLive = z.infer<typeof EvenementLive>;
export type EvenementGemini = Exclude<EvenementLive, { type: "ready" }>;

export const CommandeLive = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), currentPatientId: z.guid().nullable() }).strict(),
  z.object({ action: z.literal("audio"), sessionId: z.guid(), pcmBase64: z.string().min(4).max(48_000)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict(),
  z.object({ action: z.literal("context"), sessionId: z.guid(), currentPatientId: z.guid().nullable() }).strict(),
  z.object({ action: z.literal("stop"), sessionId: z.guid() }).strict(),
]);
