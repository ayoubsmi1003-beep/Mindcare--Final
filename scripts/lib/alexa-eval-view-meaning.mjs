import {answerContainsCount} from './alexa-eval-readonly.mjs';
const fold=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr');
const payload=read=>{const value=read?.response?.ok===false?null:read?.response?.data??read?.response;return Array.isArray(value)?value[0]??null:value;};
const ids=rows=>Array.isArray(rows)?rows.map(row=>row.id).sort():[];

export function assessFinanceView(oracle,expected,queries,calls,answer){
 const failures=[],view=oracle?.view??'',text=fold(answer),read=queries.find(q=>q.name==='get_charges_list'),data=payload(read),overview=payload(queries.find(q=>q.name==='get_finance_overview'));
 if(['charges','recurring_charges'].includes(view)){
  if(!read||!data)failures.push('independent-finance-charge-read-missing');
  if(view==='charges'){
   if(data?.total_ponctuel_periode!==expected.punctualPeriod||data?.total_recurrent_mensuel!==expected.recurringMonthly)failures.push('independent-finance-charge-total');
   if(!answerContainsCount(answer,expected.punctualPeriod)||!text.includes('charge'))failures.push('finance-charge-total-not-presented');
  }else{
   const actual=Array.isArray(data?.lignes)?data.lignes.filter(row=>row.type==='recurrente'):[];
   if(JSON.stringify(ids(actual))!==JSON.stringify(ids(expected.recurringRows)))failures.push('independent-recurring-charge-membership');
   if(expected.recurringRows.some(row=>!text.includes(fold(row.name))))failures.push('recurring-charge-name-not-presented');
   if(!expected.recurringRows.length&&!/aucun|aucune/u.test(text))failures.push('empty-recurring-charges-not-stated');
  }
  return failures;
 }
 const recordReads=queries.filter(q=>q.name==='query_alexa_records').map(q=>{let spec={};try{spec=JSON.parse(q.args.p_spec);}catch{}return {spec,data:payload(q)};});
 const zero=amount=>amount===0&&/aucun|aucune|\b0\b/u.test(text);
 const includesAmount=amount=>answerContainsCount(answer,amount)||zero(amount);
 if(view==='outstanding'){
  const measured=overview?.pulse?.impayes_total??recordReads.find(x=>(x.spec.state??x.spec.status)==='pending')?.data?.totals?.pendingDzd;
  const count=overview?.pulse?.impayes_count;
  if(measured!==expected.outstandingAmount||count!==undefined&&count!==expected.outstandingCount)failures.push('independent-outstanding-total');
  if(!includesAmount(expected.outstandingAmount)||expected.outstandingAmount>0&&!/impaye|encaisser|rest\w* a payer/u.test(text))failures.push('outstanding-total-not-presented');
  return failures;
 }
 if(view==='unpriced'){
  const unpriced=recordReads.find(x=>x.data?.totals?.unpriced!==undefined);
  const measured=unpriced?.data?.totals?.unpriced;
  if(unpriced?.spec.consultationStatus!=='closed')failures.push('unpriced-consultation-status-missing');
  if(measured!==expected.unpricedCount)failures.push('independent-unpriced-count');
  if(!includesAmount(expected.unpricedCount)||expected.unpricedCount>0&&!/consultation|seance/u.test(text))failures.push('unpriced-count-not-presented');
  return failures;
 }
 if(view==='compare_dates'){
  const created=recordReads.find(x=>(x.spec.state??x.spec.status)==='all'&&x.data?.totals),collected=recordReads.find(x=>(x.spec.state??x.spec.status)==='collected'&&x.data?.totals);
  const createdAmount=created?.data.totals.amount??(typeof created?.data.totals.pendingDzd==='number'&&typeof created?.data.totals.collectedDzd==='number'?created.data.totals.pendingDzd+created.data.totals.collectedDzd:undefined);
  const collectedAmount=collected?.data.totals.amount??collected?.data.totals.collectedDzd;
  if(!created||!collected||createdAmount!==expected.createdAmount||collectedAmount!==expected.collectedAmount)failures.push('independent-created-collected-totals');
  if(!includesAmount(expected.createdAmount)||!includesAmount(expected.collectedAmount)||!/(cree|creation)/u.test(text)||!/(encaisse|recette)/u.test(text))failures.push('created-collected-distinction-not-presented');
  if(!calls.some(c=>c.name==='query_finance'&&c.args.mode==='totals'))failures.push('created-collected-finance-tool-missing');
  return failures;
 }
 if(view==='net'){
  const pulse=overview?.pulse;
  if(!pulse||pulse.revenu_periode!==expected.collectedAmount||pulse.charges_periode!==expected.chargeTotal||pulse.resultat_net_periode!==expected.net)failures.push('independent-net-finance-totals');
  const negativeNetPresented=expected.net<0&&text.includes(fold(new Intl.NumberFormat('fr-FR').format(expected.net)));
  if(!(negativeNetPresented||includesAmount(expected.net))||!/(resultat net|solde net|net)/u.test(text))failures.push('net-result-not-presented');
  return failures;
 }
 if(view==='charge_composition'){
  const actual=overview?.composition?.charges_par_categorie;
  const canonical=rows=>Array.isArray(rows)?rows.map(row=>[row.cle??row.category,row.montant??row.amount]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))):[];
  const wanted=canonical(expected.chargeCategories),received=canonical(actual);
  if(JSON.stringify(received)!==JSON.stringify(wanted))failures.push('independent-charge-category-amounts');
  if(wanted.some(([category,amount])=>!text.includes(fold(category))||!answerContainsCount(answer,amount)))failures.push('charge-category-not-presented');
  return failures;
 }
 return ['finance-view-check-unsupported'];
}
