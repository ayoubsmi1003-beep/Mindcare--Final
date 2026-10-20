import { resoudreReferenceTemporelle } from "@/shared/jarvis/temporal";

const days = /(?<![\p{L}\p{N}])(?:\d{4}-\d{2}-\d{2}|aujourd['’ ]hui|today|demain|tomorrow|hier|yesterday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|اليوم|غدوة|غدوه|غدا|البارح|ghodwa|lyoum|lbareh)(?![\p{L}\p{N}])/gu;
const unsupported = /\b(?:semaine|mois|annee|matin|soir|apres-midi|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b|\p{N}{1,4}\s*[/.-]\s*\p{N}{1,4}|\b(?:du|le)\s+\d{1,2}\b|امس|اسبوع|الشهر|السنة|الصباح|العشية|الليل|مساء|صباح/u;

/** A day reference only; ambiguous or unsupported periods never become today. */
export function agendaSelection(text: string, inheritedDay?: string): { day: string; requestedOnly: boolean } | null {
  const normalized = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const mentions = [...normalized.matchAll(days)].map(match => match[0]);
  const unqualified = normalized.replace(/\b(?:prochain\s+patient|patient\s+suivant)\b|المريض\s+(?:التالي|الجاي)/gu, "");
  if (mentions.length > 1 || unsupported.test(normalized.replace(days, ""))
    || /\b(?:apres[- ]demain|avant[- ]hier|dernier|derniere|precedent|precedente|prochain|prochaine)\b|(?:بعد|قبل)\s+(?:غدوة|غدوه|غدا|اليوم|البارح)|الماضي|القادم|الجاي|الفايت/u.test(unqualified)) return null;
  const explicitToday = /\b(?:du jour|ma journee)\b/u.test(normalized);
  const reference = resoudreReferenceTemporelle(mentions[0] ?? (explicitToday ? "today" : inheritedDay) ?? "today");
  if (reference?.type !== "jour") return null;
  return { day: reference.jour, requestedOnly: /\ba confirmer\b|\ben attente (?:de confirmation|d.approbation)\b|تستنى التاكيد|في انتظار التاكيد/u.test(normalized) };
}

export function isGlobalWhoAgenda(text: string): boolean {
  const normalized = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return /^\s*qui (?:ai[- ]je|est prevu|vient|j.ai)\b/u.test(normalized);
}
