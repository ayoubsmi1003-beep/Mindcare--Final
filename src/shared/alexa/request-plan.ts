import { parsePatientMention } from "./patient-mention";
import { mentionsMedication } from "./medications";
import { isBoundedPublicQuestion } from "./public-question";

export type AlexaIntent = "history" | "current_consultation" | "notes" | "diagnoses" | "scales" | "dialogue" | "general" | "navigation" | "treatments" | "treatment_changes" | "summary" | "preparation" | "longitudinal" | "knowledge" | "agenda" | "receipts" | "proposal" | "clarify";
export type AlexaLanguage = "fr" | "ar" | "mixed";
export type ClinicalFocus = "sleep" | "anxiety" | "mood" | "risk" | "symptoms";
export interface WorkingReference {
  intent: AlexaIntent;
  count: number;
  cursor?: { startedAt: string; id: string };
  /** The start of the selected page; cursor is the start of the NEXT page. */
  selectionBefore?: { startedAt: string; id: string };
  operation?: "compare" | "summarize";
  focus?: ClinicalFocus;
}
export interface RequestPlan extends WorkingReference {
  language: AlexaLanguage;
  before?: { startedAt: string; id: string };
  /** Explicitly requested governed book excerpts, kept separate from patient facts. */
  includeKnowledge?: true;
  dialogueAct?: "hello" | "thanks" | "help" | "presence";
  navigationTarget?: "agenda" | "patients" | "dashboard" | "patient";
}

function requestedCount(text: string): number | null {
  const value = text.replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06f0));
  for (const noun of value.matchAll(/(?<!\p{L})(?:consultations?|seances?|(?:ال)?(?:جلسة|جلسات|جلستان|جلستين|استشارة|استشارات|استشارتان|استشارتين))(?!\p{L})/gu)) {
    // Only the quantity immediately BEFORE a consultation noun is considered.
    // A patient's name or a date after the noun can never become its count.
    const prefix = value.slice(0, noun.index).trim().replace(/(?:dernieres?|derniers?|premieres?|premiers?)\s*$/u, "").trim();
    if (/[-+−]\s*\d{1,4}\s*$|\d+\s*[.,٫⁄/]\s*\d+\s*$/u.test(prefix)) return -1;
    const words = numberKey(prefix).split(" ").filter(Boolean);
    let marker = -1;
    for (let index = 0; index < words.length; index++) {
      if (["les", "des", "آخر", "اخر"].includes(words[index]!)) marker = index;
    }
    const explicit = marker >= 0;
    let quantityWords = explicit ? words.slice(marker + 1) : [];
    if (!explicit) {
      // A bounded run of number words, rather than arbitrary prose, is safe
      // without an explicit determiner (e.g. "vingt-deux consultations").
      for (let i = words.length - 1; i >= 0 && words.length - i <= 7; i--) {
        const word = words[i]!;
        if (!isNumberWord(word) && !/^\d{1,4}$/u.test(word)) break;
        quantityWords.unshift(word);
      }
    }
    if (!quantityWords.length) {
      if (/جلست(?:ان|ين)|استشارت(?:ان|ين)/u.test(noun[0])) return 2;
      continue;
    }
    // "Les notes de la dernière séance" contains a determiner, but no
    // consultation quantity. Clinical prose before a noun is not a number.
    if (explicit && !isNumberWord(quantityWords[0]!) && !/^\d{1,4}$/u.test(quantityWords[0]!)) continue;
    const quantity = quantityWords.join(" ");
    if (/^\d{1,4}$/u.test(quantity)) return Number(quantity);
    const count = frenchCounts.get(quantity) ?? arabicCounts.get(quantity);
    // An explicit unsupported quantity must be clarified, never silently 1.
    return count ?? -1;
  }
  return null;
}

