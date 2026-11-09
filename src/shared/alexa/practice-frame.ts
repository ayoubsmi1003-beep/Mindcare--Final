import { unknownNameRuns } from "./patient-question";

/**
 * Everyday questions about the clinic's money and activity ("Combien avons-nous gagné hier ?", "Combien de patients avons-nous
 * reçus ce mois-ci ?", "Quels sont les jours les plus chargés ?"), read by concept and restated as the closed question the
 * finance and statistics gates answer. Only the wording is rewritten: figures, periods and permissions stay in the gates.
 */
const MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
const MONTH_LABEL: Record<string, string> = { fevrier: "février", aout: "août", decembre: "décembre" };
const label = (month: string) => MONTH_LABEL[month] ?? month;

const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’‘ʼ]/gu, "'").replace(/\s+/gu, " ").trim();

const DAY_PERIOD = /\b(aujourd'hui|hier|demain|cette semaine|ma semaine|la semaine(?! (?:derniere|prochaine|passee)))/u;
// "les jours les plus chargés" speaks of busy days; folded, "chargés" looks like the noun "charges".
const withoutBusy = (p: string) => p.replace(/\bplus (?:charges?|occupes?)\b/gu, " ");
const MONTH_NOW = /\b(?:ce mois(?:-ci)?|mois en cours)\b/u;
const MONTH_LAST = /\b(?:le )?mois (?:dernier|precedent|passe)\b/u;
const YEAR_NOW = /\bcette annee\b/u;
const NAMED_MONTH = new RegExp(`\\b(?:en|de|d'|du mois de|au mois de)\\s*(${MONTHS.join("|")})(?:\\s+((?:19|20)\\d{2}))?\\b`, "u");

// "reçu" is money only when no patient or session is the thing received.
const MONEY_VERB = /\b(?:encaiss\w*|gagn\w*|rentre\w*|touche\w*|recettes?|revenus?|chiffre d'affaires|argent|sous)\b/u;
const RECEIVED_MONEY = (p: string) => /\brecu\w*\b/u.test(p) && !/\b(?:patients?|consultations?|seances?|dossiers?)\b/u.test(p);
// "a-t-il" in "le cabinet a-t-il encaissé" is grammar, not a person.
const withoutInversion = (p: string) => p.replace(/\b(?:a|est)-t-(?:il|elle|on)\b/gu, " ").replace(/\b(?:a|est)-(?:il|elle|on)\b/gu, " ");
const EXPENSES = /\b(?:depenses?|charges?)\b/u;
const NET = /\b(?:resultat net|benefice net|benefice)\b/u;
const METHODS = /\b(?:especes?|cash|liquide|carte|cheques?|virements?|mode de paiement|modes de paiement|moyens? de paiement|autres? moyens?|autres? modes?)\b/u;
const COMPARE = /\b(?:compar\w*|par rapport a)\b/u;
const NOT_THE_CLINIC = /\b(?:il|elle|lui|ce patient|cette patiente|ce malade|son|sa|ses|rendez-vous|rdv|agenda)\b/u;

/** The period as the statistics and finance questions read it: "ce mois", "cette semaine", "septembre 2026". */
function period(p: string, asOf: string): { kind: "day" | "week" | "month" | "year" | "named"; phrase: string; month?: string; year?: number } | null {
  const [year, month] = asOf.slice(0, 7).split("-").map(Number) as [number, number];
  const day = DAY_PERIOD.exec(p)?.[1];
  if (day) return /semaine/u.test(day) ? { kind: "week", phrase: "cette semaine" } : { kind: "day", phrase: day };
  if (MONTH_NOW.test(p)) return { kind: "month", phrase: "ce mois", month: MONTHS[month - 1]!, year };
  if (MONTH_LAST.test(p)) { const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }; return { kind: "named", phrase: `${label(MONTHS[previous.month - 1]!)} ${previous.year}`, month: MONTHS[previous.month - 1]!, year: previous.year }; }
  if (YEAR_NOW.test(p)) return { kind: "year", phrase: "cette année", year };
  const named = NAMED_MONTH.exec(p);
  if (named) {
    const index = MONTHS.indexOf(named[1]!) + 1;
    const namedYear = named[2] ? Number(named[2]) : index > month ? year - 1 : year;
    return { kind: "named", phrase: `${label(named[1]!)} ${namedYear}`, month: named[1]!, year: namedYear };
  }
  return null;
}

export type PracticeFrame = { readonly text: string; readonly cashOnlyNotice: boolean };

/** Activity of the practice: sessions, patients seen, new records, busiest days. */
const ACTIVITY = /\b(?:patients?\b[^?]*\b(?:vus?|recus?)|nouveaux (?:patients?|dossiers)|inscri\w*|activite|jours? (?:les )?plus (?:charges?|occupes?)|plus charges?|frequentation|statistiques?|bilan d'activite|combien de patients sont suivis|patients suivis)\b/u;
export function activityQuestionFrame(text: string, asOf: string): string | null {
  const p = fold(text), q = withoutBusy(p);
  if (NOT_THE_CLINIC.test(p) || MONEY_VERB.test(p) || RECEIVED_MONEY(p) || EXPENSES.test(q) || /\bagenda|rendez-vous|rdv\b/u.test(p)) return null;
  if (!ACTIVITY.test(p)) return null;
  // "Patients suivis" and "jours les plus chargés" with no period speak of the current month.
  const found = period(p, asOf) ?? { kind: "month" as const, phrase: "ce mois" };
  if (found.kind === "day") return null;
  const phrase = found.kind === "named" ? found.phrase : found.phrase;
  return `Montre-moi les statistiques de ${phrase}`;
}

/** Money of the practice: collected, expenses, result, payment methods, month against month. */
export function financeQuestionFrame(text: string, asOf: string): PracticeFrame | null {
  const p = withoutBusy(fold(text));
  if (NOT_THE_CLINIC.test(withoutInversion(p))) return null;
  const money = MONEY_VERB.test(p) || RECEIVED_MONEY(p), expenses = EXPENSES.test(p), net = NET.test(p), methods = METHODS.test(p);
  // "Compare ce mois avec le mois dernier" names no subject: money is what a doctor means by it.
  const bareCompare = COMPARE.test(p) && !/\b(?:consultations?|seances?|patients?|activite|rendez-vous)\b/u.test(p);
  if (!money && !expenses && !net && !methods && !bareCompare) return null;
  if (/\b(?:impayes?|reste a encaisser|solde)\b/u.test(p)) return null;
  const rest = p.replace(/\b(?:combien|le|la|les|l|de|du|des|d|cabinet|avons-nous|a-t-il|a-t-on|nous|avons|on|a|ete|payes?|paye|recu|recus|gagne|gagnes|encaisse|encaisses|touche|touches|rentre|rentres|depense|depenses|perçu|percu|en|par|un|une|autre|autres|moyen|moyens|mode|modes|que|qu|especes?|cash|liquide|ce|cette|mois|mois-ci|annee|semaine|hier|aujourd'hui|demain|dernier|precedent|et|avec|compare|comparer|comparaison|rapport|au|aux|quel|quels|quelle|quelles|est|sont|montant|total|depenses?|charges?|recettes?|resultat|net|situation|apercu|donne|donne-moi|dis|dis-moi|argent|sous|chiffre|affaires|financiere?)\b/gu, " ").replace(/\b(?:19|20)\d{2}\b/gu, " ");
  if (unknownNameRuns(rest).length) return null;
  const found = period(p, asOf);
  if (COMPARE.test(p) && !methods) {
    // This month against last month, spelled as two named months of one year.
    const now = period("ce mois", asOf)!, last = period("le mois dernier", asOf)!;
    if (!found || now.year !== last.year) return null;
    const de = (month: string) => (/^[aeiouhéèêàâîïôöûü]/iu.test(label(month)) ? `d’${label(month)}` : `de ${label(month)}`);
    return { text: `Compare les encaissements ${de(last.month!)} et ${de(now.month!)}.`, cashOnlyNotice: false };
  }
  if (!found) return methods ? { text: "Quelles sont les recettes de ce mois ?", cashOnlyNotice: true } : null;
  if (expenses && !money) return found.kind === "day" ? null : { text: `Quelles sont les dépenses du cabinet ${found.kind === "named" ? `de ${found.phrase}` : found.kind === "year" ? "de cette année" : found.phrase === "cette semaine" ? "de cette semaine" : "ce mois-ci"} ?`, cashOnlyNotice: false };
  if (net) return found.kind === "day" ? null : { text: `Quel est le résultat net de ${found.phrase} ?`, cashOnlyNotice: false };
  const asked = found.kind === "day" || found.kind === "week"
    ? `Combien le cabinet a-t-il encaissé ${found.phrase} ?`
    : found.kind === "year" ? "Quel est le chiffre d'affaires de cette année ?"
    : found.kind === "named" ? `Quelles sont les recettes de ${found.phrase} ?` : "Quelles sont les recettes de ce mois ?";
  return { text: asked, cashOnlyNotice: methods };
}
