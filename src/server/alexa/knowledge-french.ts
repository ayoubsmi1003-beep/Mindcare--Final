import { copiedEnglishProse, medicationNumericQuoteGrounded, requestedMedicationNames } from "./knowledge-evidence-content";

/**
 * Limits on the model's French reading aid for approved English passages.
 *
 * Rules cannot prove a translation keeps its clinical meaning, and adversarial review showed
 * doses, frequencies and negations can change while looking consistent. So sentences carrying
 * a number, dose, negation, qualifier or risk term are never rendered: they stay verbatim. What
 * passes remains an unverified aid, published after the literal passage and never as evidence.
 */
const fold = (value: string) => value.normalize("NFC").replace(/\s+/gu, " ").trim();
export const numericFold = (value: string) => fold(value.normalize("NFKD").replace(/\p{M}/gu, "")).toLowerCase()
  .replace(/[٠-٩]/gu, digit => String(digit.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/gu, digit => String(digit.charCodeAt(0) - 0x06f0)).replace(/٫/gu, ".")
  .replace(/[−﹣－]/gu, "-").replace(/[⁄∕]/gu, "/").replace(/(?<=\d),(?=\d)/gu, ".");
export const hiddenControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/u;

const numberWords: Readonly<Record<string, string>> = { un: "1", une: "1", deux: "2", trois: "3", quatre: "4", cinq: "5", six: "6", sept: "7", huit: "8", neuf: "9", dix: "10", one: "1", two: "2", three: "3", four: "4", five: "5", seven: "7", eight: "8", nine: "9", ten: "10", واحد: "1", اثنين: "2", ثلاثة: "3", اربعة: "4", خمسة: "5", ستة: "6", سبعة: "7", ثمانية: "8", تسعة: "9", عشرة: "10" };
const units: Readonly<Record<string, string>> = { day: "day", days: "day", jour: "day", jours: "day", يوم: "day", يوما: "day", ايام: "day", week: "week", weeks: "week", semaine: "week", semaines: "week", اسبوع: "week", اسابيع: "week", month: "month", months: "month", mois: "month", شهر: "month", اشهر: "month", year: "year", years: "year", an: "year", ans: "year", annee: "year", annees: "year", سنة: "year", سنوات: "year", hour: "hour", hours: "hour", heure: "hour", heures: "hour", ساعة: "hour", ساعات: "hour", minute: "minute", minutes: "minute", دقيقة: "minute", دقائق: "minute", mg: "mg", milligramme: "mg", milligrammes: "mg", milligram: "mg", milligrams: "mg", g: "g", mcg: "mcg", μg: "mcg", ml: "ml", symptom: "symptom", symptoms: "symptom", symptome: "symptom", symptomes: "symptom", اعراض: "symptom", "%": "%" };

export function explicitNumbers(value: string): string[] {
  const text = numericFold(value), written = text.match(/\p{L}+/gu) ?? [];
  // Indefinite articles establish a quantity only next to a recognized unit.
  return [...text.match(/[+-]?\d+(?:[.,]\d+)?(?:\/\d+)?/gu) ?? [], ...written.flatMap(word => numberWords[word] && !["un", "une", "one"].includes(word) ? [numberWords[word]] : [])];
}
export function quantities(value: string): string[] {
  const expression = new RegExp(`(?<![\\p{L}\\p{N}])([+-]?\\d+(?:[.,]\\d+)?(?:/\\d+)?|${Object.keys(numberWords).join("|")})\\s*(?:(?:des|de|du|of|the|من)\\s+){0,2}(${Object.keys(units).join("|")})(?![\\p{L}\\p{N}])`, "gu");
  return [...numericFold(value).matchAll(expression)].map(match => `${numberWords[match[1]!] ?? match[1]!.replace(",", ".")} ${units[match[2]!]}`);
}

const ENGLISH_QUANTITY = /\p{N}|\b(?:one|once|two|twice|three|thrice|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|half|double|triple|quarter|dozen|several|few|many|most|all|every|daily|weekly|monthly|hourly|first|second|third|percent)\b/iu;
const ENGLISH_NEGATION = /\b(?:not|never|no|none|nor|neither|without|cannot|lack\w*|fail\w*|avoid\w*|contra-?\s?indicat\w*|unlikely|stop\w*|discontinu\w*|withdraw\w*|absent|absence|unless|except)\b|n['’]t\b/iu;
const ENGLISH_QUALIFIER = /\b(?:pregnan\w*|breast\w*|lactat\w*|renal|kidney\w*|hepatic|liver|child\w*|paediatric|pediatric|adolescen\w*|elderly|older|adult\w*|women|men|male|female|only|solely|exclusively|if|when|until|provided|before|after|during|may|might|can|could|possibly|should|must|requires?|required|recommended|usually|generally|often|typically|commonly|rarely|about|approximately|around|roughly|over|under|above|below|up|more|less|increas\w*|rais\w*|higher|elevat\w*|decreas\w*|reduc\w*|lower\w*|diminish\w*)\b/iu;
const ENGLISH_RISK = /\b(?:dos(?:e|es|ing|age)\w*|mg|mcg|mmol|titrat\w*|safe\w*|unsafe|risk\w*|danger\w*|toxic\w*|fatal\w*|death\w*|lethal|suicid\w*|overdos\w*|efficac\w*|effective\w*|ineffective|harm\w*|severe|serious|warning\w*|caution\w*|interact\w*|monitor\w*|maximum|minimum|side|adverse|indicated|first-line|second-line|prescri\w*)\b/iu;
const FRENCH_FORBIDDEN = /\p{N}|\b(?:ne|n|pas|jamais|sans|non|aucun\w*|evit\w*|contre[- ]?indiqu\w*|indiqu\w*|deconseill\w*|arret\w*|grossesse\w*|enceinte\w*|allait\w*|renal\w*|renaux|rein\w*|hepatique\w*|foie|enfant\w*|pediatri\w*|adolescen\w*|age\w*|geriatri\w*|adulte\w*|femme\w*|homme\w*|seulement|uniquement|exclusivement|si|lorsque|lorsqu|quand|sauf|avant|apres|pendant|peu|peut|peuvent|pourr\w*|possible\w*|eventuel\w*|doi\w*|dev\w*|faut|necessit\w*|exig\w*|recommand\w*|conseill\w*|generalement|habituel\w*|souvent|rarement|environ|augment\w*|diminu\w*|reduc\w*|redui\w*|baiss\w*|dose\w*|posolog\w*|sur|sure|dangereu\w*|risque\w*|toxi\w*|mortel\w*|deces|suicid\w*|efficac\w*|inefficac\w*|grave\w*|surveill\w*|interaction\w*|maximum|minimum|maximale?|minimale?|double|moitie)\b/iu;
const FRENCH_WORD = /\b(?:le|la|les|l|du|des|de|un|une|est|sont|dans|chez|selon|avec|pour|en|au|aux)\b/u;
const GENERATED_ADVICE = /\b(?:tu|toi|ton|ta|tes|vous|votre|vos|prescrivez|prenez|arretez|augmentez|diminuez)\b/u;
const LINK = /!?\[[^\]]*\]\(|https?:|www\./iu;
const DRUG_LIKE = /\b\p{L}+(?:azine|apine|idone|piprazole|oxetine|oxamine|pram|azepam|azolam|ipramine|triptyline|faxine|azodone|ulpride|peridol|trigine|bamazepine|valproate|phenidate)\b/giu;
const DRUG_CLASS = /\b(?:antidepressants?|antipsychotics?|anxiolytics?|benzodiazepines?|ssris?|snris?|maois?|tcas?|tricyclics?|mood stabili[sz]ers?|anticonvulsants?|stimulants?)\b/iu;

const drugLikeWords = (text: string) => [...new Set((numericFold(text).match(DRUG_LIKE) ?? []))].sort();
const sameList = (left: readonly string[], right: readonly string[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

/** Only plain descriptive sentences may get a reading aid. */
export function frenchAidEligible(quote: string): boolean {
  return !ENGLISH_QUANTITY.test(quote) && !ENGLISH_NEGATION.test(quote) && !ENGLISH_QUALIFIER.test(quote) && !ENGLISH_RISK.test(quote);
}

export type FrenchVerdict = { ok: true } | { ok: false; reason: "ineligible" | "language" | "medication" | "forbidden" | "length" | "unsafe" };
export function frenchAidAcceptable(quote: string, french: string): FrenchVerdict {
  if (!frenchAidEligible(quote)) return { ok: false, reason: "ineligible" };
  const target = numericFold(french).replace(/['’]/gu, " ");
  if (/<\/?[a-z][^>]*>/iu.test(french) || hiddenControls.test(french) || LINK.test(french) || GENERATED_ADVICE.test(target)) return { ok: false, reason: "unsafe" };
  if (copiedEnglishProse(french) || !FRENCH_WORD.test(target) || numericFold(quote) === target) return { ok: false, reason: "language" };
  if (!sameList(requestedMedicationNames(quote), requestedMedicationNames(french)) || !sameList(drugLikeWords(quote), drugLikeWords(french))) return { ok: false, reason: "medication" };
  if (FRENCH_FORBIDDEN.test(target)) return { ok: false, reason: "forbidden" };
  if (french.length < quote.length * 0.5 || french.length > Math.max(quote.length * 2.5, quote.length + 60)) return { ok: false, reason: "length" };
  return { ok: true };
}

const SUBJECT_VERB = /^\s*([\p{L}-]+)\s+(?:is|are|was|were|can|may|might|should|must|has|have|will)\b/iu;
const GENERIC_SUBJECT = new Set(["it", "this", "these", "they", "dose", "dosage", "treatment", "therapy", "titration", "drug", "medication", "use", "absorption", "metabolism"]);
const MONOGRAPH_LEAF_EXCLUDED = /\b(?:interact\w*|combin\w*|augment\w*|switch\w*|versus|compar\w*)\b/iu;

/**
 * A monograph sentence often leaves the drug to its heading ("Usual dosage range is…" under
 * "Aripiprazole › Dosing"). The heading binds it only when its root is exactly one requested
 * medication, the section isn't about other drugs, and the sentence has no other drug-like subject.
 */
export function medicationBoundBySection(question: string, quote: string, section: string | null): boolean {
  if (!section) return false;
  const requested = requestedMedicationNames(question);
  const parts = section.split(/›|»|\s>\s/u).map(part => numericFold(part));
  const root = parts[0] ?? "";
  if (!requested.some(name => name === root) || parts.slice(1).some(part => MONOGRAPH_LEAF_EXCLUDED.test(part))) return false;
  if (requestedMedicationNames(quote).some(name => name !== root) || DRUG_CLASS.test(quote)) return false;
  if (drugLikeWords(quote).some(word => word !== root)) return false;
  const subject = SUBJECT_VERB.exec(quote)?.[1]?.toLowerCase();
  return subject === undefined || subject === root || GENERIC_SUBJECT.has(subject);
}

/**
 * A number from a drug book needs a recognized medication: the medication lexicon is closed,
 * so "no medication recognized" may mean an unknown drug, not a question without a drug.
 */
export function numericEvidenceAllowed(question: string, quote: string, language: string, section: string | null): boolean {
  if (!explicitNumbers(quote).length && !quantities(quote).length) return true;
  if (!requestedMedicationNames(question).length) return language !== "en";
  return medicationNumericQuoteGrounded(question, quote, language) || medicationBoundBySection(question, quote, section);
}
