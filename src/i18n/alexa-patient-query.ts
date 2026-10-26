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
