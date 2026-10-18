import {resoudreReferenceTemporelle,type ReferenceTemporelle} from '@/shared/jarvis/temporal';
import {aujourdHuiCabinet,bornesDePeriode,ajouterJours} from '@/services/finance-calendrier';

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
