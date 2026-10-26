import {isDeepStrictEqual} from 'node:util';
/** A missing mode on record reads is the default list, not an exemption from member checks. */
export function recordMembershipMatches(data,expected,query){
 if(query.mode!==undefined&&!['list','first'].includes(query.mode))return true;
 const offset=query.offset??0;
 if(!Number.isSafeInteger(offset)||offset<0||!Array.isArray(data?.rows)||!Array.isArray(expected?.ids))return false;
 const ids=expected.ids.slice(offset,offset+20);
 return data.rows.length===ids.length&&data.rows.every((row,index)=>row?.id===ids[index]);
}
/** The first appointment is an ordered selection, not a request for the full count or a names page. */
export function firstAppointmentPresented(answer,sources,expected,asOf){
 const shown=sources.filter(source=>source.type==='appointment');
 if(expected.total===0)return shown.length===0&&/\b0 rendez-vous\b/u.test(answer);
 const first=expected.first;
 if(!first||shown.length!==1||shown[0].id!==first.id||typeof first.name!=='string'||!answer.includes(first.name))return false;
 const parts=answer.split(/\r?\n/u).filter(line=>line.trim());
 if(parts.length!==2||parts[0]!=='Premier rendez-vous de la période demandée.')return false;
 const format=new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Algiers',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const clock=format.format(new Date(first.at)),[hour,minute]=clock.split(':');
 const time=Number(hour)+' h'+(minute==='00'?'':' '+minute);
 if(!parts[1].startsWith(first.name+' : ')||!parts[1].includes(' à '+time+' ('))return false;
 const civil=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Algiers'}).format(new Date(value));
 const difference=Math.round((Date.parse(civil(first.at)+'T12:00:00Z')-Date.parse(civil(asOf)+'T12:00:00Z'))/86400000);
 const count=new Intl.NumberFormat('fr').format(Math.abs(difference));
 const relative=difference===0?'aujourd’hui':difference===1?'demain':difference===-1?'hier':difference===2?'après-demain':difference===-2?'avant-hier':difference>0?`dans ${count} jours`:`il y a ${count} jours`;
 const status={requested:'Demandé',confirmed:'Confirmé',arrived:'Arrivé',in_session:'En consultation',completed:'Terminé',no_show:'Absent',cancelled:'Annulé'}[first.status];
 return !!status&&parts[1].includes(relative+' à ')&&parts[1].endsWith(` (${status}).`);
}

