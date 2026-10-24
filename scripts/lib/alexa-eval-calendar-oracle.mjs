import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {inspectSql,literal} from './alexa-eval-oracle.mjs';
const day=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Algiers'}).format(new Date(value));
/** Independent oracle: aggregate scoped raw payments, never the financial gate under test. */
export function expectedCalendar(payments,query){
 const from=Date.parse(query.from),to=Date.parse(query.to);
 assert(Number.isFinite(from)&&Number.isFinite(to)&&to>from&&to-from<=367*86400000);
 const days=[];
 for(let at=from;at<to;at+=86400000)days.push(day(at));
 const totals=new Map(days.map(jour_iso=>[jour_iso,{jour_iso,montant:0,nb_seances:0,a_impaye:false}])),types=new Map(),counts=new Map();
 for(const row of payments){
  assert(Number.isSafeInteger(row.amount)&&row.amount>=0&&Number.isFinite(Date.parse(row.createdAt)));
  if(row.collectedAt===null){const value=totals.get(day(row.createdAt));if(value)value.a_impaye=true;continue;}
  const at=Date.parse(row.collectedAt);assert(Number.isFinite(at));if(at<from||at>=to)continue;
  const key=typeof row.kind==='string'?row.kind:'__non_rattache__',date=day(at),value=totals.get(date);assert(value);
  value.montant+=row.amount;value.nb_seances++;assert(Number.isSafeInteger(value.montant));
  types.set(key,(types.get(key)??0)+1);const cell=date+'|'+key;counts.set(cell,(counts.get(cell)??0)+1);
 }
 const allTypes=[...types].sort(([a,an],[b,bn])=>Number(a==='__non_rattache__')-Number(b==='__non_rattache__')||bn-an||(a<b?-1:a>b?1:0)).map(([key])=>key);
 const top=allTypes.slice(0,3),curves=[...top,...(allTypes.length>3?['autres']:[])],lines=[];
 for(const date of days)for(const cle of [...curves].sort()){
  const nb=cle==='autres'?allTypes.slice(3).reduce((sum,key)=>sum+(counts.get(date+'|'+key)??0),0):counts.get(date+'|'+cle)??0;
  lines.push({jour_iso:date,cle,nb});
 }
 return {du:day(from),au:day(to-1),calendrier:[...totals.values()],calendrier_par_type:{types:curves.map(cle=>({cle,libelle:cle})),lignes:lines},offset:query.offset??0};
}
export function calendarOracle(query,actor){
 assert(typeof actor==='string'&&actor.length>0);
 const from=literal(query.from)+'::timestamptz',to=literal(query.to)+'::timestamptz';
 const cabinet=`(SELECT cabinet_id FROM app.profiles WHERE id=${literal(actor)}::uuid AND role='owner')`;
 const [record]=inspectSql(`SELECT json_build_object('owner',EXISTS(SELECT 1 FROM app.profiles WHERE id=${literal(actor)}::uuid AND role='owner'),'payments',coalesce((SELECT json_agg(json_build_object('createdAt',p.created_at,'collectedAt',p.collected_at,'amount',p.amount_dzd,'kind',a.kind::text)) FROM app.payments p LEFT JOIN app.consultations c ON c.id=p.consultation_id LEFT JOIN app.appointments a ON a.id=c.appointment_id WHERE p.cabinet_id=${cabinet} AND ((p.collected_at>=${from} AND p.collected_at<${to}) OR (p.collected_at IS NULL AND p.created_at>=${from} AND p.created_at<${to}))),'[]'));`);
 assert(record?.owner===true&&Array.isArray(record.payments),'IndependentOwnerScopeRequired');
 return expectedCalendar(record.payments,query);
}
export function calendarDataMatches(raw,expected){
 return raw?.du===expected.du&&raw?.au===expected.au&&isDeepStrictEqual(raw?.calendrier,expected.calendrier)&&isDeepStrictEqual(raw?.calendrier_par_type,expected.calendrier_par_type);
}
export function calendarPresentationMatches(answer,expected){
 const page=expected.calendrier.slice(expected.offset,expected.offset+20);
 const actual=answer.split(/\r?\n/u).filter(line=>/^\d{4}-\d{2}-\d{2} — \d+ DZD/u.test(line));
 if(actual.length!==page.length)return false;
 if(!page.every((row,index)=>actual[index]===`${row.jour_iso} — ${row.montant} DZD — ${row.nb_seances} paiements encaissés${row.a_impaye?' — présence d’un impayé':''}`))return false;
 const pageDays=new Set(page.map(row=>row.jour_iso)),types=expected.calendrier_par_type.lignes.filter(row=>pageDays.has(row.jour_iso));
 const typeName=key=>key==='__non_rattache__'?'Paiement sans rendez-vous lié':key.replace(/_/gu,' ').replace(/^./u,c=>c.toLocaleUpperCase('fr'));
 const typeLines=answer.split(/\r?\n/u).filter(line=>/^\d{4}-\d{2}-\d{2} — /u.test(line)&&!/^\d{4}-\d{2}-\d{2} — \d+ DZD/u.test(line));
 if(typeLines.length!==types.length||!types.every((row,index)=>typeLines[index]===`${row.jour_iso} — ${typeName(row.cle)} : ${row.nb} paiements encaissés`))return false;
 return answer.includes(`Période du ${expected.du} au ${expected.au} inclus.`)&&
  (expected.offset+page.length>=expected.calendrier.length||answer.includes(`Liste partielle : ${expected.offset+1}–${expected.offset+page.length} / ${expected.calendrier.length}.`));
}
