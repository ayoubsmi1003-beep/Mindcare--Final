import { type IntentValide, type NomIntention } from "./intentions";
import { normaliserDemande, normaliserTexteIdentite } from "./normalisation";

const LECTURES: readonly [RegExp, NomIntention][] = [
  [/(?:patient (?:suivant|prochain)|prochain patient|qui (?:vient|est).*(?:apres|suivant|prochain)|المريض (?:التالي|القادم)|شكون.*(?:بعد|patient)|prochain patient)/u, "GET_NEXT_PATIENT"],
  [/(?:patient actuel|المريض الحالي|dossier|informations? (?:du|sur le) patient)/u, "GET_PATIENT_CONTEXT"],
  [/(?:salle d.?attente|راه يستن|في الانتظار)/u, "GET_WAITING_ROOM"],
  [/(?:agenda|rendez.vous.*(?:aujourd|demain|hier)|واش عندي اليوم|برنامج اليوم)/u, "GET_TODAY_AGENDA"],
  [/(?:seance|consultation|notes?|جلسه|آخر جلسه)/u, "GET_CONSULTATION_HISTORY"],
  [/(?:traitement|medicament|يشرب دوا|ادويه|دواء)/u, "GET_CURRENT_MEDICATIONS"],
  [/(?:timeline|chronologie|historique|تاريخ المريض)/u, "GET_PATIENT_TIMELINE"],
  [/(?:recette.*(?:jour|اليوم)|دخلنا اليوم|encaisse.*jour)/u, "GET_DAY_REVENUE"],
  [/(?:impayes|paiements en attente)/u, "GET_OUTSTANDING_PAYMENTS"],
  [/(?:finance|recette|chiffre d.affaires)/u, "GET_PERIOD_REVENUE"],
  [/(?:notifications)/u, "GET_NOTIFICATIONS"],
  [/(?:statut|etat).*systeme/u, "GET_SYSTEM_STATUS"],
  [/(?:documents?)/u, "GET_PATIENT_DOCUMENTS"],
];

/** Descriptive only: no permission, no SQL, no write and no identity choice. */
export function planifierLecturesLocales(texte: string): readonly IntentValide[] | null {
  if (!texte.trim() || texte.length > 2000) return null;
  const raw = normaliserTexteIdentite(texte).replace(/[’]/g, "'");
  if (/\b(?:dsm|taylor|selon|criteres|recommandations|definition)\b/u.test(raw)) return null;
  if (/https?:|ignore|\b(?:annule|prescri|modifi|supprim|cre[eé]|envoi|ajout|marque|paye)\w*|(?:الغ|احذف|بدل|اكتب وصفه)/u.test(raw)) return null;
  const parts = raw.split(/\s+(?:et(?:\s+puis)?|puis|ensuite|و)\s+/u).map((p) => p.replace(/[.!?؟]+$/u, "").trim());
  if (parts.length > 3 || parts.some((p) => p === "")) return null;
  const intents: IntentValide[] = [];
  for (const part of parts) {
    const normalized = normaliserTexteIdentite(normaliserDemande(part).canonique);
    const matches = LECTURES.filter(([re]) => re.test(part) || re.test(normalized));
    // Several data domains in an unsplit clause require clarification, never pick the first.
    const names = [...new Set(matches.map(([, name]) => name))].filter((name) =>
      !(name === "GET_PATIENT_CONTEXT" && matches.length > 1) && !(name === "GET_PERIOD_REVENUE" && matches.some(([, n]) => n === "GET_DAY_REVENUE")));
    if (names.length !== 1) return null;
    const dateMention = part.match(/aujourd'hui|aujourd hui|demain|hier|اليوم|غدوه|غدا|البارح|\d{4}-\d{2}-\d{2}/u)?.[0];
    intents.push({ name: names[0]!, entities: dateMention === undefined ? {} : { dateMention },
      references: { pronomSansAntecedent: /\b(?:son|sa|ses)\b/u.test(part), homonymePossible: false }, confidence: 1, missingInformation: [] });
  }
  return intents;
}

export function poursuitIntention(texte: string): boolean {
  const t = normaliserTexteIdentite(texte).replace(/[.!?؟]+$/u, "");
  return /^(?:(?:et |و )?(?:avant(?: ca)?|apres|la precedente|ensuite|قبل(?: هذا)?)|continue|continuer|كمل)$/u.test(t);
}
