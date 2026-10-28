import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const agentContinuationKinds = ["application", "analysis", "document", "notes", "calendar", "timeline"] as const;
export type AgentContinuationKind = typeof agentContinuationKinds[number];

export interface AgentContinuationBinding {
  actor: string;
  conversationId: string;
  requestText: string;
  appContext: Readonly<Record<string, unknown>>;
}

export interface AgentContinuationCursor {
  cursorId: string;
  kind: AgentContinuationKind;
  patientId: string | null;
  page: string;
  sourceRevision: string;
  position: number;
}

export interface StoredAgentContinuation extends AgentContinuationCursor {
  token: string;
  actor: string;
  conversationId: string;
  requestHash: string;
  contextHash: string;
  completedBatches: number;
  issuedAt: number;
}

const storedContinuationSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{40,64}$/u),
  actor: z.string().min(1).max(200),
  conversationId: z.string().min(1).max(100),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/u),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/u),
  cursorId: z.string().min(1).max(200),
  kind: z.enum(agentContinuationKinds),
  patientId: z.uuid().nullable(),
  page: z.string().max(200),
  sourceRevision: z.string().regex(/^[a-f0-9]{32}(?:[a-f0-9]{32})?$/u),
  position: z.number().int().nonnegative().safe(),
  completedBatches: z.number().int().min(1).max(1000),
  issuedAt: z.number().finite(),
}).strict();

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const contextDigest = (value: Readonly<Record<string, unknown>>): string => digest(JSON.stringify(value));

/** Select the first incomplete, revision-protected read. Write proposals are never resumable. */
export function describePendingAgentCursor(value: unknown): AgentContinuationCursor | null {
  const task = z.object({
    patientId: z.uuid().nullable(),
    page: z.string().max(200),
    results: z.array(z.object({
      callId: z.string().min(1).max(200),
      complete: z.boolean(),
      proposal: z.unknown().optional(),
      data: z.record(z.string(), z.unknown()).optional(),
    }).passthrough()).max(6),
  }).passthrough().safeParse(value);
  if (!task.success) return null;

  for (const result of task.data.results) {
    if (result.complete || result.proposal !== undefined || !result.data) continue;
    const data = result.data;
    const revision = data["revision"];
    if (typeof revision !== "string" || !/^[a-f0-9]{32}(?:[a-f0-9]{32})?$/u.test(revision)) continue;
    let kind: AgentContinuationKind | null = null;
    let position = 0;
    if ("applicationQuery" in data && typeof data["nextOffset"] === "number") {
      kind = "application"; position = data["nextOffset"];
    } else if ("consultationQuery" in data && typeof data["nextTextOffset"] === "number") {
      kind = "analysis"; position = data["nextTextOffset"];
    } else if ("documentQuery" in data && typeof data["nextTextOffset"] === "number") {
      kind = "document"; position = data["nextTextOffset"];
    } else if ("noteQuery" in data && data["next"] && typeof data["next"] === "object") {
      const next = data["next"] as Record<string, unknown>;
      if (typeof next["offset"] === "number" && typeof next["textOffset"] === "number") {
        kind = "notes"; position = next["offset"];
      }
    } else if ("timelineQuery" in data && data["timelineNext"] && typeof data["timelineNext"] === "object") {
      const next = data["timelineNext"] as Record<string, unknown>;
      if (typeof next["beforeAt"] === "string" && typeof next["beforeId"] === "string") {
        kind = "timeline"; position = 1;
      }
    } else if ("financeQuery" in data && typeof data["nextOffset"] === "number") {
      kind = "calendar"; position = data["nextOffset"];
    }
    if (!kind || !Number.isSafeInteger(position) || position < 0) continue;
    return {
      cursorId: result.callId,
      kind,
      patientId: task.data.patientId,
      page: task.data.page,
      sourceRevision: revision,
      position,
    };
  }
  return null;
}

export function createAgentContinuation(
  binding: AgentContinuationBinding,
  cursor: AgentContinuationCursor,
  completedBatches: number,
  issuedAt = Date.now(),
): StoredAgentContinuation {
  return storedContinuationSchema.parse({
    ...cursor,
    token: randomBytes(32).toString("base64url"),
    actor: binding.actor,
    conversationId: binding.conversationId,
    requestHash: digest(binding.requestText),
    contextHash: contextDigest(binding.appContext),
    completedBatches,
    issuedAt,
  });
}

/** Returns the server-held cursor only when every scope and source binding still matches. */
export function validateAgentContinuation(
  stored: unknown,
  suppliedToken: string | undefined,
  binding: AgentContinuationBinding,
  currentCursor: AgentContinuationCursor | null,
  now = Date.now(),
): StoredAgentContinuation | null {
  const parsed = storedContinuationSchema.safeParse(stored);
  if (!parsed.success || !suppliedToken || parsed.data.token !== suppliedToken) return null;
  const value = parsed.data;
  if (now - value.issuedAt >= 15 * 60_000 || value.issuedAt > now + 1000) return null;
  if (value.actor !== binding.actor || value.conversationId !== binding.conversationId
    || value.requestHash !== digest(binding.requestText) || value.contextHash !== contextDigest(binding.appContext)) return null;
  if (!currentCursor || value.cursorId !== currentCursor.cursorId || value.kind !== currentCursor.kind
    || value.patientId !== currentCursor.patientId || value.page !== currentCursor.page
    || value.sourceRevision !== currentCursor.sourceRevision || value.position !== currentCursor.position) return null;
  return value;
}

/** A supplied token must validate itself; only an omitted token may auto-resume stored progress. */
export function resolveAgentContinuation(
  stored: unknown,
  suppliedToken: string | undefined,
  binding: AgentContinuationBinding,
  currentCursor: AgentContinuationCursor | null,
  now = Date.now(),
): { continuation: StoredAgentContinuation | null; stale: boolean } {
  const storedToken=typeof stored==='object'&&stored!==null&&'token' in stored&&typeof stored.token==='string'?stored.token:undefined;
  const token=suppliedToken??storedToken;
  const continuation=validateAgentContinuation(stored,token,binding,currentCursor,now);
  return {continuation,stale:suppliedToken!==undefined&&!continuation};
}

export function agentContinuationText(kind: AgentContinuationKind): string {
  switch (kind) {
    case "application": return "la suite accueil";
    case "analysis": return "la suite analyse";
    case "document": return "la suite document";
    case "notes": return "la suite notes";
    case "calendar": return "la suite calendrier";
    case "timeline": return "la suite chronologie";
  }
}
