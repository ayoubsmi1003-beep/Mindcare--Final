import { knowledgeAnswerSchema, knowledgeAnswerJsonSchema } from "@/shared/alexa/knowledge-answer";
import type { AlexaEvent } from "@/shared/alexa/turn";
import type { AlexaLanguage } from "@/shared/alexa/request-plan";
import { dialogue } from "@/i18n/alexa-dialogue";
import { knowledgeSynthesisCopy } from "@/i18n/alexa-knowledge";
import { inferLocalText } from "./local-model";
import { classerCharge } from "@/server/egress/classification";
import { verifierCitations } from "@/server/knowledge/citations";
import { ALEXA_KNOWLEDGE_TRANSFORM, knowledgeMessages, type KnowledgeTask, type KnowledgeFocus } from "./knowledge-envelope";
import { knowledgeResponseEvents, knowledgeSource, type KnowledgeResult } from "./knowledge-response";

const fold = (value: string) => value.normalize("NFC").replace(/\s+/gu, " ").trim();
const numericFold = (value: string) => fold(value.normalize("NFKD").replace(/\p{M}/gu, "")).toLowerCase()
  .replace(/[٠-٩]/gu, digit => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/gu, digit => String(digit.charCodeAt(0) - 0x06f0)).replace(/٫/gu, ".")
  .replace(/[−﹣－]/gu, "-").replace(/[⁄∕]/gu, "/");
const hiddenControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const negation = /\b(?:ne|pas|jamais|sans|non|no|not|never|without)\b|\bn['’]|لا|ليس|دون/u;
const personalClaim = /\b(?:tu|toi|ton|ta|tes|vous|votre|vos|your|you|my|j['’]ai|je suis|i have|i am|prescrivez|prenez|arretez|augmentez|diminuez)\b|أنت|انت\s|لديك|عندك|تناول|انصحك/u;
const performedAction = /\b(?:enregistree?s?|sauvegardee?s?|modifiee?s?|cree[es]*|supprimee?s?|envoyee?s?|executee?s?|prescrit(?:e|s|es)?|validee?s?|confirmee?s?|ajoutee?s?|signee?s?|saved|recorded|updated|prescribed|created|deleted|sent|executed|confirmed|signed)\b|\bmis(?:e|es)? a jour\b|تم\s+(?:حفظ|تسجيل|تعديل|ارسال|حذف|تنفيذ|تاكيد|توقيع)|حفظت|سجلت|عدلت|ارسلت|نفذت/u;
const numberWords: Readonly<Record<string, string>> = { un: "1", une: "1", deux: "2", trois: "3", quatre: "4", cinq: "5", six: "6", sept: "7", huit: "8", neuf: "9", dix: "10", one: "1", two: "2", three: "3", four: "4", five: "5", seven: "7", eight: "8", nine: "9", ten: "10", واحد: "1", اثنين: "2", ثلاثة: "3", اربعة: "4", خمسة: "5", ستة: "6", سبعة: "7", ثمانية: "8", تسعة: "9", عشرة: "10" };
const units: Readonly<Record<string, string>> = { day: "day", days: "day", jour: "day", jours: "day", يوم: "day", يوما: "day", ايام: "day", week: "week", weeks: "week", semaine: "week", semaines: "week", اسبوع: "week", اسابيع: "week", month: "month", months: "month", mois: "month", شهر: "month", اشهر: "month", year: "year", years: "year", an: "year", ans: "year", annee: "year", annees: "year", سنة: "year", سنوات: "year", hour: "hour", hours: "hour", heure: "hour", heures: "hour", ساعة: "hour", ساعات: "hour", minute: "minute", minutes: "minute", دقيقة: "minute", دقائق: "minute", mg: "mg", milligramme: "mg", milligrammes: "mg", milligram: "mg", milligrams: "mg", g: "g", mcg: "mcg", μg: "mcg", ml: "ml", symptom: "symptom", symptoms: "symptom", symptome: "symptom", symptomes: "symptom", اعراض: "symptom", "%": "%" };
function quantities(value: string): string[] {
  const expression = new RegExp(`(?<![\\p{L}\\p{N}])([+-]?\\d+(?:[.,]\\d+)?(?:/\\d+)?|${Object.keys(numberWords).join("|")})\\s*(?:(?:des|de|du|of|the|من)\\s+){0,2}(${Object.keys(units).join("|")})(?![\\p{L}\\p{N}])`, "gu");
  return [...numericFold(value).matchAll(expression)].map(match => `${numberWords[match[1]!] ?? match[1]!.replace(",", ".")} ${units[match[2]!]}`);
}

/** Task labels only are projected. The original question remains local. */
function taskFor(question: string): KnowledgeTask {
  const text = question.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return /criter|criteria|symptomes|symptoms|معايير|اعراض/u.test(text) ? "criteria" : /compar|difference|فرق|قارن/u.test(text) ? "compare"
    : /traitement|treatment|dose|posolog|علاج|جرعة/u.test(text) ? "treatment" : "explain";
}
function focusFor(question: string): KnowledgeFocus {
  const text = numericFold(question);
  return /\bhamilton\b/u.test(text) ? "hamilton" : /\btrouble depressif caracterise\b/u.test(text) ? "major-depressive-disorder"
    : /\bdepression\b|اكتئاب/u.test(text) ? "depressive-disorders" : "retrieved-sections";
}

/** Synthesis cannot call tools. Every emitted paragraph must cite a literal span of this turn's evidence. */
export async function synthesizeKnowledge(result: KnowledgeResult, question: string, language: AlexaLanguage, signal: AbortSignal): Promise<AlexaEvent[]> {
  const locale = language === "fr" ? "fr" : "ar";
  const copy = dialogue(language);
  const message = (text: string): AlexaEvent => ({ type: "sentence", text, kind: "knowledge", sources: [] });
  const fallback = (reason: "provider" | "schema" | "coverage" | "unsafe-text" | "quote" | "unicode-number" | "number" | "quantity" | "citation" | "size" | "parse" = "parse") => {
    console.warn("[alexa-knowledge] source-fallback", reason);
    return [message(knowledgeSynthesisCopy[locale].unavailable), ...knowledgeResponseEvents(result, language)];
  };
  const messages = knowledgeMessages(result, taskFor(question), locale, focusFor(question));
  if (!messages || classerCharge(messages, { transformId: ALEXA_KNOWLEDGE_TRANSFORM }).decision !== "AUTORISER")
    return knowledgeResponseEvents(result, language);
  signal.throwIfAborted();
  try {
    const completion = await inferLocalText(messages, { jsonSchema: knowledgeAnswerJsonSchema,
      timeoutMs: 60000, maxOutputTokens: 1024, signal });
    signal.throwIfAborted();
    const parsed = knowledgeAnswerSchema.safeParse(JSON.parse(completion));
    if (!parsed.success) {
      // Only closed schema fields/codes: never provider text or unknown keys.
      const fields = new Set(["coverage", "sentences", "text", "evidence", "index", "quote"]);
      console.warn("[alexa-knowledge] invalid-schema", parsed.error.issues.slice(0, 5).map(issue => ({
        code: issue.code, path: issue.path.map(part => typeof part === "number" ? "item" : fields.has(String(part)) ? part : "unknown"),
      })));
      return fallback("schema");
    }
    const answer = parsed.data;
    if (answer.coverage === "insufficient") return answer.sentences.length === 0 ? [message(copy.noKnowledge)] : fallback("coverage");
    if (!answer.sentences.length) return fallback("coverage");
    const events: AlexaEvent[] = [message(knowledgeSynthesisCopy[locale].draft)];
    if (answer.coverage === "partial") events.push(message(knowledgeSynthesisCopy[locale].partial));
    for (const sentence of answer.sentences) {
      if (/<\/?[a-z][^>]*>/iu.test(sentence.text) || hiddenControls.test(sentence.text)
        || personalClaim.test(numericFold(sentence.text)) || performedAction.test(numericFold(sentence.text))) return fallback("unsafe-text");
      const used = [...new Set(sentence.evidence.map(evidence => evidence.index))];
      for (const evidence of sentence.evidence) {
        const proof = result.preuves[evidence.index - 1];
        const quote = fold(evidence.quote);
        if (!proof || quote.length < 20 || (quote.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 12
          || hiddenControls.test(evidence.quote) || !fold(proof.extrait).includes(quote)) return fallback("quote");
      }
      const citedText = sentence.evidence.map(evidence => evidence.quote).join(" ");
      const normalizedSentence = numericFold(sentence.text);
      if (/\p{N}|±/u.test(normalizedSentence.replace(/[0-9]/gu, ""))) return fallback("unicode-number");
      const numbers = normalizedSentence.match(/[+-]?\d+(?:[.,]\d+)?(?:\/\d+)?/gu) ?? [];
      const supportedNumbers = new Set<string>(numericFold(citedText).match(/[+-]?\d+(?:[.,]\d+)?(?:\/\d+)?/gu) ?? []);
      for (const quantity of quantities(citedText)) supportedNumbers.add(quantity.split(" ")[0]!);
      if (numbers.some(number => !supportedNumbers.has(number))) return fallback("number");
      const supportedQuantities = new Set(quantities(citedText));
      if (quantities(sentence.text).some(quantity => !supportedQuantities.has(quantity))) return fallback("quantity");
      if (verifierCitations(sentence.text, used.map(index => result.preuves[index - 1]!)).verdict === "rejete") return fallback("citation");
      // Polarity cannot be proved from a matching citation. Preserve the literal
      // source instead of publishing a paraphrased exclusion or its reversal.
      if ((!negation.test(numericFold(citedText)) && !negation.test(normalizedSentence))
        || fold(citedText).includes(fold(sentence.text))) {
        events.push({ type: "sentence", text: sentence.text, kind: "inference", sources: used.map(index => knowledgeSource(result.preuves[index - 1]!)) });
      }
      for (const evidence of sentence.evidence) events.push({ type: "sentence", text: knowledgeSynthesisCopy[locale].quote(evidence.quote),
        kind: "knowledge", sources: [knowledgeSource(result.preuves[evidence.index - 1]!)] });
    }
    if ("omittedLongPassages" in result && result.omittedLongPassages) events.push(message(copy.longKnowledge));
    if (events.reduce((total, event) => total + (event.type === "sentence" ? event.text.length : 0), 0) > 12000) return fallback("size");
    return events;
  } catch {
    signal.throwIfAborted();
    return fallback();
  }
}