const small = ["zero", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"] as const;
const tens: Readonly<Record<number, string>> = { 20: "vingt", 30: "trente", 40: "quarante", 50: "cinquante", 60: "soixante" };
function frenchNumber(count: number): string {
  if (count <= 16) return small[count]!;
  if (count < 20) return `dix ${small[count - 10]}`;
  if (count < 70) return `${tens[Math.floor(count / 10) * 10]}${count % 10 ? ` ${small[count % 10]}` : ""}`;
  if (count < 80) return `soixante ${frenchNumber(count - 60)}`;
  if (count < 100) return `quatre vingt${count === 80 ? "" : ` ${frenchNumber(count - 80)}`}`;
  return "cent";
}
function numberKey(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/-/g, " ").replace(/\bvingts\b/gu, "vingt").replace(/\bune\b/gu, "un").replace(/\bet\b/gu, "").replace(/\s+/g, " ").trim();
}
const frenchCounts = new Map(Array.from({ length: 101 }, (_, count) => [frenchNumber(count), count] as const));
const arabicUnits = [
  ["صفر"], ["واحد", "واحدة", "أحد", "إحدى"], ["اثنان", "اثنين", "اثنتان", "اثنتين", "اثنا", "اثني", "اثنتا", "اثنتي", "زوج"],
  ["ثلاث", "ثلاثة"], ["أربع", "أربعة"], ["خمس", "خمسة"], ["ست", "ستة"], ["سبع", "سبعة"], ["ثمان", "ثماني", "ثمانية"], ["تسع", "تسعة"], ["عشر", "عشرة"],
] as const;
const arabicTens: Readonly<Record<number, readonly string[]>> = {
  20: ["عشرون", "عشرين"], 30: ["ثلاثون", "ثلاثين"], 40: ["أربعون", "أربعين"], 50: ["خمسون", "خمسين"],
  60: ["ستون", "ستين"], 70: ["سبعون", "سبعين"], 80: ["ثمانون", "ثمانين"], 90: ["تسعون", "تسعين"],
};
const arabicCounts = new Map<string, number>();
arabicUnits.forEach((variants, count) => variants.forEach(value => arabicCounts.set(numberKey(value), count)));
for (let unit = 1; unit < 10; unit++) {
  for (const name of arabicUnits[unit]!) {
    if (name === "زوج") continue;
    for (const ten of arabicUnits[10]) arabicCounts.set(numberKey(`${name} ${ten}`), 10 + unit);
  }
}
for (const [count, variants] of Object.entries(arabicTens)) {
  for (const ten of variants) {
    arabicCounts.set(numberKey(ten), Number(count));
    for (let unit = 1; unit < 10; unit++) {
      for (const name of arabicUnits[unit]!) {
        for (const connector of ["و", "و "]) arabicCounts.set(numberKey(`${name} ${connector}${ten}`), Number(count) + unit);
      }
    }
  }
}
for (const hundred of ["مئة", "مائة", "مية"]) arabicCounts.set(numberKey(hundred), 100);
const numberWords = new Set([...frenchCounts.keys(), ...arabicCounts.keys()].flatMap(value => value.split(" ")).concat(
  ["cents", "mille", "plusieurs", "quelques", "aucune", "toutes", "tous", "مئتان", "مئتين", "مئتا", "مئتي", "مائتان", "مائتين", "مائتا", "مائتي", "ميتين", "ألف", "آلاف", "عدة", "بضع", "كل", "جميع"].map(numberKey),
));
function isNumberWord(word: string): boolean { return numberWords.has(word) || (word.startsWith("و") && numberWords.has(word.slice(1))); }

