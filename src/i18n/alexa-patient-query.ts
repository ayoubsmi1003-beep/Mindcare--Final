const fields={phone:'téléphone',identity_card:'carte d’identité',birth_date:'date de naissance',sex:'sexe'} as const;
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
