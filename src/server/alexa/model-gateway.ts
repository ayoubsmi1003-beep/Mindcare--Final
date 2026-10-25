import { createHash, randomUUID } from "node:crypto";
import { preparerPoolModelesGratuits, preparerGeminiGratuit, preparerGroqGratuit,
  type LlmRequest, type LlmResult } from "@/server/egress/external-call";
import { ALEXA_CLINICAL_PROMPT, ALEXA_CLINICAL_TRANSFORM, SafeClinicalPayloadSchema, isIssuedSafeClinicalPayload, safeClinicalMessages, type SafeClinicalPayload } from "./privacy-boundary";
import { validateAlexaResponse, type AlexaAnswer } from "./response-validator";
import { ALEXA_CONVERSATION_MODEL as ALEXA_DIRECT_MODEL } from "./model-policy";
import { SentenceStream } from "./sentence-stream";
import { classerCharge } from "@/server/egress/classification";
import { mentionsMedication } from "@/shared/alexa/medications";
import { ALEXA_GENERAL_PROMPTS } from "@/i18n/alexa-general";
import { isBoundedPublicQuestion } from "@/shared/alexa/public-question";
import { isIssuedPublicQuestion, type PublicQuestionAdmission } from "./semantic-planner";
import { findVerifiedPublicFact } from "./general-reference";
import { isFrenchAlexaCapabilityQuestion, isFrenchMissingInformationPolicyQuestion } from "@/shared/alexa/request-contract";

import { inferLocalText } from "./local-model";
/** Delivered text stays on the pinned local MiniCPM engine. Gemini voice remains separate. */
export { ALEXA_CONVERSATION_MODEL as ALEXA_DIRECT_MODEL } from "./model-policy";

export type AlexaInferenceResult = { readonly ok: true; readonly data: AlexaAnswer; readonly model: string | null }
  | { readonly ok: false; readonly code: "privacy" | "unavailable" | "invalid-response" | "cancelled"; readonly localFallback: true; readonly partial?: boolean };

/** Explicit synthetic qualification, outside the ordinary turn deadline. */
export function qualifyAlexaModels(options: { readonly timeoutMs?: number; readonly maxModels?: number; readonly allModels?: boolean; readonly signal?: AbortSignal;
  readonly provider?: "openrouter" | "gemini-free" | "groq-free"; readonly freeTierConfirmed?: boolean } = {}) {
  return options.provider === "gemini-free" ? preparerGeminiGratuit(options) : options.provider === "groq-free" ? preparerGroqGratuit(options) : preparerPoolModelesGratuits(options);
}
export function getAlexaModelPolicy() {
  return { primary: ALEXA_DIRECT_MODEL, provider: "local-minicpm", family: "authenticated-loopback", variant: "local", maxAttempts: 1,
    cloudFallback: false, qualification: "synthetic-local-routing-and-answers", persistentReferenceConfigured: typeof process.env.ALEXA_HMAC_KEY === "string"
      && Buffer.byteLength(process.env.ALEXA_HMAC_KEY, "utf8") >= 32 } as const;
}

function clinicalOutputSchema(payload: SafeClinicalPayload): Record<string, unknown> {
  return { type: "object", additionalProperties: false, required: ["sentences"], properties: {
    sentences: { type: "array", minItems: 1, maxItems: 12, items: {
      type: "object", additionalProperties: false, required: ["text", "evidence", "kind"], properties: {
        text: { type: "string", const: "recorded fact" }, kind: { type: "string", const: "fact" },
        evidence: { type: "array", minItems: 1, maxItems: 1,
          items: { type: "string", enum: payload.facts.map(fact => fact.evidence) } },
      },
    } },
  } };
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
    sessionToken: randomUUID(), timeoutMs: Math.max(1, Math.min(60000, options.timeoutMs ?? 60000)),
    besoin: { json: true, streaming: !!options.onSentence, outils: false, tache: options.purpose === "resume-cas" ? "resume" as const : "conversation" as const },
    egress: { transformId: ALEXA_CLINICAL_TRANSFORM }, ...(options.signal ? { signal: options.signal } : {}) };
  if (options.onSentence) return inferStreaming(payload, request, options.onSentence, options.signal, options.identityTokens);
  // Fixed local MiniCPM; privacy admission and clinical response validation remain mandatory.
  let text: string;
  try {
    text = await inferLocalText(request.messages, { jsonSchema: clinicalOutputSchema(payload), timeoutMs: request.timeoutMs, signal: options.signal });
  } catch {
    return { ok: false, code: options.signal?.aborted ? "cancelled" : "unavailable", localFallback: true };
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, code: "invalid-response", localFallback: true }; }
  const validated = validateAlexaResponse(value, parsed.data, options.identityTokens);
  return validated.ok ? { ok: true, data: validated.answer, model: ALEXA_DIRECT_MODEL }
    : { ok: false, code: "invalid-response", localFallback: true };
}

