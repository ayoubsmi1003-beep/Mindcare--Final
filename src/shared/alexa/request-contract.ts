import {requestedConsultationCount,requestsOldestConsultations} from "./request-plan";
import {parsePatientMention} from "./patient-mention";
import {mentionsMedication} from "./medications";
import type {RequestPart,SupportedCondition} from './agent';
const fold=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').replace(/[’‘]/gu,"'").toLocaleLowerCase();
export function isFrenchAlexaCapabilityQuestion(text:string):boolean{
 const plain=fold(text).replace(/\s+/gu,' ').trim();
 return /^(?:bonjour\s+)?(?:(?:alexa|assistant)[, :]+)?(?:comment\s+(?:(?:peux|pourrais)[- ]tu|tu peux|tu pourrais)\s+(?:m'aider|nous aider)(?:\s+(?:au cabinet|dans mindcare))?|que\s+peux[- ]tu\s+faire(?:\s+pour moi)?|quelles?\s+lectures?\s+(?:(?:peux|pourrais)[- ]tu|tu peux|tu pourrais)\s+(?:effectuer|consulter|lire)(?:\s+dans mindcare)?)\s*[.!?]*$/u.test(plain)||isFrenchClarificationCapabilityQuestion(text);
}
export function isFrenchClarificationCapabilityQuestion(text:string):boolean{
 const plain=fold(text).replace(/\s+/gu,' ').trim();
 return /^(?:(?:alexa|assistant)[, :]+)?(?:(?:peux|pourrais)[- ]tu|tu peux|tu pourrais)\s+(?:me\s+)?demander\s+(?:une\s+)?precision\s+(?:lorsque|si|quand)\s+(?:(?:ma|une|la)\s+)?question\s+(?:est\s+)?ambigue\s*[.!?]*$/u.test(plain);
}
export function isFrenchMissingInformationPolicyQuestion(text:string):boolean{
 const plain=fold(text).replace(/\s+/gu,' ').trim();
 return /^(?:dis[- ]moi(?:\s+en\s+deux\s+phrases)?\s+)?comment\s+tu\s+(?:geres|traites)\s+(?:une\s+)?information\s+(?:absente|manquante)\s*[.!?]*$/u.test(plain);
}
const frenchMonths=['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'] as const;
const frenchDayWords:Record<string,number>={'premier':1,'premiere':1,'un':1,'une':1,'deux':2,'trois':3,'quatre':4,'cinq':5,'six':6,'sept':7,'huit':8,'neuf':9,'dix':10,'onze':11,'douze':12,'treize':13,'quatorze':14,'quinze':15,'seize':16,'dix sept':17,'dix huit':18,'dix neuf':19,'vingt':20,'vingt et un':21,'vingt et une':21,'vingt deux':22,'vingt trois':23,'vingt quatre':24,'vingt cinq':25,'vingt six':26,'vingt sept':27,'vingt huit':28,'vingt neuf':29,'trente':30,'trente et un':31,'trente et une':31};
const frenchDayWordPattern=Object.keys(frenchDayWords).sort((a,b)=>b.length-a.length).map(word=>word.replace(/ /gu,'[- ]+')).join('|');
export function hasExplicitClockRestriction(text:string):boolean{
 return /\b\d{1,2}\s*(?:h(?:\s*\d{1,2})?(?![\p{L}\p{N}])|:\s*\d{2}\b)|\b(?:matin\w*|soir\w*|midi|minuit|heures?|ouverture|fermeture)\b/u.test(fold(text));
}
/** Payment-row state only. Unresolved exclusions cannot become all payment rows. */
export function frenchFinanceRecordState(text:string):'all'|'pending'|'collected'|null{
 const plain=fold(text),pendingPattern=/\b(?:(?:non|pas(?: encore)?)\s+encaisse\w*|en attente|impaye\w*|a encaisser)\b/gu;
 const pending=pendingPattern.test(plain),rest=plain.replace(pendingPattern,'');
 if(/\b(?:non|pas|sans|sauf|hors|exclu\w*|ni)\b/u.test(rest))return null;
 const collected=/\b(?:encaisse\w*|encaissements?)\b/u.test(rest);
 return pending&&collected?'all':pending?'pending':collected?'collected':'all';
}
/** One explicit civil date only; comparisons, open ranges and invalid dates stay unresolved. */
export function explicitFrenchDayRange(text:string,asOf?:string):{from:string;to:string}|null{
 const plain=fold(text);
 if(hasExplicitClockRestriction(text)||/\b(?:depuis|avant|apres|jusqu\w*|entre|a partir)\b/u.test(plain))return null;
 const numeric=[...plain.matchAll(/(?<!\d)(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})(?!\d)/gu)];
 const named=[...plain.matchAll(new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${frenchMonths.join('|')})\\s+((?:19|20)\\d{2})\\b`,'gu'))];
 const instant=asOf===undefined?NaN:Date.parse(asOf);
 const numericWithoutYear=Number.isFinite(instant)?[...plain.matchAll(/(?<!\d)(\d{1,2})\/(\d{1,2})(?![\/\d])/gu)]:[];
 const namedWithoutYear=Number.isFinite(instant)?[...plain.matchAll(new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${frenchMonths.join('|')})(?!\\s+(?:19|20)\\d{2})\\b`,'gu'))]:[];
 const wordsWithoutYear=Number.isFinite(instant)?[...plain.matchAll(new RegExp(`\\b(${frenchDayWordPattern})\\s+(${frenchMonths.join('|')})(?!\\s+(?:19|20)\\d{2})\\b`,'gu'))]:[];
 if(numeric.length+named.length+numericWithoutYear.length+namedWithoutYear.length+wordsWithoutYear.length!==1)return null;
 const numericDate=numeric[0]??numericWithoutYear[0],namedDate=named[0]??namedWithoutYear[0]??wordsWithoutYear[0],match=numericDate??namedDate!;
 const explicitYear=!!numeric[0]||!!named[0],spokenDay=!!namedDate&&wordsWithoutYear.includes(namedDate),day=numericDate?Number(match[1]):spokenDay?frenchDayWords[match[1]!.replace(/-/gu,' ').replace(/\s+/gu,' ')]??0:Number(match[1]),month=numericDate?Number(match[2]):frenchMonths.indexOf(match[2] as typeof frenchMonths[number])+1;
 const year=explicitYear?Number(match[3]):new Date(instant+3_600_000).getUTCFullYear();
 const date=new Date(Date.UTC(year,month-1,day));
 if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
 const from=date.toISOString().slice(0,10)+'T00:00:00+01:00';date.setUTCDate(date.getUTCDate()+1);
 return {from,to:date.toISOString().slice(0,10)+'T00:00:00+01:00'};
}
/** A fully stated closed civil-date range; the spoken end date is inclusive. */
export function explicitFrenchDateRange(text:string,asOf?:string):{from:string;to:string}|null{
 const plain=fold(text),named=new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${frenchMonths.join('|')})\\s+((?:19|20)\\d{2})\\b`,'gu');
 const matches:[number,number,number,number,string][]=[];
 for(const match of plain.matchAll(/(?<!\d)(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})(?!\d)/gu))matches.push([match.index,match[0].length,Number(match[1]),Number(match[2]),match[3]!]);
 for(const match of plain.matchAll(named))matches.push([match.index,match[0].length,Number(match[1]),frenchMonths.findIndex(month=>month===match[2])+1,match[3]!]);
 matches.sort((a,b)=>a[0]-b[0]);
 const years=[...plain.matchAll(/\b((?:19|20)\d{2})\b/gu)];
 if(matches.length===2&&years.length===2){
  const first=matches[0]!,second=matches[1]!,prefix=plain.slice(0,first[0]),between=plain.slice(first[0]+first[1],second[0]);
  if(!/\b(?:du|entre)\s+(?:le\s+)?$/u.test(prefix)||!/^\s+(?:au|et)\s+(?:le\s+)?$/u.test(between))return null;
  const [startDay,startMonth,startYear,endDay,endMonth,endYear]=[first[2],first[3],Number(first[4]),second[2],second[3],Number(second[4])];
  const start=new Date(Date.UTC(startYear,startMonth-1,startDay)),end=new Date(Date.UTC(endYear,endMonth-1,endDay));
  if(start.getUTCFullYear()!==startYear||start.getUTCMonth()!==startMonth-1||start.getUTCDate()!==startDay||end.getUTCFullYear()!==endYear||end.getUTCMonth()!==endMonth-1||end.getUTCDate()!==endDay||start>end)return null;
  const from=start.toISOString().slice(0,10)+'T00:00:00+01:00';end.setUTCDate(end.getUTCDate()+1);
  return {from,to:end.toISOString().slice(0,10)+'T00:00:00+01:00'};
 }
 if(years.length>1)return null;
 const instant=asOf===undefined?NaN:Date.parse(asOf);
 if(!years.length&&!Number.isFinite(instant))return null;
 const day=`(?:\\d{1,2}(?:er)?|${frenchDayWordPattern})`,month=`(?:${frenchMonths.join('|')})`,year=`(?:19|20)\\d{2}`;
 const namedRanges=[...plain.matchAll(new RegExp(`\\b(?:du|entre)\\s+(?:le\\s+)?(${day})\\s+(${month})\\s+(?:au|et)\\s+(?:le\\s+)?(${day})\\s+(${month})(?:\\s+(${year}))?\\b`,'gu'))];
 const sharedMonthRanges=[...plain.matchAll(new RegExp(`\\b(?:du|entre)\\s+(?:le\\s+)?(${day})\\s+(?:au|et)\\s+(?:le\\s+)?(${day})\\s+(${month})(?:\\s+(${year}))?\\b`,'gu'))];
 const numericRanges=[...plain.matchAll(new RegExp(`\\b(?:du|entre)\\s+(?:le\\s+)?(\\d{1,2})/(\\d{1,2})\\s+(?:au|et)\\s+(?:le\\s+)?(\\d{1,2})/(\\d{1,2})(?:\\s+(${year}))?\\b`,'gu'))];
 if(namedRanges.length+sharedMonthRanges.length+numericRanges.length!==1)return null;
 const dayValue=(value:string)=>/^\d/u.test(value)?Number.parseInt(value,10):frenchDayWords[value.replace(/-/gu,' ').replace(/\s+/gu,' ')]??0;
 let startDay:number,endDay:number,startMonth:number,endMonth:number,rangeYear:number;
 const namedRange=namedRanges[0],sharedMonth=sharedMonthRanges[0],numericRange=numericRanges[0];
 if(namedRange){startDay=dayValue(namedRange[1]!);endDay=dayValue(namedRange[3]!);startMonth=frenchMonths.indexOf(namedRange[2]! as typeof frenchMonths[number])+1;endMonth=frenchMonths.indexOf(namedRange[4]! as typeof frenchMonths[number])+1;rangeYear=Number(namedRange[5]??years[0]?.[1]??new Date(instant+3_600_000).getUTCFullYear());}
 else if(sharedMonth){startDay=dayValue(sharedMonth[1]!);endDay=dayValue(sharedMonth[2]!);startMonth=frenchMonths.indexOf(sharedMonth[3]! as typeof frenchMonths[number])+1;endMonth=startMonth;rangeYear=Number(sharedMonth[4]??years[0]?.[1]??new Date(instant+3_600_000).getUTCFullYear());}
 else{startDay=Number(numericRange![1]);startMonth=Number(numericRange![2]);endDay=Number(numericRange![3]);endMonth=Number(numericRange![4]);rangeYear=Number(numericRange![5]??years[0]?.[1]??new Date(instant+3_600_000).getUTCFullYear());}
 if(startMonth>endMonth)return null;
 const start=new Date(Date.UTC(rangeYear,startMonth-1,startDay)),end=new Date(Date.UTC(rangeYear,endMonth-1,endDay));
 if(start.getUTCFullYear()!==rangeYear||start.getUTCMonth()!==startMonth-1||start.getUTCDate()!==startDay||end.getUTCFullYear()!==rangeYear||end.getUTCMonth()!==endMonth-1||end.getUTCDate()!==endDay||start>end)return null;
 const from=start.toISOString().slice(0,10)+'T00:00:00+01:00';end.setUTCDate(end.getUTCDate()+1);
 return {from,to:end.toISOString().slice(0,10)+'T00:00:00+01:00'};
}
/** Closed full-month ranges only; missing years and cross-year ambiguity stay on the model path. */
export function explicitFrenchMonthRange(text:string):{from:string;to:string}|null{
 const plain=fold(text),month=frenchMonths.join('|'),pattern=new RegExp(`(?:\\bentre\\s+|\\bde\\s+|d')(${month})\\s+(?:a|et|jusqu(?:a|au)?)\\s+(${month})\\s+((?:19|20)\\d{2})\\b`,'gu');
 const matches=[...plain.matchAll(pattern)];
 if(matches.length!==1||[...plain.matchAll(/\b(?:19|20)\d{2}\b/gu)].length!==1)return null;
 const match=matches[0]!,start=frenchMonths.indexOf(match[1] as typeof frenchMonths[number]),end=frenchMonths.indexOf(match[2] as typeof frenchMonths[number]),year=Number(match[3]);
 if(start<0||end<start)return null;
 const from=`${year}-${String(start+1).padStart(2,'0')}-01T00:00:00+01:00`,nextMonth=end===11?{year:year+1,month:1}:{year,month:end+2};
 return {from,to:`${nextMonth.year}-${String(nextMonth.month).padStart(2,'0')}-01T00:00:00+01:00`};
}
/** A single named clinical month means its latest occurrence, unless a year is explicit. */
export function explicitFrenchSingleMonthRange(text:string,asOf?:string):{from:string;to:string}|null{
 const plain=fold(text),matches=[...plain.matchAll(new RegExp(`\\b(${frenchMonths.join('|')})\\b`,'gu'))];
 if(matches.length!==1||/\b(?:depuis|avant|apres|jusqu\w*|a partir|entre|compar\w*|versus)\b/u.test(plain))return null;
 const years=[...plain.matchAll(/\b((?:19|20)\d{2})\b/gu)];if(years.length>1)return null;
 const month=frenchMonths.indexOf(matches[0]![1] as typeof frenchMonths[number])+1;
 let year:number;
 if(years.length===1)year=Number(years[0]![1]);
 else{
  if(!asOf||!Number.isFinite(Date.parse(asOf)))return null;
  const cabinetDate=new Date(Date.parse(asOf)+3_600_000),currentMonth=cabinetDate.getUTCMonth()+1;
  year=cabinetDate.getUTCFullYear()-(month>currentMonth?1:0);
 }
 const next=month===12?{year:year+1,month:1}:{year,month:month+1};
 return {from:`${year}-${String(month).padStart(2,'0')}-01T00:00:00+01:00`,to:`${next.year}-${String(next.month).padStart(2,'0')}-01T00:00:00+01:00`};
}
/** Two named consultation months in a comparison stay separate half-open periods. */
export function explicitFrenchComparedMonthRanges(text:string,asOf?:string):{month:typeof frenchMonths[number];year:number;from:string;to:string}[]|null{
 const plain=fold(text);
 if(!/\bcompar\w*\b/u.test(plain)||! /\bconsult\w*\b/u.test(plain))return null;
 const matches=[...plain.matchAll(new RegExp(`\\b(${frenchMonths.join('|')})\\b`,'gu'))];
 if(matches.length!==2||matches[0]![1]===matches[1]![1])return null;
 const years=[...plain.matchAll(/\b((?:19|20)\d{2})\b/gu)];if(years.length>1)return null;
 if(years.length===0&&(!asOf||!Number.isFinite(Date.parse(asOf))))return null;
 const asOfDate=years.length===0?new Date(Date.parse(asOf!)+3_600_000):null,currentMonth=asOfDate?asOfDate.getUTCMonth()+1:0,currentYear=asOfDate?.getUTCFullYear()??0;
 return matches.map(match=>{
  const month=match[1] as typeof frenchMonths[number],monthNumber=frenchMonths.indexOf(month)+1,year=years.length===1?Number(years[0]![1]):currentYear-(monthNumber>currentMonth?1:0),next=monthNumber===12?{year:year+1,month:1}:{year,month:monthNumber+1};
  return {month,year,from:`${year}-${String(monthNumber).padStart(2,'0')}-01T00:00:00+01:00`,to:`${next.year}-${String(next.month).padStart(2,'0')}-01T00:00:00+01:00`};
 });
}
export interface FrenchCountContract {clauses:readonly string[];}
function closedMetricFragment(text:string,field?:SupportedCondition['field']):boolean{
 const header='compte comptes comptez combien nombre total effectif patients patient dossiers dossier patientele actif actifs active actives tous toutes tout toute la le les de du des sont est';
 const prefix='puis separement les le la de du des actifs active actives sont combien n ont pas sans eu et ceux celles';
 const words=field==='identity_card'?prefix+' numero numeros d identite carte cartes piece pieces nationale nationales national':field==='phone'?prefix+' telephone telephones':field==='age'?prefix+' moins dix huit 18 ans enfant enfants mineur mineurs':field==='no_completed_months'?prefix+' aucune aucun consultation consultations terminee terminees termine termines close closes dans six 6 dernier derniers mois depuis':header;
 const allowed=new Set(words.split(' '));
 return (fold(text).match(/[\p{L}\p{N}]+/gu)??[]).every(word=>allowed.has(word));
}
function separateMetricClauses(text:string):readonly string[]|null|undefined{
 const plain=fold(text);
 if(!/\b(?:separement|chaque nombre)\b/u.test(plain))return undefined;
 if(! /\b(?:patients?|patientele)\b/u.test(plain)||/\b(?:agenda|rendez[- ]vous|finance|prepar\w*|modifi\w*|ouvre|lis)\b/u.test(plain))return null;
 const fragments=text.split(/[.,?;]|\bet\s+(?=(?:les|des|ces)\s+actifs?\b|ce(?:ux|lles)\s+sans\b|n['’]ont\b|ont\s+moins)/iu).map(s=>s.trim()).filter(Boolean);
 const clauses:string[]=[];const seen=new Set<string>();
 for(const fragment of fragments){
  const p=fold(fragment),conditions=explicitConditions(fragment)??[];
  if(!conditions.length&&/^parmi (?:les|ces) actifs$|^donne chaque nombre separement$|^separement$/u.test(p))continue;
  if(!clauses.length&&!conditions.length&&/\b(?:actifs?|actives?)\b/u.test(p)&&/\b(?:patients?|patientele)\b/u.test(p)&&closedMetricFragment(fragment)){clauses.push(fragment);continue;}
  if(conditions.length!==1)return null;
  const c=conditions[0]!,metric=key(c);
  if((c.field==='age'&&/\bpas\b/u.test(p))||/\bpas\s+(?:sans|aucun\w*)\b/u.test(p))return null;
  if(!['["identity_card","missing",null]','["phone","missing",null]','["age","lt",18]','["no_completed_months","eq",6]'].includes(metric)||seen.has(metric)||!closedMetricFragment(fragment,c.field))return null;
  seen.add(metric);clauses.push(fragment);
 }
 const identityAndPhone=clauses.length===2&&seen.size===2&&seen.has('["identity_card","missing",null]')&&seen.has('["phone","missing",null]');
 return identityAndPhone||clauses.length===4&&seen.size===3?clauses:null;
}
/** An output constraint only: it never chooses a gate, queries records or invents an answer. */
export function frenchPatientCountContract(text:string):FrenchCountContract|null {
 const enumerated=enumeratedPatientMetricClauses(text);if(enumerated!==undefined)return enumerated?{clauses:enumerated}:null;
 const separate=separateMetricClauses(text);if(separate!==undefined)return separate?{clauses:separate}:null;
 const plain=fold(text),combien=[...text.matchAll(/\bcombien\b/giu)],starts=(combien.length?combien:[...text.matchAll(/\b(?:nombre(?:\s+total)?|total|effectif|d[ée]compte|taille(?=\s+de\s+la\s+patient[èe]le)|compte(?:r|z)?(?=\s+(?:tous|toutes|les?|des?|patients?|dossiers?|fiches?)))/giu)]).map(m=>m.index);
 const presentation=[...plain.matchAll(/\b(?:donne|affiche|montre)\w*/gu)],singleLeadingPresentation=presentation.length===1&&presentation[0]!.index===0&&presentation[0]!.index<starts[0]!;
 if(!starts.length||! /\b(?:patients?|dossiers?|fiches?|patientele)\b/u.test(plain)||/\b(?:lis|lire|expliqu\w*|resum\w*|detaill\w*|compar\w*|list\w*|lesquels|lesquelles|prepar\w*|cre[er]\w*|modifi\w*|annul\w*|ouvre\w*)\b|\b(?:leurs?|les)\s+noms?\b/u.test(plain)||(presentation.length>0&&!singleLeadingPresentation))return null;
 const identityDocumentField=/\b(?:numero\s+(?:de\s+)?|piece\s+|carte\s+|document\s+)d[' ]?identite\b|\bcarte nationale\b|\bcni\b/u.test(plain);
 const savedDocumentIntent=/\bdocuments?\b/u.test(plain)&&!identityDocumentField;
 if(/\b(?:et|puis|aussi)\s+(?:quels?|quelles?|qui|comment|pourquoi|est-ce)\b|\b(?:rendez-vous|agenda|recettes?|revenus?|charges?)\b|(?:combien|compte(?:r|z)?|nombre(?:\s+total)?|total)\s+(?:(?:de|du|des|ses|les|toutes|tous)\s+)*consult\w*\b/u.test(plain)||savedDocumentIntent)return null;
 // A single interrogative with comma-separated categories may mean several outputs.
 // Leave that ambiguous form to native interpretation instead of forcing one output.
 const explicitCombinedPopulationCount=/^\s*combien de patients? au total,\s*actifs?\s+et\s+archives?\s*[?!.]*\s*$/u.test(fold(text));
 if(starts.length===1&&text.slice(starts[0]).includes(',')&&!explicitCombinedPopulationCount&&!/^[^,]+,\s*(?:sans inclure|en excluant|hors)\b[^,]*$/iu.test(text.slice(starts[0])))return null;
 const clauses=starts.length===1?[text.trim()]:starts.map((at,i)=>text.slice(at,starts[i+1]??text.length).replace(/[,;\s]+(?:et\s*)?$/iu,'').trim());
 return clauses.length<=12?{clauses}:null;
}
/** Recognize a closed list of patient metrics following one explicit count verb. */
function enumeratedPatientMetricClauses(text:string):readonly string[]|undefined{
 const prefix=text.match(/^\s*(?:pour\s+le\s+cabinet\s*,\s*)?(?:compte(?:r|z)?|d[ée]nombre(?:r|z)?|calcule(?:r|z)?|donne(?:r|z)?\s+(?:le|les)?|donne(?:r|z)?\s+(?:quatre\s+)?chiffres?\s*:\s*|indique(?:r|z)?\s+(?:s[ée]par[ée]ment\s+)?le\s+nombre\s+d[’']|fais\s+(?:un\s+)?bilan\s+en\s+quatre\s+points?\s*:\s*|quels?\s+sont\s+les\s+quatre\s+nombres?\s+correspondants?\s+aux?|je\s+veux\s+(?:le\s+)?total\s+(?:de|des))(?:\s+|(?=actifs?\b))/iu);
 if(!prefix)return undefined;
 const tail=text.slice(prefix[0].length).replace(/(?:[,;]\s*|\s+)(?:s[ée]par[ée]ment|distinctement)\s*[?!.]*$/iu,''),clauses=tail.split(/[,;]|\b(?:et|puis)\b/iu).map(clause=>clause.trim().replace(/^[,;\s]+|[,;\s?.!]+$/gu,'')).filter(Boolean);
 if(clauses.length<2||clauses.length>7)return undefined;
 if(/\b(?:agenda|rendez[- ]?vous|rdv|recettes?|revenus?|charges?|documents?|emails?|courriels?)\b/u.test(fold(tail)))return undefined;
 const metricFor=(clause:string):string|null=>{
  const plain=fold(clause),conditions=explicitConditions(clause)??[];
  if(!conditions.length&&(/\b(?:patients?|dossiers?)\s+actifs?\b|\beffectif\s+actif\b|^actifs?$\b/u.test(plain))&&! /\b(?:sans|aucun\w*|pas|manquant\w*)\b/u.test(plain))return closedMetricFragment(clause)?'active':null;
  if(conditions.length!==1)return null;
  const condition=conditions[0]!;
  if(condition.field==='identity_card'&&condition.op==='missing')return 'missing_identity_card';
  if(condition.field==='phone'&&condition.op==='missing')return 'missing_phone';
  if(condition.field==='age'&&condition.op==='lt'&&condition.value===18)return 'children';
  if(condition.field==='birth_date'&&condition.op==='missing')return 'unknown_age';
  if(condition.field==='no_completed_months'&&condition.op==='eq'&&condition.value===6)return 'not_seen_6m';
  if(condition.field==='completed_consultations'&&condition.op==='eq'&&condition.value===0)return 'never_seen';
  return null;
 };
 const metrics=clauses.map(metricFor);
 if(metrics.some(metric=>!metric)||new Set(metrics).size!==metrics.length||! /\b(?:patients?|dossiers?)\b/u.test(fold(tail)))return undefined;
 return clauses;
}
const key=(c:SupportedCondition)=>JSON.stringify([c.field,c.op,c.value]);
const mentions:Record<SupportedCondition['field'],RegExp>={phone:/\b(?:telephones?|portables?|mobiles?)\b/u,identity_card:/\b(?:identite|identification nationale|cni|carte nationale|carte d[' ]?identite|piece d[' ]?identite|document d[' ]?identite|numero national)\b/u,birth_date:/\b(?:naissance|age)\b/u,sex:/\bsexe\b/u,age:/\b(?:age|ages?|ans?|anniversaires?|adultes?|majeurs?|enfants?|mineurs?)\b/u,completed_consultations:/\b(?:consult\w*|seances?|vus?|recus?|visites?|suivis?)\b/u,outstanding_balance:/\b(?:soldes?|impayes?|dettes?|encaisse\w*|paiements?)\b/u,no_completed_days:/\b(?:consult\w*|seances?|assiste\w*|vus?|recus?|visites?|suivis?)\b/u,no_completed_months:/\b(?:consult\w*|seances?|assiste\w*|vus?|recus?|visites?|suivis?)\b/u,administrative_incomplete:/\b(?:administrati\w*|dossiers?)\b/u};
export const patientConditionMentions=mentions;
/** Predicate admission is independent of a model-generated goal or cited database value. */
export function patientConditionsGrounded(conditions:readonly SupportedCondition[],text:string):boolean {
  const plain=fold(text),missing=/\bsans\b|\baucun\w*\b|\bpas\b|\bmanquant\w*\b|\bmanque\w*\b|\bnuls?\b|\babsences?\b|\babsent\w*\b|\binconnu\w*\b|\bnon\s+(?:renseigne\w*|enregistre\w*)\b|\bvides?\b/u.test(plain);
 const groups=/\bou\b/u.test(plain)?explicitPatientCountFilterGroups(text):null;
 if(/\bou\b/u.test(plain)){
  if(!groups)return false;
  const expected=groups.flat().map(key).sort(),actual=conditions.map(key).sort();if(expected.length!==actual.length||expected.some((value,index)=>value!==actual[index]))return false;
 }
 const numeric=['age','completed_consultations','outstanding_balance'] as const;
 for(const group of groups??[conditions])for(const field of numeric){let min=Number.NEGATIVE_INFINITY,max=Number.POSITIVE_INFINITY;for(const c of group.filter(item=>item.field===field&&typeof item.value==='number')){const n=c.value as number;if(c.op==='gte')min=Math.max(min,n);if(c.op==='gt')min=Math.max(min,n+1);if(c.op==='lt')max=Math.min(max,n-1);if(c.op==='eq'){min=Math.max(min,n);max=Math.min(max,n);}}if(min>max)return false;}
 const explicit=explicitConditions(text)??[];
 return conditions.every(condition=>{
  if(!mentions[condition.field].test(plain)||(condition.op==='missing'&&!missing))return false;
  const matching=explicit.filter(c=>c.field===condition.field);if(matching.length)return matching.some(c=>key(c)===key(condition));
  return true;
 });
}
/** Conservative checks for the explicit count vocabulary already in the capability contract. */
function explicitConditions(text:string):SupportedCondition[]|null {
 const numbers:Record<string,string>={zero:'0',un:'1',une:'1',deux:'2',trois:'3',quatre:'4',cinq:'5',six:'6',sept:'7',huit:'8',neuf:'9',dix:'10',onze:'11',douze:'12',treize:'13',quatorze:'14',quinze:'15',seize:'16','dix-sept':'17','dix-huit':'18','dix-huitieme':'18','dix-neuf':'19',vingt:'20'};
 const value=fold(text).replace(/\b(?:dix[- ]huitieme|dix[- ](?:sept|huit|neuf)|zero|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt)\b/gu,word=>numbers[word.replace(/ /gu,'-')]!),conditions:SupportedCondition[]=[],missing=/\bsans\b|\baucun\w*\b|\bpas\b|\bmanquant\w*\b|\bmanque\w*\b|\bnuls?\b|\babsences?\b|\babsent\w*\b|\bnon\s+(?:renseigne\w*|enregistre\w*)\b|\bvides?\b/u.test(value),documented=!missing&&/\b(?:avec|ayant|dont|qui\s+(?:a|ont)|possed\w*|dispos\w*)\b/u.test(value)&&/\b(?:renseigne\w*|enregistre\w*|presen\w*|indique\w*)\b/u.test(value);
 const add=(field:SupportedCondition['field'],op:SupportedCondition['op'],n:SupportedCondition['value'])=>{const condition={field,op,value:n};if(!conditions.some(existing=>key(existing)===key(condition)))conditions.push(condition);};
 if(missing&&/\b(?:identite|identification nationale|cni|carte nationale|carte d[' ]?identite|piece d[' ]?identite|document d[' ]?identite|numero national)\b/u.test(value))add('identity_card','missing',null);
 if(documented&&/\b(?:identite|identification nationale|cni|carte nationale|carte d[' ]?identite|piece d[' ]?identite|document d[' ]?identite|numero national)\b/u.test(value))add('identity_card','present',null);
 if(missing&&/\btelephones?\b/u.test(value))add('phone','missing',null);
 if(documented&&/\btelephones?\b/u.test(value))add('phone','present',null);
 if((missing&&/\bnaissance\b/u.test(value))||/\bage\s+(?:est\s+)?(?:inconnu|non renseigne|manquant)/u.test(value))add('birth_date','missing',null);
 if(documented&&/\bnaissance\b/u.test(value))add('birth_date','present',null);
 if(missing&&/\bsexe\b/u.test(value))add('sex','missing',null);
 if(documented&&/\bsexe\b/u.test(value))add('sex','present',null);
 if(!missing&&/\bsexe\s+feminin\b/u.test(value))add('sex','eq','F');
 if(!missing&&/\bsexe\s+masculin\b/u.test(value))add('sex','eq','M');
 if(/\b(?:enfants?|mineurs?)\b|moins de\s*18\s*ans|pas encore\s*18\s*ans|pas atteint\s+(?:leur\s+)?18\s+anniversaire/u.test(value))add('age','lt',18);
 else if(/\b(?:adultes?|majeurs?)\b|(?:au moins\s+18\s+ans?|18\s+ans?\s+ou\s+plus)/u.test(value))add('age','gte',18);
 for(const match of value.matchAll(/\b(moins de|au moins|plus de)\s*(\d+)\s*ans?\b/gu)){const age=Number(match[2]);if(age<=120)add('age',match[1]==='moins de'?'lt':match[1]==='au moins'?'gte':'gt',age);}
  if(missing&&/\b(?:consult\w*|visites?|suivis?|vus?)\b/u.test(value)&&/(?:six|6)\s+(?:derniers?\s+)?mois/u.test(value))add('no_completed_months','eq',6);
 const recent=/\b(?:aucune?|sans|pas de)\s+(?:consultations?|seances?|visites?)\s+(?:(?:termine|cloture|complete|clos|acheve)\w*\s+)?(?:depuis|dans les|au cours des)\s+(\d+)\s+(?:derniers\s+)?jours/gu;
 for(const m of value.matchAll(recent))if(Number(m[1])>0&&Number(m[1])<=3650)add('no_completed_days','eq',Number(m[1]));
 const minimum=/(?:au moins|au minimum|minimum(?: de)?|>=)\s*(\d+)\s+(?:consultations?|seances?)\s+(?:termine|cloture|complete|clos|acheve)\w*/gu;
 for(const m of value.matchAll(minimum))if(Number(m[1])<=1000000)add('completed_consultations','gte',Number(m[1]));
 const noDebt=/\b(?:sans|aucun\w*|pas de|pas d')\s*(?:impayes?|dettes?|soldes?)\b/u.test(value);
 if(!noDebt&&/\b(?:solde(?: restant)?|solde restant du|reste a payer|impayes?|dettes?|montant a encaisser)\s+(?:strictement )?positi\w*|\bsolde\s*(?:restant\s*)?>\s*0\b|\bsolde impaye\b|\bdes impayes\b|\bsolde du superieur a 0\b/u.test(value))add('outstanding_balance','gt',0);
 if(/\bjamais\b/u.test(value)&&/\b(?:consult\w*|vus?|recus?)\b/u.test(value))add('completed_consultations','eq',0);
 return conditions.length?conditions:null;
}
export const explicitPatientConditions=explicitConditions;
export function explicitPatientCountFilterGroups(text:string):SupportedCondition[][]|null {
 const clauses=text.split(/\bou\b/iu);
 if(clauses.length!==2)return null;
 const threshold=/\b(?:moins de|au moins|plus de)\s*\d+\s*ans?\b/u;
 const groups=clauses.map(clause=>explicitConditions(clause.trim()));
 if(groups.some((group,index)=>!threshold.test(fold(clauses[index]!))||group?.length!==1||group[0]!.field!=='age'||!['lt','lte','gt','gte'].includes(group[0]!.op)||typeof group[0]!.value!=='number'))return null;
 return groups as SupportedCondition[][];
}
export function countContractParts(contract:FrenchCountContract):RequestPart[]{return contract.clauses.map((goal,i)=>({id:'requested_'+(i+1),goal,tools:['query_patients'],population:requestedPopulation(goal),conditions:explicitConditions(goal)??[],dependsOn:[],status:'pending',resultRefs:[]}));}
export function requestedPopulation(text:string):NonNullable<RequestPart['population']>{
 const plain=fold(text);
 if(/\bactifs?\s+et\s+archives?\b|\by compris (?:les )?archives?\b/u.test(plain))return 'all';
 if(/\b(?:inactifs?|archives?)\b/u.test(plain))return 'archived';
 if(/\b(?:actifs?|actives?)\b/u.test(plain))return 'active';
 if(/\b(?:tous les patients|toutes les patientes|tous les dossiers|toute la patientele|ensemble des patients)\b/u.test(plain))return 'all';
 return 'active';
}
function populationAlias(text:string):NonNullable<RequestPart['population']>|null{
 const value=fold(text).replace(/^population\s*:\s*/u,'').trim();
 if(['active','actif','actifs','active','actives'].includes(value))return 'active';
 if(['archived','archive','archives','inactif','inactifs','inactive','inactives'].includes(value))return 'archived';
 if(['all','tous','toutes'].includes(value))return 'all';
 return null;
}
function bindPatientPopulation(part:RequestPart,text:string):RequestPart{
 const population=requestedPopulation(text);
 if(part.population&&part.population!==population)throw Error('PatientPopulationMismatch');
 const unsupportedConditions:string[]=[];
 for(const condition of part.unsupportedConditions??[]){const alias=populationAlias(condition);if(alias){if(alias!==population)throw Error('PatientPopulationMismatch');continue;}unsupportedConditions.push(condition);}
 return {...part,population,...(unsupportedConditions.length?{unsupportedConditions}:{unsupportedConditions:undefined})};
}
export function constrainCountDeclaration(parts:RequestPart[],contract:FrenchCountContract):RequestPart[]{
 let normalized=parts;
 if(contract.clauses.length===1&&parts.length>1){
  const signatures=new Set(parts.map(p=>JSON.stringify([p.tools,p.population??'active',p.literalQuery??null,p.conditions.map(key).sort(),p.unsupportedConditions??[]])));
  if(signatures.size===1&&parts.every(p=>p.tools?.length===1&&p.tools[0]==='query_patients'&&!p.dependsOn.length))normalized=[parts[0]!];
 }
 if(normalized.length!==contract.clauses.length)throw Error('RequestedCountOutputsMismatch');
 return normalized.map((rawPart,i)=>{
  const clause=contract.clauses[i]!,plain=fold(clause);
  let part=bindPatientPopulation(rawPart,clause);
  if(part.tools?.length!==1||part.tools[0]!=='query_patients')throw Error('PatientCountToolMismatch');
  const unsupported=/\b(?:e-?mails?|courriels?)\b|adresse\s+electronique/u.test(plain)?['email']:[];
  const expected=explicitConditions(clause);
  const expectedIdentity=expected?.find(condition=>condition.field==='identity_card'&&condition.op==='missing');
  if(expectedIdentity&&part.unsupportedConditions?.length){const conditions=[...part.conditions],remaining:string[]=[];for(const candidate of part.unsupportedConditions){const alias=fold(candidate).replace(/[\s_-]+/gu,'');if(['identity:empty','identity:missing','identity:missing:null','identitycard:null','identitycard:missing:null','noidentitycard','noidentitycardnumber','nonationalcardnumber','nonationalid','nonationalidnumber','nationalidmissing','missingnationalid','missingnationalidnumber','missingidentitycard'].includes(alias)){if(!conditions.some(condition=>key(condition)===key(expectedIdentity)))conditions.push(expectedIdentity);}else remaining.push(candidate);}part={...part,conditions,...(remaining.length?{unsupportedConditions:remaining}:{unsupportedConditions:undefined})};}
  if(!unsupported.length&&((expected&&!expected.every(condition=>part.conditions.some(provided=>key(provided)===key(condition))))||!patientConditionsGrounded(part.conditions,clause)))throw Error('CountConditionsMismatch');
  return {...part,goal:clause,...(unsupported.length?{unsupportedConditions:[...new Set([...(part.unsupportedConditions??[]),...unsupported])]}:{})};
 });
}

export type FrenchReadTool='query_agenda'|'query_patients'|'query_consultations'|'get_patient_context'|'query_documents'|'query_finance'|'query_app'|'search_knowledge'|'prepare_action'|'navigate';
export interface FrenchReadTarget {tool:FrenchReadTool;navigationTarget?:'patient'|'patients'|'agenda'|'dashboard'|'documents'|'finances'|'parametres'|'jarvis';consultationCount?:number;messageKind?:'rappel_rendez_vous'|'document_pret';applicationView?:'cabinet'|'practitioner'|'notifications'|'system'|'message_draft'|'reception'|'medication_catalog';financeMode?:'charges'|'overview'|'calendar'|'totals'|'composition';financeState?:'all'|'pending'|'collected';financeConsultationStatus?:'closed';patientSection?:'summary'|'history'|'treatments'|'profile'|'diagnoses'|'scales'|'current'|'notes'|'timeline';consultationMode?:'count'|'list';consultationStatus?:'all'|'open'|'closed'|'unsigned';dateAxis?:'started_at'|'ended_at';unboundedPeriod?:boolean;from?:string;to?:string;noteArea?:'working'|'subjective'|'objective'|'assessment'|'plan'|'amendment'|'structured';noteQuery?:string;diagnosisState?:'all'|'active'|'resolved';diagnosisRole?:'all'|'primary'|'secondary';treatmentState?:'all'|'active'|'paused'|'stopped';documentKind?:'bonne_sante_mentale'|'suivi_medical'|'certificat_medical'|'justification'|'ordonnance';documentStatus?:'issued'|'draft';documentAllKinds?:boolean;}
export type FrenchRequestAdmission=Omit<FrenchReadTarget,'tool'>&{tools?:readonly string[];profileOnly:boolean;preparationAction?:'create_editable_document_draft'|'update_editable_document_draft'|'create_appointment'|'update_treatment'|'stop_treatment'|'print_issued_document'|'send_internal_message';preparationDocumentType?:'bonne_sante_mentale'|'suivi_medical'|'certificat_medical'|'justification'|'ordonnance'};
const patientAnchor=(plain:string,text:string)=>{
 if(/\b(?:patients?|dossiers?|personnes?|selectionn\w*|son|sa|ses)\b/u.test(plain)||/\b[A-ZÀ-Ö][a-zà-ö]+\s+[A-ZÀ-Ö][a-zà-ö]+\b/u.test(text))return true;
 if(/\b(?:combien|nombre|total|effectif|compte\w*|liste\w*)\b/u.test(plain))return false;
 const mention=parsePatientMention(text);
 return mention.status==='named'&&mention.name.includes(' ');
};
/** Positive French phrases map to existing, audited read gates; this never grants write authority. */
function messageDraftTarget(text:string):'rappel_rendez_vous'|'document_pret'|undefined{
 const plain=fold(text);
 if(!/\b(?:prepare\w*|redige\w*|brouillon)\b/u.test(plain)||! /\b(?:message|sms|rappel)\b/u.test(plain))return;
 return /\brendez[- ]vous|\brdv\b/u.test(plain)?'rappel_rendez_vous':/\bdocument\b/u.test(plain)&&/\bpret|disponib|mise a disposition/u.test(plain)?'document_pret':undefined;
}
function frenchReadTargets(text:string,asOf?:string):FrenchReadTarget[]{
 const plain=fold(text),anchor=patientAnchor(plain,text),targets:FrenchReadTarget[]=[];
 const documentedTreatmentRequest=/\b(?:traitements?|medicaments?|prescriptions?)\b/u.test(plain)&&/\b(?:documente\w*|suspendu\w*|en pause|arrete\w*)\b/u.test(plain);
 const messageKind=messageDraftTarget(text);if(messageKind)return [{tool:'query_app',applicationView:'message_draft',messageKind}];
 const add=(target:FrenchReadTarget)=>{if(!targets.some(existing=>existing.tool===target.tool&&existing.applicationView===target.applicationView&&existing.financeMode===target.financeMode&&existing.patientSection===target.patientSection&&existing.consultationMode===target.consultationMode&&existing.documentKind===target.documentKind&&existing.documentStatus===target.documentStatus))targets.push(target);};
 const mention=parsePatientMention(text);
 if(/\b(?:accueil|salle d.attente|file d.attente|demandes web|demandes? (?:de|d['’]) rendez[- ]?vous|demandes? a traiter)\b/u.test(plain))return [{tool:'query_app',applicationView:'reception'}];
 if(/\bcatalogue\b/u.test(plain)&&/\b(?:medicament|sertraline|fluoxetine|quetiapine|risperidone|olanzapine|lithium)/u.test(plain))return [{tool:'query_app',applicationView:'medication_catalog'}];
 if(/^(?:alexa[, :]+)?(?:(?:peux[- ]tu|tu peux)\s+)?(?:ouvre|ouvrir|va|aller)\b/u.test(plain)){
  const destination=/\b(?:parametres|reglages)\b/u.test(plain)?'parametres':/\b(?:finances|comptabilite)\b/u.test(plain)?'finances':/\bdocuments\b/u.test(plain)?'documents':/\b(?:jarvis|alexa)\b/u.test(plain.replace(/^alexa[, :]+/u,''))?'jarvis':/\bagenda\b/u.test(plain)?'agenda':/\b(?:tableau de bord|dashboard)\b/u.test(plain)?'dashboard':/\bliste des patients\b/u.test(plain)?'patients':undefined;
  if(destination&&mention.status!=='named'&&!/\b(?:patient|patiente|son|sa|ses|ce dossier)\b/u.test(plain))return [{tool:'navigate',navigationTarget:destination}];
 }
 const periodText=mention.status==='named'?plain.replace(fold(mention.name),''):plain;
 const dateRange=explicitFrenchDateRange(periodText,asOf);
 const monthRange=explicitFrenchMonthRange(periodText);
 const dayRange=explicitFrenchDayRange(periodText,asOf);
 const unboundedPeriod=!/(?<![\p{L}\p{N}_-])(?:19|20)\d{2}(?![\p{L}\p{N}_-])|(?<![\p{L}\p{N}_-])\d{1,4}[-/]\d{1,2}[-/]\d{1,4}(?![\p{L}\p{N}_-])|\ble\s+\d{1,2}\b|\b(?:depuis|entre|avant|apres|jusqu\w*|pendant|derni\w*|preced\w*|prochain\w*|mois|semaines?|annees?|jours?|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|aujourd.hui|hier|demain|dates?|periode)\b/u.test(periodText);
 const chronology=/\b(?:chronologie|evenements?(?: cliniques?| du dossier))\b/u.test(plain);
 if(chronology&&!unboundedPeriod&&/\b(?:presente|resum\w*|synthetis\w*|ordre chronologique)\b/u.test(plain))return [{tool:'get_patient_context',patientSection:'summary',unboundedPeriod:true}];
 if(chronology&&anchor)return [{tool:'get_patient_context',patientSection:'timeline',unboundedPeriod:true}];
 const knowledge=/\b(?:dsm(?:\s*[- ]?5)?|cim(?:\s*[- ]?11)?|icd(?:\s*[- ]?11)?|taylor|maudsley|stahl|selon (?:la|le|les) (?:reference|livre|ouvrage|manuel)|dans (?:le|les) livres?)\b/u.test(plain);
 if(knowledge)add({tool:'search_knowledge'});
 const storedMedicalScope=/\b(?:dossiers?|ce patient|cette patiente|patients? selectionne\w*|patient courant|notes?|consultations?|quels? patients|combien de patients|liste les patients)\b/u.test(plain)||mention.status==='named'&&/\bpatient(?:e)?\b/u.test(plain);
 if(knowledge&&!storedMedicalScope)return [{tool:'search_knowledge'}];
 if(/\b(?:agenda|rendez[- ]?vous|rdv)\b/u.test(plain)&&(/\b(?:montre\w*|affich\w*|liste\w*|donne\w*|combien|nombre|quel(?:s|les)?|prochain|demain|aujourd.hui|semaine|mois|jour|agenda|confirme\w*|annule\w*|termine\w*|ouvert\w*|disponible\w*|libre\w*|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/u.test(plain)||!!dateRange||!!monthRange||!!dayRange))add({tool:'query_agenda'});
 const latestNarrativeVerb=requestedConsultationCount(text)===1&&/\b(?:decris\w*|expliqu\w*|ressort\w*|retiens\w*|compte rendu)\b/u.test(plain);
 const summaryStyle=(/\b(?:resum\w*|synthes\w*|raconte\w*|chang\w*|compar\w*|en bref|theme recurrent|motif recurrent|element recurrent)\b/u.test(plain)||latestNarrativeVerb)&&!/\b(?:mot pour mot|texte integral|citation exacte|recopie)\b/u.test(plain);
 const olderDifficulty=/\bdifficulte\w*\b[^.!?]*\bune ancienne consultation\b/u.test(plain);
 const notes=olderDifficulty||/\b(?:notes?|focus|mesures|subjecti(?:f|fs|ve|ves)|objecti(?:f|fs|ve|ves)|conduites? a tenir|texte integral|soap|amendements?|rectificatifs?)\b/u.test(plain)||(/\b(?:suivi|suite)(?:\s+\w+){0,2}\s+prevu\w*\b/u.test(plain))||(/\bevaluations?\b/u.test(plain)&&/\bconsult\w*/u.test(plain)&&!/psychometri/u.test(plain));
 const areas=[['working',/\b(?:travail|brut|brute|bruts|brutes)\b/u],['subjective',/\bsubjecti(?:f|fs|ve|ves)\b/u],['objective',/\bobjecti(?:f|fs|ve|ves)\b/u],['assessment',/\bevaluations?\b/u],['plan',/\bconduites? a tenir\b|\b(?:suivi|suite)(?:\s+\w+){0,2}\s+prevu\w*\b/u],['amendment',/\b(?:amendements?|rectificatifs?)\b/u],['structured',/\b(?:structurees?|focus|mesures)\b/u]] as const;
 const requestedAreas=olderDifficulty?['subjective' as const]:areas.filter(([,pattern])=>pattern.test(plain)).map(([area])=>area);
 const treatmentOnly=/\b(?:traitements?|medicaments?|prescriptions?)\b/u.test(plain)&&!/\b(?:consult\w*|seances?|parcours|cas)\b/u.test(plain);
 const monthlyComparison=explicitFrenchComparedMonthRanges(text,asOf)!==null;
 const genericDossierRead=/\b(?:montre\w*|affich\w*|present\w*|ouvre\w*)\b[^.!?]{0,60}\b(?:dossiers?|fiches?)\b/u.test(plain)&&!/\b(?:documents?|brouillons?|certificats?|ordonn?ances?|justifications?)\b/u.test(plain);
 const explicitConsultationList=/\b(?:liste\w*|historique|combien|nombre|total|compte\w*)\b[^.!?]*\b(?:consultations?|seances?)\b/u.test(plain);
 const explicitDiagnosisRequest=/\bdiagnosti\w*\b/u.test(plain);
 const summaryRequested=(summaryStyle||genericDossierRead)&&!monthlyComparison&&!treatmentOnly&&!explicitConsultationList&&!explicitDiagnosisRequest&&(anchor||notes||/\b(?:consult\w*|seances?|cas)\b/u.test(plain))&&!knowledge&&requestedAreas.length===0;
 const noteArea=requestedAreas.length===1?requestedAreas[0]:undefined;
 const queryMatch=text.match(/(?:\bmot|\bexpression|\bphrase|\bcode|\br[eé]f[eé]rence|\br[eé]p[èe]re)\s+[«“"]?(.+?)[»”"]?(?=\s+dans\b|$)/iu);
 const noteQuery=queryMatch?.[1]?.replace(/[»”"?.!]+$/u,'').trim();
 const document=/\b(?:documents?|brouillons?|certificats?|ordonn?ances?|justifications?|justificatifs?|suivis?\s+medic(?:al|ale|aux|ales))\b/u.test(plain);
 if(document&&!knowledge){
  const documentKind:FrenchReadTarget['documentKind']=/\bcertificats?\s+medic(?:al|ale|aux|ales)\b/u.test(plain)?'certificat_medical':/\bordonn?ances?\b/u.test(plain)?'ordonnance':/\bjustificati(?:on|ons|f|fs)\b/u.test(plain)?'justification':/\bsuivis?\s+medic(?:al|ale|aux|ales)\b/u.test(plain)?'suivi_medical':/\bbonne sante mentale\b/u.test(plain)?'bonne_sante_mentale':undefined;
  const documentStatus:FrenchReadTarget['documentStatus']=/\b(?:emis(?:e|es)?|delivre(?:e|es)?s?|signe(?:e|es)?s?)\b/u.test(plain)?'issued':/\b(?:brouillons?|non signes?)\b/u.test(plain)?'draft':undefined;
  add({tool:'query_documents',unboundedPeriod,...(dateRange??dayRange??{}),documentAllKinds:!documentKind,...(documentKind?{documentKind}:{}),...(documentStatus?{documentStatus}:{})});
 }
 const consultationText=notes&&noteQuery?plain.replace(fold(noteQuery),''):plain;
 const requestedConsultationStatus=/\b(?:termine\w*|clos\w*|cloture\w*|acheve\w*|ferme\w*)\b/u.test(consultationText)?'closed' as const:/\b(?:ouvert\w*|en cours)\b/u.test(consultationText)?'open' as const:undefined;
 const unpricedQuestion=/\bconsult\w*\b/u.test(plain)&&/\b(?:sans tarif|non tarife\w*|sans prix|(?:pas|aucun) de tarif)\b/u.test(plain);
 const consultation=/\b(?:consultations?|seances?)\b/u.test(plain);
 if(consultation&&!unpricedQuestion&&!notes&&!knowledge&&!summaryRequested){
  const detail=/\b(?:details?|duree|analys\w*)\b/u.test(plain);
  const consultationMode:FrenchReadTarget['consultationMode']=detail?undefined:monthlyComparison?'count':/\b(?:liste\w*|historique)\b/u.test(plain)?'list':/\b(?:combien|nombre|total|compte|comptabilise)\b/u.test(plain)?'count':'list';
  const consultationStatus:FrenchReadTarget['consultationStatus']=detail?undefined:/\b(?:non signe\w*|sans signature)\b/u.test(plain)?'unsigned':requestedConsultationStatus??'all';
  const consultationRange=monthlyComparison?null:dateRange??dayRange??explicitFrenchMonthRange(periodText)??explicitFrenchSingleMonthRange(periodText,asOf);
  const dateAxis=/\bdate (?:de )?(?:cloture|fin)\b/u.test(plain)?'ended_at' as const:'started_at' as const;
  add({tool:'query_consultations',unboundedPeriod,...(consultationMode?{consultationMode}:{}),...(consultationStatus?{consultationStatus}:{}),...(consultationRange?{...consultationRange,dateAxis}:monthlyComparison?{dateAxis}:{})});
 }
 const paymentAmountQuestion=/\b(?:montant|total|somme|valeur)\b[^.!?]*\b(?:paiements?|encaisse\w*|recettes?)\b/u.test(plain);
 const financeCore=unpricedQuestion||paymentAmountQuestion||/\b(?:chiffre d.affaires|recettes?|revenus?|depenses?|impayes?|soldes?|resultat net|paiements?|encaissements?|encaisse\w*|indicateurs? financiers?|synthese de caisse|bilan financier)\b/u.test(plain);
 const financialCharges=/\bcharges?\b/u.test(plain)&&/\b(?:enregistr\w*|depenses?|du mois|de ce mois|ce mois|cette periode|total|repartition|reparti\w*|compositi\w*|categorie\w*|financ\w*|factures?)\b/u.test(plain)&&! /\belectriqu\w*|electrostat\w*\b/u.test(plain);
 if((financeCore||financialCharges)&&!knowledge){
  const createdCollectedComparison=/\b(?:difference|compar\w*)\b/u.test(plain)&&/\brecettes? encaisse\w*\b/u.test(plain)&&/\bpaiements? cree\w*\b/u.test(plain);
  const allTimeBalance=/\b(?:solde|impayes?|a encaisser|reste a encaisser)\b[^.!?]*\b(?:toutes? dates?|toutes? periodes?|depuis toujours|confondue?s?)\b/u.test(plain);
  const chargeComposition=/\bcharges?\b/u.test(plain)&&/\b(?:repartition|reparti\w*|compositi\w*|categories?)\b/u.test(plain);
  const financeMode:FrenchReadTarget['financeMode']=/\bcalendrier financier\b/u.test(plain)?'calendar':createdCollectedComparison||unpricedQuestion||paymentAmountQuestion||allTimeBalance?'totals':chargeComposition?'composition':anchor?undefined:/\b(?:charges?|depenses?)\b/u.test(plain)?'charges':/\b(?:chiffre d.affaires|resultat net|bilan financier|recettes?|revenus?|indicateurs? financiers?|synthese de caisse)\b/u.test(plain)?'overview':undefined;
  const financeState=financeMode==='totals'?(createdCollectedComparison||unpricedQuestion||allTimeBalance?'all':frenchFinanceRecordState(text)??'all'):financeMode?null:frenchFinanceRecordState(text);
  const financeMonthText=createdCollectedComparison?periodText.replace(/\bentre\b/u,' '):periodText;
  const financePeriod=dateRange??dayRange??explicitFrenchMonthRange(financeMonthText)??explicitFrenchSingleMonthRange(financeMonthText,asOf);
  add({tool:'query_finance',...(financeMode?{financeMode}:{}),...(financeState?{financeState}:{}),...(unpricedQuestion?{financeConsultationStatus:'closed' as const}:{}),...(financePeriod??{})});
 }
 if(/\bnotifications?\b/u.test(plain))add({tool:'query_app',applicationView:'notifications'});
 if(/\b(?:etat|statut|environnement|heure|date)\b/u.test(plain)&&/\b(?:systeme|serveur|deploiement|cabinet)\b/u.test(plain))add({tool:'query_app',applicationView:'system'});
 const specificOffice=targets.some(t=>t.tool==='query_app'&&['notifications','system'].includes(t.applicationView??''));
 const cabinetView=!specificOffice&&!targets.length&&/\b(?:cabinet|clinique)\b/u.test(plain)?'cabinet' as const:undefined;
 const practitionerView=!specificOffice&&/\b(?:praticien\w*|medecin|docteur|mon profil professionnel)\b/u.test(plain)?'practitioner' as const:undefined;
 if(cabinetView||practitionerView){const applicationView=cabinetView&&practitionerView?undefined:cabinetView??practitionerView;add({tool:'query_app',...(applicationView?{applicationView}:{})});}
 if(anchor||notes||summaryRequested||documentedTreatmentRequest){
   const selectedPatientName=/\b(?:noms?|prenoms?)\b/u.test(plain)&&/\b(?:patient\s+(?:selectionne\w*|courant)|(?:ce|cette)\s+patient(?:e)?|dossier\s+(?:ouvert|courant|actif)|son dossier)\b/u.test(plain)&&!/\b(?:agenda|rendez[- ]?vous|rdv)\b/u.test(plain);
   const patientSection:FrenchReadTarget['patientSection']=summaryRequested?'summary':notes?'notes':/\bdiagnosti\w*\b/u.test(plain)?'diagnoses':/\b(?:echelles?|scores?)\b/u.test(plain)?'scales':/\b(?:traitements?|medicaments?|prescriptions?)\b/u.test(plain)?'treatments':/\b(?:seance en cours|consultation en cours|actuellement en consultation)\b/u.test(plain)?'current':/\bhistorique\b/u.test(plain)?'history':/\b(?:resume|synthese) clinique\b/u.test(plain)?'summary':/\b(?:e[- ]?mail|courriel|adresse electronique|telephones?|coordonnees?|adresses?|naissance|ages?|sexe|identite|identite nationale|identification nationale|carte nationale|cni|cin|situation familiale|contact d.urgence|numero national|numero (?:de (?:carte|piece) d.identite|d.identite|de dossier)|profil|administrati\w*)\b/u.test(plain)||selectedPatientName?'profile':undefined;
  const diagnosisStates=[...(/\bactif\w*\b/u.test(plain)?['active' as const]:[]),...(/\bresolu\w*\b/u.test(plain)?['resolved' as const]:[])];
  const diagnosisRoles=[...(/\bprincipa(?:l|le|ux|les)\b/u.test(plain)?['primary' as const]:[]),...(/\bsecondair\w*\b/u.test(plain)?['secondary' as const]:[])];
  const treatmentStates=[...(/\bactif\w*\b/u.test(plain)?['active' as const]:[]),...(/\b(?:pause|suspendu\w*)\b/u.test(plain)?['paused' as const]:[]),...(/\barrete\w*\b/u.test(plain)?['stopped' as const]:[])];
  if(patientSection)add({tool:'get_patient_context',patientSection,unboundedPeriod,...(patientSection==='summary'&&monthRange?monthRange:{}),...(patientSection==='notes'&&dayRange?dayRange:{}),...(['summary','history'].includes(patientSection)&&!requestsOldestConsultations(text)&&requestedConsultationCount(text)!==null?{consultationCount:requestedConsultationCount(text)!}:{}),...(patientSection==='diagnoses'&&diagnosisStates.length===1?{diagnosisState:diagnosisStates[0]}:{}),...(patientSection==='diagnoses'&&diagnosisRoles.length===1?{diagnosisRole:diagnosisRoles[0]}:{}),...(patientSection==='treatments'&&treatmentStates.length===1?{treatmentState:treatmentStates[0]}:{}),...(patientSection==='notes'&&requestedConsultationStatus?{consultationStatus:requestedConsultationStatus}:{}),...(patientSection==='notes'&&noteArea?{noteArea}:{}),...(patientSection==='notes'&&noteQuery?{noteQuery}:{})});
 }
 const patientQuery=/\b(?:patients|dossiers|patientele)\b/u.test(plain)&&(/\b(?:combien|nombre|total|compt\w*|liste\w*|lesquels|lesquelles|trouve\w*|recherch\w*|identifi\w*|actifs?|inactifs?|archives?|mineurs?|adultes?|enfants?|sans|aucun\w*|manquant\w*|impayes?|soldes?|dettes?)\b/u.test(plain));
 if(patientQuery)add({tool:'query_patients'});
 return targets;
}
/** Un message operationnel a l'accueil reste une proposition, jamais un envoi. */
function internalMessageTarget(text:string):Pick<FrenchRequestAdmission,'preparationAction'>|null{
 const plain=fold(text);
 if(!/\b(?:envoie|envoyer|transmets|transmettre|dis|dire|previens|prevenir)\b/u.test(plain))return null;
 if(!/\b(?:secretaire|accueil|reception)\b/u.test(plain))return null;
 if(!/\b(?:message|mot)\b/u.test(plain))return null;
 return {preparationAction:'send_internal_message'};
}

/** A requested draft/proposal is an outcome, never authority to execute the business action. */
function preparationTarget(text:string):Pick<FrenchRequestAdmission,'preparationAction'|'preparationDocumentType'>|null{
 const plain=fold(text),command=plain
  .replace(/^(?:alexa|assistant)[, :]+/u,'')
  .replace(/^(?:dans|sur)\s+(?:le\s+)?dossier\s+(?:(?:du|de)\s+|d')/u,'')
  .replace(/^(?:(?:le|la)\s+)?(?:traitement|medicament)\s+de\s+[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2}\s*[,;:]\s*/u,'')
  .replace(/^(?:(?:pour|concernant)\s+)?(?:patiente?\s+)?[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){1,2}\s*,\s*/u,'')
  .replace(/^(?:(?:s.il te plait|s.il vous plait|svp),?\s*)?(?:(?:est[- ]ce que\s+)?(?:peux[- ]tu|pourrais[- ]tu|pouvez[- ]vous|pourriez[- ]vous|tu peux|vous pouvez|je voudrais|j.aimerais|je souhaite|je veux)\s+(?:(?:me|nous)\s+|(?:que\s+)?(?:tu|vous)\s+)?)/u,'')
  .trim();
 if(/\b(?:ne|pas|annule|signe|emets|delivre)\b/u.test(plain))return null;
 const requestedDocumentType=/\bbonne sante(?: mentale)?\b/u.test(plain)?'bonne_sante_mentale':/\bsuivis?\s+medic(?:al|ale|aux|ales)\b/u.test(plain)?'suivi_medical':/\bcertificats?\s+medic(?:al|ale|aux|ales)\b/u.test(plain)?'certificat_medical':/\bjustificati(?:on|ons|f|fs)\b/u.test(plain)?'justification':/\bordonn?ances?\b/u.test(plain)?'ordonnance':undefined;
 if(requestedDocumentType&&/^(?:imprim\w*|lance\w*\s+l.impression)\b/u.test(command))return {preparationAction:'print_issued_document',preparationDocumentType:requestedDocumentType};
 const politeDocumentRequest=/^(?:je voudrais|j.aimerais|je souhaite|je veux)\b/u.test(plain)&&!/^\s*(?:consulte\w*|voir\b|lire\b|affiche\w*|ouvre\w*|cherche\w*|liste\w*|retrouve\w*)\b/u.test(command);
 const treatmentField=/\b(?:dose|posologie|frequence|moment de prise|consignes?|instructions?|date de (?:debut|fin))\b/u.test(plain);
 const treatmentTarget=/\b(?:traitements?|medicaments?|prescriptions?)\b/u.test(plain)||mentionsMedication(plain)||(treatmentField&&/\b\d+(?:[.,]\d+)?\s*(?:mg|g|mcg|µg|ml|l)\b/u.test(plain));
 if(treatmentTarget&&/^(?:arrete\w*|cesse\w*|interromp\w*|stoppe\w*)\b/u.test(command))return {preparationAction:'stop_treatment'};
 if(treatmentTarget&&(/^(?:modifi\w*|change\w*|ajust\w*|augment\w*|diminu\w*|passe\w*|baisse\w*|reduit\w*|fix\w*|met(?:s)?\s+a\s+jour|mettre\s+a\s+jour|retir\w*|enlev\w*|supprim\w*)\b/u.test(command)||(treatmentField&&/^ajout\w*/u.test(command))))return {preparationAction:'update_treatment'};
 if(/\b(?:aucun|supprime)\b/u.test(plain))return null;
 if(/^(?:modifi\w*|change\w*|corrige\w*|rectifi\w*|mets?\s+a\s+jour|mettre\s+a\s+jour)\b/u.test(command)&&/\bbrouillon\b/u.test(plain)&&/\b(?:documents?|certificats?|justifications?|justificatifs?|ordonn?ances?|suivis?\s+medic(?:al|ale|aux|ales)|bonne sante)\b/u.test(plain)){
  const type=requestedDocumentType;
  return {preparationAction:'update_editable_document_draft',...(type?{preparationDocumentType:type}:{})};
 }
 if(/\b(?:rendez[- ]vous|rdv)\b/u.test(plain)&&/^(?:cre\w*|ajout\w*|prepar\w*|propos\w*|gener\w*|fix\w*|planifi\w*|programm\w*|prend\w*|reserv\w*|organis\w*)\b/u.test(command))return {preparationAction:'create_appointment'};
 if(!/^(?:cre\w*|ajout\w*|prepar\w*|propos\w*|gener\w*|fix\w*|planifi\w*|programm\w*|prend\w*|reserv\w*|organis\w*|redig\w*|fais?\b)/u.test(command)&&!(requestedDocumentType&&politeDocumentRequest))return null;
 if(!/\b(?:brouillons?|certificats?|justifications?|justificatifs?|suivis?\s+medic(?:al|ale|aux|ales)|ordonn?ances?)\b/u.test(plain))return null;
 const preparationDocumentType=requestedDocumentType;
 return {preparationAction:'create_editable_document_draft',...(preparationDocumentType?{preparationDocumentType}:{})};
}

/** Positive vocabulary narrows only a single supported domain; mixed requests retain the full native interpretation path. */
export function frenchRequestAdmission(text:string,publicAllowed:boolean,asOf?:string):FrenchRequestAdmission{
 const plain=fold(text),chronology=/\b(?:chronologie|evenements?(?: cliniques?| du dossier))\b/u.test(plain)&&/\b(?:presente|resum\w*|synthetis\w*|ordre chronologique)\b/u.test(plain),chronologicalOrder=/\b(?:ordre chronologique|chronologiquement|du plus ancien au plus recent)\b/u.test(plain);
 const compoundChronology=/\b(?:et|puis|ainsi que)\b|[;\n]/u.test(plain);
 if(chronology)return compoundChronology?{profileOnly:false}:{tools:['get_patient_context'],profileOnly:false,patientSection:chronologicalOrder?'timeline':'summary',unboundedPeriod:true};
 const requestedOutputs=frenchRequestedOutputs(text),preparation=preparationTarget(text);
 if(requestedOutputs){
  if(requestedOutputs.length===1&&preparation?.preparationAction&&['update_treatment','stop_treatment'].includes(preparation.preparationAction))return {tools:['prepare_action'],profileOnly:false,...preparation};
  return {profileOnly:false};
 }
 const messageKind=messageDraftTarget(text);if(messageKind&&!frenchRequestedOutputs(text))return {tools:['query_app'],profileOnly:false,applicationView:'message_draft',messageKind};
 const internalMessage=internalMessageTarget(text);if(internalMessage)return {tools:['prepare_action'],profileOnly:false,...internalMessage};
 if(preparation)return {tools:['prepare_action'],profileOnly:false,...preparation};
 const receivableRead=/\b(?:reste|restant|solde|impayes?)\s+a\s+encaisser\b/u.test(plain);
 const comparisonQuestion=/^\s*(?:alexa[, :]\s*)?qu['’]est[- ]ce qui a chang\w*\b/u.test(plain);
 const write=!receivableRead&&!comparisonQuestion&&/\b(?:creer|cree|ajouter|ajoute|ajoutez|enregistrer|enregistrez|modifier|modifie|modifiez|changer|change|changez|ajuster|ajuste|ajustez|augmenter|augmente|augmentez|diminuer|diminue|diminuez|arreter|arrete|arretez|cesser|cesse|cessez|interrompre|interrompt|interrompez|stopper|stoppe|stoppez|corriger|corrige|corrigez|rectifier|rectifie|rectifiez|passer|passe|passez|annuler|annule|annulez|supprimer|supprime|supprimez|signer|signe|signez|encaisser|encaissez|deplacer|deplace|deplacez|preparer|prepare|preparez|generer|genere|generez|proposer|propose|proposez|envoyer|envoie|envoyez|transmettre|transmets)\b/u.test(plain);
 if(write)return {profileOnly:false};
 const clinical=/\b(?:notes?|historique|consult\w*|seances?|diagnosti\w*|traitements?|echelles?|symptom\w*|analyse\w*|ordonn\w*|certificats?|medic\w*|prescri\w*|therap\w*|stress|sommeil|risques?|humeur|sante|dsm|cim|icd|taylor|maudsley)\b/u.test(plain);
 const finance=/\b(?:chiffre d.affaires|recettes?|revenus?|depenses?|impayes?|soldes?|resultat net|paiements?|encaissements?)\b/u.test(plain);
 if(clinical&&finance)return {profileOnly:false};
 const targets=frenchReadTargets(text,asOf),domains=[...new Set(targets.map(target=>target.tool))];
 const mixedFinanceAndCabinetContact=domains.includes('query_finance')&&/\b(?:cabinet|clinique)\b/u.test(plain)&&/\b(?:telephone|tel|numero|coordonnees?|adresse|e[- ]?mail|courriel|nom)\b/u.test(plain);
 if(mixedFinanceAndCabinetContact)return {profileOnly:false};
 if(publicAllowed&&isFrenchAlexaCapabilityQuestion(text)&&targets.every(target=>target.tool==='query_app'&&target.applicationView==='cabinet'))return {tools:['answer_general'],profileOnly:false};
 if(domains.length===1){const scopes=targets.filter(target=>target.tool===domains[0]);const common=Object.fromEntries(['messageKind','navigationTarget','consultationCount','applicationView','financeMode','financeState','financeConsultationStatus','patientSection','consultationMode','consultationStatus','dateAxis','unboundedPeriod','from','to','noteArea','noteQuery','diagnosisState','diagnosisRole','treatmentState','documentKind','documentStatus','documentAllKinds'].flatMap(key=>{const values=new Set(scopes.map(target=>target[key as keyof FrenchReadTarget]).filter(value=>value!==undefined));return values.size===1?[[key,[...values][0]]]:[]}));return {tools:domains,profileOnly:scopes.length===1&&scopes[0]?.tool==='get_patient_context'&&scopes[0].patientSection==='profile',...common};}
 const appReference=/\b(?:mindcare|alexa|application|logiciel|systeme|serveur|notifications?|messages?|factures?|recus?|frais|caisse|mois|semaine|periode|aujourd.hui|hier|demain|ceci|cela|ca)\b/u.test(plain);
 if(publicAllowed&&!targets.length&&!appReference&&/^(?:pourquoi\b|comment\b|qu.est-ce\s+que\b|qu.est-ce\s+qu[' ]\w+|quel(?:le)?s?\b|explique(?:-moi)?\b|dis[- ]moi\b|aide[- ]moi\b|donne[- ]moi\b)/u.test(plain)&&!/[;\n]/u.test(plain))return {tools:['answer_general'],profileOnly:false};
 return {profileOnly:false};
}
/** Lexical hints contain requested slots only, never inferred records, values or dispatch authority. */
export function countContractHints(contract:FrenchCountContract){return contract.clauses.map(goal=>({goal,conditions:explicitConditions(goal)?.map(c=>c.field+':'+c.op+(c.value===null?'':':'+c.value))??[]}));}

export interface FrenchCompoundContract {text:string;conditions:SupportedCondition[];count:boolean;sort?:'outstanding_desc';}
/** Only an explicit conjunctive patient-set request is constrained; domain execution stays model-selected and gated. */
export function frenchPatientCompoundContract(text:string):FrenchCompoundContract|null{
 const plain=fold(text),conditions=explicitConditions(text)??[];
 const explicitCountThenFirstNamePage=/\b(?:combien|nombre|total|compt\w*)\b[^.!?]*\b(?:puis|ensuite)\b[^.!?]*\b(?:liste\w*|affich\w*|montre\w*)\b[^.!?]*\b20\s+premier\w*\b[^.!?]*\bnoms?\b/u.test(plain);
 if(!/\b(?:patients?|adultes?|majeurs?|enfants?|mineurs?)\b/u.test(plain)||! /\b(?:trouve|cherch\w*|recherch\w*|liste\w*|affich\w*|montre\w*)\b/u.test(plain)||conditions.length<1||(conditions.length===1&&!explicitCountThenFirstNamePage))return null;
 if(/\b(?:ou|rendez-vous|rdv|agenda|dsm|taylor|maudsley|cabinet|email|courriel|archiv\w*|inacti\w*)\b|adresse electronique|chiffre d.affaires/u.test(plain))return null;
 const sort=/\b(?:soldes?|dettes?|impayes?)\s+(?:decroiss\w*|du plus (?:grand|eleve))\b|\bdu plus gros solde au plus petit\b/u.test(plain)?'outstanding_desc' as const:undefined;
 return {text,conditions,count:/\b(?:compt\w*|combien|nombre|total)\b/u.test(plain),...(sort?{sort}:{})};
}
export function compoundContractHints(contract:FrenchCompoundContract){return (contract.count?['count','list']:['list']).map(id=>({id,goal:id==='count'?(contract.text.match(/\b(?:compt\w*|combien|nombre|total)\b[^.!?]*/iu)?.[0]??contract.text):contract.text,tool:'query_patients',conditions:contract.conditions.map(c=>c.field+':'+c.op+(c.value===null?'':':'+c.value))}));}
export function compoundContractParts(contract:FrenchCompoundContract):RequestPart[]{return (contract.count?['count','list']:['list']).map(id=>({id,goal:contract.text,tools:['query_patients'],conditions:contract.conditions,dependsOn:[],status:'pending',resultRefs:[]}));}
export function constrainCompoundDeclaration(parts:RequestPart[],contract:FrenchCompoundContract):RequestPart[]{
 const scoped=parts.map(part=>bindPatientPopulation(part,contract.text));
 if(scoped.length!==(contract.count?2:1)||scoped.some(p=>p.tools?.length!==1||p.tools[0]!=='query_patients'||p.dependsOn.length||!contract.conditions.every(c=>p.conditions.some(actual=>key(actual)===key(c)))||!patientConditionsGrounded(p.conditions,contract.text)))throw Error('CompoundOutputsOrConditionsMismatch');
 const unresolved=[...new Set(scoped.flatMap(p=>p.unsupportedConditions??[]))];return unresolved.length?scoped.map(p=>({...p,unsupportedConditions:unresolved})):scoped;
}

/** Counts explicit coordinated application requests only; it grants no domain authority or business action. */
export function frenchRequestedOutputs(text:string):string[]|null{
 const plain=fold(text);
 if(/\b(?:chronologie|evenements?(?: cliniques?| du dossier))\b/u.test(plain)&&/\b(?:presente|resum\w*|synthetis\w*|ordre chronologique)\b/u.test(plain))return null;
 const patientNamesSuffix=/\bet\s+(?:donne|affiche|indique)\s+(?:leurs?|les)\s+noms?\s*[?!.]*$/iu.exec(text);
 if(patientNamesSuffix){const head=fold(text.slice(0,patientNamesSuffix.index));if(/\b(?:patients?|patientes?|dossiers?)\b/u.test(head)&&/\b(?:liste\w*|affich\w*|montr\w*|quels?|quelles?)\b/u.test(head))return null;}
 const treatmentSuffix=/\bet\s+quels?\s+changements?\s+(?:sont\s+)?(?:document[eé]s|enregistr[eé]s)\s*[?!.]*$/iu.exec(text);
 if(treatmentSuffix){const head=text.slice(0,treatmentSuffix.index),targets=frenchReadTargets(head);if(targets.length===1&&targets[0]?.patientSection==='treatments'&&!/\b(?:et|puis)\b|[;\n]/iu.test(head))return null;}
 const statusSuffix=/\bet\s+quels?\s+sont\s+(?:leurs?|les)\s+statuts?\s*[?!.]*$/iu.exec(text);
 if(statusSuffix){const head=text.slice(0,statusSuffix.index),targets=frenchReadTargets(head);if(targets.length===1&&targets[0]?.tool==='query_agenda'&&!/\b(?:et|puis)\b|[;\n]/iu.test(head))return null;}
 if(!frenchReadTargets(text).length&&!preparationTarget(text))return null;
 const documentKinds:[string,RegExp,string][]=[
  ['bonne_sante_mentale',/\bcertificats?\s+(?:de\s+)?bonne\s+sant[ée]\s+mentale\b/giu,'le certificat de bonne santé mentale'],
  ['suivi_medical',/\bsuivis?\s+m[ée]dic(?:al|ale|aux|ales)\b/giu,'le certificat de suivi médical'],
  ['certificat_medical',/\bcertificats?\s+m[ée]dic(?:al|ale|aux|ales)\b/giu,'le certificat médical'],
  ['justification',/\bjustific(?:ation|ations|atif|atifs|ative|atives)\b/giu,'la justification'],
  ['ordonnance',/\bordonnances?\b/giu,'l’ordonnance'],
 ];
 const documentMentions=documentKinds.flatMap(([kind,pattern,label])=>[...text.matchAll(pattern)].map(match=>({kind,label,start:match.index,end:match.index+match[0].length}))).sort((left,right)=>left.start-right.start);
 if(new Set(documentMentions.map(mention=>mention.kind)).size>=2&&/\b(?:montre|affich|list|trouv|cherch|recherch|ouvr|consult)\w*\b/iu.test(text)&&! /\b(?:sans|aucun|aucune|ni|ou|pas\s+de|sauf)\b/iu.test(fold(text))){
  const identity=parsePatientMention(text);
  const connected=documentMentions.slice(1).every((mention,index)=>/\b(?:et|puis)\b|,/iu.test(text.slice(documentMentions[index]!.end,mention.start)));
  if(identity.status!=='ambiguous'&&connected){
   const patientPrefix=identity.status==='named'?`Pour ${identity.name}, `:'';
   const uniqueMentions=[...new Map(documentMentions.map(mention=>[mention.kind,mention])).values()];
   const tail=text.slice(documentMentions.at(-1)!.end),otherClause=tail.match(/^\s*[,;]?\s*puis\s+(.+?)\s*[?؟!.]*\s*$/iu)?.[1]?.trim();
   const tailWithoutIdentity=fold(tail).replace(identity.status==='named'?fold(identity.name):/(?!)/u,'').replace(/\b(?:de|du|des|pour|chez)\b/gu,'').replace(/[?؟!.,;]+/gu,'').trim();
   if(!tailWithoutIdentity||otherClause){
    const goals=uniqueMentions.map(mention=>`${patientPrefix}montre ${mention.label}.`);
    if(otherClause){const extra=`${patientPrefix}${otherClause}.`;if(!requestedReadTool(extra,text))return null;goals.push(extra);}
    if(goals.length>=2&&goals.every(goal=>requestedReadTool(goal,text)))return goals;
   }
  }
 }
 const markers=[...text.matchAll(/(?:^|[,;]\s*|\b(?:et|puis)\s+)((?:affich|montr|trouv|rep[èe]r|cherch|recherch|identifi|r[ée]sum|pr[ée]par|compt|donn|lis|lire|ouvr|compar|expliqu|cr[ée]|ajout|enregistr|modifi|annul|supprim|sign|encaiss|d[ée]pla|r[ée]dig|r[èe]gl)\p{L}*)\b/giu)];
 if(markers.length>=2&&markers.length<=12&&markers[0]!.index===0)return markers.map((match,index)=>text.slice(match.index+match[0].length-match[1]!.length,markers[index+1]?.index??text.length).replace(/[\s,;]+$/u,'').trim());
 const sharedVerb=text.match(/^\s*(?:alexa[, :]\s*)?((?:affich|montr|trouv|rep[èe]r|cherch|recherch|identifi|r[ée]sum|pr[ée]par|compt|donn|lis|lire|ouvr|compar|expliqu|cr[ée]|ajout|enregistr|modifi|annul|supprim|sign|encaiss|d[ée]pla|r[èe]dig)\p{L}*)\s+/iu);
 if(sharedVerb){
  const commaItems=text.slice(sharedVerb[0].length).replace(/[?؟!.]+$/u,'').split(/\s*,\s*/u).filter(Boolean),items=commaItems.flatMap(item=>{
   const coordinated=item.split(/\s+et\s+/iu),left=coordinated.length===2?parsePatientMention(coordinated[0]!):{status:'none' as const},right=coordinated.length===2?parsePatientMention(coordinated[1]!):{status:'none' as const};
   return left.status==='named'&&right.status==='named'&&left.name!==right.name?coordinated:[item];
  }),names=items.map(item=>{const mention=parsePatientMention(item);return mention.status==='named'?fold(mention.name):null;});
  if(items.length>=2&&items.length<=8&&names.every((name):name is string=>!!name)&&new Set(names).size===names.length){
   const ending=text.match(/[?؟!.]+\s*$/u)?.[0]??'',goals=items.map((item,index)=>`${sharedVerb[1]} ${item.trim()}${index===items.length-1?ending:''}`);
   if(goals.every(goal=>requestedReadTool(goal,text)))return goals;
  }
 }
 const listWithExactTotal=/\b(?:liste\w*|affich\w*|montr\w*)\b[^.!?]{0,120}\b(?:consultations?|seances?)\b[^.!?]{0,100}\b(?:total|nombre)(?:\s+exact)?\b/u.test(fold(text));
 if(listWithExactTotal&&requestedReadTool(text,text)==='query_consultations')return null;
  const separators=[...text.matchAll(/\s+\b(?:et|puis)\s+(?=(?:combien|quel(?:le|s|les)?|qui|comment|pourquoi|où|quand|le\s+(?:nombre|total|effectif|rep[èe]re)|l['’]effectif|la\s+référence)\b)/giu)];
 if(!separators.length||separators.length>5){
  const action=preparationTarget(text),targets=frenchReadTargets(text);
  if(action?.preparationAction&&['update_treatment','stop_treatment'].includes(action.preparationAction)&&targets.length<=1&&!/\b(?:et|puis|ensuite|ou|mais)\b|[;\n]/iu.test(text))return [text.trim()];
  return null;
 }
 const clauses:string[]=[];let start=0;
 for(const separator of separators){clauses.push(text.slice(start,separator.index).trim().replace(/[\s,;]+$/u,''));start=separator.index+separator[0].length;}
 clauses.push(text.slice(start).trim());
 const mention=parsePatientMention(text),patientName=mention.status==='named'?mention.name:null,patientPrefix=patientName?`Pour ${patientName}, `:'';
 const goals=clauses.map((goal,index)=>{
  const cleaned=goal.replace(/[?!.]+$/u,'').trim();
  const withPatient=patientPrefix&&patientName&&!fold(cleaned).includes(fold(patientName))?patientPrefix+cleaned:cleaned;
  return withPatient+(index===clauses.length-1?(goal.match(/[\u00a0\u202f ]?[?？]$/u)?.[0]??''):'');
 });
 if(goals.length<2||goals.some(goal=>!goal||!requestedReadTool(goal,text)))return null;
 return goals;
}
export function constrainRequestedOutputs(parts:RequestPart[],outputs:readonly string[]):RequestPart[]{
 const norm=(s:string)=>fold(s).replace(/[.!?]+$/gu,'').trim();
 if(parts.length!==outputs.length||outputs.some(goal=>parts.filter(p=>norm(p.goal)===norm(goal)).length!==1))throw Error('RequestedOutputsMismatch');
 const original=outputs.join(' ');
 const constrained=parts.map(part=>{const goal=outputs.find(goal=>norm(goal)===norm(part.goal))!,hint=requestedReadTool(goal,original);if(hint&&(part.tools?.length!==1||part.tools[0]!==hint))throw Error('RequestedReadToolMismatch');const count=frenchPatientCountContract(goal);return count?constrainCountDeclaration([part],count)[0]!:{...part,goal};});
 const agenda=constrained.find(p=>requestedReadTool(p.goal,original)==='query_agenda');
 const ordered=agenda?[agenda,...constrained.filter(p=>p!==agenda)]:constrained;
 return ordered.map(part=>isAdministrativeReview(part.goal,original)?{...part,conditions:[...part.conditions.filter(c=>c.field!=='administrative_incomplete'),{field:'administrative_incomplete' as const,op:'eq' as const,value:true}],dependsOn:[...new Set([...part.dependsOn,...(agenda?[agenda.id]:[])])]}:part);
}

/** Positive read purposes only. Administrative review produces a checklist, never an unsupported record mutation. */
export function requestedReadTool(goal:string,original:string):FrenchReadTool|undefined{
 const plain=fold(goal);
 if(isAdministrativeReview(goal,original)||(/\b(?:champs? manquants?|corrections?)\b/u.test(plain)&&/\b(?:dossiers?|patient\w*|revue)\b/u.test(plain)&&!/\b(?:modifi\w*|enregistr\w*|corrige\w*|sauvegard\w*)\b/u.test(plain)))return 'query_patients';
 if(messageDraftTarget(goal))return 'query_app';
 if(preparationTarget(goal))return 'prepare_action';
 const goalDomains=[...new Set(frenchReadTargets(goal).map(target=>target.tool))];
 if(goalDomains.length===1)return goalDomains[0];
 if(!goalDomains.length){const wholeDomains=[...new Set(frenchReadTargets(original).map(target=>target.tool))];if(wholeDomains.length===1)return wholeDomains[0];}
 if(requestedCountRead(goal)){if(/\bpatients?\b/u.test(plain))return 'query_patients';if(/\bconsult\w*\b/u.test(plain))return 'query_consultations';}
 return undefined;
}
export function requestedCountRead(goal:string):boolean{return /^(?:(?:compt\w*|combien|(?:le\s+)?nombre|(?:le\s+)?total|effectif)\b|quel(?:le)?\s+est(?:-ce)?\s+(?:le\s+)?(?:nombre|total|effectif)\b)/u.test(fold(goal))&&!/\b(?:liste\w*|affich\w*|montr\w*|lesquels|lesquelles)\b/u.test(fold(goal));}
export function isAdministrativeReview(goal:string,original:string):boolean{
 const plain=fold(goal),whole=fold(original);
 return /administrati\w*[^.!?]*incomplet|incomplet[^.!?]*administrati/u.test(whole)&&!/\b(?:modifi\w*|enregistr\w*|corrige\w*|sauvegard\w*)\b/u.test(plain)&&/administrati|champs? manquant|correction\w*[^.!?]*revue/u.test(plain);
}

/** Values grounded in the requested read, shared by native schemas and validated dispatch. */
export function frenchReadArgumentBindings(scope:FrenchRequestAdmission,tool:string):Record<string,string|number>{
 const values:Record<string,string|number>={};
 if(tool==='navigate'&&scope.navigationTarget)values['target']=scope.navigationTarget;
 if(tool==='prepare_action'){if(scope.preparationAction)values['action']=scope.preparationAction;if(scope.preparationDocumentType)values['documentType']=scope.preparationDocumentType;}
 if(tool==='get_patient_context'&&scope.patientSection){values['section']=scope.patientSection;if(scope.consultationCount!==undefined)values['count']=scope.consultationCount;if(scope.diagnosisState)values['diagnosisState']=scope.diagnosisState;if(scope.diagnosisRole)values['diagnosisRole']=scope.diagnosisRole;if(scope.treatmentState)values['treatmentState']=scope.treatmentState;if(['summary','notes'].includes(scope.patientSection)&&scope.from&&scope.to){values['from']=scope.from;values['to']=scope.to;}if(scope.patientSection==='notes'){if(scope.noteArea)values['area']=scope.noteArea;else if(scope.noteQuery)values['area']='all';if(scope.noteQuery)values['query']=scope.noteQuery;if(scope.consultationStatus)values['status']=scope.consultationStatus;}}
 if(tool==='query_consultations'){if(scope.consultationMode)values['mode']=scope.consultationMode;if(scope.consultationStatus)values['status']=scope.consultationStatus;if(scope.from&&scope.to){values['from']=scope.from;values['to']=scope.to;values['dateAxis']=scope.dateAxis??'started_at';}}
 if(tool==='query_finance'){if(scope.financeMode)values['mode']=scope.financeMode;if(scope.financeState)values['state']=scope.financeState;if(scope.financeConsultationStatus)values['consultationStatus']=scope.financeConsultationStatus;if(scope.from&&scope.to){values['from']=scope.from;values['to']=scope.to;}}
 if(tool==='query_app'&&scope.applicationView){values['view']=scope.applicationView;if(scope.messageKind)values['motif']=scope.messageKind;}
 if(tool==='query_documents'){if(scope.documentKind)values['kind']=scope.documentKind;if(scope.documentStatus)values['status']=scope.documentStatus;if(scope.from&&scope.to){values['from']=scope.from;values['to']=scope.to;}}
 return values;
}
