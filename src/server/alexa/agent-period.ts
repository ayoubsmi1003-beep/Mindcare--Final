import {resoudreReferenceTemporelle,type ReferenceTemporelle} from '@/shared/jarvis/temporal';
import {aujourdHuiCabinet,bornesDePeriode,ajouterJours} from '@/services/finance-calendrier';
import {hasExplicitClockRestriction} from '@/shared/alexa/request-contract';
import {patientQueryPeriod} from '@/shared/alexa/patient-query-contract';

/** A single intraday interval on a single civil day; no implicit dayparts or rollover. */
export function explicitAgendaClockWindow(text:string,asOf:string):{from:string;to:string;matchedText:string}|null{
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').replace(/[’‘]/gu,"'").toLowerCase();
 const time='(\\d{1,2})(?:\\s*h(?:\\s*(\\d{1,2}))?|:(\\d{2}))';
 const matches=[...plain.matchAll(new RegExp(`\\b(?:entre|de)\\s+${time}\\s*(?:et|a)\\s*${time}(?!\\d)`,'gu'))];
 if(matches.length!==1)return null;
 const match=matches[0]!,rest=plain.slice(0,match.index)+plain.slice(match.index+match[0].length);
 if(hasExplicitClockRestriction(rest))return null;
 const day=patientQueryPeriod(rest,asOf)??explicitAgentPeriod(rest,asOf);
 if(!day||Date.parse(day.to)-Date.parse(day.from)!==86400000)return null;
 const h1=Number(match[1]),m1=Number(match[2]??match[3]??0),h2=Number(match[4]),m2=Number(match[5]??match[6]??0);
 if(h1>23||h2>24||m1>59||m2>59||h2===24&&m2!==0||h2*60+m2<=h1*60+m1)return null;
 const civil=day.from.slice(0,10),clock=(hour:number,minute:number)=>`${civil}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+01:00`;
 return {from:clock(h1,m1),to:h2===24?day.to:clock(h2,m2),matchedText:match[0]};
}

/** Native cabinet questions use the same whole civil weeks/months/years as the app. */
export function resolveAgentPeriod(value:string,asOf:string):ReferenceTemporelle|null{
 const t=value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
 const calendar=/^(?:ce mois(?:-ci)?|mois (?:courant|en cours)|mois|cette semaine|semaine|cette annee|annee)$/u.exec(t);
 if(calendar){const nom=t.includes('mois')?'mois':t.includes('semaine')?'semaine':'annee';const p=bornesDePeriode(nom,aujourdHuiCabinet(new Date(asOf)));return {type:'plage',du:p.du,au:p.au};}
 return resoudreReferenceTemporelle(value,new Date(asOf));
}

/** A single explicit whole civil period only; ranges, comparisons and time windows remain unrestricted. */
export function explicitAgentPeriod(text:string,asOf:string):{period:string;from:string;to:string}|null{
 const plain=text.normalize('NFKD').replace(/\p{M}/gu,'').replace(/[’‘]/gu,"'").toLowerCase();
 const matches=[...plain.matchAll(/\b(?:aujourd'hui|demain|hier|ce mois(?:-ci)?|mois (?:courant|en cours)|cette semaine|cette annee)\b/gu)];
 if(matches.length!==1)return null;
 const match=matches[0]!,rest=plain.slice(0,match.index)+plain.slice(match.index+match[0].length);
 if(/\d|\b(?:a|entre|avant|apres|vers|matin\w*|soir\w*|midi|minuit|heures?|compar\w*|preced\w*|dernier\w*|suivant\w*|prochain\w*|pass\w*|depuis|jusqu\w*|debut|fin|demi|premier\w*|moitie|partie|ici|versus|vs|contre)\b/u.test(rest))return null;
 const period=resolveAgentPeriod(match[0],asOf);if(!period||!['jour','plage'].includes(period.type))return null;
 const first=period.type==='jour'?period.jour:period.type==='plage'?period.du:'',last=period.type==='jour'?period.jour:period.type==='plage'?period.au:'';
 return {period:match[0],from:first+'T00:00:00+01:00',to:ajouterJours(last,1)+'T00:00:00+01:00'};
}
