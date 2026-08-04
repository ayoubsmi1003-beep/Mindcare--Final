/**
 * MindCare OS — textes d'interface. Français intégral (I8).
 *
 * SOURCE UNIQUE de toute chaîne affichée. Aucune chaîne en dur dans un
 * composant, dès le premier composant (WORKING-CONTEXT §5). Une chaîne écrite
 * ailleurs échappe à la relecture linguistique et finit par diverger.
 *
 * Trois règles qui gouvernent ce fichier :
 *   1. Les noms d'écran et les verbes sont IMPOSÉS (§5). Les variantes
 *      « Accueil », « Dossiers », « Calendrier », « Communications »,
 *      « Aftercare », « Rapports » sont des pièges : elles n'apparaissent pas
 *      ici, et ne doivent pas y être ajoutées.
 *   2. Un bouton nomme son action, et le retour reprend le même verbe :
 *      `Signer la note` → « Note signée. » Jamais « Soumettre », « OK », ni
 *      « Valider » seul.
 *   3. Aucune donnée fictive, aucun nom, aucun contenu clinique d'exemple
 *      (I19). Un état vide est honnête.
 *
 * Pas de bibliothèque i18n en Phase 1 : un objet figé suffit, et `tsc` vérifie
 * chaque clé à la compilation — ce qu'une clé dynamique ne permettrait pas.
 */