/** Possessive requests address the working patient, including attached Arabic pronouns. */
export function requestsPatientScope(text: string): boolean {
  const normalized = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return /\b(?:son|ses|sa|ce patient|cette patiente|du patient|de la patiente|prend[-\s]+(?:il|elle))\b|المريض|المريضة|تاعو|تاعها|(?:مواعيد|موعد|اجندت?)(?:ه|ها|هم|هن|و)(?!\p{L})/u.test(normalized);
}
const agendaRequest = /agenda|prochain patient|patient suivant|المريض التالي|مواعيد|موعد|planning|rendez[\s-]?vous|\brdv\b/u;
/** Shared routing predicate; whitespace and Darija cannot change dossier scope. */
export function requestsNextPatient(text: string): boolean {
  const normalized = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return /prochain\s+patient|patient\s+suivant|المريض\s+التالي|المريض\s+الجاي|patient\s+(?:jaya|jay|jاي)/iu.test(normalized)
    || /^\s*qui\s+(?:arrive|vient)\s+(?:ensuite|apres)\s*[?!.]*\s*$/u.test(normalized);
}
// The audited dashboard only supports today. An explicit other period cannot
// be silently replaced by today's appointments, including in a mixed request.
const unsupportedAgendaPeriod = /\b(?:demain|hier|semaine|mois|annee|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b|\p{N}{1,4}\s*[/.-]\s*\p{N}{1,4}|\b(?:du|le)\s+\d{1,2}\b|غدوة|غدا|البارح|امس|أمس|اسبوع|أسبوع|الاسبوع|الأسبوع|الشهر|السنة/u;

/** Only an explicit, global cash read for today uses the daily dashboard gate. */
function requestsDailyReceipts(text: string): boolean {
  if (!/aujourd.hui|du jour|اليوم|نهار اليوم/u.test(text) || !/encaiss|recettes?|دخلنا|قبضنا|مداخيل/u.test(text)) return false;
  if (!/combien|recette|montant|total|دخلنا|قبضنا|مداخيل/u.test(text)) return false;
  // Unknown qualifiers, names, dates and write verbs must be clarified, never
  // silently discarded in favour of the caller's global daily cash total.
  const words = text.replace(/[’'-]/gu, " ").match(/\p{L}+|\p{N}+/gu) ?? [];
  const allowed = new Set(["combien", "ai", "je", "j", "nous", "on", "avons", "a", "t", "quelle", "quel", "est", "la", "le", "les", "du", "d", "jour", "aujourd", "hui", "encaiss", "encaisse", "encaisses", "recette", "recettes", "montant", "total", "شحال", "قداه", "واش", "دخلنا", "قبضنا", "مداخيل", "اليوم", "نهار"]);
  return words.length > 0 && words.every(word => allowed.has(word));
}

/** Closed local routing. Raw user text is never an instruction to a tool. */
function routeRequest(text: string, previous: WorkingReference | null): RequestPlan {
  const normalized = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const arabic = /[\u0600-\u06ff]/u.test(text);
  const language: AlexaLanguage = arabic ? (/[a-z]{3}/iu.test(text) ? "mixed" : "ar") : "fr";
  const patientWording = /\b(?:son|ses|sa|ce patient|cette patiente|dossier|patient|patiente|notes?)\b|تاعو|تاعها|تاع\s|المريض|المريضة|ملف|ملاحظ|[«“"][^»”"]{2,80}[»”"]/u.test(normalized)
    || requestsPatientScope(text) || parsePatientMention(text).status !== "none";
  const clinicalTopic = mentionsMedication(normalized) || /dsm|cim|icd|diagnosti|symptom|traitement|medicament|posolog|therap|psychi|depress|anxi|angoiss|bipol|schizo|suicid|sommeil|insomni|sante|malad|douleur|stress|medecin|soins|fievre|migraine|diabet|cancer|hypertens|vaccin|grossesse|infection|antibio|\b(?:medical|health|illness|disease|fever|pain|doctor|physician|pregnancy)\b|مريض|مرض|تشخيص|اعراض|علاج|دواء|اكتئاب|قلق|انتحار|النوم|ارق|صحة|طبي|حمى|سكري|سرطان|ضغط\s+الدم|حمل|عدوى|لقاح/u.test(normalized);
  const focus = clinicalFocus(normalized);
  const operation = /compar|قارن|مقارن/u.test(normalized) ? "compare" : /resum|synth|لخص|تلخيص|ملخص/u.test(normalized) ? "summarize" : undefined;
  // Writes always retain the existing human confirmation boundary.
  if (/supprim|effac|signer|clotur|fermer|ajout|prescri|modifi(?!cation)|augment|arrete.*trait|(?:prepar|redig|gener).{0,60}brouillon|حذف|امسح|وقع|زيد.*دوز/u.test(normalized)) return { intent: "proposal", count: 1, language };
  if (/(?:n['’]|ne\s+|pas\s+)(?:ouvre|ouvrir|va|aller)|(?:ouvre|ouvrir|va|aller)\b.{0,30}\b(?:pas|jamais)\b|لا\s+(?:تفتح|تروح|افتح)|ما\s+(?:تفتح|تروح)/u.test(normalized)) return { intent: "clarify", count: 1, language };
  // Next-patient scope comes from the audited agenda, never the active dossier.
  // Compound clinical requests remain unsupported and must not reuse it.
  if (requestsNextPatient(normalized)) {
    const clinical = /traitement|medicament|dose|posolog|ordonnance|diagnosti|notes?|resum|synth|seance|consultation|symptom|evolu|علاج|دواء|جرعة|تشخيص|ملاحظ|ملخص|لخص|جلس|استشار|اعراض/u.test(normalized);
    return { intent: clinical ? "clarify" : "agenda", count: 1, language };
  }
  if (/^\s*(?:resume[- ]moi ma journee|aide[- ]moi a preparer ma journee|prepare ma journee|ma journee)\s*[?!.]*\s*$/u.test(normalized)) return { intent: "agenda", count: 1, language };
  if (/^\s*recherch(?:e|er)\s+(?:un|le|des)\s+dossiers?\s*[?!.]*\s*$/u.test(normalized)) return { intent: "navigation", navigationTarget: "patients", count: 1, language };
  if (/^\s*(?:alexa[\s,،:]+)?(?:(?:s['’]il te plait|svp|من فضلك)[\s,،:]+)?(?:(?:peux[ -]tu|tu peux)\s+)?(?:ouvre|ouvrir|va|aller)\b|^\s*(?:alexa[\s,،:]+)?(?:افتح|روح)/u.test(normalized)) {
    const navigationTarget = /agenda|اجندة/u.test(normalized) ? "agenda"
      : /tableau de bord|dashboard|لوحة المتابعة/u.test(normalized) ? "dashboard"
      : /liste (?:des )?patients|قايمة المرضى/u.test(normalized) ? "patients"
      : /dossier|patient|patiente|ملف|المريض|المريضة/u.test(normalized) ? "patient" : undefined;
    if (navigationTarget) return { intent: "navigation", count: 1, language, navigationTarget };
  }
  // Courtesy is a complete turn only when no clinical request follows it.
  const courtesy = normalized.replace(/\balexa\b/gu, "").replace(/[?!؟!.,،:]/gu, "").replace(/\s+/gu, " ").trim();
  if ((/^\s*alexa\s*[?!؟!.,،:]*\s*$/u.test(normalized)) || /^(?:tu es (?:la|prete)|es[ -]tu (?:la|prete)|(?:واش |وش )?راكي? هنا|راك هنا)$/u.test(courtesy)) return { intent: "dialogue", dialogueAct: "presence", count: 1, language };
  if (/^(?:bonjour|salut|bonsoir|hello|السلام عليكم|صباح الخير|مساء الخير|salam(?: alaykoum| aleykoum)?)$/u.test(courtesy)) return { intent: "dialogue", dialogueAct: "hello", count: 1, language };
  if (/^(?:merci(?: beaucoup| بزاف| bien)?|شكرا|شكرا بزاف|يعطيك الصحة|صحا)$/u.test(courtesy)) return { intent: "dialogue", dialogueAct: "thanks", count: 1, language };
  if (/^(?:que peux[ -]tu faire|comment peux[ -]tu m['’]aider|aide|واش تقدري تديري|وش تقدري تديري)$/u.test(courtesy)) return { intent: "dialogue", dialogueAct: "help", count: 1, language };
  if (/^\s*(?:et )?(?:avant|avant elle|قبلها|قبل|زيد|زيد قبل|et avant)\s*[?؟!.]*\s*$/u.test(normalized)) {
    return previous?.intent === "history"
      ? { intent: "history", count: previous.count, language, ...(previous.cursor ? { before: previous.cursor } : {}), ...(previous.operation ? { operation: previous.operation } : {}), ...(previous.focus ? { focus: previous.focus } : {}) }
      : { intent: "clarify", count: 1, language };
  }
  if (previous?.intent === "history" && (/^(?:resum[e]?[- ]les|لخصهم|لخصها)\s*[?؟!.]*$/u.test(normalized.trim())
      || (focus && /^(?:et (?:son|ses|le|la)|و|وال|واش)\s*/u.test(normalized) && normalized.length < 90 && !/consultation|seance|جلس|استشار|depuis|من البداية/u.test(normalized)))) {
    return { intent: "history", count: previous.count, language, ...(previous.selectionBefore ? { before: previous.selectionBefore } : {}), ...(focus ? { focus } : { operation: "summarize" }) };
  }
  if (/dernier|historique|quel|آخر|اخر|واش|وش/u.test(normalized) && /modification|changement|ajustement|تغيير|تبديل/u.test(normalized)
      && (/traitement|medicament|دواء|علاج/u.test(normalized) || previous?.intent === "treatments" || previous?.intent === "treatment_changes")) return { intent: "treatment_changes", count: 1, language };
  if (!patientWording && clinicalTopic && (/difference|symptomes? (?:de|du|des)|diagnostic (?:de|du|des)|comment diagnostiquer|c.est quoi|qu.est.ce|definition|واش الفرق|الفرق بين|اعراض (?:ال|مرض)|علاج (?:ال|مرض)|(?:ما هو|ما هي|واش هو|وش هو)\s+(?:ال)?تشخيص|تشخيص (?:ال|مرض)/u.test(normalized)
      || /traitements? (?:de|du|des|pour) (?:la|le|les|l['’])(?:\s|\p{L})/u.test(normalized))) return { intent: "knowledge", count: 1, language };
  if (!patientWording && /explique|interpret|signifi|اشرح|تفسير/u.test(normalized)
      && /scores?|echelles?|hamilton|phq[ -]?9|gad[ -]?7|ham[ -]?d|madrs|مقياس|مقاييس|هاملتون/u.test(normalized)) return { intent: "knowledge", count: 1, language };
  if (!patientWording && mentionsMedication(normalized)
      && /\bdose\b|posolog|effets?|contre.?indications?|fonctionne|mecanisme|جرعة/u.test(normalized)) return { intent: "knowledge", count: 1, language };
  if (requestsDailyReceipts(normalized)) return { intent: "receipts", count: 1, language };
  if (/traitement|medicament|posolog|ordonnance|\bdose\b|frequence des prises|دواء|دوا|علاج|جرعة|dwa/u.test(normalized)) return { intent: "treatments", count: 1, language };
  if (/prepare|prepar|حضّر|حضر/u.test(normalized)) return { intent: "preparation", count: 5, language };
  if (/consultation|seance|جلس|استشار/u.test(normalized) && /en cours|actuelle|الحالية/u.test(normalized)) return { intent: "current_consultation", count: 1, language, ...(focus ? { focus } : {}) };
  if (/\b(?:scores?|echelles?|phq[ -]?9|gad[ -]?7|ham[ -]?d|madrs)\b|مقاييس|المقاييس/u.test(normalized)) return { intent: "scales", count: 1, language };
  if (/evolu|depuis le debut|longitudin|تطور|من البداية/u.test(normalized)) return { intent: "longitudinal", count: 100, language, ...(focus ? { focus } : {}) };
  if (/seance|consultation|جلس|استشار/u.test(normalized)) {
    const count = requestedCount(normalized) ?? 1;
    return count < 1 || count > 100 || (operation === "compare" && count < 2) ? { intent: "clarify", count: 1, language } : { intent: "history", count, language, ...(operation ? { operation } : {}), ...(focus ? { focus } : {}) };
  }
  if (/resume|resum|synthese|cas|ملخص|لخص/u.test(normalized)) return { intent: "summary", count: 5, language };
  if (/comment va (?:ce patient|cette patiente)|كيف(?:اش)?\s+راه\s+المريض/u.test(normalized)) return { intent: "summary", count: 5, language };
  if (agendaRequest.test(normalized)) return { intent: "agenda", count: 1, language };
  // General questions must never acquire the currently open patient's record.
  if (/diagnosti|تشخيص/u.test(normalized)) return { intent: "diagnoses", count: 1, language };
  if (/\bnotes?\b|symptom|ملاحظ|اعراض/u.test(normalized) || (patientWording && focus)) return { intent: "notes", count: 5, language, ...(focus ? { focus } : {}) };
  if (!patientWording && isBoundedPublicQuestion(text)) return { intent: "general", count: 1, language };
  if (patientWording) return { intent: "clarify", count: 1, language };
  if (clinicalTopic || /definition|explique|qu.est.ce|اشرح|ما هو|ما هي/u.test(normalized) || /\b(?:livres?|ouvrages?|references?|dsm|taylor|maudsley|stahl)\b|الكتب|الكتاب|المراجع|المصادر/u.test(normalized)) return { intent: "knowledge", count: 1, language };
  return { intent: "clarify", count: 1, language };
}

function clinicalFocus(text: string): ClinicalFocus | undefined {
  if (/sommeil|insomni|\bsleep\b|النوم|نوم|ارق/u.test(text)) return "sleep";
  if (/anxie|angoiss|قلق/u.test(text)) return "anxiety";
  if (/humeur|mood|مزاج/u.test(text)) return "mood";
  if (/suicid|auto.?agress|risque|انتحار|خطر/u.test(text)) return "risk";
  if (/symptom|اعراض/u.test(text)) return "symptoms";
  return undefined;
}

/** An explicit book request alone must not read the currently open patient's record. */
export function planRequest(text: string, previous: WorkingReference | null): RequestPlan {
  const plan = routeRequest(text, previous);
  if (plan.intent === "proposal") return plan;
  const normalized = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  if ((agendaRequest.test(normalized) || requestsNextPatient(normalized)) && unsupportedAgendaPeriod.test(normalized)) return { intent: "clarify", count: 1, language: plan.language };
  if (plan.intent === "agenda" || plan.intent === "navigation") return plan;
  const books = /\b(?:dsm|livres?|references?|ouvrages?)\b|المراجع|المصادر|الكتب|الكتاب/u.test(normalized);
  if (!books) return plan;
  const record = /\b(?:ce patient|cette patiente|dossier|du cas|consultations?|seances?|actuel(?:le)?s?|son traitement|ses traitements|son diagnostic|ses symptomes|notes?)\b|هذا المريض|هذه المريضة|الحالي|الحالية|ملف|جلس|استشار|تاعو|تاعها/u.test(normalized)
    || (["history", "current_consultation", "notes", "diagnoses", "scales", "treatments", "treatment_changes", "summary", "preparation", "longitudinal"].includes(plan.intent) && parsePatientMention(text).status !== "none");
  if (!record) return { intent: "knowledge", count: 1, language: plan.language };
  if (["history", "current_consultation", "notes", "diagnoses", "scales", "treatments", "treatment_changes", "summary", "preparation", "longitudinal"].includes(plan.intent)) {
    return { ...plan, includeKnowledge: true };
  }
  return { intent: "summary", count: 5, language: plan.language, includeKnowledge: true };
}
