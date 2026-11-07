import { parsePatientMention } from "./patient-mention";
import { asksForAChange, frenchRequestAdmission, frenchRequestedOutputs, hasNoChangeAction, sequencedGoals, thirdPartyReference } from "./request-contract";

/**
 * What a turn asks, decided before anything is read. It runs without a model: on this hardware one
 * planner call takes about 13 s, and 244 of the 300 campaign cases never need one. Whatever stays
 * "unknown" goes on to the model planner, whose choices the executor still checks.
 */
export interface TurnUnderstanding {
  /** Goals from explicit sequence words. One goal when the request has no sequence. */
  readonly goals: readonly string[];
  /** Goals beyond the limit of a single turn. Always reported back, never dropped. */
  readonly dropped: readonly string[];
  readonly subject: "third_party" | "named" | "ambiguous" | "in_context" | "none";
  readonly source: "application" | "books" | "unknown";
  readonly wantsChange: boolean;
  /** A change Alexa has no action for, such as deleting a record or marking messages read. */
  readonly noChangeAction: boolean;
  /** Part of the request is a change with no action, even though another part can be proposed. */
  readonly partlyWithoutAction: boolean;
  /** The existing output contract already splits this request into several outputs. */
  readonly contractOutputs: boolean;
}

export function understandTurn(text: string, context: { readonly selected: boolean; readonly asOf?: string }): TurnUnderstanding {
  const sequence = sequencedGoals(text), mention = parsePatientMention(text).status;
  const tools = frenchRequestAdmission(text, false, context.asOf).tools ?? [];
  return {
    goals: sequence?.goals ?? [text.trim()],
    dropped: sequence?.dropped ?? [],
    subject: thirdPartyReference(text, context.selected) ? "third_party" : mention === "named" ? "named" : mention === "ambiguous" ? "ambiguous" : context.selected ? "in_context" : "none",
    source: tools.length === 0 ? "unknown" : tools.length === 1 && tools[0] === "search_knowledge" ? "books" : "application",
    wantsChange: asksForAChange(text),
    noChangeAction: hasNoChangeAction(text) && !frenchRequestAdmission(text, false, context.asOf).preparationAction,
    partlyWithoutAction: hasNoChangeAction(text) && !!frenchRequestAdmission(text, false, context.asOf).preparationAction && /\b(?:dossier|messages?|note|paiement)\b[^.?!]*$/u.test(text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/^.*?\b(?:et|puis)\b/u, "")),
    contractOutputs: (frenchRequestedOutputs(text)?.length ?? 0) > 1,
  };
}

/** Closed codes for the turn trace: never the question's words. */
export function understandingCodes(understanding: TurnUnderstanding): string[] {
  return [`goals:${understanding.goals.length + understanding.dropped.length}`, `subject:${understanding.subject}`, `source:${understanding.source}`, ...(understanding.wantsChange ? ["wants_change"] : [])];
}
