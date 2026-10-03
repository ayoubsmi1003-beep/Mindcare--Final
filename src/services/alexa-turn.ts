import { db } from "./db";
import { abonnerPatientActif, patientActifCourant } from "./patient-actif";
import { alexa } from "@/i18n/alexa";
import { alexaNavigationSchema, type AlexaEvent, type AlexaNavigation, type AlexaSource } from "@/shared/alexa/turn";

let conversation: string | null = null;
let conversationPending: Promise<string> | null = null;
let lastPatient: string | null = null;
let lastPage = "";
let sequence = 0;
let generation = 0;
let observedPatient: string | null = patientActifCourant()?.id ?? null;
abonnerPatientActif(patient => {
  const next = patient?.id ?? null;
  if (observedPatient !== next) { observedPatient = next; lastPatient = next; sequence++; }
});
export function adoptAlexaConversation(id: string): void { conversation = id; }
export function clearAlexaConversation(): void { conversation = null; conversationPending = null; lastPatient = null; lastPage = ""; sequence++; generation++; }
export async function ensureAlexaConversation(): Promise<string> {
  if (conversation) return conversation;
  if (conversationPending) return conversationPending;
  const ownGeneration = generation;
  const pending = (async () => {
    const result = await db().rpc<string>("start_jarvis_conversation", {});
    if (!result.ok || !result.data[0]) throw new Error(alexa.lectureIndisponible);
    if (generation !== ownGeneration) throw new Error(alexa.contexteChange);
    conversation = result.data[0];
    return conversation;
  })().finally(() => { if (conversationPending === pending) conversationPending = null; });
  conversationPending = pending;
  return conversationPending;
}
export interface AlexaTurnResult { texte: string; sources: AlexaSource[]; patientId: string | null; limited: boolean; persiste: boolean; navigation?: AlexaNavigation }
export class AlexaTurnError extends Error {
  constructor(message: string, readonly partial: boolean) { super(message); this.name = "AlexaTurnError"; }
}
export async function envoyerTourAlexa(text: string, signal?: AbortSignal, callbacks: { onSentence?: (text: string) => void; onStage?: (stage: string) => void } = {}): Promise<AlexaTurnResult> {
  signal?.throwIfAborted();
  const page = typeof window === "undefined" ? "" : window.location.pathname;
  const activePatient = patientActifCourant()?.id ?? null;
  if (lastPage !== page) lastPatient = activePatient;
  lastPage = page;
  const patientId = lastPatient;
  const ownSequence = ++sequence;
  const id = await ensureAlexaConversation();
  signal?.throwIfAborted();
  if (ownSequence !== sequence) throw new Error(alexa.contexteChange);
  const response = await db().invokeFunctionStream("alexa-turn", { text, conversationId: id, clientTurnId: crypto.randomUUID(), appContext: { patientId, page } }, signal);
  if (!response.ok) throw new Error(alexa.lectureIndisponible);
  const reader = response.data.getReader();
  const decoder = new TextDecoder();
  let pending = "", answer = "", done = false, limited = true, persiste = false;
  let sourcePatientId: string | null = null;
  let replacePatient = false;
  let navigation: AlexaNavigation | undefined;
  const sources: AlexaSource[] = [];
  const checkScope = () => {
    signal?.throwIfAborted();
    if (ownSequence !== sequence || (typeof window !== "undefined" && page !== window.location.pathname)) throw new Error(alexa.contexteChange);
  };
  try {
    for (;;) {
      checkScope();
      const chunk = await reader.read();
      checkScope();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      if (pending.length > 128_000) throw new Error(alexa.format);
      let boundary: number;
      while ((boundary = pending.indexOf("\n\n")) !== -1) {
        checkScope();
        const record = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        const raw = record.startsWith("data: ") ? JSON.parse(record.slice(6)) as AlexaEvent : null;
        if (!raw) continue;
        if (raw.type === "sentence" && typeof raw.text === "string" && raw.text.length <= 10_000 && Array.isArray(raw.sources)) {
          answer += `${answer ? "\n" : ""}${raw.text}`;
          if (answer.length > 64_000) throw new Error(alexa.format);
          sources.push(...raw.sources); callbacks.onSentence?.(raw.text);
        } else if (raw.type === "stage") callbacks.onStage?.(raw.stage);
        else if (raw.type === "error") throw new AlexaTurnError(raw.message, raw.partial === true);
        else if (raw.type === "done") {
          if (raw.navigation !== undefined) {
            const parsed = alexaNavigationSchema.safeParse(raw.navigation);
            if (!parsed.success || (parsed.data.target === "patient" && (parsed.data.patientId !== raw.patientId || raw.patientScope !== "replace"))) throw new Error(alexa.format);
            navigation = parsed.data;
          }
          done = true; limited = raw.limited; persiste = raw.persiste === true;
          sourcePatientId = raw.patientId;
          replacePatient = raw.patientScope !== "preserve";
        }
      }
      if (chunk.done) break;
    }
    checkScope();
    if (!done) throw new Error(alexa.interrompu);
    if (replacePatient) lastPatient = sourcePatientId;
    return { texte: answer, sources, patientId: sourcePatientId, limited, persiste, ...(navigation ? { navigation } : {}) };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
