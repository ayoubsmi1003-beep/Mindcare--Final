const fields={phone:'téléphone',identity_card:'carte d’identité',birth_date:'date de naissance',sex:'sexe'} as const;
type ConsultationPeriod={from:string;to:string;axis:'started_at'|'ended_at'};
function completeMonthLabel(period:ConsultationPeriod):string|null {
 const start=period.from.match(/^(\d{4})-(\d{2})-01T00:00:00(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/u);
 if(!start)return null;
 const year=Number(start[1]),month=Number(start[2]);
 if(month<1||month>12)return null;
 const nextYear=month===12?year+1:year,nextMonth=month===12?1:month+1;
 const nextStart=`${nextYear}-${String(nextMonth).padStart(2,'0')}-01T00:00:00${start[3]}`;
 if(!period.to.startsWith(nextStart))return null;
 return new Intl.DateTimeFormat('fr-DZ',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(year,month-1,15)));
}
export function completedConsultationCountParagraph(total:number,threshold:number,period:ConsultationPeriod):string|null {
 const month=completeMonthLabel(period);
 if(!month||total<0||threshold<1)return null;
 const detail=period.axis==='started_at'?`consultations commencées dans le mois et terminées`:`consultations clôturées dans le mois`;
 if(total===0)return `En ${month}, aucun patient actif n’a eu au moins ${threshold} ${detail}.`;
 const patients=new Intl.NumberFormat('fr-DZ').format(total);
 return `En ${month}, ${patients} patient${total>1?'s':''} actif${total>1?'s':''} ont eu au moins ${threshold} ${detail}.`;
}
type PatientCountCondition={field:string;op:string;value?:unknown};
function patientCountCriterion(condition:PatientCountCondition):string|null {
 const value=typeof condition.value==='number'?new Intl.NumberFormat('fr-DZ').format(condition.value):null;
 if(condition.field==='phone'&&condition.op==='missing')return 'sans numéro de téléphone';
 if(condition.field==='identity_card'&&condition.op==='missing')return 'sans numéro de carte d’identité';
 if(condition.field==='birth_date'&&condition.op==='missing')return 'sans date de naissance renseignée';
 if(condition.field==='sex'&&condition.op==='eq'&&condition.value==='F')return 'de sexe féminin';
 if(condition.field==='sex'&&condition.op==='eq'&&condition.value==='M')return 'de sexe masculin';
 if(condition.field==='completed_consultations'&&value){
  const threshold=Number(condition.value),visits=threshold===1?'une consultation terminée':`${value} consultations terminées`;
  if(condition.op==='gte')return `avec au moins ${visits}`;
  if(condition.op==='gt')return `avec plus de ${value} consultation${threshold===1?'':'s'} terminée${threshold===1?'':'s'}`;
  if(condition.op==='eq')return `avec exactement ${value} consultation${threshold===1?'':'s'} terminée${threshold===1?'':'s'}`;
  if(condition.op==='lt')return `avec moins de ${value} consultation${threshold===1?'':'s'} terminée${threshold===1?'':'s'}`;
  if(condition.op==='lte')return `avec au plus ${visits}`;
 }
 if(condition.field==='age'&&value){
  if(condition.op==='lt')return `âgés de moins de ${value} ans`;
  if(condition.op==='lte')return `âgés de ${value} ans ou moins`;
  if(condition.op==='gt')return `âgés de plus de ${value} ans`;
  if(condition.op==='gte')return `âgés d’au moins ${value} ans`;
  if(condition.op==='eq')return `âgés de ${value} ans`;
 }
 if(condition.field==='no_completed_months'&&value&&condition.op==='eq')return `sans consultation terminée depuis ${value} mois`;
 if(condition.field==='no_completed_days'&&value&&condition.op==='eq')return `sans consultation terminée depuis ${value} jours`;
 if(condition.field==='administrative_incomplete'&&condition.op==='eq'&&condition.value===true)return 'avec au moins un champ administratif manquant';
 if(condition.field==='outstanding_balance'&&value){
  if(condition.op==='gt'&&Number(condition.value)===0)return 'avec un solde impayé';
  if(condition.op==='gt')return `avec un solde supérieur à ${value} DZD`;
  if(condition.op==='gte')return `avec un solde supérieur ou égal à ${value} DZD`;
  if(condition.op==='lt')return `avec un solde inférieur à ${value} DZD`;
  if(condition.op==='lte')return `avec un solde inférieur ou égal à ${value} DZD`;
  if(condition.op==='eq')return `avec un solde de ${value} DZD`;
 }
 return null;
}
export function filteredPatientCountParagraph(total:number,population:'active'|'archived'|'all',conditions:readonly PatientCountCondition[]):string {
 const formatted=new Intl.NumberFormat('fr-DZ').format(total),scope=population==='active'?'patients actifs':population==='archived'?'patients archivés':'patients';
 const subject=population==='active'?'patient actif':population==='archived'?'patient archivé':'patient';
 if(conditions.length===1&&conditions[0]?.field==='no_completed_months'&&conditions[0].op==='eq'&&typeof conditions[0].value==='number'){
  const months=new Intl.NumberFormat('fr-DZ').format(conditions[0].value);
  if(total===0)return `Aucun ${subject} n’a eu de consultation terminée depuis ${months} mois.`;
  return `Parmi les ${scope}, ${formatted} ${total===1?'n’a':'n’ont'} pas eu de consultation terminée depuis ${months} mois, y compris ${total===1?'celui':'ceux'} qui n’en ont jamais eu.`;
 }
 const criteria=conditions.map(patientCountCriterion).filter((value):value is string=>value!==null);
 if(total===0)return `Aucun ${subject} ne répond${subject.startsWith('patient')?'':' pas'} aux critères${criteria.length?` : ${criteria.join(' et ')}`:' de cette recherche'}.`;
 return `Parmi les ${scope}, ${formatted} ${total===1?'répond':'répondent'} aux critères${criteria.length?` : ${criteria.join(' et ')}`:' de cette recherche'}.`;
}
export const patientQueryCopy={
 fieldUnresolved:(field:keyof typeof fields)=>'Condition de présence ou d’absence non résolue : '+fields[field],
 sexesUnresolved:'Combinaison de sexes non résolue',
 outputsUnresolved:'Sorties de population multiples non résolues',
 disjunctionUnresolved:'Disjonction non résolue',
 negationUnresolved:'Négation non résolue',
 periodUnresolved:'Période non résolue',
 axisAmbiguous:'Axe temporel ambigu',
 axisMissing:'Axe temporel non précisé',
 consultationsMissing:'Condition de consultations non précisée',
 consultationStatusUnsupported:'Statut de consultations non pris en charge pour ce filtre patient',
 emailUnsupported:'Courriel : champ patient non pris en charge',
 conditionUnsupported:'Condition patient non prise en charge',
 combinationUnsupported:'Combinaison non prise en charge',
} as const;
