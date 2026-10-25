import { resoudreReferenceTemporelle } from "@/shared/jarvis/temporal";
import type {agentSchemas} from './agent';
import type {z} from 'zod';

type AgendaStatus=NonNullable<z.infer<typeof agentSchemas.query_agenda>['statuses']>[number];
const agendaStatuses:readonly AgendaStatus[]=['requested','confirmed','arrived','in_session','completed','no_show','cancelled'];
/** A generic status description is not the name of a patient. Explicit named scopes remain intact. */
export function agendaIdentityText(text:string):string{
 return text.normalize('NFC')
  .replace(/\bavec\s+(?:le|les)\s+noms?\s+et\s+(?:le|les)\s+pr[ée]noms?\s+de\s+chaque\s+patients?\b/giu,'')
  .replace(/\bavec\s+(?:les\s+)?noms?\s+(?:des|de)\s+patients?\b/giu,'')
  .replace(/\bavec\s+(?:(?:un|des)\s+)?patients?\s+arriv[eé]s?(?![\p{L}\p{M}])/giu,'');
}
/** Only human status phrases authorize a native agenda filter. Unknown negations stay unresolved. */
export function nativeAgendaStatusContract(text:string):{complete:boolean;statuses?:AgendaStatus[]}{
 let rest=text.normalize('NFKD').replace(/\p{M}/gu,'').replace(/[’‘]/gu,"'").toLowerCase();
 const positive=new Set<AgendaStatus>(),negative=new Set<AgendaStatus>();
 rest=rest.replace(/\b(?:non honore[es]*|absent[es]*|no[- ]show)\b/gu,()=>{positive.add('no_show');return '';});
 const all=/\btous (?:les )?statuts\b/u.test(rest);rest=rest.replace(/\btous (?:les )?statuts\b/gu,'');
 const phrases:readonly [AgendaStatus,string][]=[['requested',"a confirmer|en attente de confirmation|demande[es]*"],['confirmed','confirme[es]*'],['arrived','arrive[es]*'],['in_session','en consultation|en seance|en cours'],['completed','termine[es]*|acheve[es]*'],['cancelled','annule[es]*']];
 for(const [status,phrase]of phrases){
  rest=rest.replace(new RegExp(`\\b(?:(non|sans|sauf|hors|excluant|excepte|pas)\\s+(?:les?\\s+)?)?(${phrase})\\b`,'gu'),(_match,excluded:unknown)=>{(excluded?negative:positive).add(status);return '';});
 }
 // Unknown status language and mixed/conjunctive state logic require clarification.
 const unresolved=/\b(?:non|pas|sans|sauf|hors|exclu\w*|excepte|ni|valide\w*|rejete\w*|reporte\w*|en attente)\b/u.test(rest)
  ||positive.size>0&&negative.size>0||positive.size>1&&/\bet\b/u.test(rest.replace(/\bentre\b[^.!?]*?\bet\b/u,''));
 if(unresolved)return {complete:false};
 if(all)return {complete:true,statuses:agendaStatuses.filter(s=>!negative.has(s))};
 if(negative.size)return {complete:true,statuses:agendaStatuses.filter(s=>s!=='cancelled'&&!negative.has(s))};
 return {complete:true,...(positive.size?{statuses:agendaStatuses.filter(s=>positive.has(s))}:{})};
}

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