/** Independent ordered payment identities must retain their own patient and amount. */
export function financialRowsMatch(actual,expected){
 if(!Array.isArray(actual)||!Array.isArray(expected)||actual.length!==expected.length)return false;
 return actual.every((row,index)=>{
  const truth=expected[index];
  return row&&truth&&typeof truth.id==='string'&&truth.id.length>0&&typeof truth.patientId==='string'
   &&Number.isSafeInteger(truth.amount)&&truth.amount>=0
   &&row.id===truth.id&&row.patientId===truth.patientId&&row.amount===truth.amount;
 });
}
/** Totals require their own verified labels; an unrelated occurrence of the sum is insufficient. */
export function financialTotalsMatch(answer,summary,query={}){
 if(typeof answer!=='string'||!summary||!['total','pendingDzd','collectedDzd','unpriced','amount'].every(k=>Number.isSafeInteger(summary[k])&&summary[k]>=0)||summary.amount!==summary.pendingDzd+summary.collectedDzd)return false;
 if(query.state==='collected'){
  const text=answer.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
  const amounts=[...text.matchAll(/(?:^|\D)(\d[\d\s\u00a0\u202f]*)\s*dzd\b/gu)];
  if(amounts.length!==1||Number(amounts[0][1].replace(/\s/gu,''))!==summary.collectedDzd)return false;
  const start=amounts[0].index??0,end=start+amounts[0][0].length;
  return /\b(?:encaiss\w*|collect\w*)\b/u.test(text.slice(Math.max(0,start-120),Math.min(text.length,end+40)));
 }
 const normalize=value=>value.normalize('NFKC').replace(/\s+/gu,' ').trim().toLowerCase();
 let rest=normalize(answer);
 const headers=[`${summary.total} Résultat(s)`,`${summary.total} résultat${summary.total<=1?'':'s'}`].map(normalize);
 const header=headers.find(value=>rest===value||rest.startsWith(value+' '));if(!header)return false;
 rest=rest.slice(header.length).trim();
 const footer=summary.dateAxis==='collected_at'?'Période selon la date d’encaissement.':summary.dateAxis==='created_at'?'Période selon la création du paiement ; les consultations sans tarif sont comptées séparément.':null;
 if(!footer)return false;
 for(const atom of [`Solde connu à encaisser (DZD) : ${summary.pendingDzd}`,`Encaissements (DZD) : ${summary.collectedDzd}`,`Consultations sans tarif : ${summary.unpriced}`,footer].map(normalize)){
  const at=rest.indexOf(atom);
  if(at<0||(at>0&&rest[at-1]!==' ')||(at+atom.length<rest.length&&rest[at+atom.length]!==' '))return false;
  rest=(rest.slice(0,at)+' '+rest.slice(at+atom.length)).trim();
 }
 return rest==='';
}
/** A correct gate total does not prove that the requested members were presented. */
/** @param {{total:number,pendingDzd:number,collectedDzd:number,unpriced:number,dateAxis?:string}|null} [summary] */
export function financialPresentationMatches(answer,expected,summary=null){
 if(typeof answer!=='string'||!Array.isArray(expected)||!summary
  ||!['total','pendingDzd','collectedDzd','unpriced'].every(k=>Number.isSafeInteger(summary[k])&&summary[k]>=0))return false;
 const normalized=value=>value.normalize('NFKC').replace(/\s+/gu,' ').trim();
 const fold=value=>normalized(value).normalize('NFKD').replace(/\p{M}/gu,'').replace(/’/gu,"'").toLowerCase();
 if(expected.length===0&&summary.total===0&&/\baucun paiement\b/u.test(fold(answer))&&!/\b\d[\d\s.,]*\s*dzd\b/u.test(fold(answer)))return true;
 const headers=[`${summary.total} Résultat(s)`,`${summary.total} résultat${summary.total<=1?'':'s'}`].map(fold);
 const allowed=new Set([...headers,
  `Solde connu à encaisser (DZD) : ${summary.pendingDzd}`,`Encaissements (DZD) : ${summary.collectedDzd}`,
  `Consultations sans tarif : ${summary.unpriced}`,
  ...(summary.dateAxis==='collected_at'?['Période selon la date d’encaissement.']:summary.dateAxis==='created_at'?['Période selon la création du paiement ; les consultations sans tarif sont comptées séparément.']:[]),
  ...(summary.total>20?[`1–20 / ${summary.total}`,`1-20 / ${summary.total}`]:[]),
 ].map(fold));
 const rows=[];let hasHeader=false;
 for(const line of answer.split(/\r?\n/u).filter(line=>line.trim())){
  const text=fold(line);
  if(allowed.has(text)){if(headers.includes(text))hasHeader=true;continue;}
  rows.push(normalized(line));
 }
 return hasHeader&&rows.length===expected.length&&rows.every((row,index)=>{
  const truth=expected[index];
  if(!truth||typeof truth.label!=='string'||!Number.isSafeInteger(truth.amount)||!Number.isFinite(Date.parse(truth.at))||!['pending','collected'].includes(truth.status))return false;
  // Formatting follows the public French contract; all values come from the independent SQL oracle.
  const when=new Date(truth.at).toLocaleString('fr-DZ',{timeZone:'Africa/Algiers'});
  return row===normalized(`${truth.label} — ${when} — ${truth.status==='collected'?'Encaissé':'À encaisser'} — ${truth.amount} DZD`);
 });
}

