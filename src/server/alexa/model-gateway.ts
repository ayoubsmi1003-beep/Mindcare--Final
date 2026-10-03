import { createHash, randomUUID } from "node:crypto";
import { llm, llmStream,
  type LlmRequest, type LlmResult } from "@/server/egress/external-call";
import { ALEXA_CLINICAL_PROMPT, ALEXA_CLINICAL_TRANSFORM, SafeClinicalPayloadSchema, isIssuedSafeClinicalPayload, safeClinicalMessages, type SafeClinicalPayload } from "./privacy-boundary";
import { validateAlexaResponse, type AlexaAnswer } from "./response-validator";
import { ALEXA_PRIMARY_MODEL, ALEXA_PROVIDER_POLICY } from "./model-policy";
import { SentenceStream } from "./sentence-stream";
import { classerCharge } from "@/server/egress/classification";
import { mentionsMedication } from "@/shared/alexa/medications";
import { ALEXA_GENERAL_PROMPT } from "@/i18n/alexa-general";
import { isBoundedPublicQuestion } from "@/shared/alexa/public-question";

export type AlexaInferenceResult = { readonly ok: true; readonly data: AlexaAnswer; readonly model: string | null }
  | { readonly ok: false; readonly code: "privacy" | "unavailable" | "invalid-response" | "cancelled"; readonly localFallback: true; readonly partial?: boolean };

/** Maintenance explicite du pool `:free` — hors tour ordinaire (single-model). */
export function qualifyAlexaModels(_options: { readonly timeoutMs?: number; readonly maxModels?: number; readonly allModels?: boolean; readonly signal?: AbortSignal;
  readonly provider?: "openrouter"; readonly freeTierConfirmed?: boolean } = {}): never {
  throw new Error("AlexaSingleModelNoMaintenance");
}
export function getAlexaModelPolicy() {
  return { primary: ALEXA_PRIMARY_MODEL, provider: ALEXA_PROVIDER_POLICY, family: "single-openrouter", variant: "paid", maxAttempts: 1,
    syntheticDevelopmentAlternative: null, realPatientGemini: false,
    qualification: "none-single-primary", persistentReferenceConfigured: typeof process.env.ALEXA_HMAC_KEY === "string"
      && Buffer.byteLength(process.env.ALEXA_HMAC_KEY, "utf8") >= 32 } as const;
}

export async function inferAlexa(payload: SafeClinicalPayload, options: {
  readonly signal?: AbortSignal; readonly caller?: string; readonly timeoutMs?: number; readonly identityTokens?: readonly string[];
  readonly purpose?: "jarvis" | "resume-cas";
  readonly onSentence?: (sentence: AlexaAnswer["sentences"][number]) => Promise<void>;
} = {}): Promise<AlexaInferenceResult> {
  const parsed = SafeClinicalPayloadSchema.safeParse(payload);
  if (!parsed.success || !isIssuedSafeClinicalPayload(payload)) return { ok: false, code: "privacy", localFallback: true };
  if (options.signal?.aborted) return { ok: false, code: "cancelled", localFallback: true };
  const request = { purpose: options.purpose ?? "jarvis", messages: safeClinicalMessages(payload),
    promptVersion: ALEXA_CLINICAL_TRANSFORM, promptHash: createHash("sha256").update(ALEXA_CLINICAL_PROMPT).digest("hex"),
    sessionToken: randomUUID(), timeoutMs: Math.max(1, Math.min(60000, options.timeoutMs ?? 15000)),
    besoin: { json: true, streaming: !!options.onSentence, outils: false, tache: options.purpose === "resume-cas" ? "resume" as const : "conversation" as const },
    egress: { transformId: ALEXA_CLINICAL_TRANSFORM }, ...(options.signal ? { signal: options.signal } : {}) };
  if (options.onSentence) return inferStreaming(payload, request, options.onSentence, options.signal, options.identityTokens);
  // Single-model : OpenRouter direct, sans second fournisseur.
  const result = await llm(request);
  if (!result.ok) return { ok: false, code: options.signal?.aborted ? "cancelled" : result.error.code === "frontiere" ? "privacy" : "unavailable", localFallback: true };
  let value: unknown;
  try { value = JSON.parse(result.data); } catch { return { ok: false, code: "invalid-response", localFallback: true }; }
  const validated = validateAlexaResponse(value, parsed.data, options.identityTokens);
  return validated.ok ? { ok: true, data: validated.answer, model: result.inference?.model ?? null }
    : { ok: false, code: "invalid-response", localFallback: true };
}

