export const profileCopy={
 one:(name:string,fields:readonly string[])=>`Pour ${name}, ${fields.join(' ; ')}.`,
 ageLabel:'Âge',age:(years:number)=>`${years} ans`,invalidBirth:'Date de naissance incohérente',
 askField:'Quelle information administrative souhaitez-vous : téléphone, identité, naissance, adresse ou fiche complète ?',
 emailUnavailable:'Le champ e-mail du patient n’est pas pris en charge. Les autres coordonnées restent consultables.',
};
