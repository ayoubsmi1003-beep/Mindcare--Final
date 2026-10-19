export const messageDraftCopy={
 review:(body:string)=>`Brouillon non envoyé, à relire et copier si nécessaire : « ${body} » Aucun message n’a été envoyé ni enregistré.`,
 reminder:(name:string,date:string,requested:boolean)=>requested?`Bonjour ${name}, votre demande de rendez-vous pour le ${date} reste à confirmer par le cabinet.`:`Bonjour ${name}, votre rendez-vous au cabinet est prévu le ${date}.`,
 document:(name:string)=>`Bonjour ${name}, un document émis est enregistré dans votre dossier au cabinet. Vous pouvez contacter le cabinet pour convenir de sa remise.`,
 noAppointment:'Aucun rendez-vous à venir visible pour ce patient : aucun rappel n’a été préparé.',
 noDocument:'Aucun document émis visible pour ce patient : aucun message de mise à disposition n’a été préparé.',
};
