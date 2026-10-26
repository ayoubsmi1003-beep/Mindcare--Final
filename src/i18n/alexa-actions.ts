/**
 * Chaînes des actions cliniques exposées à Alexa.
 *
 * Elles vivent hors des composants : aucune action ne compose un libellé
 * visible dans son propre fichier. Les valeurs restent courtes, car elles sont
 * lues à voix haute et dans la carte de confirmation.
 */
const fieldLabels: Readonly<Record<string, string>> = {
  id_document_number: "le numéro de la pièce d'identité",
  mairie: "la mairie de délivrance",
  jours: "le nombre de jours d'arrêt",
  date_debut: "la date de début",
  date_naissance: "la date de naissance",
  traitement_1: "le traitement à faire figurer",
  date_consultation: "la date de consultation",
  medicament: "un médicament du traitement actif",
};

export const alexaActions = {
  missingDocumentField(field: string): string {
    return `Le dossier ne contient pas ${fieldLabels[field] ?? field}. Indiquez-le avant de préparer le document.`;
  },
  documentDraftTitle: "Préparer un document",
  documentDraftPatient: "Patient",
  documentDraftKind: "Type de document",
  documentDraftAutoFilled: "Champs préremplis depuis le dossier",
  documentDraftMedications: "Médicaments repris du traitement actif",
  documentDraftMissingTreatment: "Aucun traitement actif n'est disponible pour composer le certificat. Ajoutez le traitement au dossier ou indiquez-le explicitement.",
  documentDraftMissingMedication: "Aucun traitement actif ni aucune prescription ne permet de composer l'ordonnance. Ajoutez un médicament au dossier ou indiquez-le explicitement.",
  documentDraftMissing: "Je ne trouve pas de brouillon non émis correspondant dans ce dossier.",
  documentDraftAmbiguous: "Plusieurs brouillons correspondent. Précisez lequel modifier :",
  documentDraftFieldsMissing: "Indiquez le champ existant et sa nouvelle valeur exacte avant que je modifie le brouillon.",
  documentDraftUpdateTitle: "Modifier un brouillon de document",
  documentDraftUpdateVerified: "Le brouillon a été modifié et relu. Je l'ouvre dans Documents pour vérification.",
  documentDraftChangedField(field: string): string { return `Champ modifié — ${field}`; },
  documentDraftRevisionConflict: "Ce brouillon a changé depuis sa lecture. Rechargez-le avant de proposer une nouvelle modification.",
  treatmentMissing: "Quel traitement actif ou en pause dois-je modifier ou arrêter ?",
  treatmentAmbiguous: "Plusieurs traitements sont possibles. Précisez lequel :",
  treatmentChangeMissing: "Je n’ai pas pu associer une valeur au champ demandé. Précisez le champ et la valeur à modifier : dose, fréquence, moment de prise, consigne ou date de début/fin.",
  treatmentNoChange: "La valeur demandée correspond déjà au traitement enregistré. Aucune modification n'est proposée.",
  treatmentReasonNotGrounded: "Je n'ai pas pu vérifier le motif ou les notes d'arrêt dans votre demande. Reformulez-les explicitement.",
  treatmentConsultationChanged: "La consultation en cours a changé. Vérifiez le dossier puis reformulez la demande.",
  treatmentUpdateTitle: "Modifier un traitement",
  treatmentStopTitle: "Arrêter un traitement",
  treatmentName: "Traitement",
  treatmentDose: "Dose",
  treatmentDoseUnit: "Unité",
  treatmentFrequency: "Fréquence",
  treatmentTiming: "Moment de prise",
  treatmentInstructions: "Consignes",
  treatmentStartDate: "Date de début",
  treatmentEndDate: "Date de fin",
  treatmentFieldLabel(field: "dose"|"dose_unit"|"frequency"|"timing"|"instructions"|"start_date"|"end_date"): string {
    return ({dose:"Dose",dose_unit:"Unité de dose",frequency:"Fréquence",timing:"Moment de prise",instructions:"Consignes",start_date:"Date de début",end_date:"Date de fin"} as const)[field];
  },
  treatmentStopReason: "Motif d'arrêt",
  treatmentStopNotes: "Précision demandée",
  treatmentUpdateVerified: "La modification du traitement a été relue et vérifiée.",
  treatmentStopVerified: "L'arrêt du traitement a été relu et vérifié.",
  treatmentVersionConflict: "Ce traitement a changé depuis sa lecture. Rechargez le dossier avant de proposer une nouvelle modification.",
  treatmentStopReasonLabel(reason: "inefficacite"|"effets_indesirables"|"amelioration"|"decision_clinique"|"autre"): string {
    return ({inefficacite:"Inefficacité",effets_indesirables:"Effets indésirables",amelioration:"Amélioration",decision_clinique:"Décision clinique",autre:"Autre raison"} as const)[reason];
  },
  internalMessageTitle: "Envoyer un message à l'accueil",
  internalMessageRecipient: "Destinataire",
  internalMessageRecipientValue: "Accueil du cabinet",
  internalMessageBody: "Message",
  internalMessageRestricted:
    "Je ne peux pas envoyer de donnée patient par la messagerie interne. Je peux marquer le patient arrivé dans la salle d'attente.",
  internalMessageMissing: "Quel message dois-je envoyer à l'accueil ?",
  internalMessageSent: "Message envoyé à l'accueil.",
  printOpening(label: string): string {
    return `J'ouvre ${label} et je lance l'impression. Le choix de l'imprimante reste dans la fenêtre d'impression.`;
  },
  printNoDocument(kind: string): string {
    return `Aucun ${kind} émis n'est disponible pour ce dossier. Préparez et émettez le document d'abord.`;
  },
  printMultiple(kind: string): string {
    return `Plusieurs ${kind} émis correspondent à ce dossier. Précisez lequel doit être imprimé.`;
  },
  printUnavailable: "Le document demandé n'a pas pu être relu. Aucune impression n'a été lancée.",
  closeConsultationTitle: "Clore la consultation",
  closeConsultationPatient: "Patient",
  closeConsultationDate: "Séance",
  closeConsultationRequiresTariff: "Cette séance n'a pas de tarif. Indiquez le tarif avant de la clore.",
  currentConsultationMissing: "Je ne trouve pas de consultation en cours dans le dossier sélectionné.",
  closeConsultationAlreadyClosed: "Cette séance est déjà close.",
  closeConsultationFailed: "La clôture n'a pas été vérifiée. La séance reste ouverte.",
  closeConsultationVerified: "Séance close et rendez-vous mis à jour.",
} as const;
