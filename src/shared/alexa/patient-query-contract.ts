import type {RequestPart,SupportedCondition} from './agent';
import {conditionKey} from './agent';
import {patientQueryCopy as copy} from '@/i18n/alexa-patient-query';
import {explicitPatientConditions,explicitPatientCountFilterGroups,requestedPopulation,frenchPatientCountContract,explicitFrenchMonthRange,patientConditionMentions,hasExplicitClockRestriction} from './request-contract';

type Period={from:string;to:string};
export interface PatientQueryContract {population:NonNullable<RequestPart['population']>;filterGroups:SupportedCondition[][];consultationPeriod?:Period&{axis:'started_at'|'ended_at'};createdPeriod?:Period;unsupported:string[];ledger:NonNullable<RequestPart['constraintLedger']>;extended:boolean;}
const months=['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
const fold=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').replace(/[’‘]/gu,"'").toLowerCase();
function sourceFragment(text:string,pattern:RegExp):string {
 let normalized='',offset=0;const positions:number[]=[];
 for(const character of text){const value=fold(character);for(let i=0;i<value.length;i++)positions.push(offset);normalized+=value;offset+=character.length;}
 positions.push(text.length);
 const match=pattern.exec(normalized),at=match?positions[match.index]??0:0,end=match?positions[match.index+match[0].length]??text.length:0;
 return text.slice(Math.max(0,at-80),Math.min(text.length,Math.max(at+240,end+80))).slice(0,500);
}
const civil=(y:number,m:number,d:number)=>{const date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?date.toISOString().slice(0,10):null;};
const next=(s:string)=>{const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
export function patientQueryPeriod(text:string,asOf:string):Period|null {
 const t=fold(text),named=[...t.matchAll(new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${months.join('|')})\\s+((?:19|20)\\d{2})\\b`,'gu'))];
 if(hasExplicitClockRestriction(text)||/\b(?:depuis|avant|apres|jusqu\w*|compar\w*|versus|a ce jour)\b/u.test(t))return null;
 const wholeMonths=explicitFrenchMonthRange(text);if(wholeMonths)return wholeMonths;
 const compact=t.match(new RegExp(`\\b(?:du|entre le)\\s+(\\d{1,2})(?:er)?\\s+(?:au|et le)\\s+(\\d{1,2})(?:er)?\\s+(${months.join('|')})\\s+((?:19|20)\\d{2})\\b`,'u'));
 const commonYear=t.match(new RegExp(`\\b(?:du|entre le)\\s+(\\d{1,2})(?:er)?\\s+(${months.join('|')})\\s+(?:au|et le)\\s+(\\d{1,2})(?:er)?\\s+(${months.join('|')})\\s+((?:19|20)\\d{2})\\b`,'u'));
 if(compact||commonYear){
  const low=compact?civil(Number(compact[4]),months.indexOf(compact[3]!)+1,Number(compact[1])):civil(Number(commonYear![5]),months.indexOf(commonYear![2]!)+1,Number(commonYear![1]));
  const high=compact?civil(Number(compact[4]),months.indexOf(compact[3]!)+1,Number(compact[2])):civil(Number(commonYear![5]),months.indexOf(commonYear![4]!)+1,Number(commonYear![3]));
  return low&&high&&low<=high?{from:low+'T00:00:00+01:00',to:next(high)+'T00:00:00+01:00'}:null;
 }
 const iso=[...t.matchAll(/\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/gu)],numeric=[...t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})\b/gu)];
 const dates=[...named.map(m=>({at:m.index,date:civil(Number(m[3]),months.indexOf(m[2]!)+1,Number(m[1]))})),...iso.map(m=>({at:m.index,date:civil(Number(m[1]),Number(m[2]),Number(m[3]))})),...numeric.map(m=>({at:m.index,date:civil(Number(m[3]),Number(m[2]),Number(m[1]))}))].sort((a,b)=>a.at-b.at).map(m=>m.date);
 if(dates.length<2&&(t.match(new RegExp(`\\b(?:${months.join('|')})\\b`,'gu'))??[]).length>1)return null;
 if(dates.length&&dates.every((s):s is string=>s!==null)){
  if(dates.length===1&&!/\b(?:depuis|avant|apres|entre|jusqu)\b/u.test(t))return {from:dates[0]+'T00:00:00+01:00',to:next(dates[0]!)+'T00:00:00+01:00'};
  if(dates.length===2&&/\b(?:entre|du)\b/u.test(t)&&dates[0]!<=dates[1]!)return {from:dates[0]+'T00:00:00+01:00',to:next(dates[1]!)+'T00:00:00+01:00'};
  return null;
 }
 const namedMonths=[...t.matchAll(new RegExp(`\\b(${months.join('|')})\\s+((?:19|20)\\d{2})\\b`,'gu'))];
 if(namedMonths.length===1&&!dates.length){const m=namedMonths[0]!,year=Number(m[2]),month=months.indexOf(m[1]!)+1;return {from:civil(year,month,1)+'T00:00:00+01:00',to:new Date(Date.UTC(year,month,1)).toISOString().slice(0,10)+'T00:00:00+01:00'};}
 if(/\bce mois(?:-ci)?\b/u.test(t)){const date=new Date(Date.parse(asOf)+3600000),y=date.getUTCFullYear(),m=date.getUTCMonth()+1;return {from:civil(y,m,1)+'T00:00:00+01:00',to:new Date(Date.UTC(y,m,1)).toISOString().slice(0,10)+'T00:00:00+01:00'};}
 return null;
}

/** Closed additions to the existing patient grammar; unknown restrictions never broaden a read. */
export function patientQueryContract(text:string,asOf:string):PatientQueryContract {
 const t=fold(text),unsupported:string[]=[],explicitAgeOr=explicitPatientCountFilterGroups(text),segments=explicitAgeOr?t.split(/\s+ou\s+/u):t.split(/\s+ou\s+(?=(?:sans|avec|les |des |ayant|dont|qui ))/u),groups:SupportedCondition[][]=[];
 for(const segment of segments){
  const conditions=[...(explicitPatientConditions(segment)??[])];
  // Absence is local to the field, rather than inferred from a sibling predicate.
  for(const [field,pattern]of [['identity_card',"(?:cni|carte d'identite|carte d.identite|numero de piece d'identite)"],['phone','(?:telephone|portable)'],['birth_date','(?:date de naissance)'],['sex','(?:sexe)']] as const){
   const missing=new RegExp(`(?:sans|aucun(?:e)?|pas de|pas d'|manqu\\w*|non renseigne\\w*)\\s+(?:un |une |numero de |numero d'|de |d')?${pattern}|${pattern}\\s+(?:est |sont )?(?:manquant\\w*|non renseigne\\w*|vide\\w*|absent\\w*)`,'u').test(segment);
   const present=new RegExp(`(?:avec|ayant)\\s+(?:un |une |le |la |son |sa |numero de |numero d')?${pattern}(?:\\s+renseigne\\w*)?|${pattern}\\s+(?:est |sont )?(?:renseigne\\w*|present\\w*)`,'u').test(segment);
   if(missing||present){for(let i=conditions.length-1;i>=0;i--)if(conditions[i]!.field===field)conditions.splice(i,1);conditions.push({field,op:missing?'missing':'present',value:null});}
   else if(new RegExp(pattern,'u').test(segment)&&!conditions.some(c=>c.field===field)&&!(field==='sex'&&/\bsexe (?:feminin|masculin)\b/u.test(segment)))unsupported.push(copy.fieldUnresolved(field));
  }
  const female=/\b(?:femmes?|patientes? de sexe feminin|sexe feminin)\b/u.test(segment),male=/\b(?:hommes?|sexe masculin)\b/u.test(segment);
  if(female&&male)unsupported.push(copy.sexesUnresolved);
  else if(female||male){for(let i=conditions.length-1;i>=0;i--)if(conditions[i]!.field==='sex')conditions.splice(i,1);conditions.push({field:'sex',op:'eq',value:female?'F':'M'});}
  for(const match of segment.matchAll(/(?:au plus|maximum(?: de)?|<=)\s*(\d+)\s*ans?\b/gu))conditions.push({field:'age',op:'lte',value:Number(match[1])});
  const count=segment.match(/(?:au moins|minimum de)\s*(\d+)\s+consultations?/u);if(count&&!conditions.some(c=>c.field==='completed_consultations'))conditions.push({field:'completed_consultations',op:'gte',value:Number(count[1])});
  if(/\b(?:sans|aucun\w*|pas de|pas d')\s*(?:impayes?|dettes?)\b/u.test(segment))conditions.push({field:'outstanding_balance',op:'eq',value:0});
  const seen=new Set<string>();groups.push(conditions.filter(c=>{const k=conditionKey(c);if(seen.has(k))return false;seen.add(k);return true;}));
 }
 if(/\b(?:separement|chaque nombre)\b/u.test(t)&&!frenchPatientCountContract(text))unsupported.push(copy.outputsUnresolved);
 const disjunctions=(t.match(/\bou\b/gu)??[]).length,knownAlternatives=(t.match(/\bans? ou plus\b|\bnul(?:le)?s? ou vides?\b/gu)??[]).length;
 if(disjunctions>segments.length-1+knownAlternatives)unsupported.push(copy.disjunctionUnresolved);
 if(/\b(?:pas (?:des? )?(?:femmes?|hommes?|adultes?|mineurs?|enfants?|moins|plus|sans)|non (?:adultes?|mineurs?)|ne (?:sont|soient) pas)\b/u.test(t))unsupported.push(copy.negationUnresolved);
 const temporal=new RegExp(`\\b(?:${months.join('|')}|(?:19|20)\\d{2}|ce mois|entre|depuis|avant|apres|jusqu\\w*)\\b`,'u').test(t),period=temporal?patientQueryPeriod(text,asOf):null;
 const creation=/\b(?:inscrit\w*|cree\w*|creation|enregistre\w*)\b/u.test(t),consultation=/\bconsult\w*\b/u.test(t),legacyRelative=groups.flat().some(c=>['no_completed_days','no_completed_months'].includes(c.field));
 if(temporal&&!period&&!legacyRelative)unsupported.push(copy.periodUnresolved);
 if(period&&creation&&consultation)unsupported.push(copy.axisAmbiguous);
 if(period&&!creation&&!consultation)unsupported.push(copy.axisMissing);
 if(period&&consultation&&!groups.flat().some(c=>c.field==='completed_consultations'))unsupported.push(copy.consultationsMissing);
 if(consultation&&/\bconsult\w*\s+(?:(?:qui sont|encore)\s+)?(?:ouvert\w*|en cours|non (?:signe\w*|termine\w*|cloture\w*|close\w*)|pas encore (?:termine\w*|cloture\w*)|annule\w*|prevu\w*|planifie\w*)\b/u.test(t))unsupported.push(copy.consultationStatusUnsupported);
 if(/\b(?:adresse electronique|e-mail)\b/u.test(t))unsupported.push(copy.emailUnsupported);
 if(/\b(?:habite\w*|domicil\w*|resid\w*|diagnostiqu\w*|hospitalis\w*|emails?|courriels?|allerg\w*)\b/u.test(t))unsupported.push(copy.conditionUnsupported);
 if(segments.length>4||groups.flat().length>12||segments.length>1&&groups.some(g=>!g.length))unsupported.push(copy.combinationUnsupported);
 const extended=unsupported.length>0||segments.length>1||temporal&&!legacyRelative||groups.flat().some(c=>c.op==='present'||c.op==='lte'||typeof c.value==='string'||c.field==='outstanding_balance'&&c.op==='eq'&&c.value===0);
 const ledger:PatientQueryContract['ledger']=groups.flat().map(c=>({key:conditionKey(c),kind:'filter',span:sourceFragment(text,patientConditionMentions[c.field]),supported:true}));
 ledger.push({key:'population:'+requestedPopulation(text),kind:'population',span:sourceFragment(text,/\b(?:actifs?|archives?|tous|toute|patients?|patientele)\b/u),supported:true});
 if(temporal)ledger.push({key:JSON.stringify({...period,axis:creation?'created_at':consultation?/\bdate (?:de )?(?:cloture|fin)\b/u.test(t)?'ended_at':'started_at':'unresolved'}),kind:'period',span:sourceFragment(text,new RegExp(`\\b(?:${months.join('|')}|depuis|avant|apres|ce mois|(?:19|20)\\d{2})\\b`,'u')),supported:!!period||legacyRelative});
 for(const reason of unsupported)ledger.push({key:reason,kind:'unsupported',span:text.slice(0,500),supported:false});
 return {population:requestedPopulation(text),filterGroups:groups,unsupported,ledger,extended,...(period&&creation?{createdPeriod:period}:{}),...(period&&consultation?{consultationPeriod:{...period,axis:/\bdate (?:de )?(?:cloture|fin)\b/u.test(t)?'ended_at' as const:'started_at' as const}}:{})};
}
