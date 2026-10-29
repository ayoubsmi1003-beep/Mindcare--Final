/**
 * Statistiques — les textes de l'écran.
 *
 * ⚠️ POURQUOI CE FICHIER ET PAS `fr.ts`. `fr.ts` est gelé (AGENTS.md §7,
 * découpe Phase 6) et pèse déjà plus de 2 400 lignes. Un domaine qui arrive
 * avec ses propres libellés ouvre son module, comme `clinical-ui.ts` l'a fait.
 * Aucune chaîne affichée ne vit dans un composant.
 *
 * ⚠️ AUCUNE DONNÉE FICTIVE ICI. Aucun nom, aucun chiffre d'exemple. Les états
 * vides sont des phrases qui disent ce qui manque, pas des maquettes.
 */

export const analyse = {
  /** L'identité de l'écran, sous le titre déduit de la route. */
  sousTitre: "Ce que dit votre pratique, sans ouvrir un dossier.",

  periodes: {
    legende: "Période analysée",
    aujourdhui: "Aujourd'hui",
    sept: "7 jours",
    trente: "30 jours",
    quatreVingtDix: "90 jours",
    annee: "Année en cours",
    personnalise: "Personnalisé",
    du: "Du",
    au: "Au",
    appliquer: "Appliquer",
    /**
     * ⚠️ LA PÉRIODE COMPARÉE EST ÉCRITE, PAS SOUS-ENTENDUE. « +12 % » sans
     * « par rapport à quoi » est un chiffre qui ne veut rien dire.
     */
    comparaison: "comparé à",
    jours: "jours",
    unJour: "1 jour",
    plageInvalide: "La date de fin doit suivre la date de début.",
    plageTropLongue: "Un an au plus : au-delà, la lecture perd son sens.",
  },

  pulse: {
    seances: "Séances",
    seancesAide: "Consultations closes sur la période. Une séance en cours n'est pas comptée.",
    patientesVues: "Patientes vues",
    patientesVuesAide: "Dossiers distincts ayant au moins une séance close sur la période.",
    nouveaux: "Nouveaux dossiers",
    nouveauxAide: "Dossiers ouverts pendant la période.",
    retours: "Retours",
    retoursAide: "Patientes vues dont le dossier existait déjà avant la période.",
    absences: "Absences",
    absencesAide: "Rendez-vous marqués « absent » sur la période.",
    annulations: "Annulations",
    annulationsAide: "Rendez-vous annulés sur la période.",
    notesSignees: "Notes signées",
    notesSigneesAide: "Notes cliniques signées sur la période.",
    notesManquantes: "Séances sans note signée",
    notesManquantesAide:
      "Séances closes pour lesquelles aucune note signée n'est rattachée. Ce n'est pas un retard : aucun délai n'est défini ici.",
    rdvAVenir: "Rendez-vous à venir",
    rdvAVenirAide: "Rendez-vous confirmés ou demandés dont l'heure n'est pas passée.",
    rdvNonClotures: "Rendez-vous non clôturés",
    rdvNonCloturesAide:
      "Rendez-vous passés restés « confirmé » ou « arrivé » : la transition n'a jamais été enregistrée.",
    traitementsActifs: "Traitements actifs",
    traitementsActifsAide: "Traitements dont l'état courant est actif, à cet instant.",
    changements: "Changements de traitement",
    changementsAide: "Démarrages, ajustements, pauses et arrêts enregistrés sur la période.",
    echelles: "Échelles administrées",
    echellesAide: "PHQ-9 et GAD-7 enregistrés sur la période.",
    patientesSuivies: "Patientes suivies",
    patientesSuiviesAide: "Dossiers avec au moins une séance close dans les douze mois précédant la fin de période.",
    patientsTotal: "Dossiers au cabinet",
    patientsTotalAide: "Tous les dossiers du périmètre, sans filtre de période.",
    comparaison: "période précédente",
    pasDeComparaison: "pas de période précédente comparable",
    denominateurNul: "aucune donnée sur la période précédente",
  },

  panneaux: {
    activite: {
      titre: "Activité dans le temps",
      question: "Combien de séances, et à quel rythme ?",
    },
    statuts: {
      titre: "Statuts des rendez-vous",
      question: "Que sont devenus les rendez-vous de la période ?",
    },
    nouveauxRetours: {
      titre: "Nouveaux et retours",
      question: "La pratique grandit-elle, ou fidélise-t-elle ?",
      nouveaux: "Nouveaux",
      retours: "Retours",
    },
    semaine: {
      titre: "Rythme de la semaine",
      question: "Quels jours portent réellement l'activité ?",
    },
    heures: {
      titre: "Moments de la journée",
      question: "À quelles heures les rendez-vous sont-ils posés ?",
    },
    delais: {
      titre: "Délai entre deux séances",
      question: "À quel intervalle les patientes reviennent-elles ?",
      aide:
        "Écart entre deux séances consécutives d'un même dossier, mesuré sur les séances closes de la période. Une annulation ne crée pas d'intervalle.",
    },
    diagnostics: {
      titre: "Diagnostics documentés",
      question: "Quels libellés sont réellement écrits au dossier ?",
      aide:
        "Le libellé tel qu'il est stocké. Aucune normalisation, aucune traduction, aucun regroupement automatique.",
      actifs: "actifs",
      total: "au total",
      vide: "Aucun diagnostic documenté sur le périmètre.",
    },
    echelles: {
      titre: "Échelles cliniques",
      question: "Où se situent les mesures enregistrées ?",
      aide:
        "PHQ-9 et GAD-7. Le score est calculé par la base ; l'interprétation suit le barème de l'instrument. Aucune moyenne n'est affichée : elle n'aurait pas de sens clinique ici.",
      toutes: "Toutes les mesures",
      dernieres: "Dernière mesure par dossier",
      repetees: "dossiers avec plusieurs mesures",
      vide: "Aucune échelle administrée sur la période.",
      bandes: {
        minimal: "Minimal",
        "léger": "Léger",
        "modéré": "Modéré",
        "modérément sévère": "Modérément sévère",
        "sévère": "Sévère",
      } as Record<string, string>,
    },
    qualite: {
      titre: "Qualité du dossier",
      question: "Qu'est-ce qui attend un geste, aujourd'hui ?",
      vide: "Rien à signaler sur la période.",
      notesManquantes: "Séances closes sans note signée",
      notesManquantesAide: "Ouvrir la séance pour rédiger ou signer la note.",
      rdvNonClotures: "Rendez-vous passés non clôturés",
      rdvNonCloturesAide: "Marquer le rendez-vous terminé ou absent.",
      ouvrir: "Voir les dossiers",
    },
    traitements: {
      titre: "Traitements",
      question: "Que suit-on, et qu'est-ce qui a bougé ?",
      actifs: "traitements actifs",
      changements: "changements sur la période",
      vide: "Aucun traitement enregistré.",
      aide:
        "Un traitement enregistré n'est pas une prise confirmée. Aucune adhérence n'est calculée : le logiciel n'enregistre pas les prises.",
    },
    methode: {
      titre: "Ce que compte chaque chiffre",
      resume: "Définitions, sources et limites",
      periode: "Fenêtre",
      comparaison: "Comparaison",
      comparaisonTexte:
        "La période précédente est la fenêtre de même durée qui précède immédiatement celle affichée. Aucun écart n'est affiché quand cette fenêtre ne contient rien : un pourcentage calculé sur zéro n'est pas une tendance.",
      source: "Sources",
      sourceTexte:
        "Séances : consultations closes. Rendez-vous : agenda, tous statuts. Notes : notes cliniques signées. Diagnostics : libellés stockés. Échelles : administrations PHQ-9 et GAD-7. Montants : encaissements, jamais facturé.",
      limites: "Limites",
      limitesTexte:
        "Aucune adhérence médicamenteuse, aucune efficacité de traitement, aucune capacité d'agenda : ces données ne sont pas enregistrées. Les totaux portent sur le périmètre autorisé par la base, pas sur un export.",
      premiereActivite: "Données depuis",
      derniereActivite: "Dernière séance",
    },
  },

  statuts: {
    requested: "Demandé",
    confirmed: "Confirmé",
    arrived: "Arrivé",
    in_session: "En séance",
    completed: "Terminé",
    no_show: "Absent",
    cancelled: "Annulé",
  } as Record<string, string>,

  types: {
    premiere_consultation: "Première consultation",
    suivi: "Suivi",
    psychotherapie_individuelle: "Psychothérapie individuelle",
    therapie_couple: "Thérapie de couple",
    therapie_familiale: "Thérapie familiale",
    therapie_groupe: "Thérapie de groupe",
    teleconsultation: "Téléconsultation",
    certificat_medical: "Certificat médical",
    renouvellement_ordonnance: "Renouvellement d'ordonnance",
    evaluation_psychiatrique: "Évaluation psychiatrique",
    bilan_psychologique: "Bilan psychologique",
    entretien_famille: "Entretien famille",
    entretien_tiers: "Entretien tiers",
    non_renseigne: "Non renseigné",
  } as Record<string, string>,

  jours: {
    "1": "Lundi",
    "2": "Mardi",
    "3": "Mercredi",
    "4": "Jeudi",
    "5": "Vendredi",
    "6": "Samedi",
    "7": "Dimanche",
  } as Record<string, string>,

  delais: {
    "0-7": "0 à 7 jours",
    "8-30": "8 à 30 jours",
    "31-90": "31 à 90 jours",
    "91-180": "91 à 180 jours",
    "181+": "Plus de 180 jours",
  } as Record<string, string>,

  detail: {
    titre: "Dossiers concernés",
    chargement: "Lecture des dossiers…",
    vide: "Aucun dossier sur cette période.",
    erreur: "La lecture des dossiers a échoué.",
    reessayer: "Réessayer",
    fermer: "Fermer",
    precedent: "Page précédente",
    suivant: "Page suivante",
    page: "Page",
    sur: "sur",
    resultats: "résultats",
    ouvrirDossier: "Ouvrir le dossier",
    ouvrirSeance: "Ouvrir la séance",
    colonneDossier: "Dossier",
    colonneDate: "Date",
    colonneValeur: "Détail",
  },

  etats: {
    chargement: "Lecture de votre activité…",
    vide: "Aucune donnée sur cette période.",
    videAide:
      "Aucune séance, aucun rendez-vous et aucune note ne sont enregistrés entre ces deux dates. Élargir la période fera apparaître votre activité.",
    insuffisant: "Pas assez de données pour cette lecture.",
    insuffisantAide:
      "Les séances existent, mais il en faut au moins deux par dossier pour mesurer un intervalle de suivi.",
    erreur: "L'analyse n'a pas pu être lue.",
    erreurAide: "La base n'a pas répondu. Rien n'a été modifié.",
    reessayer: "Réessayer",
    nonAutorise: "Cet écran est réservé au suivi clinique.",
    nonAutoriseAide: "Votre rôle ne donne pas accès aux indicateurs cliniques.",
    horsLigne: "Lecture impossible hors ligne.",
    sansComparaison: "Pas de comparaison",
  },

  actions: {
    voirDossiers: "Voir les dossiers",
    ouvrirFinances: "Ouvrir Finances",
  },

  finance: {
    etiquette: "Encaissé sur la période",
    perimetreCabinet: "cabinet",
    perimetrePraticienne: "votre activité",
    note: "Montant encaissé, jamais facturé. Le détail vit dans Finances.",
    absent: "Hors périmètre",
  },

  graphiques: {
    aucunPoint: "Aucun point à afficher sur cette période.",
    legende: "Légende",
    seriesActives: "Séries affichées",
    tableauEquivalent: "Valeurs de la période",
    point: "Point",
    valeur: "Valeur",
    courbe: "Courbe des séances",
    astuce: "Utilisez les flèches pour parcourir les points.",
  },
} as const;

export type TextesAnalyse = typeof analyse;
