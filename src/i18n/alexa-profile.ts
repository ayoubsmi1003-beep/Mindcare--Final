export const profileCopy={
 nameLabel:'Nom',
 name:(value:string,missing:string)=>value===missing?'Le nom du patient n’est pas renseigné.':`Le nom enregistré dans le dossier est ${value}.`,
 one:(name:string,fields:readonly string[])=>`Pour ${name}, ${fields.join(' ; ')}.`,
 singleField:(name:string,field:string,label:string,value:string,missing:string)=>{
  if(field==='id_document_number')return value===missing?`Pour ${name}, aucun numéro de CNI n’est renseigné dans le dossier.`:`Pour ${name}, le numéro de CNI enregistré est ${value}.`;
  if(field==='phone')return value===missing?`Pour ${name}, aucun numéro de téléphone n’est renseigné dans le dossier.`:`Pour ${name}, le téléphone enregistré est ${value}.`;
  if(field==='phone_alt')return value===missing?`Pour ${name}, aucun téléphone secondaire n’est renseigné dans le dossier.`:`Pour ${name}, le téléphone secondaire enregistré est ${value}.`;
  if(field==='birth_date')return value===missing?`Pour ${name}, la date de naissance n’est pas renseignée dans le dossier.`:`Pour ${name}, la date de naissance enregistrée est ${value}.`;
  if(field==='age')return value===missing?`Pour ${name}, l’âge ne peut pas être déterminé, car sa date de naissance n’est pas renseignée.`:value==='Date de naissance incohérente'?`Pour ${name}, la date de naissance enregistrée est incohérente.`:`${name} a ${value}.`;
  if(field==='address')return value===missing?`Aucune adresse n’est renseignée dans le dossier de ${name}.`:`L’adresse enregistrée pour ${name} est ${value}.`;
  if(field==='sex')return value===missing?`Le sexe de ${name} n’est pas renseigné dans le dossier.`:`Dans le dossier de ${name}, le sexe est indiqué comme « ${value.toLowerCase()} ».`;
  if(field==='marital_status')return value===missing?`La situation familiale de ${name} n’est pas renseignée dans le dossier.`:`La situation familiale de ${name} est indiquée comme « ${value} ».`;
  if(field==='record_number')return value===missing?`Le numéro de dossier de ${name} n’est pas renseigné.`:`Le numéro de dossier de ${name} est ${value}.`;
  if(field==='id_document_issuer')return value===missing?`L’autorité de délivrance de la pièce d’identité de ${name} n’est pas renseignée.`:`La pièce d’identité de ${name} a été délivrée par ${value}.`;
  if(field==='emergency_contact')return value===missing?`Aucun contact d’urgence n’est renseigné dans le dossier de ${name}.`:`Le contact d’urgence renseigné pour ${name} est ${value}.`;
  if(field==='is_active')return `Le dossier de ${name} est ${value.toLowerCase()}.`;
  if(field==='notes_admin')return value===missing?`Aucune note administrative n’est renseignée dans le dossier de ${name}.`:`La note administrative du dossier de ${name} indique : ${value}.`;
  return `Pour ${name}, ${label.toLowerCase()} : ${value}.`;
 },
 ageLabel:'Âge',age:(years:number)=>`${years} ans`,invalidBirth:'Date de naissance incohérente',
 askField:'Quelle information administrative souhaitez-vous : téléphone, identité, naissance, adresse ou fiche complète ?',
 emailUnavailable:'Le champ e-mail du patient n’est pas pris en charge. Les autres coordonnées restent consultables.',
};
