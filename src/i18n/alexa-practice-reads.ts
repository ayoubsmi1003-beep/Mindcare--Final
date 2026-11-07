const timelineActions: Readonly<Record<string, string>> = {
  started: "début", dose_changed: "changement de dose", schedule_changed: "changement de rythme", paused: "pause", resumed: "reprise", stopped: "arrêt", renewed: "renouvellement",
  prescription: "prescription", document_issued: "ordonnance émise", document_voided: "ordonnance annulée",
};

/** Wording of the practice and treatment reads. Every figure comes from a database gate. */
export const practiceReadCopy = {
  statistics: {
    heading: (from: string, to: string) => `Activité enregistrée du ${from} au ${to}, dans votre périmètre d’accès :`,
    sessions: (n: number) => `Séances closes : ${n}`,
    patientsSeen: (n: number) => `Patients vus, avec au moins une séance close : ${n}`,
    returning: (n: number) => `Retours, patients vus dont le dossier existait déjà avant la période : ${n}`,
    newRecords: (n: number) => `Nouveaux dossiers ouverts : ${n}`,
    noShows: (n: number) => `Rendez-vous marqués absents : ${n}`,
    cancellations: (n: number) => `Rendez-vous annulés : ${n}`,
    signedNotes: (n: number) => `Notes signées : ${n}`,
    unsignedSessions: (n: number) => `Séances closes sans note signée : ${n}`,
    scales: (n: number) => `Échelles administrées : ${n}`,
    treatmentChanges: (n: number) => `Événements de traitement enregistrés, démarrages, ajustements, pauses et arrêts compris : ${n}`,
    followed: (n: number) => `Patients suivis, avec une séance close dans les douze mois précédant la fin de la période : ${n}`,
    previous: (from: string, to: string, n: number) => `Période précédente, du ${from} au ${to} : ${n} séance(s) close(s).`,
    currentHeading: "À cet instant, quelle que soit la période :",
    totalRecords: (n: number) => `Dossiers dans votre périmètre : ${n}`,
    upcoming: (n: number) => `Rendez-vous à venir : ${n}`,
    unclosed: (n: number) => `Rendez-vous passés restés sans clôture : ${n}`,
    activeTreatments: (n: number) => `Traitements actifs : ${n}`,
    periodUnresolved: "Je n’ai pas pu fixer cette période avec assez de précision. Pouvez-vous préciser les dates de début et de fin ?",
    periodFuture: "Cette période n’a pas encore commencé : il n’y a pas d’activité enregistrée à présenter.",
    periodTooWide: "Je peux présenter au plus 366 jours de statistiques à la fois. Pouvez-vous réduire la période ?",
  },
  workload: {
    summary: (treatments: number, patients: number, review: number, changes: number) =>
      `Dans votre périmètre : ${treatments} traitement(s) actif(s), chez ${patients} patient(s). À revoir : ${review} patient(s), pour une posologie incomplète ou une date de fin dépassée ou dans 14 jours au plus. Événements de traitement enregistrés sur 30 jours : ${changes}.`,
    row: (name: string, active: number, flags: readonly string[]) => `${name} : ${active} traitement(s) actif(s)${flags.length ? `, ${flags.join(", ")}` : ""}`,
    missingDose: "posologie incomplète",
    overdue: "date de fin dépassée",
    nextEnd: (date: string) => `prochaine fin le ${date}`,
    more: (shown: number, total: number) => `${shown} patient(s) affiché(s) sur ${total} : consultez l’écran Traitements pour la liste complète.`,
    scanned: (read: number, total: number) => `Je n’ai examiné que ${read} patients sur ${total} : d’autres peuvent être concernés. Consultez l’écran Traitements.`,
    missingDoseHeading: (n: number, allRead: boolean) => `Patients avec une posologie incomplète${allRead ? "" : " parmi ceux examinés"} : ${n}`,
    reviewHeading: (n: number, allRead: boolean) => `Patients à revoir${allRead ? "" : " parmi ceux examinés"} : ${n}`,
    empty: "Aucun traitement actif visible avec votre accès.",
  },
  medicationTimeline: {
    source: "Dossier patient, chronologie des traitements",
    heading: (shown: number, more: boolean) => `${more ? "Les plus récents : " : ""}${shown} événement(s) de traitement consigné(s) :`,
    row: (date: string, action: string, subject: string | null, reason: string | null) => `${date} : ${action}${subject ? `, ${subject}` : ""}${reason ? `, motif : ${reason}` : ""}`,
    actions: timelineActions,
    otherAction: "autre événement",
    more: "D’autres événements plus anciens existent : consultez le dossier pour la chronologie complète.",
    empty: "Aucun événement de traitement consigné ou visible avec votre accès.",
  },
  caseSummary: {
    source: "Dossier patient, état du résumé du cas",
    none: "Aucun résumé du cas enregistré ou visible avec votre accès.",
    status: (version: number, date: string, current: boolean) =>
      `Résumé du cas : version ${version}, générée le ${date}. ${current ? "Elle correspond aux consultations, notes, traitements, diagnostics et échelles du dossier ; d’autres données, dont les allergies, effets indésirables, l’observance, les mesures et les documents, ne sont pas vérifiées." : "Je ne peux pas la confirmer à jour du dossier."} Ce résumé a été généré par un modèle : je n’en lis pas le contenu ici, ouvrez le dossier pour le vérifier.`,
  },
} as const;
