import type { DocumentKind, DocumentReason } from "@/shared/documents/types";

export const documentsEditor = {

  dailyCount:"Prises par jour", prescription:"Prescription", prescriptionHint:"Le nom du médicament et le nombre de prises quotidiennes.", more:"Autres actions", formatting:"Mise en forme", changePatient:"Changer de dossier", library:"Vos documents", filters:"Filtrer", startHint:"Choisissez un dossier, puis préparez un certificat ou une ordonnance.", title:"Documents", subtitle:"Certificats et ordonnances", newDocument:"Nouveau document", drafts:"Brouillons", issued:"Documents émis",

  save:"Enregistrer", saving:"Enregistrement…", saved:"Enregistré", dirty:"Modifications non enregistrées", edit:"Modifier", preview:"Aperçu",

  issueForPrint:"Émettre pour imprimer", issuing:"Émission…", printAfterIssue:"Après confirmation, le bouton Imprimer sera disponible en haut du document.", issue:"Émettre", print:"Imprimer", duplicate:"Dupliquer", newRevision:"Nouvelle version", archive:"Archiver", restore:"Restaurer", close:"Fermer",

  patient:"Patient", kind:"Type de document", documentDate:"Date du document", fields:"Champs du document", history:"Historique", choosePatient:"Choisir un dossier",

  emptyDrafts:"Aucun brouillon enregistré.", emptyDocuments:"Aucun document émis.", draft:"Brouillon", issuedStatus:"Émis", voided:"Annulé",

  bold:"Gras", italic:"Italique", underline:"Souligné", left:"Aligner à gauche", center:"Centrer", right:"Aligner à droite", justify:"Justifier",

  bulletList:"Liste à puces", orderedList:"Liste numérotée", undo:"Annuler la dernière modification", redo:"Rétablir", rtl:"Arabe · droite à gauche", ltr:"Français · gauche à droite", pageBreak:"Saut de page",

  detachField:"Remplacer le champ par du texte", regenerate:"Repartir du modèle", regenerateConfirmation:"Repartir du modèle ? La version actuelle sera conservée dans l’historique.",

  addMedication:"Ajouter un médicament", medication:"Médicament", catalogue:"Rechercher dans le catalogue", freeMedication:"Saisie libre hors catalogue",

  strength:"Dosage / forme", posology:"Prise / posologie", quantity:"Quantité", frequency:"Fréquence", duration:"Durée", administration:"Administration", instructions:"Instructions complémentaires",

  remove:"Retirer", moveUp:"Monter", moveDown:"Descendre", noMedication:"Ajoutez un médicament pour préparer l’ordonnance.", noResults:"Aucun médicament trouvé.",

  confirmIssue:"Confirmer l’émission", confirmBody:"Vous confirmez le contenu affiché. Cette version sera figée, numérotée et conservée dans l’historique.",

  issueSuccess:"Document émis et conservé.", retry:"Réessayer", conflict:"Ce brouillon a changé dans un autre onglet. Votre texte est conservé. Rechargez la version enregistrée avant de résoudre le conflit.",

  keepLocal:"Conserver mon texte sur la version actuelle", recoveryConfirm:"Votre texte reste visible. Choisissez la version enregistrée ou reprenez votre texte comme nouvelle modification à relire.", zoom:"Zoom", auditRetry:"Réessayer la journalisation",

  reload:"Recharger la version enregistrée", unsavedLeave:"Des modifications ne sont pas enregistrées. Restez pour enregistrer votre travail.",

  invalidContent:"Ce contenu dépasse les limites ou comporte une mise en forme non prise en charge. Votre saisie reste dans l’éditeur.",

  previewLoading:"Préparation des pages…", previewStale:"Enregistrez vos modifications pour actualiser l’aperçu avant émission.",

  printInstructions:"Impression : A5, portrait, taille réelle (100 %), en-têtes et pieds de page du navigateur désactivés.",

  printAuditFailed:"Le dialogue a été demandé, mais l’envoi à l’impression n’a pas pu être journalisé. Réessayez la journalisation.",

  printFailed:"L’impression n’a pas pu être préparée. Le document est conservé. Réessayez.",

  legacyRevisionNotice:"Une nouvelle version de cette pièce historique reprend le modèle actuel et ses champs enregistrés. Relisez le texte avant émission. La pièce originale reste conservée.",
  orderNumber:"N° d’Ordre", controlledIdentity:"Identité professionnelle contrôlée", orderSaved:"N° d’Ordre enregistré.",

  identityReadOnly:"L’identité professionnelle provient des données contrôlées du cabinet. Seul le N° d’Ordre se modifie ici.",

  voidDocument:"Annuler le document", voidReason:"Motif d’annulation", voidConfirmation:"Le contenu et le numéro restent dans l’historique. Le numéro ne sera jamais réutilisé.",

  signature:"Signature et cachet", phone:"Tél.", birthDate:"Date de naissance", date:"Date", name:"Nom", firstName:"Prénom", age:"Âge", years:"ans",

  revision:"Version", page:"Page", saveFailure:"L’enregistrement a échoué. Votre texte reste dans l’éditeur ; réessayez avant de quitter.",

} as const;

export const documentLabels:Readonly<Record<DocumentKind,string>>={bonne_sante_mentale:"Certificat de bonne santé mentale",suivi_medical:"Certificat de suivi médical",certificat_medical:"Certificat médical",justification:"Justification",ordonnance:"Ordonnance"};

export const documentReasons:Readonly<Record<DocumentReason,string>>={

  "patient-sex-missing":"Renseignez le sexe dans le dossier patient avant d’émettre.",

  "patient-birth-missing":"Renseignez la date de naissance dans le dossier patient avant d’émettre.",

  "header-incomplete":"L’identité professionnelle du cabinet est incomplète. Vérifiez sa configuration contrôlée.",

  "required-field":"Complétez les champs requis du document.","medication-invalid":"Vérifiez les médicaments et leur posologie avant d’émettre.",

  "draft-conflict":"Le brouillon a changé. Réouvrez la version enregistrée avant de continuer.",

  "preview-stale":"L’aperçu ne correspond plus à la version courante. Actualisez-le avant d’émettre.",

  "layout-invalid":"La mise en page n’est pas prête. Vérifiez les pages avant d’émettre.",

};



export const documentFieldLabels:Readonly<Record<string,string>>={

 id_document_number:"Numéro de la pièce d’identité",mairie:"Mairie de délivrance",jours:"Nombre de jours d’arrêt",jours_lettres:"En toutes lettres",date_debut:"À compter du (JJ/MM/AAAA)",date_naissance:"Date de naissance (JJ/MM/AAAA)",traitement_1:"Traitement — 1re ligne",traitement_2:"Traitement — 2e ligne (facultatif)",date_consultation:"Date de la consultation (JJ/MM/AAAA)"

};

export const documentFilters={search:"Rechercher un document",allKinds:"Tous les types",allStatuses:"Tous les statuts"} as const;

