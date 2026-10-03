/** Closed public-topic grammar, not unrestricted language or patient classification. */
const frenchTopics = "(?:la photosynthese|l'electricite|la gravite|un arc-en-ciel|l'arc-en-ciel|un ordinateur|le processeur|la memoire d'un ordinateur)";
const englishTopics = "(?:photosynthesis|electricity|gravity|a rainbow|a computer|a processor|computer memory)";
const arabicTopics = "(?:قوس قزح|التمثيل الضوئي|البناء الضوئي|الكهرباء|الجاذبية|الحاسوب|الكمبيوتر|المعالج|ذاكرة الحاسوب)";
const digits = "\\d{1,4}(?:[.,]\\d{1,3})?";
const frenchNumber = `(?:${digits}|zero|un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)`;
const englishNumber = `(?:${digits}|zero|one|two|three|four|five|six|seven|eight|nine|ten)`;
const arabicNumber = `(?:${digits}|صفر|واحد|اثنان|اثنين|ثلاثة|اربعة|خمسة|ستة|سبعة|ثمانية|تسعة|عشرة)`;

// Entire-string matching is the admission boundary: no unknown subject or
// appended qualifier can borrow the permission of a public topic prefix.
const publicQuestions: readonly RegExp[] = [
  /^(?:pourquoi le ciel est(?:-il| il)? bleu|pourquoi le ciel doit-il sa couleur au soleil|why is the sky blue|لماذا السماء زرقاء|علاش السماء زرقاء)$/u,
  /^(?:comment se forme un arc-en-ciel|explique(?:-moi)? comment se forme un arc-en-ciel|how does a rainbow form|explain how a rainbow forms|ما هي الوان قوس قزح|كيف يتكون قوس قزح|اشرح كيف يتكون قوس قزح)$/u,
  new RegExp(`^(?:c'est quoi|explique(?:-moi)?) ${frenchTopics}(?: simplement)?$`, "u"),
  new RegExp(`^qu'est-ce (?:que ${frenchTopics}|qu'(?:un ordinateur|un arc-en-ciel))$`, "u"),
  new RegExp(`^(?:comment|explique(?:-moi)? comment) fonctionne ${frenchTopics}$`, "u"),
  new RegExp(`^(?:what is|explain) ${englishTopics}(?: simply)?$`, "u"),
  new RegExp(`^(?:how does ${englishTopics} work|explain how ${englishTopics} works)$`, "u"),
  new RegExp(`^(?:ما هو|ما هي|واش هو|وش هو|اشرح|فسر) ${arabicTopics}$`, "u"),
  new RegExp(`^(?:كيف يعمل|اشرح كيف يعمل) ${arabicTopics}$`, "u"),
  new RegExp(`^(?:combien font|combien fait) ${frenchNumber} (?:plus|moins|fois|divise par|[+*/×÷-]) ${frenchNumber}$`, "u"),
  new RegExp(`^what is ${englishNumber} (?:plus|minus|times|divided by|[+*/×÷-]) ${englishNumber}$`, "u"),
  new RegExp(`^(?:كم يساوي|شحال يساوي) ${arabicNumber} (?:زائد|ناقص|ضرب|في|مقسوم على|[+*/×÷-]) ${arabicNumber}$`, "u"),
];

/** Pure shared routing gate; sensitive-content/C4 checks still run at egress. */
export function isBoundedPublicQuestion(text: string): boolean {
  if (typeof text !== "string" || !text.trim() || text.length > 1000 || /[\r\n]/u.test(text)) return false;
  const normalized = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/’/gu, "'")
    .replace(/[٠-٩]/gu, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\s+/gu, " ").trim().replace(/[?؟.]$/u, "").trim();
  return publicQuestions.some(question => question.test(normalized));
}