export const fr = {
  /** Les douze écrans, groupés comme dans la navigation. Libellés imposés §5. */
  nav: {
    groupes: {
      menu: "MENU",
      clinique: "CLINIQUE",
      gestion: "GESTION",
      systeme: "SYSTÈME",
    },
    ecrans: {
      tableauDeBord: "Tableau de bord",
      patients: "Patients",
      agenda: "Agenda",
      messages: "Messages",
      documents: "Documents",
      traitements: "Traitements",
      suivi: "Suivi",
      finances: "Finances",
      statistiques: "Statistiques",
      agents: "Agents",
      journalActivite: "Journal d'activité",
      parametres: "Paramètres",
    },
  },

  /** Verbes d'action imposés §5. Un bouton nomme son action. */
  actions: {
    enregistrer: "Enregistrer",
    signerLaNote: "Signer la note",
    demarrerLaSeance: "Démarrer la séance",
    terminerLaSeance: "Terminer la séance",
    genererLeCertificat: "Générer le certificat",
    confirmer: "Confirmer",
    annuler: "Annuler",
    fixerLeTarif: "Fixer le tarif",
    reessayer: "Réessayer",
    seConnecter: "Se connecter",
    seDeconnecter: "Se déconnecter",
    /**
     * Agenda. `annuler` seul reste ce qu'il a toujours été — abandonner la
     * saisie en cours. Annuler un RENDEZ-VOUS est un autre geste, irréversible
     * et visible du patient : il porte son propre libellé, sans quoi le même mot
     * désignerait « fermer ce formulaire » et « prévenir quelqu'un de ne pas
     * venir ».
     */
    enregistrerLeRendezVous: "Enregistrer le rendez-vous",
    annulerLeRendezVous: "Annuler le rendez-vous",
    /**
     * Ouvre le formulaire ; il ne sauvegarde pas. L'étiqueter `Enregistrer`
     * serait un bouton qui ne fait pas ce qu'il dit — la faute exacte du bouton
     * « Masquer le contexte » retiré en S3.
     */
    modifierLeRendezVous: "Modifier le rendez-vous",
  },

  /** Retours d'action — même verbe que l'action qui les déclenche. */
  feedback: {
    enregistre: "Modifications enregistrées.",
    noteSignee: "Note signée.",
    seanceDemarree: "Séance démarrée.",
    seanceTerminee: "Séance terminée.",
    certificatGenere: "Certificat généré.",
    confirme: "Confirmé.",
    annule: "Annulé.",
    tarifFixe: "Tarif fixé.",
    connecte: "Connecté.",
    deconnecte: "Déconnecté.",
    rendezVousEnregistre: "Rendez-vous enregistré.",
    rendezVousAnnule: "Rendez-vous annulé.",
  },

  /** Écran de connexion — libellés pour l'écran qu'un autre agent construit. */
  connexion: {
    titre: "Connexion",
    champEmail: "E-mail",
    champMotDePasse: "Mot de passe",
    connexionEnCours: "Connexion en cours…",
  },

  /**
   * Coquille de navigation (`AppShell`). Les libellés d'écran viennent de
   * `nav.ecrans` ; ceux-ci ne décrivent que l'état de construction, jamais un
   * nom d'écran supplémentaire.
   */
  coquille: {
    /** Écran référencé dans la navigation mais pas encore construit (I19). */
    ecranAVenir: "Écran à venir",
    deconnexionCompte: "Compte connecté :",
  },

  /**
   * Écran Patients — liste, recherche, fiche.
   *
   * ⚠️ `listeVide` et `rechercheSansResultat` sont DEUX phrases distinctes, et
   * il ne faut pas les fusionner. `app.search_patients` applique la RLS avant
   * de compter : zéro ligne signifie « aucun dossier VISIBLE PAR VOUS », ce qui
   * n'est pas « aucun dossier ». Écrire « aucun patient dans le cabinet »
   * affirmerait quelque chose que cet écran ne peut pas savoir — la file de
   * l'autre praticienne existe peut-être, et c'est la cloison qui la masque.
   *
   * ⚠️ `ficheIntrouvable` sert AUSSI BIEN au dossier inexistant qu'au dossier
   * hors périmètre : `getPatient` rend `ok(null)` dans les deux cas et
   * l'interface ne doit pas les distinguer. Un message « ce dossier ne vous est
   * pas accessible » divulguerait l'existence d'un patient d'une autre
   * praticienne — exactement ce que la cloison ADR-003 interdit. Une seule
   * phrase, donc, et surtout pas deux.
   */
  patients: {
    titre: "Patients",
    rechercher: "Rechercher un patient",
    rechercherIndication: "Nom, téléphone ou numéro de dossier",
    listeVide: "Aucun dossier visible dans votre périmètre.",
    rechercheSansResultat: "Aucun dossier ne correspond à cette recherche.",
    /** Le total est celui du périmètre de l'appelant, jamais celui du cabinet. */
    comptage: "dossier(s) dans votre périmètre",
    ficheIntrouvable:
      "Ce dossier est introuvable. Rien n'a été modifié. Vérifiez le lien, ou revenez à la liste.",
    retourALaListe: "Revenir à la liste",
    numeroDossier: "Numéro de dossier",
    dateNaissance: "Date de naissance",
    telephone: "Téléphone",
    telephoneSecondaire: "Téléphone secondaire",
    adresse: "Adresse",
    notesAdministratives: "Notes administratives",
    /** Statut porté par un TEXTE, jamais par la couleur seule (§4 règle 4). */
    dossierInactif: "Dossier inactif",
    /** La liste ne montre que les dossiers actifs — le dire plutôt que le laisser croire. */
    listeActifsSeulement: "Seuls les dossiers actifs apparaissent dans cette liste.",
  },

  /**
   * Écran Agenda — journée, création, détail, annulation.
   *
   * ⚠️ `journeeVide` et `aucunVisible` sont DEUX phrases distinctes, comme pour
   * Patients et pour la même raison : `app.list_agenda` applique la RLS. Zéro
   * ligne signifie « rien de VISIBLE par vous », ce qui n'est pas « rien dans
   * le cabinet ». Écrire « aucun rendez-vous » affirmerait quelque chose que cet
   * écran ne peut pas savoir — l'agenda de l'autre praticienne existe peut-être,
   * et c'est la cloison qui le masque.
   *
   * ⚠️ `introuvable` sert AUSSI BIEN au rendez-vous inexistant qu'au rendez-vous
   * hors périmètre. `getAppointment` rend `ok(null)` dans les deux cas et
   * l'interface ne doit pas les distinguer.
   *
   * ⚠️ AUCUN LIBELLÉ DE « TYPE DE CONSULTATION » ICI. La colonne n'existe pas
   * dans le schéma et la liste réelle employée par la praticienne n'a pas été
   * fournie. Inventer « première consultation / suivi / urgence » serait une
   * taxonomie clinique fabriquée (I19). `origine` ci-dessous nomme le CANAL
   * d'entrée du rendez-vous (`app.appt_source`), qui est une autre donnée — ne
   * pas l'employer comme un type de consultation.
   */
  agenda: {
    titre: "Agenda",
    aujourdhui: "Aujourd'hui",
    aVenir: "À venir",
    journeeVide: "Aucun rendez-vous aujourd'hui.",
    aucunVisible: "Aucun rendez-vous visible dans votre périmètre.",
    aucunAVenir: "Aucun rendez-vous à venir dans les trente prochains jours.",
    /** Le total est celui du périmètre de l'appelant, jamais celui du cabinet. */
    comptage: "rendez-vous dans votre périmètre",
    nouveau: "Nouveau rendez-vous",
    retourALAgenda: "Revenir à l'agenda",
    introuvable:
      "Ce rendez-vous est introuvable. Rien n'a été modifié. Vérifiez le lien, ou revenez à l'agenda.",

    patient: "Patient",
    patientNonRattache: "Aucun dossier rattaché",
    praticienne: "Praticienne",
    date: "Date",
    heure: "Heure",
    /** Tiret demi-cadratin encadré d'espaces — une plage horaire, pas un trait d'union. */
    separateurPlage: "–",
    duree: "Durée",
    dureeUnite: "min",
    origine: "Origine du rendez-vous",
    notesAdministratives: "Notes administratives",
    notesFacultatives: "Notes administratives (facultatif)",
    motifAnnulation: "Motif de l'annulation",
    motifAnnulationIndication:
      "Visible par l'assistante. N'y écrivez rien de clinique.",

    /** Statuts de `app.appt_status`. Un statut porte un TEXTE, jamais une couleur seule. */
    statuts: {
      requested: "Demandé",
      confirmed: "Confirmé",
      arrived: "Arrivé",
      in_session: "En séance",
      completed: "Terminé",
      no_show: "Non présenté",
      cancelled: "Annulé",
    },

    /** Canaux de `app.appt_source`. Dérivé du rôle à la création, jamais saisi. */
    origines: {
      phone: "Téléphone",
      walk_in: "Sans rendez-vous",
      web: "Demande web",
      assistant: "Assistante",
      doctor: "Praticienne",
    },

    typeConsultation: "Type de consultation",

    /**
     * Les treize types de `app.consult_kind` (migration 024). Libellés fournis
     * par le cabinet — ne pas en ajouter, ne pas en reformuler sans la
     * praticienne : ce sont des actes, pas des étiquettes d'interface.
     */
    types: {
      premiere_consultation: "Première consultation",
      suivi: "Consultation de suivi",
      psychotherapie_individuelle: "Psychothérapie individuelle",
      therapie_couple: "Thérapie de couple",
      therapie_familiale: "Thérapie familiale",
      therapie_groupe: "Thérapie de groupe",
      teleconsultation: "Téléconsultation",
      certificat_medical: "Certificat médical",
      renouvellement_ordonnance: "Renouvellement d'ordonnance",
      evaluation_psychiatrique: "Évaluation psychiatrique",
      bilan_psychologique: "Bilan psychologique",
      entretien_famille: "Entretien avec la famille",
      entretien_tiers: "Entretien avec un tiers",
    },

    /**
     * Cinq FAMILLES pour la légende et la couleur d'accent.
     *
     * Treize teintes distinctes seraient indiscernables et plusieurs
     * tomberaient sous le plancher de contraste de 4.5:1 (§4 règle 4). La
     * couleur ne code donc que la famille ; le LIBELLÉ complet du type est
     * toujours écrit dans la carte, et la couleur ne porte jamais
     * l'information seule.
     */
    familles: {
      suivi: "Suivi",
      premiere: "Première consultation",
      psychotherapie: "Psychothérapie",
      entretien: "Entretiens",
      administratif: "Administratif",
    },

    /** Vue semaine — l'écran principal de l'agenda. */
    semaine: {
      titre: "Semaine du",
      au: "au",
      seancesCetteSemaine: "Séances cette semaine",
      creneauxLibres: "Créneaux libres",
      demandesEnAttente: "Demandes en attente",
      seances: "séances",
      libre: "libre",
      semainePrecedente: "Semaine précédente",
      semaineSuivante: "Semaine suivante",
      cetteSemaine: "Cette semaine",
      vueSemaine: "Semaine",
      vueJour: "Jour",
      /**
       * ⚠️ Phrase distincte de `journeeVide`. `list_agenda` applique la RLS :
       * une grille vide signifie « rien de visible par vous », jamais « le
       * cabinet ne travaille pas cette semaine ».
       */
      semaineVide: "Aucun rendez-vous visible dans votre périmètre cette semaine.",
      /**
       * La file d'attente est honnêtement vide tant que l'accueil QR n'existe
       * pas : les demandes `requested` viennent du web, flux non construit. On
       * le dit plutôt que d'afficher un compteur inventé (I19).
       */
      aucuneDemande: "Aucune demande en attente d'approbation.",
    },

    approuver: "Approuver la demande",
    demandeApprouvee: "Demande approuvée.",
    enAttenteApprobation: "En attente d'approbation",
  },

  /**
   * Les cinq états que tout composant doit gérer (I11).
   * `texteAbsent` couvre le champ vide ou non renseigné — jamais un tiret nu,
   * qui se confond avec une valeur.
   */
  etats: {
    chargement: "Chargement…",
    vide: "Aucun élément à afficher.",
    // Pas de clé `erreur` ici, délibérément. « Une erreur est survenue. » est
    // le prototype exact du vague qu'interdit §4 règle 8, et l'offrir comme
    // clé prête à l'emploi à côté du gabarit `erreur.*` reviendrait à fournir
    // la règle et son contournement le plus commode dans le même fichier.
    // Un état d'erreur se décrit toujours par le gabarit en trois temps.
    horsLigne: "Hors ligne. Les données affichées peuvent ne pas être à jour.",
    texteAbsent: "Non renseigné",
  },

  /**
   * Gabarit d'erreur (§4, règle 8) : ce qui s'est passé · ce qui a été préservé
   * · quoi faire. Jamais de vague.
   *
   * ⚠️ Les trois EN-TÊTES sont ici ; les CONTENUS ne le sont pas, et c'est
   * délibéré. Une phrase du type « votre saisie est conservée localement »
   * n'est pas un libellé, c'est une affirmation de fait sur le comportement du
   * système. Aucune persistance locale n'existe aujourd'hui dans ce dépôt.
   * L'afficher dirait à la praticienne, après une coupure, que sa note est
   * sauvegardée — elle fermerait l'écran et perdrait son travail. C'est
   * exactement le mensonge qu'I19 interdit, sous une forme plus dangereuse
   * qu'une donnée fictive.
   *
   * Chaque écran fournit donc le contenu qui décrit CE QUE SON CODE FAIT
   * réellement, et ces phrases s'écrivent en même temps que le mécanisme de
   * préservation (I20), jamais avant.
   */
  erreur: {
    titre: "Ce qui s'est passé",
    preserveTitre: "Ce qui a été préservé",
    actionTitre: "Ce que vous pouvez faire",
    reseauIndisponible: "La connexion au serveur a échoué.",
  },

  /**
   * Messages d'erreur de la couche données (`src/services/errors.ts`).
   *
   * Chacun est écrit en TROIS TEMPS — ce qui s'est passé · ce qui a été
   * préservé · quoi faire — parce que « Une erreur est survenue » ne dit aucun
   * des trois et laisse la praticienne décider seule si elle a perdu son
   * travail, avec un patient en face.
   *
   * ⚠️ Ces phrases remplacent le message brut de Postgres, qui n'atteint JAMAIS
   * l'écran : il porte régulièrement la valeur qui a déclenché l'erreur
   * (« Key (phone)=(0554…) »), c'est-à-dire une donnée identifiante dans un
   * message d'interface (I5).
   *
   * Les clés reprennent exactement `AppErrorCode`. `tsc` vérifie la
   * correspondance à la compilation : un code sans message ne compile pas.
   */
  erreurs: {
    "hors-ligne":
      "La connexion au serveur est interrompue. Rien n'a été perdu : ce qui est affiché reste utilisable et la consultation peut continuer. Réessayez lorsque le réseau est rétabli.",
    "non-authentifie":
      "Votre session a expiré. Aucune donnée n'a été modifiée. Reconnectez-vous pour reprendre.",
    "identifiants-refuses":
      "L'e-mail ou le mot de passe est incorrect. Aucune session n'a été ouverte. Vérifiez votre saisie, puis réessayez.",
    interdit:
      "Cet accès n'est pas autorisé pour votre rôle. Aucune donnée n'a été lue ni modifiée. Si vous pensez qu'il devrait l'être, signalez-le — la règle est appliquée par la base de données.",
    introuvable:
      "Cet élément est introuvable. Rien n'a été modifié. Il a pu être déplacé, ou ne relève pas de votre dossier.",
    conflit:
      "Cette valeur entre en conflit avec une donnée existante. Rien n'a été enregistré. Vérifiez la saisie, puis réessayez.",
    "regle-metier":
      "L'enregistrement a été refusé par une règle du dossier médical. Rien n'a été modifié. Le détail de la règle figure dans le journal d'activité.",
    indisponible:
      "Le service de données est momentanément indisponible. Aucune donnée n'a été perdue. Réessayez dans quelques instants.",
    inattendu:
      "Une erreur inattendue s'est produite. Aucune donnée n'a été modifiée. Réessayez ; si cela se reproduit, signalez-le avec l'heure exacte.",
  },

  /**
   * Bandeau « données fictives » — ADR-016.
   *
   * La valeur affichée est LUE EN BASE (`app.deployment`), jamais déduite d'une
   * variable d'environnement : le bandeau doit dire ce que la base fait.
   * Jetons `--attention`, jamais `--critical` — le rouge est un budget réservé
   * au disque critique et à la perte de données. Aucun verre : le verre décore
   * le mobilier, pas la donnée.
   */
  bandeauSynthetique: {
    titre: "Données fictives",
    corps:
      "Cette instance est une base de développement. Elle n'accepte que des données synthétiques et refuse toute donnée patient réelle.",
    reference: "ADR-016",
  },

  /**
   * Mention permanente sur toute sortie d'aide à la décision (I7).
   * Elle n'est pas décorative et ne se masque pas : l'IA décrit, elle ne
   * conclut jamais.
   */
  disclaimer:
    "Aide à la décision — le jugement clinique appartient au praticien.",
} as const;

export type Fr = typeof fr;
