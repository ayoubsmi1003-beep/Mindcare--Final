import {recordReadMatches} from './alexa-eval-record-meaning.mjs';
import {assessPatientDetail} from './alexa-eval-clinical-meaning.mjs';
import {answerContainsCount} from './alexa-eval-readonly.mjs';

const fold=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr');
const payload=read=>{const value=read?.response?.ok===false?null:read?.response?.data??read?.response;return Array.isArray(value)?value[0]??null:value;};
const queryMeaning=q=>({population:q.population??'active',mode:q.mode,query:q.query??null,sort:q.sort??'name',patientIds:q.patientIds??null,metrics:q.metrics??null,offset:q.offset??0,limit:q.limit??20,groups:(q.filterGroups??[q.filters??[]]).map(g=>g.map(c=>JSON.stringify(c)).sort()).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),consultationPeriod:q.consultationPeriod??null,createdPeriod:q.createdPeriod??null});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hasValueNearTerms=(answer,value,terms)=>{
 const text=fold(answer),digits=String(value).split('').join('[\\s\\u00a0\\u202f]*'),pattern=new RegExp('(?:^|\\D)'+digits+'(?:\\D|$)','gu');
 for(const match of text.matchAll(pattern)){
  const start=Math.max(0,match.index-90),end=Math.min(text.length,match.index+match[0].length+90),window=text.slice(start,end);
  if(terms.some(term=>window.includes(fold(term))))return true;
 }
 return false;
};
const idLike=/\b(?:patient|consultation|note)-[a-f0-9]{6,}\b/iu;

/** Checks each part of a mixed app question against a separate independent read oracle. */
export function assessMixedAppAnswer(oracle,expected,queries,calls,sentences,answer,bindings={}){
 if(oracle?.patientRef&&expected?.patient)return assessPatientDetail(oracle,expected,queries,calls,sentences,answer);
 const failures=[];
 if(idLike.test(answer))failures.push('mixed-app-internal-id-presented');
 for(const check of expected?.checks??[]){
  if(check.kind==='patients'){
   let read=null,spec=null;
   for(const candidate of queries.filter(q=>q.name==='search_patients')){
    try{const parsed=JSON.parse(candidate.args.p_spec);if(same(queryMeaning(parsed),queryMeaning(check.query))){read=candidate;spec=parsed;break;}}catch{}
   }
   if(!read){failures.push('mixed-app-constraint-not-preserved');continue;}
   const data=payload(read);
   if(data?.total!==check.result?.total)failures.push('mixed-app-independent-count-mismatch');
   const filters=(check.query?.filterGroups??[check.query?.filters??[]]).flat();
   const missingField=filters.find(filter=>filter.op==='missing')?.field;
   const labelAliases=missingField==='identity_card'?['carte d’identité','numéro de carte d’identité','carte d’identité renseigné','CNI']:missingField==='phone'?['téléphone','numéro de téléphone','portable']:[];
   const labelOk=[...(check.terms??[]),...labelAliases].some(term=>fold(answer).includes(fold(term)));
   const countOk=answerContainsCount(answer,check.result?.total)||check.result?.total===0&&/\b(?:aucun|aucune|zero)\b/iu.test(fold(answer));
   if(!countOk||!labelOk)failures.push('mixed-app-count-not-presented');
   if(check.listLimit!==undefined&&check.result?.ids){
    const limit=check.listLimit,expectedIds=check.result.ids.slice(0,limit),actualIds=(data?.rows??[]).slice(0,limit).map(row=>row.id);
    if(!same(actualIds,expectedIds))failures.push('mixed-app-page-membership-mismatch');
    if(check.result.names?.slice(0,limit).some(name=>!fold(answer).includes(fold(name))))failures.push('mixed-app-patient-name-not-presented');
    if(check.result.total===0&&!/\b(?:aucun|aucune|zero)\b/iu.test(fold(answer)))failures.push('mixed-app-empty-list-not-stated');
   }
   continue;
  }
  if(check.kind==='records'){
   const read=queries.find(candidate=>recordReadMatches(candidate,{domain:check.domain,query:check.query},bindings));
   if(!read){failures.push('mixed-app-independent-read-missing');continue;}
   const data=payload(read);
   if(data?.total!==check.result?.total)failures.push('mixed-app-independent-count-mismatch');
   const state=check.query?.state;
   const actualAmount=state==='collected'?(data?.totals?.collectedDzd??data?.totals?.amount??data?.amount):state==='pending'?(data?.totals?.pendingDzd??data?.totals?.amount??data?.amount):(data?.totals?.amount??data?.amount);
   if(check.result?.amount!==undefined&&actualAmount!==check.result.amount)failures.push('mixed-app-independent-amount-mismatch');
   const value=check.result?.amount??check.result?.total,terms=[...(check.terms??[])];
   if(check.domain==='finance'&&state==='collected')terms.push('montant encaissé','montant encaisse','encaissé','encaissée','encaissés','encaissement');
   if(check.domain==='finance'&&state==='pending')terms.push('montant en attente','impayé','impayée','reste à payer');
   const statedZero=value===0&&/\b(?:aucun|aucune|zero|ne\s+compte\s+aucun)\b/iu.test(fold(answer))&&terms.some(term=>fold(answer).includes(fold(term)));
   if(!(answerContainsCount(answer,value)||statedZero)||!terms.length||!(hasValueNearTerms(answer,value,terms)||statedZero))failures.push('mixed-app-value-not-presented');
   if(check.unit&&!/\b(?:dzd|da|dinars?)\b/iu.test(fold(answer))&&value!==0)failures.push('mixed-app-amount-unit-missing');
   if(check.listLimit!==undefined&&check.result?.ids){
    const limit=check.listLimit,expectedIds=check.result.ids.slice(0,limit),actualIds=(data?.rows??[]).slice(0,limit).map(row=>row.id);
    if(!same(actualIds,expectedIds))failures.push('mixed-app-record-membership-mismatch');
    if(check.result.namedRows?.slice(0,limit).some(row=>row.name&&!fold(answer).includes(fold(row.name))))failures.push('mixed-app-record-name-not-presented');
   }
   continue;
  }
  failures.push('mixed-app-check-unsupported');
 }
 return failures;
}
