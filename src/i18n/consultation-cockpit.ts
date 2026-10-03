// Compléments du cockpit : `fr.ts` reste gelé jusqu'à la découpe Phase 6.
export const frConsultationCockpit = {
  mesuresAide: "Curseur ou flèches — les valeurs restent dans cet écran, les notes sont rédigées séparément.",
  reperes: {
    titre: "Repères pour la consultation",
    aide: "Changements documentés et points à vérifier",
    faits: "Données du dossier",
    derniers: "Derniers repères",
    verifier: "À vérifier",
    resumeSource: "Résumé du cas",
    pointsIndisponibles: "Points à vérifier indisponibles — aucun résumé du cas disponible.",
    pointsVides: "Aucun point à vérifier dans ce résumé.",
    cliniqueIndisponible: "Données cliniques indisponibles",
    prescriptionsIndisponibles: "Prescriptions indisponibles",
    consultationVide: "Aucune consultation enregistrée",
    prescriptionVide: "Aucune prescription enregistrée",
    rendezVousVide: "Aucun rendez-vous programmé",
    echellesVides: "Aucune évaluation enregistrée",
    scoreVide: "Score non renseigné",
    comparaisonPartielle: "Comparaison partielle : certaines données cliniques sont indisponibles.",
    prescriptionLignes: (n: number): string => n === 1 ? "1 ligne prescrite" : `${String(n)} lignes prescrites`,
  },
} as const;