async function inferStreaming(payload: SafeClinicalPayload, request: { readonly messages: LlmRequest["messages"]; readonly timeoutMs: number },
  onSentence: NonNullable<Parameters<typeof inferAlexa>[1]>["onSentence"] & {},
  signal?: AbortSignal, identities?: readonly string[]): Promise<AlexaInferenceResult> {
  // The local answer is buffered before the existing sentence validator publishes it.
  let text: string;
  try {
    text = await inferLocalText(request.messages, { jsonSchema: clinicalOutputSchema(payload), timeoutMs: request.timeoutMs, signal });
  } catch {
    return { ok: false, code: signal?.aborted ? "cancelled" : "unavailable", localFallback: true };
  }
  const result = { data: { deltas: new ReadableStream<string>({ start(c) { c.enqueue(text); c.close(); } }),
    usage: Promise.resolve({ tokensIn: 0, tokensOut: 0 }) }, inference: { model: ALEXA_DIRECT_MODEL } };
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

export type AlexaGeneralInferenceResult = { readonly ok: true; readonly text: string; readonly model: string | null; readonly localSource?: "capability"|"missing_information";
  readonly reference?: { readonly id: string; readonly label: string; readonly sourceUrl: string; readonly secondarySourceUrl?: string } }
  | { readonly ok: false; readonly code: "privacy" | "unavailable" | "invalid-response" | "cancelled" | "quota-exhausted" | "rate-limited"; readonly localFallback: true };

const GENERAL_PRIVATE_OR_CLINICAL = /\b(?:patients?|patientes?|dossier\w*|records?|consult\w*|seances?|cabinet|agenda|planning|rendez[-\s]?vous|soap|notes?|ordonn\w*|diagnos\w*|symptom\w*|traitement\w*|treatm\w*|medic\w*|medical\w*|clin\w*|prescri\w*|posolog\w*|dosage\w*|dose\w*|therap\w*|psychi\w*|sante|health|malad\w*|disease\w*|depress\w*|anx\w*|suicid\w*|bipola\w*|schiz\w*|douleur\w*|pain|stress|sommeil|insomn\w*|dsm|icd|cim|phq|gad|ymrs|cbt|nom|prenom|identit\w*|adresse\w*|address\w*|telephone\w*|phone|contacts?|courriel|naissance|birth|factur\w*|paiement\w*|recettes?)\b|مريض|مريضة|مرضى|المرض|ملف|دوسيه|تشخيص|اعراض|علاج|دواء|دوائها|الدوا|اكتئاب|قلق|انتحار|الطبيب|طبي|الصحة|عيادة|موعد|جلسة|ملاحظ|اسم(?:ه|ها|ي|ك|هم|كم)|رقم|عنوان|هاتف|تلفون|الميلاد/u;
const GENERAL_DRUGS = /\b(?:xanax|prozac|zoloft|deroxat|lexomil|rivotril|paracetamol|ibuprofen|aspirin\w*|insulin\w*)\b|باراسيتامول|سيرترالين|اسيتالوبرام|فلوكسيتين|ريسبيريدون|اولانزابين|ليثيوم|زاناكس|بروزاك|انسولين/u;
const GENERAL_MEDICAL_TERMS = /\b(?:doctors?|physician\w*|medecin\w*|soins?|illness\w*|fever\w*|fievre\w*|migraine\w*|diabet\w*|cancer\w*|hypertens\w*|vaccin\w*|pregnan\w*|grossesse|infection\w*|antibio\w*)\b|حمى|سكري|سرطان|ضغط\s+الدم|حمل|عدوى|لقاح|مضاد\s+حيوي/u;
const GENERAL_ENGLISH_TERMS = /\b(?:the|and|with|because|causing|creating|engines?|systems?|stability|motion|stationary|orbiting|without|through)\b/u;
const GENERAL_ACTION_OR_SOURCE = /\b(?:ignore|instructions?|system\s+prompt|role|envoi\w*|envoie\w*|transmet\w*|execut\w*|supprim\w*|commande\w*|ecri\w*|redige\w*|ouvre\w*|fais|lance\w*|copie\w*|shell|powershell|terminal|send|emails?|delete|execute|launch|save|update|write|open\w*|livres?|ouvrages?|citations?|bibliograph\w*|taylor|maudsley|stahl)\b|\[(?:source|book|livre)\b|\bpage\s+\d|(?:j['’]ai|je\s+viens\s+de|i\s+have|we\s+have)\s+(?:lu|ouvert|ajoute|cree|enregistre|modifie|read|saved|opened|updated|created)|\bi\s+(?:read|opened|saved|updated|created)\b|donnees\s+(?:locales?|du\s+cabinet)|local\s+data|تم\s+(?:حفظ|فتح|تعديل|ارسال)|حفظت|فتحت|عدلت|نفذت|ارسلت|تجاهل|تعليمات|نفذ|احذف/u;

function generalTextIsUnsafe(text: string, computerExplanation = false): boolean {
  const value = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  // A processor executing instructions describes a public topic, not an
  // action performed by Alexa. Only this subject/verb phrase is exempted;
  // identity, clinical content, appended commands and first-person claims
  // are still scanned in the complete original answer.
  const actions = computerExplanation ? value.replace(/(?:\b(?:un\s+ordinateur|l['’]ordinateur)\s+(?:peut\s+)?(?:execut\w*|trait\w*|interpret\w*|suiv\w*)\s+(?:les|des)\s+instructions|\ba computer executes instructions|الحاسوب ينفذ تعليمات)/gu, "ordinateur calcule") : value;
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(text)
    || /\b(?:my|your|his|her|their)\s+(?:names?|surnames?|identit(?:y|ies))\b/u.test(value)
    || /\b(?:chiffre d.affaires|chiffre|soldes?|finances?|impayes?|depenses?|benefices?|revenus?|encaissements?|resultat net)\b/u.test(value)
    || GENERAL_PRIVATE_OR_CLINICAL.test(value) || GENERAL_MEDICAL_TERMS.test(value) || GENERAL_DRUGS.test(value) || GENERAL_ENGLISH_TERMS.test(value) || mentionsMedication(value)
    || GENERAL_ACTION_OR_SOURCE.test(actions) || /<\/?[a-z][^>]*>/i.test(value)
    || /(?:\+|00)\s*\d(?:[\s().-]*\d){6,}|\b\d{7,}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/u.test(value);
}

function isGeneralC4(value: unknown): boolean {
  const verdict = classerCharge(value, null);
  return verdict.classe === "C4" && verdict.decision === "AUTORISER";
}
function isValidFrenchGeneralAnswer(answer:string,computerExplanation:boolean):boolean{
 return !!answer.trim()&&answer.length<=500&&!/[\p{Script=Arabic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}]/u.test(answer)&&!GENERAL_ENGLISH_OUTPUT.test(answer)
  &&!generalTextIsUnsafe(answer,computerExplanation)&&isGeneralC4(answer);
}
const GENERAL_ENGLISH_OUTPUT=/\b(?:the|and|with|because|without|through|lists?|checks?|checklist|mistakes?|backup|files?|saved|exported?|steps?|tasks?|work|time|goals?|priorities|focus|deadline|workflow|schedule|before|future|systematic(?:ally)?|validation|execution)\b/iu;

/** Local-only public routing: an egress name heuristic is not authority for app facts. */
export function canAnswerGeneralAlexa(text:string):boolean {return typeof text==="string"&&text.trim().length>0&&text.length<=1000&&(isFrenchAlexaCapabilityQuestion(text)||!generalTextIsUnsafe(text));}
export async function inferNativeGeneralAlexa(text:string,signal:AbortSignal):Promise<AlexaGeneralInferenceResult>{
 if(!canAnswerGeneralAlexa(text))return {ok:false,code:"privacy",localFallback:true};
 if(isFrenchAlexaCapabilityQuestion(text))return {ok:true,text:"Je peux vous aider à consulter les dossiers, les consultations, l’agenda, les documents et les paiements. Je peux aussi préparer certains brouillons ; toute action qui modifie ou envoie quelque chose demande votre confirmation.",model:null,localSource:"capability"};
 if(isFrenchMissingInformationPolicyQuestion(text))return {ok:true,text:"Si une information manque, je le signale clairement et je ne remplace pas l’absence par zéro ni par une supposition. Si ce manque empêche une lecture fiable, je précise ce qui reste à vérifier.",model:null,localSource:"missing_information"};
 const reference=findVerifiedPublicFact(text);
 if(reference){
  if(generalTextIsUnsafe(reference.answer,reference.id==="computer"))return {ok:false,code:"invalid-response",localFallback:true};
  return {ok:true,text:reference.answer,model:null,reference:{id:reference.id,label:reference.label,sourceUrl:reference.sourceUrl,...(reference.secondarySourceUrl?{secondarySourceUrl:reference.secondarySourceUrl}:{})}};
 }
 try{
  const computerExplanation=/ordinateur/iu.test(text);
  for(let attempt=0;attempt<2;attempt++){
   const system=attempt===0?ALEXA_GENERAL_PROMPTS.fr:`${ALEXA_GENERAL_PROMPTS.fr} Réponds en une phrase courte, avec des mots français courants. N’utilise aucun terme anglais, aucun caractère d’une autre langue, nom de médicament, nom de patient, mention de dossier, donnée personnelle, agenda ou rendez-vous, et n’affirme pas qu’une action a été exécutée. Si tu ne peux pas répondre ainsi, indique simplement la limite.`;
   const answer=await inferLocalText([{role:"system",content:system},{role:"user",content:text}],{signal,timeoutMs:240000,maxOutputTokens:160});
   if(signal.aborted)return {ok:false,code:"cancelled",localFallback:true};
   if(isValidFrenchGeneralAnswer(answer,computerExplanation))return {ok:true,text:answer.trim(),model:ALEXA_DIRECT_MODEL};
  }
  return {ok:false,code:"invalid-response",localFallback:true};
 }catch{return {ok:false,code:signal.aborted?"cancelled":"unavailable",localFallback:true};}
}

/**
 * Current public question only: no context, history, receipts, tools or writes.
 * `openGeneral` (delivery: unclassified non-patient questions) skips ONLY the
 * closed-topic grammar; every other guard — unsafe-word scan in/out, C4 in/out,
 * length caps — still runs.
 */
export async function inferGeneralAlexa(text: string, options: {
  readonly signal?: AbortSignal; readonly caller?: string; readonly timeoutMs?: number;
  readonly publicAdmission?: PublicQuestionAdmission; readonly openGeneral?: boolean; readonly language?: "fr";
} = {}): Promise<AlexaGeneralInferenceResult> {
  if (options.signal?.aborted) return { ok: false, code: "cancelled", localFallback: true };
  if (typeof text !== "string" || text.length > 1000
    || (options.openGeneral !== true && !isBoundedPublicQuestion(text) && !isIssuedPublicQuestion(options.publicAdmission, text))
    || generalTextIsUnsafe(text) || !isGeneralC4(text))
    return { ok: false, code: "privacy", localFallback: true };
  // Select language only after the entire public question has passed admission.
  const question = text.trim();
  const language = options.language ?? (/^(?:واش|وش|علاش|شحال)(?:\s|$)/u.test(question) ? "darija"
    : /\p{Script=Arabic}/u.test(question) ? "ar" : /^(?:why|what|how|explain)\b/iu.test(question) ? "en" : "fr");
  const prompt = ALEXA_GENERAL_PROMPTS[language];
  const messages: LlmRequest["messages"] = [{ role: "system", content: prompt }, { role: "user", content: text }];
  if (!isGeneralC4(messages)) return { ok: false, code: "privacy", localFallback: true };
  const duration = Math.max(1, Math.min(60000, typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30000));
  const deadline = performance.now() + duration;
  const computerExplanation = /ordinateur|computer|الحاسوب|الكمبيوتر/iu.test(text);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = Math.ceil(deadline - performance.now());
      if (remaining <= 0) return { ok: false, code: "unavailable", localFallback: true };
      // Regenerate only from the admitted public question. Rejected output is
      // neither published nor included in the next request.
      const requestMessages: LlmRequest["messages"] = attempt === 0 ? messages : [
        { role: "system", content: `${prompt} Réponds en une phrase courte et simple, sans nom de personne.` },
        { role: "user", content: text },
      ];
      const answer = await inferLocalText(requestMessages, {
        maxOutputTokens: 1024, timeoutMs: remaining, signal: options.signal,
      });
      if (options.signal?.aborted) return { ok: false, code: "cancelled", localFallback: true };
      if (answer.trim() && answer.length <= 2000 && !generalTextIsUnsafe(answer, computerExplanation) && isGeneralC4(answer))
        return { ok: true, text: answer.trim(), model: ALEXA_DIRECT_MODEL };
    }
    return { ok: false, code: "invalid-response", localFallback: true };
  } catch {
    return { ok: false, code: options.signal?.aborted ? "cancelled" : "unavailable", localFallback: true };
  }
}