/** Gate identity and all material arguments matter even when totals coincide. */
export function recordReadMatches(observed,oracle,bindings){
 if(observed.name!=='query_alexa_records'||observed.args.p_domain!==oracle.domain)return false;
 let actual;try{actual=JSON.parse(observed.args.p_spec);}catch{return false;}
 const expected={...oracle.query};
 // Agenda count/list is an editorial intent; its closed SQL spec has no mode.
 if(oracle.domain==='agenda'){delete expected.mode;delete expected.limit;}
 if(expected.patientRef){if(!bindings[expected.patientRef])return false;expected.patientId=bindings[expected.patientRef];delete expected.patientRef;}
 if(expected.axis){expected.dateAxis=expected.axis;delete expected.axis;}
 const canonical=spec=>{
  const copy={...spec};
  // These defaults cannot change the result set or its first requested page.
  if(copy.mode==='list')delete copy.mode;
  if(copy.limit===20)delete copy.limit;if(copy.offset===0)delete copy.offset;
  if(oracle.domain==='consultations'&&(copy.dateAxis===undefined||copy.dateAxis==='started_at'))delete copy.dateAxis;
  if(oracle.domain==='consultations'&&copy.status==='all')delete copy.status;
  if(oracle.domain==='finance'&&copy.state==='all')delete copy.state;
  if(oracle.domain==='documents'&&(copy.status===undefined||copy.status==='issued'))delete copy.status;
  for(const k of ['from','to'])if(copy[k]!==undefined){const t=Date.parse(copy[k]);if(!Number.isFinite(t))return null;copy[k]=t;}
  if(Array.isArray(copy.statuses))copy.statuses=[...copy.statuses].sort();
  return copy;
 };
 const left=canonical(actual),right=canonical(expected);
 return left!==null&&right!==null&&isDeepStrictEqual(left,right);
}

/** Verifies each side of a two-period consultation comparison against its own source query. */
export function assessRecordComparison(expected,queries,answer){
 const failures=[];
 if(expected?.domain!=='consultations'||!Array.isArray(expected.periods)||expected.periods.length!==2){return ['comparison-oracle-invalid'];}
 const reads=queries.filter(query=>query.name==='query_alexa_records'&&query.args?.p_domain==='consultations');
 if(reads.length!==expected.periods.length)failures.push('comparison-read-count');
 const matches=[];
 for(const period of expected.periods){
  const oracle={domain:'consultations',query:{...(expected.patientId?{patientId:expected.patientId}:{}),from:period.from,to:period.to,dateAxis:expected.axis,status:expected.status,mode:'count'}};
  const found=reads.filter(query=>recordReadMatches(query,oracle,{}));
  if(found.length!==1){failures.push('comparison-month-read-missing');matches.push(null);continue;}
  const data=found[0].response?.ok===true?found[0].response.data:null;
  const result=Array.isArray(data)?data.length===1?data[0]:null:data;
  if(!result||result.total!==period.total)failures.push('comparison-independent-count');
  matches.push(result);
 }
 const normalized=String(answer??'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').replace(/\s+/gu,' ');
 const positions=expected.periods.map(period=>normalized.indexOf(String(period.label).normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr')));
 for(let index=0;index<expected.periods.length;index++){
  const period=expected.periods[index],position=positions[index];
  if(position<0){failures.push('comparison-month-not-presented');continue;}
  const next=positions.filter(other=>other>position).sort((a,b)=>a-b)[0]??normalized.length;
  let segment=normalized.slice(position,next).normalize('NFKC').replace(/(?<=\p{N})\p{White_Space}+(?=\p{N})/gu,'');
  const numeric=new RegExp('(?:^|\\D)'+period.total+'(?:\\D|$)','u').test(segment),explicitEmpty=period.total===0&&/\b(?:aucun\w*|aucune|pas de)\s+(?:consultation|seance)/u.test(segment);
  if(!numeric&&!explicitEmpty)failures.push('comparison-count-not-presented');
 }
 return [...new Set(failures)];
}
