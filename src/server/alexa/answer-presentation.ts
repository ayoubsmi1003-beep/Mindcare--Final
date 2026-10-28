import type {AgentResult} from '@/shared/alexa/agent';

type RecordValue=Record<string,unknown>;
const isRecord=(value:unknown):value is RecordValue=>!!value&&typeof value==='object'&&!Array.isArray(value);
const frNumber=(value:number)=>new Intl.NumberFormat('fr-FR').format(value);
function financePeriod(data:RecordValue):string{
 const from=typeof data.du==='string'?data.du:undefined,to=typeof data.au==='string'?data.au:undefined;
 if(!from||!to)return '';
 const first=new Date(`${from}T12:00:00+01:00`),last=new Date(`${to}T12:00:00+01:00`);
 if(Number.isNaN(first.getTime())||Number.isNaN(last.getTime()))return '';
 const month=new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric',timeZone:'Africa/Algiers'});
 if(first.getFullYear()===last.getFullYear()&&first.getMonth()===last.getMonth())return `En ${month.format(first)}, `;
 const date=new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'Africa/Algiers'});
 return `Du ${date.format(first)} au ${date.format(last)}, `;
}
function financeParagraph(result:AgentResult,question:string,detailed:boolean):string|undefined{
 if(!['ok','empty'].includes(result.status)||!isRecord(result.data))return;
 const plain=question.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase(),data=result.data,pulse=isRecord(data.pulse)?data.pulse:null;
  const explicitPaymentList=/\b(?:liste\w*|affich\w*|montre\w*)\b|\bquels?\s+(?:(?:sont|sont-ils)\s+)?(?:les\s+)?paiements?\b|\bquelle\s+liste\s+(?:des?\s+)?paiements?\b/u.test(plain);
  if(data.total===0&&Array.isArray(data.rows)&&data.rows.length===0&&/\bpaiements?\b/u.test(plain)&&explicitPaymentList)return /\b(?:en attente|impaye\w*|a encaisser|non encaisse\w*)\b/u.test(plain)?'Aucun paiement en attente ne correspond à cette demande.':'Aucun paiement ne correspond à cette demande.';
  if(detailed)return;
 if(pulse&&/\bchiffre d['’]affaires\b/u.test(plain)&&typeof pulse.revenu_periode==='number')return `${financePeriod(data)}les recettes encaissées du cabinet sont de ${frNumber(pulse.revenu_periode)} DZD.`;
 if(pulse&&/\b(?:resultat net|solde net)\b/u.test(plain)&&typeof pulse.resultat_net_periode==='number')return `${financePeriod(data)}${financePeriod(data)?'le':'Le'} résultat net du cabinet est de ${frNumber(pulse.resultat_net_periode)} DZD.`;
 const recurring=data.total_recurrent_mensuel,oneOff=data.total_ponctuel_periode,from=typeof data.du==='string'?data.du:undefined,to=typeof data.au==='string'?data.au:undefined;
 const monthStart=from?new Date(`${from}T12:00:00Z`):null,monthEnd=to?new Date(`${to}T12:00:00Z`):null;
 const oneMonth=!!monthStart&&!!monthEnd&&!Number.isNaN(monthStart.getTime())&&!Number.isNaN(monthEnd.getTime())&&monthStart.getUTCDate()===1&&monthStart.getUTCFullYear()===monthEnd.getUTCFullYear()&&monthStart.getUTCMonth()===monthEnd.getUTCMonth()&&monthEnd.getUTCDate()===new Date(Date.UTC(monthEnd.getUTCFullYear(),monthEnd.getUTCMonth()+1,0)).getUTCDate();
 if(oneMonth&&typeof recurring==='number'&&typeof oneOff==='number'&&/\b(?:total|combien|montant)\b/u.test(plain)&&/\bcharges?\b/u.test(plain))return `${financePeriod(data)}le total des charges est de ${frNumber(recurring+oneOff)} DZD, dont ${frNumber(recurring)} DZD récurrentes et ${frNumber(oneOff)} DZD ponctuelles.`;
 const composition=isRecord(data.composition)?data.composition:null;
 if(composition&&/\bcharges?\b/u.test(plain)&&/\b(?:repartition|reparti\w*|categories?)\b/u.test(plain)){
  const rows=Array.isArray(composition.charges_par_categorie)?composition.charges_par_categorie.filter(isRecord):[];
  if(!rows.length)return `${financePeriod(data)}${financePeriod(data)?'aucune':'Aucune'} charge n’est enregistrée pour cette période.`;
  const items=rows.map(row=>`${String(row.libelle??row.cle??'Catégorie')} : ${frNumber(Number(row.montant))} DZD${typeof row.part_pct==='number'?` (${frNumber(row.part_pct)} %)` : ''}`);
  return `${financePeriod(data)}les charges se répartissent ainsi : ${items.join(' ; ')}.`;
 }
 const totals=isRecord(data.totals)?data.totals:null;
 if(totals&&/\b(?:montant|total|somme|valeur)\b[^.!?]*\b(?:paiements?|encaisse\w*|recettes?)\b/u.test(plain)&&/\bencaisse\w*\b/u.test(plain)&&typeof totals.collectedDzd==='number')return totals.collectedDzd===0?'Sur la période demandée, le montant encaissé est de 0 DZD.':`Sur la période demandée, le montant encaissé est de ${frNumber(totals.collectedDzd)} DZD.`;
 if(totals&&/\b(?:consult\w*|seances?)\b/u.test(plain)&&/\b(?:sans tarif|non tarife\w*|sans prix|pas de tarif)\b/u.test(plain)&&typeof totals.unpriced==='number')return totals.unpriced===0?'Aucune consultation terminée sans tarif enregistré.':`${frNumber(totals.unpriced)} consultation${totals.unpriced===1?'':'s'} terminée${totals.unpriced===1?'':'s'} sans tarif enregistré.`;
 if(totals&&/\b(?:solde|reste a encaisser|impayes?)\b/u.test(plain)&&typeof totals.pendingDzd==='number'){
  const allTime=/\btoutes? dates? confondue?s?\b/u.test(plain),period=allTime?'Toutes dates confondues, ':financePeriod(data);
  return totals.pendingDzd===0?`${period}${period?'aucun':'Aucun'} solde ne reste à encaisser.`:`${period}${period?'le':'Le'} solde restant à encaisser est de ${frNumber(totals.pendingDzd)} DZD.`;
 }
 return;
}

/** Preserve requested lists and verbatim notes; simple verified facts form one paragraph. */
export function presentAgentResults(results:readonly AgentResult[],question:string):string[]{
 const detailed=/\b(?:liste\w*|noms?|lesquels|lesquelles|mot pour mot|lis|lire|detail\w*|integral\w*)\b/u.test(question.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase());
 const linked=results.some(r=>r.links?.length);
 const texts=results.filter(r=>r.text).map(r=>{const finance=financeParagraph(r,question,detailed||!!linked);const calendar=isRecord(r.data)&&isRecord(r.data.financeQuery)&&r.data.financeQuery.mode==='calendar';return finance??(detailed||linked||calendar?r.text:r.text.replace(/\s*\n\s*/gu,' ').trim());});
 return detailed||linked?texts:texts.length?[texts.join(' ')]:[];
}