async function inferStreaming(payload: SafeClinicalPayload, request: Parameters<typeof llmStream>[0],
  onSentence: NonNullable<Parameters<typeof inferAlexa>[1]>["onSentence"] & {},
  signal?: AbortSignal, identities?: readonly string[]): Promise<AlexaInferenceResult> {
  // Single-model : OpenRouter direct, sans second fournisseur.
  const result = await llmStream(request);
  if (!result.ok) return { ok: false, code: signal?.aborted ? "cancelled" : result.error.code === "frontiere" ? "privacy" : "unavailable", localFallback: true };
  const reader = result.data.deltas.getReader();
  const selected = new Set<string>();
  const scanner = new SentenceStream();
  let published = false;
  // Observe usage even if validation/cancellation stops consuming before EOF.
  void result.data.usage.catch(() => {});
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    for (;;) {
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) break;
      for (const object of scanner.push(chunk.value)) {
        const validated = validateAlexaResponse({ sentences: [object] }, payload, identities);
        if (!validated.ok) throw new Error("InvalidAlexaStream");
        const added = validated.answer.sentences.filter(sentence => !selected.has(sentence.evidence[0]!));
        if (selected.size + added.length > 12) throw new Error("InvalidAlexaStream");
        for (const sentence of added) {
          signal?.throwIfAborted();
          await onSentence(sentence);
          published = true;
          selected.add(sentence.evidence[0]!);
        }
      }
    }
    const validated = validateAlexaResponse(scanner.finish(), payload, identities);
    if (!validated.ok) throw new Error("InvalidAlexaStream");
    await abortableUsage(result.data.usage, signal);
    signal?.throwIfAborted();
    return { ok: true, data: validated.answer, model: result.inference?.model ?? null };
  } catch (error) {
    // Scope/revision failures belong to the orchestrator, which has the local context.
    if (error instanceof Error && ["ScopeChanged", "StaleContext"].includes(error.message)) throw error;
    return { ok: false, code: signal?.aborted ? "cancelled" : (error instanceof Error && error.message === "InvalidAlexaStream") || error instanceof SyntaxError ? "invalid-response" : "unavailable",
      localFallback: true, ...(published ? { partial: true } : {}) };
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function abortableUsage<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("AlexaCancelled"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export type AlexaGeneralInferenceResult = { readonly ok: true; readonly text: string; readonly model: string | null }
  | { readonly ok: false; readonly code: "privacy" | "unavailable" | "invalid-response" | "cancelled"; readonly localFallback: true };

const GENERAL_PRIVATE_OR_CLINICAL = /\b(?:patients?|patientes?|dossier\w*|records?|consult\w*|seances?|cabinet|agenda|planning|rendez[-\s]?vous|soap|notes?|ordonn\w*|diagnos\w*|symptom\w*|traitement\w*|treatm\w*|medic\w*|medical\w*|clin\w*|prescri\w*|posolog\w*|dosage\w*|dose\w*|therap\w*|psychi\w*|sante|health|malad\w*|disease\w*|depress\w*|anx\w*|suicid\w*|bipola\w*|schiz\w*|douleur\w*|pain|stress|sommeil|insomn\w*|dsm|icd|cim|phq|gad|ymrs|cbt|nom|prenom|identit\w*|adresse\w*|address\w*|telephone\w*|phone|contacts?|courriel|naissance|birth|factur\w*|paiement\w*|recettes?)\b|مريض|مريضة|مرضى|المرض|ملف|دوسيه|تشخيص|اعراض|علاج|دواء|دوائها|الدوا|اكتئاب|قلق|انتحار|الطبيب|طبي|الصحة|عيادة|موعد|جلسة|ملاحظ|اسم(?:ه|ها|ي|ك|هم|كم)|رقم|عنوان|هاتف|تلفون|الميلاد/u;
const GENERAL_DRUGS = /\b(?:xanax|prozac|zoloft|deroxat|lexomil|rivotril|paracetamol|ibuprofen|aspirin\w*|insulin\w*)\b|باراسيتامول|سيرترالين|اسيتالوبرام|فلوكسيتين|ريسبيريدون|اولانزابين|ليثيوم|زاناكس|بروزاك|انسولين/u;
const GENERAL_MEDICAL_TERMS = /\b(?:doctors?|physician\w*|medecin\w*|soins?|illness\w*|fever\w*|fievre\w*|migraine\w*|diabet\w*|cancer\w*|hypertens\w*|vaccin\w*|pregnan\w*|grossesse|infection\w*|antibio\w*)\b|حمى|سكري|سرطان|ضغط\s+الدم|حمل|عدوى|لقاح|مضاد\s+حيوي/u;
const GENERAL_ACTION_OR_SOURCE = /\b(?:ignore|instructions?|system\s+prompt|role|envoi\w*|envoie\w*|transmet\w*|execut\w*|supprim\w*|commande\w*|ecri\w*|redige\w*|ouvre\w*|fais|lance\w*|copie\w*|shell|powershell|terminal|send|emails?|delete|execute|launch|save|update|write|open\w*|livres?|ouvrages?|citations?|bibliograph\w*|taylor|maudsley|stahl)\b|\[(?:source|book|livre)\b|\bpage\s+\d|(?:j['’]ai|je\s+viens\s+de|i\s+have|we\s+have)\s+(?:lu|ouvert|ajoute|cree|enregistre|modifie|read|saved|opened|updated|created)|\bi\s+(?:read|opened|saved|updated|created)\b|donnees\s+(?:locales?|du\s+cabinet)|local\s+data|تم\s+(?:حفظ|فتح|تعديل|ارسال)|حفظت|فتحت|عدلت|نفذت|ارسلت|تجاهل|تعليمات|نفذ|احذف/u;

function generalTextIsUnsafe(text: string): boolean {
  const value = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(text)
    || /\b(?:my|your|his|her|their)\s+(?:names?|surnames?|identit(?:y|ies))\b/u.test(value)
    || GENERAL_PRIVATE_OR_CLINICAL.test(value) || GENERAL_MEDICAL_TERMS.test(value) || GENERAL_DRUGS.test(value) || mentionsMedication(value)
    || GENERAL_ACTION_OR_SOURCE.test(value) || /<\/?[a-z][^>]*>/i.test(value)
    || /(?:\+|00)\s*\d(?:[\s().-]*\d){6,}|\b\d{7,}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/u.test(value);
}

function isGeneralC4(value: unknown): boolean {
  const verdict = classerCharge(value, null);
  return verdict.classe === "C4" && verdict.decision === "AUTORISER";
}

/** Current public question only: no context, history, receipts, tools or writes. */
export async function inferGeneralAlexa(text: string, options: {
  readonly signal?: AbortSignal; readonly caller?: string; readonly timeoutMs?: number;
} = {}): Promise<AlexaGeneralInferenceResult> {
  if (options.signal?.aborted) return { ok: false, code: "cancelled", localFallback: true };
  if (typeof text !== "string" || text.length > 1000 || !isBoundedPublicQuestion(text) || generalTextIsUnsafe(text) || !isGeneralC4(text))
    return { ok: false, code: "privacy", localFallback: true };
  const messages: LlmRequest["messages"] = [{ role: "system", content: ALEXA_GENERAL_PROMPT }, { role: "user", content: text }];
  if (!isGeneralC4(messages)) return { ok: false, code: "privacy", localFallback: true };
  const duration = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
  const request: LlmRequest = { purpose: "jarvis", messages, promptVersion: "alexa-general-c4-v1",
    promptHash: createHash("sha256").update(ALEXA_GENERAL_PROMPT).digest("hex"), sessionToken: randomUUID(),
    timeoutMs: Math.max(1, Math.min(15000, duration)),
    besoin: { json: false, streaming: false, outils: false, tache: "conversation" }, ...(options.signal ? { signal: options.signal } : {}) };
  try {
    // Single-model : OpenRouter direct, sans second fournisseur.
    const result = await llm(request);
    if (options.signal?.aborted) return { ok: false, code: "cancelled", localFallback: true };
    if (!result.ok) return { ok: false, code: result.error.code === "frontiere" ? "privacy" : "unavailable", localFallback: true };
    if (typeof result.data !== "string" || !result.data.trim() || result.data.length > 2000 || generalTextIsUnsafe(result.data) || !isGeneralC4(result.data))
      return { ok: false, code: "invalid-response", localFallback: true };
    return { ok: true, text: result.data.trim(), model: result.inference?.model ?? null };
  } catch {
    return { ok: false, code: options.signal?.aborted ? "cancelled" : "unavailable", localFallback: true };
  }
}
