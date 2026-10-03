import { isMedicationName } from "./medications";

const common = new Set([
  "la", "le", "les", "un", "une", "du", "des", "ses", "son", "sa", "ce", "cet", "cette", "mon", "ma", "mes", "notre", "nos",
  "derniere", "dernieres", "dernier", "derniers", "patient", "patiente", "patients", "consultation", "consultations", "seance", "seances",
  "traitement", "traitements", "medicament", "medicaments", "debut", "cas", "dossier", "clinique", "synthetique", "complet", "complete", "medical", "medicale", "psychiatrique", "global", "globale",
  "actuel", "actuelle", "actuels", "precedent", "precedente", "recent", "recente", "cette", "semaine", "mois", "jour", "aujourd'hui", "hier",
  "passe", "passee", "passes", "passees", "ancien", "ancienne", "anciens", "anciennes",
  "avant", "apres", "depuis", "avec", "sans", "et", "pour", "chez", "de", "du", "en", "au", "a", "il", "elle",
  "selon", "dsm", "livre", "livres", "reference", "references",
  "diagnostic", "diagnostics", "note", "notes", "cliniques", "symptome", "symptomes", "anxiete", "depression", "sommeil", "humeur", "dose", "posologie", "frequence",
  "trouble", "troubles", "bipolaire", "bipolaires", "schizophrenie",
  "sur", "concernant", "svp", "s'il", "s’il", "please", "merci", "score", "scores", "echelle", "echelles", "ordonnance", "cours",
  "est", "est-il", "est-elle", "sont", "sont-ils", "sont-elles", "ont", "ont-ils", "ont-elles", "prend", "prend-il", "prend-elle", "indique", "indiquent", "indiquent-elles", "enregistre", "enregistree", "enregistres", "enregistrees", "ete", "fait", "font", "a-t-il", "a-t-elle", "efficace", "efficaces", "ou", "aucun", "aucune", "quel", "quelle", "quels", "quelles", "suivant", "prochain", "suivante", "prochaine", "dit", "disent", "montre", "montrent", "auquel", "auxquels",
  "retenu", "retenue", "retenus", "retenues", "consigne", "consignee", "consignes", "consignees", "renseigne", "renseignee", "renseignes", "renseignees", "rapporte", "rapportee", "rapportes", "rapportees", "mentionne", "mentionnee", "mentionnes", "mentionnees",
  "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche", "janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre",
  "المريض", "للمريض", "المريضة", "للمريضة", "الحالة", "العلاج", "الدواء", "الجلسة", "الجلسات", "الاخيرة", "الأخيرة", "الحالي", "آخر", "اخر", "السابق", "السابقة", "قبل", "بعد", "مع", "و",
  "هذا", "هذه", "حسب", "المراجع", "المصادر", "الكتاب", "الكتب", "الملف", "ملف", "حالة", "الكاملة", "كاملة",
  "او", "أو", "هو", "هي", "واش", "وش", "مسجل", "مسجلة", "التالي", "قال", "تاعو", "تاعها",
  "الاخير", "الاخيرتان", "الاخيرتين", "الاخيرات", "الحالية", "الحاليتان", "الحاليتين", "السابقتين", "السابقتان",
  "المكتملة", "المكتملتان", "المكتملتين", "المكتملات", "الماضي", "الماضية", "الماضيتين", "من", "عن", "على", "في", "يوم", "اليوم",
  "النوم", "القلق", "الاعراض", "اعراض", "الملاحظات", "ملاحظات", "المزاج", "تاع",
]);
const folded = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const scaleNames = new Set(["hamilton", "madrs"]);
function candidateName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const words = value.trim().split(/\s+/u);
  const name: string[] = [];
  for (const word of words) {
    const clean = word.replace(/[?.!،,؟:;]+$/u, "");
    const lexical = folded(clean).replace(/^[ld]['’]/u, "");
    if (!/^[\p{L}][\p{L}\p{M}'’-]{1,}$/u.test(clean) || common.has(lexical)) break;
    name.push(clean);
    if (name.length === 3) break;
  }
  const candidate = name.join(" ");
  return candidate.length >= 2 && candidate.length <= 80 ? candidate : undefined;
}
export type PatientMention = { status: "none" } | { status: "named"; name: string } | { status: "ambiguous" };
/** Names are extracted only locally. Multiple explicit names require a local choice. */
export function parsePatientMention(text: string): PatientMention {
  const names = new Map<string, string>();
  const normalized = folded(text);
  const explicitPatient = /\b(?:patiente?s?|dossier)\b|المريض|المريضة|ملف/u.test(normalized);
  const localFieldPattern = /\b(?:resume|synthese|consultations?|seances?|traitements?|medicaments?|diagnostics?|notes?|dossier|patiente?s?|prend|dose|posologie|frequence|ordonnance|symptomes?|scores?|echelles?|sommeil|humeur|agenda|rdv|rendez[- ]vous|historique)\b|ملخص|لخص|جلس|استشار|العلاج|الدواء|الملاحظات|اعراض|الاعراض/gu;
  const localFieldRead = [...normalized.matchAll(localFieldPattern)].length > 0;
  // A single noun in a general symptom/diagnosis question is a topic.
  // Named single patients remain explicit through patient/dossier or quotes.
  const generalSingleTopic = (name: string | undefined, prefix: string): boolean => {
    if (!name || name.includes(" ") || explicitPatient) return false;
    const context = folded(prefix);
    const lastField = [...context.matchAll(localFieldPattern)].at(-1)?.[0];
    return /^(?:symptomes?|diagnostics?)$/u.test(lastField ?? "")
      && /\b(?:quels?|quelles?|comment|pourquoi|explique(?:-moi)?|decris(?:-moi)?|definis|qu.est.ce|c.est quoi|que sont)\b[\s\S]*\b(?:symptomes?|diagnostics?)\b/u.test(context);
  };
  const nameRanges: Array<readonly [number, number]> = [];
  const add = (name: string | undefined, start?: number) => {
    if (!name) return;
    names.set(folded(name), name);
    if (start === undefined) return;
    const words = [...text.slice(start, start + 100).matchAll(/\S+/gu)].slice(0, name.split(/\s+/u).length);
    const last = words.at(-1);
    if (last) nameRanges.push([start, start + last.index + last[0].length]);
  };
  const quoted = [...text.matchAll(/[«“"]([^»”"]{2,80})[»”"]/gu)];
  for (const match of quoted) {
    add(match[1]?.trim());
    nameRanges.push([match.index, match.index + match[0].length]);
  }
  const medicineQuestion = /dose|posolog|traitement|m[ée]dicament|effets?|contre.?indications?|fonctionne|m[ée]canisme/iu.test(text);
  // Establish direct identities first so an apostrophe inside a surname
  // ("patient Jean D'Angelo") cannot become a second elided introducer.
  const direct = text.matchAll(/(?:\b(?:r[eé]sum[eé]|synth[eè]se|consultations?|s[eé]ances?|traitements?|m[eé]dicaments?|diagnostics?|notes?|dossier|patient|patiente|prend)|ملخص|لخص|(?:ال)?(?:جلسة|جلسات|جلستان|جلستين|استشارة|استشارات|استشارتان|استشارتين))\s+/giu);
  for (const match of direct) {
    const start = match.index + match[0].length;
    const tail = text.slice(start, start + 100);
    if (/^[dl]['’]/iu.test(tail) && !/^patiente?\s/iu.test(match[0])) continue;
    const candidate = candidateName(tail);
    if (generalSingleTopic(candidate, text.slice(0, start))) continue;
    if (candidate && isMedicationName(candidate) && /^(?:traitements?|m[eé]dicaments?)\s/iu.test(match[0])) continue;
    add(candidate, start);
  }
  // Look ahead for candidate words without consuming a later name introducer
  // (e.g. "de Hamilton pour Nadia Test" or "de Nadia pour Karim").
  const matches = text.matchAll(/(?:\b(?:pour|chez|de|du|ta3|t3|dyal)\s+(?:(?:la|le)\s+|l['’]\s*)?|\bd['’]\s*|(?:تاع|للمريض|للمريضة)\s+)(?=([\p{L}][\p{L}\p{M}'’-]{1,}(?:\s+[\p{L}][\p{L}\p{M}'’-]{1,}){0,2})(?![\p{L}\p{M}\p{N}'’-]))/giu);
  for (const match of matches) {
    if (nameRanges.some(([start, end]) => match.index >= start && match.index < end)) continue;
    // French possessive grammar alone does not establish a dossier scope.
    if (/^(?:de|du)\s|^d['’]/u.test(folded(match[0])) && !localFieldRead && !explicitPatient) continue;
    const candidate = candidateName(match[1]);
    if (generalSingleTopic(candidate, text.slice(0, match.index))) continue;
    // In medication questions an unquoted drug is a topic. A separately named
    // patient, "patient Lithium" or a quoted identity still resolves locally.
    if (candidate && medicineQuestion && isMedicationName(candidate)) continue;
    // In "score de Hamilton", Hamilton names the scale. A quoted name or
    // "patient Hamilton" remains an explicit identity reference. Exclude this
    // eponym before counting distinct names, including a named mixed request.
    if (candidate && scaleNames.has(folded(candidate)) && /(?:scores?|[ée]chelles?)\s*$/iu.test(text.slice(0, match.index))) continue;
    if (candidate && /\b(?:livres?|ouvrages?|r[eé]f[eé]rences?)\s*$/iu.test(text.slice(0, match.index))) continue;
    add(candidate, match.index + match[0].length);
  }
  return names.size === 0 ? { status: "none" } : names.size === 1 ? { status: "named", name: [...names.values()][0]! } : { status: "ambiguous" };
}
/** Compatibility helper for callers which only need a unique local name. */
export function patientMention(text: string): string | undefined {
  const mention = parsePatientMention(text);
  return mention.status === "named" ? mention.name : undefined;
}
