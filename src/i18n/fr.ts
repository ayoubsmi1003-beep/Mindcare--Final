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
      /** V-JARVIS-CORE — l'écran conversationnel plein. Rail praticiennes. */
      jarvis: "Alexa",
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
    /**
     * v9 — la promesse du panneau de marque, à côté du formulaire. Une phrase,
     * pas un slogan : elle dit ce que ce poste est, au moment de la journée où
     * la praticienne décide encore si elle ouvre le bon logiciel.
     */
    accroche: "Le poste de travail du cabinet.",
  },

  /**
   * Coquille de navigation (`AppShell`). Les libellés d'écran viennent de
   * `nav.ecrans` ; ceux-ci ne décrivent que l'état de construction, jamais un
   * nom d'écran supplémentaire.
   */
  coquille: {
    /**
     * Écran référencé dans la navigation mais pas encore construit (I19).
     *
     * Reste le libellé COMPLET, lu par les lecteurs d'écran et affiché en
     * infobulle. La pastille visible dit « bientôt » — plus court, donc plus
     * calme dans une colonne — mais « bientôt » seul ne dirait pas de QUOI il
     * s'agit hors contexte visuel.
     */
    ecranAVenir: "Écran à venir",
    /** La pastille elle-même. Décision Q12 : assumée et visible, pas masquée. */
    bientot: "bientôt",
    deconnexionCompte: "Compte connecté :",
    /** Le rail lui-même, pour `aria-label` — distinct du groupe « MENU ». */
    navigationPrincipale: "Navigation principale",
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
    /**
     * v9 — le sous-titre de l'en-tête de lieu. Il dit ce qu'est l'écran, pas
     * ce qu'il contient : le comptage, lui, vit près de la liste, où il est
     * vrai au moment où on le lit.
     */
    sousTitre: "L'annuaire clinique du cabinet.",
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

    // ─── Patients V2 — l'espace de travail ─────────────────────────────────

    /**
     * ⚠️ « NON RENSEIGNÉE », JAMAIS « AUCUNE ». Le féminin est voulu : ces
     * phrases qualifient une adresse, une donnée. Dire « Aucune allergie »
     * quand la base ne sait rien serait une AFFIRMATION CLINIQUE fausse, tirée
     * d'un champ vide. On dit ce qu'on sait : rien.
     */
    adresseAbsente: "Non renseignée",
    contactUrgence: "Contact d'urgence",
    contactUrgenceAbsent: "Non renseigné",
    pieceIdentite: "Pièce d'identité",
    pieceIdentiteEmetteur: "Délivrée par",
    sexe: "Sexe",
    sexeM: "Homme",
    sexeF: "Femme",
    age: "Âge",
    ageAnnees: "ans",

    /** Fraîcheur du plan de travail — une seule fois par écran, jamais par carte. */
    actualiseA: "Actualisé à",

    onglets: {
      vueDEnsemble: "Vue d'ensemble",
      chronologie: "Chronologie",
      clinique: "Clinique",
      traitements: "Traitements",
      rendezVous: "Rendez-vous",
      documents: "Documents",
    },

    sections: {
      identite: "Identité & coordonnées",
      contexteClinique: "Contexte clinique",
      prochaineEcheance: "Prochaine échéance",
      diagnostics: "Diagnostics",
      diagnosticsActifs: "Diagnostics actifs",
      diagnosticsResolus: "Antécédents résolus",
      diagnosticPrincipal: "Diagnostic principal",
      echelles: "Échelles d'évaluation",
      dernierePrescription: "Dernière prescription",
      historiquePrescriptions: "Historique des prescriptions",
      prochainRendezVous: "Prochain rendez-vous",
      dernierRendezVous: "Dernier rendez-vous",
      derniereConsultation: "Dernière consultation",
    },

    actions: {
      nouveauRendezVous: "Nouveau rendez-vous",
      modifier: "Modifier le dossier",
      chargerPlus: "Charger les événements précédents",
    },

    /**
     * États vides. Chacun dit ce qui MANQUE, jamais ce qui est ABSENT au sens
     * clinique : « aucun diagnostic enregistré » parle du dossier, pas de la
     * patiente.
     */
    vide: {
      diagnostics: "Aucun diagnostic enregistré.",
      echelles: "Aucune mesure d'échelle disponible.",
      prescriptions: "Aucune prescription enregistrée.",
      rendezVousAVenir: "Aucun rendez-vous à venir.",
      rendezVous: "Aucun rendez-vous enregistré.",
      consultations: "Aucune consultation enregistrée.",
      chronologie: "Aucun événement enregistré pour ce dossier.",
      chronologieFin: "Début du dossier.",
    },

    /**
     * Libellés de la chronologie. La base ne fabrique aucune phrase : elle rend
     * une clé fermée (`label_key`), résolue ici. Un libellé formé en SQL est un
     * endroit où du texte clinique finit par se glisser.
     */
    chronologie: {
      consultationOuverte: "Consultation ouverte",
      consultationClose: "Consultation terminée",
      noteSignee: "Note clinique signée",
      diagnosticPose: "Diagnostic posé",
      diagnosticResolu: "Diagnostic résolu",
      prescription: "Prescription",
      echelle: "Échelle administrée",
      rdv: "Rendez-vous",
      document: "Document émis",
    },

    /**
     * Traitements. ⚠️ AUCUN LIBELLÉ « EN COURS », « ACTIF » NI « ARRÊTÉ » : le
     * schéma n'a ni `stopped_at` ni statut de ligne (009). Affirmer qu'un
     * traitement est en cours serait inventer une donnée clinique.
     */
    traitements: {
      manuscrite: "Ordonnance manuscrite",
      lignes: "ligne(s)",
      posologie: "Posologie",
      parJour: "fois par jour",
      duree: "Durée",
      jours: "jour(s)",
      /**
       * Une fonction plutôt qu'une chaîne à trous : l'accord du pluriel est une
       * décision de LANGUE, elle appartient à ce fichier. Concaténer « autre » et
       * un « s » conditionnel dans un composant disperse le français dans le code
       * et le rend introuvable le jour où il faut le corriger.
       */
      autresPrescriptions: (n: number): string =>
        n === 1
          ? "1 autre prescription figure au dossier. La chronologie en porte le détail daté."
          : `${String(n)} autres prescriptions figurent au dossier. La chronologie en porte le détail daté.`,
    },

    echelle: {
      dernierScore: "Dernier score",
      scorePrecedent: "Score précédent",
      evolution: "Écart",
      /** Une seule mesure : on le DIT, plutôt que de laisser un écart vide. */
      mesureUnique: "Une seule mesure : aucun écart calculable.",
    },

    prenom: "Prénom",
    nom: "Nom",
    /** L'indication reprend la contrainte réelle de la base, pas une approximation. */
    formatTelephone: "8 à 20 caractères : chiffres, espaces et « + ».",
    /* Dit à CÔTÉ DU CHAMP fautif ce que la contrainte `patients_phone_format`
       (004) refuse. Le refus arrivait jusque-là de la base, en message
       générique : la praticienne voyait « une valeur saisie n'est pas
       acceptée » sans savoir laquelle. La ponctuation courante (tirets,
       points, parenthèses) est ramenée à des espaces avant ce contrôle. */
    telephoneRefuse:
      "Ce numéro n'est pas enregistrable : 8 à 20 caractères, uniquement des chiffres, des espaces et « + ».",

    modification: {
      titre: "Modifier le dossier",
      enregistrer: "Enregistrer",
      annuler: "Annuler",
      contactNom: "Nom du contact",
      contactLien: "Lien avec le patient",
      contactTelephone: "Téléphone du contact",
    },

    /**
     * Patients V3 — création d'un dossier. L'écran ne collecte QUE ce que le
     * schéma porte (004) : pas d'e-mail, pas de profession, pas de situation
     * familiale — ces colonnes n'existent pas, elles ne sont donc ni demandées
     * ni affichées « Non renseigné ».
     */
    creation: {
      surTitre: "Patients",
      titre: "Nouveau dossier",
      sousTitre:
        "L'essentiel d'abord : prénom, nom et téléphone. Tout le reste se complète ensuite dans le dossier.",
      obligatoires: "Champs obligatoires",
      complementaires: "Informations complémentaires",
      complementairesAide:
        "Facultatif maintenant. Chaque champ se modifie plus tard dans le dossier.",
      creer: "Créer le dossier",
      annuler: "Annuler",
      /** Dit à CÔTÉ DU CHAMP fautif, avant l'aller-retour (motif modification). */
      champRequis: "Ce champ est obligatoire.",
      praticienResponsable: "Praticien responsable",
      praticienAide:
        "Le dossier est rattaché à ce praticien : c'est elle qui en verra le contenu clinique.",
      /**
       * Le refus NOMMÉ du garde de doublon dur (`app.create_patient`,
       * SQLSTATE 23505). La base reste l'autorité du refus ; le message,
       * lui, est écrit ici — le texte brut de Postgres n'atteint jamais
       * l'écran (I5), et un « conflit » générique ne dirait pas quel geste
       * faire.
       */
      doublonRefuse:
        "Un dossier avec ces mêmes coordonnées existe déjà. Rien n'a été créé. Consultez la liste des patients similaires ci-contre.",
    },

    /**
     * Patients V3 — candidats doublons pendant la saisie. Protecteur, jamais
     * obstructif : on montre QUI ressemble, POURQUOI, et comment ouvrir le
     * dossier existant. Aucun score ni pourcentage : des raisons.
     */
    similaires: {
      titre: "Patients similaires",
      verification: "Vérification des doublons…",
      aucun: "Aucun dossier similaire dans votre périmètre.",
      raisonNom: "Nom proche",
      raisonTelephone: "Même téléphone",
      raisonNaissance: "Naissance identique",
      ouvrir: "Ouvrir le dossier",
      forteTitre: "Ce dossier semble correspondre à un patient existant.",
      forteCorps:
        "Si c'est bien la même personne, ouvrez son dossier plutôt que d'en créer un second.",
      creerMalgreTout: "Créer malgré tout",
    },

    /**
     * Patients V3 — bandeau « Aujourd'hui ». Données uniquement : la porte
     * rend rendez_vous_du_jour ; une liste vide dit « aucun RDV aujourd'hui »
     * et, si elle existe, la prochaine échéance. Rien d'inventé.
     */
    aujourdhui: {
      titre: "Aujourd'hui",
      aucun: "Aucun rendez-vous aujourd'hui",
      prochain: "Prochain",
    },

    /**
     * Patients V3 — Résumé du cas. ⚠️ L'IA ne bloque jamais l'écran et n'est
     * JAMAIS la source de vérité : chaque item porte ses sources, la mention
     * permanente du disclaimer s'applique, et l'échec laisse un Point de
     * situation déterministe à la place.
     */
    resume: {
      titre: "Résumé du cas",
      surTitre: "Alexa",
      enBref: "En bref",
      evolution: "Évolution récente",
      dernierEtat: "Dernier état connu",
      traitements: "Traitements documentés",
      pointsAttention: "Points d'attention",
      sources: "Sources",
      pourquoi: "Pourquoi ?",
      fermerPreuves: "Fermer les sources",
      registreDocumente: "Documenté",
      registreSynthese: "Synthèse IA",
      aucuneSource: "Aucune source rattachée.",
      generer: "Générer le résumé",
      actualiser: "Actualiser",
      generationEnCours: "Actualisation du résumé…",
      aJour: "À jour",
      modifieDepuis: "Données modifiées depuis ce résumé",
      genereLe: "Généré le",
      indisponibleTitre: "Résumé IA indisponible",
      indisponibleCorps:
        "La génération n'a pas abouti. Vos données restent entièrement utilisables.",
      reessayer: "Réessayer",
      videTitre: "Aucun résumé généré",
      videCorps:
        "Alexa peut préparer une synthèse structurée à partir des faits documentés du dossier.",
      pointSituationTitre: "Point de situation du dossier",
      pointSituationSousTitre:
        "Données directes du dossier — ce n'est pas un résumé IA.",
      signaler: "Signaler une erreur",
      signalerTitre: "Signaler une information incorrecte",
      signalerMotif: "Qu'est-ce qui est inexact ?",
      signalerMotifAide:
        "Le motif est obligatoire ; il reste dans le cabinet.",
      signalerEnvoyer: "Envoyer le signalement",
      signaleOk: "Signalement envoyé. Le correctif passe par une nouvelle version.",
      signalementInvalide:
        "Le signalement exige un verdict et un motif. Rien n'a été envoyé.",
      verdicts: {
        incorrect: "Information incorrecte",
        imprecis: "Information imprécise",
        hors_sujet: "Hors sujet",
      },
    },

    /**
     * Patients V3 — « Depuis la dernière consultation ». Calcul déterministe
     * côté écran depuis les données du workspace ; aucune inférence clinique.
     */
    depuis: {
      titre: "Depuis la dernière consultation",
      sansReference: "Premier passage documenté.",
      rien: "Aucun nouvel élément documenté depuis",
      toutAfficher: "Tout afficher",
      reduire: "Réduire",
    },

    /**
     * Patients V3 — Signaux du dossier. ⚠️ CE SONT DES SIGNAUX, PAS DES
     * RECOMMANDATIONS : préfixe neutre « À vérifier — », jamais un verbe
     * prescriptif. Chaque item porte sa raison factuelle et sa source.
     */
    signaux: {
      titre: "Signaux du dossier",
      prefixe: "À vérifier — ",
      autres: (n: number): string =>
        n === 1
          ? "+1 autre signal visible dans le dossier."
          : `+${String(n)} autres signaux visibles dans le dossier.`,
      vide: "Aucun signal à examiner.",
    },

    rendezVousTotal: (n: number): string =>
      n === 1
        ? "1 rendez-vous figure au dossier."
        : `${String(n)} rendez-vous figurent au dossier.`,

    documentsTotal: (n: number): string =>
      n === 0
        ? "Aucun document émis."
        : n === 1
          ? "1 document émis."
          : `${String(n)} documents émis.`,

    /** Le format est celui de la contrainte `patients_phone_format` (004). */
    saisieInvalide:
      "Cette saisie n'a pas été acceptée. Rien n'a été enregistré. Vérifiez le téléphone (8 à 20 chiffres) et les champs obligatoires.",

    /**
     * ⚠️ PAS « une erreur est survenue ». Une réponse qui ne respecte pas le
     * contrat de la porte est un défaut NOMMÉ, et la praticienne doit savoir
     * que rien n'a été perdu.
     */
    reponseIncoherente:
      "Ce dossier n'a pas pu être affiché : la réponse du serveur ne correspond pas au format attendu. Aucune donnée n'a été modifiée. Réessayez, puis signalez-le si cela persiste.",
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
    /** Rendue à la place du bouton « Démarrer la séance » quand la praticienne
     * connectée n'est pas celle du rendez-vous. Ne dit rien qui ne soit déjà
     * vrai en base (`app.start_consultation` refuserait de toute façon) —
     * c'est de l'honnêteté d'interface, pas une deuxième barrière. */
    seanceReserveeAutrePraticien: "Séance réservée au praticien du rendez-vous.",
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
      /**
       * En-tête de colonne. Le français accorde à partir de DEUX : « 1 séance »,
       * « 2 séances » — et « 0 séance », au singulier, contrairement à l'anglais.
       * Écrire « 1 séances » sept fois par écran signale un logiciel approximatif
       * à quelqu'un dont le métier est de remarquer les détails.
       */
      seance: "séance",
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
   * Consultation — la séance et la note clinique (S5).
   *
   * ⚠️ AUCUNE PHRASE ICI N'AFFIRME UNE PROTECTION QUE LE CODE NE TIENT PAS.
   * `verrouParLaBase` dit que le refus vient de la base, parce que c'est vrai :
   * `trg_note_immutable` (008) lève, et l'interface ne fait que le relayer.
   * Ne jamais écrire ici qu'une note est « sauvegardée automatiquement » ni
   * qu'une saisie est « conservée localement » : aucune persistance locale
   * n'existe dans ce dépôt, et la praticienne fermerait l'écran en le croyant.
   *
   * ⚠️ AUCUN CONTENU CLINIQUE D'EXEMPLE (I19). Les indications sous les champs
   * SOAP décrivent la RUBRIQUE, jamais ce qu'il faudrait y écrire — suggérer
   * un contenu à une praticienne, c'est orienter un dossier médical.
   */
  consultation: {
    titre: "Consultation",
    surTitreSeance: "SÉANCE EN COURS",
    surTitreClose: "SÉANCE CLOSE",
    /**
     * V1.3 — une séance close dont `endedAt` est `null` (clôture administrative
     * d'une orpheline, migration 032, option C) n'a pas de durée connue. Ne
     * jamais afficher un chiffre qui continuerait de courir sur une séance
     * fermée : c'est exactement le symptôme `125:44:26` que V1.3 corrige.
     */
    dureeInconnue: "durée inconnue",
    introuvable:
      "Cette séance est introuvable. Rien n'a été modifié. Vérifiez le lien, ou revenez à l'agenda.",

    /* ⚠️ NI « Démarrer la séance », NI « Terminer la séance », NI « Signer la
       note » NE SONT ICI. Ces trois verbes sont IMPOSÉS par le §5 et vivent
       déjà dans `actions.*`, avec leurs retours dans `feedback.*`. Les
       redéclarer donnerait deux sources pour un même libellé, et le jour où
       l'une change, deux écrans nomment le même geste différemment. */
    reprendre: "Reprendre la séance",
    /** Titre du bandeau de rappel dans la coquille — pas un `eyebrow` de plus,
     * un fait affiché tant qu'une séance reste ouverte ailleurs que sur son
     * propre écran. */
    seanceEnCours: "Séance en cours",
    /* Le geste est irréversible côté dossier : le rendez-vous passe à
       « terminé » et les notes de travail se figent. On le dit avant, pas après. */
    confirmerCloture:
      "Terminer la séance ? Le rendez-vous passera à « Terminé » et les notes de travail ne seront plus modifiables.",

    /* La clôture EXIGE un tarif depuis 037 : sans ligne de paiement, la séance
       serait invisible aux Finances définitivement. Le refus remonte en P0001,
       qu'`errors.ts` traduit — à bon droit — par un message générique. L'écran
       dit donc la règle AVANT l'aller-retour, et nomme le geste exact. */
    clotureSansTarifTitre: "Le tarif manque",
    clotureSansTarif:
      "Une séance ne se termine pas sans tarif : elle ne serait jamais comptée. Indiquez le montant ci-dessus, puis terminez la séance. Une séance offerte se saisit à 0.",

    duree: "Durée de la séance",
    debut: "Début",
    fin: "Fin",
    typeConsultation: "Type de consultation",

    notesBrutes: "Notes de séance",
    notesBrutesIndication:
      "Brouillon de travail, saisi au fil de la séance. Ne fait pas partie de la note signée.",
    notesBrutesFigees: "La séance est close : ces notes ne sont plus modifiables.",

    note: "Note clinique",
    noteAbsente: "Aucune note n'a encore été ouverte pour cette séance.",
    subjective: "Subjectif",
    subjectiveIndication: "Ce que le patient rapporte.",
    objective: "Objectif",
    objectiveIndication: "Ce qui est observé pendant l'entretien.",
    assessment: "Évaluation",
    assessmentIndication: "L'analyse clinique de la praticienne.",
    plan: "Conduite à tenir",
    planIndication: "Ce qui est décidé pour la suite.",

    /* Le mot « définitivement » n'y est pas : la fenêtre de 15 minutes existe,
       et l'annoncer comme définitif serait faux dans les deux sens. */
    confirmerSignature:
      "Signer cette note ? Elle entrera au dossier. Vous pourrez encore la corriger pendant quinze minutes, puis toute correction devra passer par un amendement.",
    signeePar: "Signée par",
    signeeLe: "Signée le",
    noteVide: "Renseignez au moins une rubrique avant de signer.",

    fenetreCorrection: "Correction possible encore",
    fenetreIndication:
      "Après ce délai, la note est verrouillée par la base de données et toute correction passe par un amendement.",
    verrouillee: "Note verrouillée",
    verrouParLaBase:
      "Cette note est verrouillée. Le refus vient de la base de données, pas de cet écran : elle ne peut plus être réécrite par aucun moyen. Une correction s'ajoute en amendement.",

    amendements: "Amendements",
    amendementsAucun: "Aucun amendement.",
    /* Le français accorde à partir de deux ; « 0 amendement » reste au
       singulier. Le défaut « 1 séances » de S4 ne se rejoue pas ici. */
    amendementSingulier: "amendement",
    amendementPluriel: "amendements",
    redigerAmendement: "Rédiger un amendement",
    amendementMotif: "Motif de l'amendement",
    amendementMotifIndication: "Pourquoi cette correction est nécessaire.",
    amendementCorps: "Contenu de l'amendement",
    amendementEnregistre: "Amendement enregistré.",
    amendementIncomplet: "Le motif et le contenu sont tous deux requis.",
    amendementPar: "Par",

    /* Le panneau existe, la fonctionnalité non — et l'écran le dit au lieu
       d'afficher une transcription inventée (I19). */
    filSeance: "Fil de séance",
    filSeanceIndisponible:
      "La transcription automatique n'est pas disponible ce mois-ci. Les notes de séance ci-contre se saisissent à la main.",
    assistance: "Aide à la décision",
    /* S6 — `analyze_session`, seul outil Jarvis de cette passe. `write: false`
       dans les deux specs (03-JARVIS-TOOLS.md §3, JARVIS-DEMO-SPEC.md §2) :
       un simple bouton, sans carte de confirmation. Le résultat est un
       BROUILLON en lecture seule — rien ne l'insère dans la note SOAP, qui
       reste le geste de la praticienne (I6). */
    analyserLaSeance: "Analyser la séance",
    analyseEnCours: "Analyse en cours…",
    analyseAucuneNote: "Aucune note de séance à analyser pour l'instant.",
    analyseIndisponible:
      "Assistant indisponible. Le reste de l'écran reste pleinement utilisable — notes, note clinique et signature ne dépendent pas d'Alexa.",
    noteStructureeTitre: "Note structurée",
    evolutionTitre: "Évolution depuis la dernière fois",
    evolutionAucune: "Aucune consultation antérieure à comparer.",
    pointsNonExploresTitre: "Points non explorés",
    pointsNonExploresAucun: "Aucun point signalé.",

    enregistrement: "Enregistrement…",
    enregistre: "Enregistré",
    nonEnregistre: "Non enregistré",
    nonEnregistreIndication:
      "La dernière saisie n'a pas pu être envoyée. Le texte reste affiché à l'écran ; ne fermez pas cet onglet avant qu'il soit enregistré.",
  },

  /**
   * V8 — Documents. Émettre, relire, imprimer un certificat.
   *
   * ⚠️ AUCUNE DE CES PHRASES NE PROMET CE QUE LE CODE NE FAIT PAS.
   *
   * `impression.avertissementCompteur` en est l'exemple à ne pas défaire : le
   * navigateur ne dit JAMAIS si la feuille est sortie ou si la boîte de
   * dialogue a été annulée. `printed_count` compte donc des ENVOIS à
   * l'impression, pas des tirages. Écrire « imprimé 2 fois » affirmerait une
   * chose que le système ne peut pas savoir.
   *
   * `emission.apercuAvertissement` ferme l'autre piège : l'aperçu affiché
   * AVANT l'émission est reconstitué par l'écran, alors que la pièce est rendue
   * et figée par la base (030 §1quater). Les deux se ressemblent, ils ne sont
   * pas le même document — et c'est le second qui engage la praticienne.
   *
   * ⚠️ `erreurs.dossierIntrouvable` sert AUSSI BIEN au dossier inexistant
   * qu'au dossier d'une consœur, même raison que `patients.ficheIntrouvable` :
   * la base rend NULL dans les deux cas (ADR-003) et deux phrases distinctes
   * fabriqueraient un oracle d'existence.
   */
  documents: {
    titre: "Documents",
    sousTitre: "Certificats et attestations",

    types: {
      bonne_sante_mentale: "Certificat de bonne santé mentale",
      suivi_medical: "Certificat de suivi médical",
      certificat_medical: "Certificat médical",
      justification: "Justification",
    },

    selecteur: {
      titre: "Choisir un dossier",
      rechercher: "Rechercher un patient",
      indication: "Nom, téléphone ou numéro de dossier",
      lancerRecherche: "Rechercher",
      aucunResultat: "Aucun dossier visible dans votre périmètre.",
      changer: "Changer de dossier",
      dossier: "Dossier",
    },

    liste: {
      titre: "Documents du dossier",
      colonneType: "Type",
      colonneDate: "Émis le",
      colonneImpressions: "Impressions",
      ouvrir: "Ouvrir",
    },

    emission: {
      ouvrir: "Générer un certificat",
      choisirType: "Type de document",
      /* Le bouton qui SOUMET le formulaire. Distinct de « ouvrir » : les deux
       * portaient le même libellé, donc deux gestes différents disaient la même
       * chose — « ouvrir le formulaire » et « passer à la confirmation ». Un
       * bouton nomme SON action (04-DESIGN-SYSTEM §5). */
      verifier: "Vérifier le certificat",
      apercuTitre: "Aperçu avant émission",
      apercuAvertissement:
        "Aperçu reconstitué. Le certificat définitif est rendu et figé par le serveur au moment de l'émission.",
      confirmerTitre: "Émettre ce certificat ?",
      confirmerCorps:
        "Un certificat émis ne se modifie ni ne s'annule. Une erreur se corrige en émettant un nouveau certificat.",
      confirmer: "Émettre le certificat",
      annuler: "Annuler",
      enCours: "Émission en cours…",
      emis: "Certificat émis.",
    },

    champs: {
      id_document_number: "Numéro de la pièce d'identité",
      mairie: "Mairie de délivrance",
      jours: "Nombre de jours d'arrêt",
      jours_lettres: "En toutes lettres",
      date_debut: "À compter du",
      date_naissance: "Date de naissance",
      /* DOCUMENT-TEMPLATES-v2 §3 : deux puces, la seconde facultative. */
      traitement_1: "Traitement — 1re ligne",
      traitement_2: "Traitement — 2e ligne (facultatif)",
      date_consultation: "Date de la consultation",
      aideJoursLettres: "Calculée par le serveur — non modifiable.",
      aideDateNaissance: "Reprise du dossier. Vérifiez avant d'émettre.",
      aideTraitement: "Texte libre, tel qu'il apparaîtra sur le certificat.",
      /* Dire ce que le vide FAIT, pas seulement qu'il est permis : « laissez
       * vide » sans la conséquence laisse craindre une puce blanche imprimée. */
      aideTraitement2: "Laissez vide pour n'imprimer qu'une seule ligne.",
      formatDate: "JJ/MM/AAAA",
    },

    /** Les libellés du bloc patient de l'en-tête, côté APERÇU seulement. */
    enTete: {
      date: "Date :",
      nom: "Nom :",
      prenom: "Prénom :",
      age: "Age :",
      ans: "ans",
    },

    apercu: {
      /* Le bloc identité de l en-tête vit dans app.profiles, que l aperçu ne lit
       * pas. On le DIT plutôt que d écrire un nom approximatif : un en-tête faux
       * dans un aperçu est pire qu un en-tête absent, parce qu il rassure. */
      enTetePraticienne: "En-tête de la praticienne — composé par le serveur à l’émission.",
      corpsRenduParServeur:
        "Le texte du certificat est celui du modèle du cabinet. Il est composé par le serveur ; voici les valeurs qui y seront insérées :",
    },

    impression: {
      imprimer: "Imprimer",
      envoyees: "Envois à l'impression :",
      avertissementCompteur:
        "Ce compteur mesure les envois à l'impression, pas les feuilles sorties.",
    },

    vide: {
      phrase: "Aucun document émis pour ce patient.",
      action: "Générer un certificat",
      sansDossier: "Choisissez un dossier pour voir ses documents.",
      /* La colonne de droite quand un dossier EST choisi mais qu’aucun document
       * n’est ouvert. Distincte de sansDossier : afficher « choisissez un
       * dossier » alors qu’un dossier est affiché en en-tête est une phrase que
       * l’écran contredit lui-même, et une phrase fausse coûte plus qu’une
       * phrase absente. */
      aucunDocumentOuvert: "Aucun document ouvert.",
    },

    erreurs: {
      chargementListe: "La liste des documents de ce dossier n'a pas pu être lue.",
      chargementDocument: "Ce document n'a pas pu être ouvert.",
      emission: "Le certificat n'a pas été émis.",
      preserveListe: "Aucun document n'a été émis, et la liste existante est intacte.",
      preserveEmission: "Aucun certificat n'a été émis.",
      dossierIntrouvable: "Ce dossier n'est pas accessible.",
      /**
       * ⚠️ LE DOSSIER INCOMPLET — REFUS PRÉVU PAR L'ÉCRAN, PAS SUBI.
       *
       * `043` refuse d'émettre si le dossier n'a ni sexe ni date de naissance :
       * `civilite`, `age` et `birth_date_fr` en dérivent, et sans elles le
       * certificat sortirait avec des marqueurs littéraux. Le refus est JUSTE.
       *
       * Mais il remonte en `P0001`, que `errors.ts` traduit — à bon droit — par
       * un message générique : le texte brut de Postgres n'atteint jamais
       * l'écran, parce qu'il porte régulièrement la valeur fautive (I5, règle
       * 1). La praticienne lisait donc « refusé par une règle du dossier
       * médical » sans savoir QUOI corriger, devant un formulaire qui lui
       * paraissait complet.
       *
       * L'écran connaît déjà la date de naissance — il affiche « Non renseigné »
       * dans l'aperçu. Il annonce donc le refus AVANT l'aller-retour, avec le
       * geste à faire. Même principe que la validation de `champs.ts` : un refus
       * qui n'a pas quitté la machine n'a rien coûté, et son message est écrit
       * par nous plutôt que par un SQLSTATE.
       */
      dossierIncomplet:
        "Ce dossier n'a pas de date de naissance : aucun certificat ne peut en être émis. La date et le sexe se saisissent dans le dossier du patient — l'écran Patients ne les modifie pas encore.",
      /**
       * Le filet, pour les refus que l'écran NE SAIT PAS prévoir — au premier
       * rang desquels un sexe manquant, que `get_patient` ne rend pas. Nommer
       * les deux causes vérifiables vaut mieux que renvoyer au journal
       * d'activité, que la praticienne n'ouvrira pas entre deux patients.
       */
      emissionRefusee:
        "L'émission a été refusée par une règle du dossier. Aucun certificat n'a été émis. Vérifiez que la fiche du patient porte bien une date de naissance ET un sexe, puis réessayez.",
      /**
       * ⚠️ L'INVARIANT DE SORTIE. Un marqueur `{{…}}` sans valeur est laissé
       * LITTÉRAL par `app.render_template` (030 §1quater) — délibérément :
       * « un trou invisible dans un certificat est pire qu'un marqueur
       * visible ». Vrai en base ; faux devant une imprimante. Sur le papier,
       * un `{{praticien.full_name_ar}}` n'est plus un signal, c'est un
       * certificat médico-légal abîmé remis à un notaire.
       *
       * L'écran refuse donc de composer et d'imprimer une pièce trouée. Il ne
       * la répare pas et ne la masque pas : la ligne émise reste intacte et
       * immuable en base, c'est le TIRAGE qui est bloqué. La cause est
       * toujours la même — une valeur de `app.profiles` non saisie sur
       * l'instance — et le message nomme le geste, pas le défaut.
       */
      marqueurNonResolu:
        "Ce certificat ne peut pas être imprimé : l'en-tête du cabinet est incomplet.",
      marqueurNonResoluAide:
        "Une information de la praticienne manque dans les paramètres du cabinet. Complétez-la, puis émettez un nouveau certificat — celui-ci reste dans le dossier, il ne se modifie pas.",
      champRequis: "Ce champ est obligatoire.",
      joursHorsBornes: "Entre 1 et 365 jours.",
      joursNonEntier: "Un nombre entier de jours est attendu.",
      dateInvalide: "Date attendue au format JJ/MM/AAAA.",
    },

    horsLigne: {
      emissionBloquee: "Émission indisponible hors ligne.",
    },
  },

  /**
   * S7a — Finance. Le tarif en fin de séance et la recette du jour.
   *
   * `perimetreCabinet` / `perimetrePraticienne` recopient ce que la BASE a
   * réellement filtré (029 §4 rend la colonne `perimetre`). Ce ne sont pas deux
   * étiquettes au choix de l'écran : afficher « cabinet » à qui ne voit que sa
   * part serait un chiffre faux avec un mot juste.
   */
  finances: {
    titre: "Finances",

    /* ═══ CONSULTATION — le bloc tarif, inchangé ═══════════════════════════
     * Ces clés appartiennent à l'écran de SÉANCE, pas à /finances. Elles
     * survivent au passage en comptabilité de caisse parce que la saisie du
     * tarif, elle, n'a pas changé — et depuis 037 elle est même DEVENUE une
     * condition de clôture. */
    tarifTitre: "Tarif de la séance",
    tarifIndication: "Dinars entiers. Le montant est enregistré, pas imprimé.",
    tarifMontant: "Montant",
    tarifDejaEncaisse: "Encaissé — le montant ne se modifie plus.",
    tarifDejaEncaisseIndication:
      "Une somme encaissée est une pièce comptable. La corriger se fait hors de cet écran.",
    tarifSeanceIntrouvable:
      "Cette séance n'a pas pu être retrouvée. Le tarif n'a pas été enregistré.",
    numeroRecu: "Reçu",

    incoherence:
      "Les chiffres de cette période ne se recoupent pas. Aucune donnée n'a été modifiée. Réessayez ; si le problème persiste, signalez-le.",

    /* ═══ COMPTABILITÉ DE CAISSE ═══════════════════════════════════════════
     *
     * ⚠️ IL N'Y A QU'UN SEUL CHIFFRE DE RECETTE : l'argent reçu.
     *
     * Le lot précédent nommait quatre grandeurs — Facturé, Encaissé, En
     * attente, Taux d'encaissement — parce qu'il modélisait un cabinet qui
     * facture puis se fait payer. Celui-ci est au COMPTANT : la patiente règle
     * à la séance. « Facturé » et « encaissé » y désignaient la même chose à
     * quelques exceptions près, et ces quatre mots occupaient la moitié de
     * l'écran pour une distinction qui n'existe pas dans ce cabinet.
     *
     * Les impayés n'ont pas disparu — ils sont redevenus ce qu'ils sont : des
     * EXCEPTIONS, qui vivent dans « À votre attention » et dans l'onglet
     * Séances & paiements, jamais en tête d'écran comme un second total.
     */
    onglets: {
      apercu: "Vue d'ensemble",
      charges: "Charges",
      seances: "Séances & paiements",
    },

    periodes: {
      legende: "Période affichée",
      jour: "Aujourd'hui",
      semaine: "Cette semaine",
      mois: "Ce mois",
      annee: "Cette année",
      personnalise: "Personnalisé",
      du: "Du",
      au: "au",
      jours: "jours",
      unJour: "1 jour",
      appliquer: "Appliquer",
      plageInvalide:
        "Cette plage de dates n'est pas valide. Vérifiez que la fin suit le début, et que la période ne dépasse pas un an.",
    },

    pulse: {
      aujourdhui: "Aujourd'hui",
      aujourdhuiAide: "L'argent entré en caisse depuis minuit, heure d'Alger.",
      semaine: "Cette semaine",
      semaineAide: "L'argent entré en caisse depuis lundi.",
      mois: "Ce mois",
      moisAide: "L'argent entré en caisse depuis le 1er du mois.",
      charges: "Charges",
      chargesAide:
        "Les charges imputées sur la période. Une charge trimestrielle compte pour un tiers par mois, une annuelle pour un douzième.",
      resultatNet: "Résultat net",
      resultatNetAide: "Recette de la période moins les charges de la période.",
      seances: "{n} séances",
      uneSeance: "1 séance",
      aucuneSeance: "Aucune séance",
      panierMoyen: "Panier moyen {montant}",
      chargesRecurrentes: "{n} charges récurrentes",
      uneChargeRecurrente: "1 charge récurrente",
      absent: "—",
    },

    evolution: {
      titre: "Évolution",
      legendeRevenu: "Recette",
      legendeCharges: "Charges",
      legendeNet: "Résultat net",
      aide: "Six mois glissants, jusqu'au mois en cours.",
      tableau: "Évolution mensuelle, en tableau",
      colonneMois: "Mois",
    },

    anatomie: {
      titre: "Anatomie",
      revenus: "D'où vient l'argent",
      charges: "Où part l'argent",
      aucunRevenu: "Aucune recette sur la période.",
      aucuneCharge: "Aucune charge sur la période.",
      nonRattache: "Séance non rattachée",
      part: "{pct} %",
    },

    attention: {
      titre: "À votre attention",
      impayes: "Impayés",
      impayesDetail: "{n} séances",
      impayeUn: "1 séance",
      aucunImpaye: "Aucun impayé.",
      plusAncien: "Le plus ancien remonte à {n} jours.",
      plusAncienUn: "Le plus ancien remonte à 1 jour.",
      echeances: "Prochaines échéances",
      aucuneEcheance: "Aucune échéance à venir.",
      dansJours: "dans {n} j",
      demain: "demain",
      aujourdhui: "aujourd'hui",
    },

    calendrier: {
      titre: "Calendrier",
      aide: "Intensité de l'argent encaissé, jour par jour.",
      cellule: "{date} · {montant} · {n} séances",
      celluleImpaye: "{date} · {montant} · {n} séances · impayé",
      moins: "moins",
      plus: "plus",
    },

    tableauCharges: {
      intitule: "Intitulé",
      categorie: "Catégorie",
      montant: "Montant",
      type: "Type",
      frequence: "Fréquence",
      echeance: "Prochaine échéance",
      actions: "Actions",
      /* ⚠️ DEUX TOTAUX, JAMAIS ADDITIONNÉS — un rythme mensuel et des dépenses
       * ponctuelles ne sont pas la même unité. Les sommer donnerait un nombre
       * sans signification sur lequel on déciderait quand même. */
      totalRecurrent: "Récurrent mensuel",
      totalPonctuel: "Ponctuel sur la période",
      ajouter: "Ajouter une charge",
      modifier: "Modifier",
      desactiver: "Désactiver",
      aucune: "Aucune charge enregistrée.",
      recurrente: "Récurrente",
      ponctuelle: "Ponctuelle",
      sansEcheance: "—",
      confirmerDesactivation:
        "Désactiver cette charge ? Elle sortira des totaux à venir ; l'historique déjà produit reste lisible.",
    },

    formulaireCharge: {
      titreCreer: "Nouvelle charge",
      titreModifier: "Modifier la charge",
      intitule: "Intitulé",
      intitulePlaceholder: "Loyer du cabinet, abonnement, assurance…",
      montant: "Montant (DZD)",
      montantIndication: "Dinars entiers, supérieur à zéro.",
      type: "Type",
      frequence: "Fréquence",
      frequenceDesactivee: "Une charge ponctuelle n'a pas de fréquence.",
      categorie: "Catégorie",
      date: "Date",
      enregistrer: "Enregistrer la charge",
      annuler: "Annuler",
      champRequis: "Ce champ est requis.",
    },

    tableauSeances: {
      date: "Date",
      patient: "Patient",
      type: "Type",
      montant: "Montant",
      mode: "Mode",
      statut: "Statut",
      action: "Action",
      paye: "payé",
      impaye: "impayé",
      recu: "Reçu",
      relancer: "Relancer",
      badge: "{n} impayés · {montant}",
      badgeUn: "1 impayé · {montant}",
      aucunImpaye: "Aucun impayé",
      aucune: "Aucune séance tarifée sur cette période.",
    },

    categories: {
      local: "Local",
      personnel: "Personnel",
      outils: "Outils",
      assurance: "Assurance",
      autre: "Autre",
    },

    /* `app.payment_method` ne porte qu'une valeur (ADR-010 : espèces). La table
       existe quand même : afficher la clé d'enum brute — « cash » — dans une
       interface intégralement française serait une chaîne en dur anglaise. */
    modes: {
      cash: "Espèces",
    },

    frequences: {
      mensuelle: "Mensuelle",
      trimestrielle: "Trimestrielle",
      annuelle: "Annuelle",
    },

    videPeriode:
      "Aucun mouvement sur cette période. Les séances tarifées et les charges apparaissent ici.",
    reessayer: "Réessayer",
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
    // ⚠️ CES TROIS-LÀ DISENT QUEL ORGANE A LÂCHÉ, ET C'EST TOUT L'INTÉRÊT.
    // Chacune se lit en trois temps comme les autres : ce qui s'est passé ·
    // ce qui est préservé · quoi faire. Aucune ne prétend qu'une écriture a
    // eu lieu ou non quand la sémantique de l'opération est inconnue.
    transcription:
      "Je n'ai pas réussi à comprendre votre demande. Rien n'a été enregistré. Reformulez à voix haute, ou tapez votre demande.",
    // La réponse EXISTE et reste affichée : le dire évite de refaire une
    // demande qui a parfaitement abouti.
    synthese:
      "La réponse est prête, mais je n'arrive pas à la lire à voix haute. Le texte reste affiché ci-dessus. Réessayez la lecture dans quelques instants.",
    analyse:
      "Le service d'analyse est momentanément indisponible. Aucune donnée n'a été modifiée. Réessayez dans quelques instants.",
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

  /**
   * V1.5 — au-delà de 10 s sans réponse, un CHARGEMENT bascule en ERREUR
   * (05-UX-CONTRACT.md §2 : « le spinner sans fin est interdit »). Le mot
   * « délai » y figure toujours — c'est ce que le checkpoint relit.
   */
  delaiDepasse:
    "Le délai de réponse a été dépassé. Aucune donnée n'a été modifiée. Réessayez.",

  /**
   * V2 — Jarvis. Chaque message dit ce qui s'est passé, ce qui n'a PAS été
   * modifié, et quoi faire ensuite. Aucun ne cite une valeur de ligne (règle 1),
   * et aucun ne distingue « introuvable » de « hors périmètre » (ADR-003).
   */
  jarvis: {
    titre: "Alexa",

    /**
     * Patients V3 — contexte patient actif. Jamais une autorisation : une
     * cible PRÉ-RESOLUE pour les outils, effacée à la navigation. La cloison
     * reste en base (L3) ; l'écran rend le contexte évident, rien de plus.
     */
    contexte: {
      patientActif: "Patient actif",
      retirer: "Retirer le contexte patient",
    },
    ouvrir: "Ouvrir Alexa",
    fermer: "Fermer",
    invite: "Posez une question, ou dictez-la.",
    /** v9 — le libellé du bouton d'envoi (icône seule : nommé pour le lecteur
     * d'écran) et l'état d'attente, qui existe parce que le silence ne dit pas
     * que Jarvis travaille. */
    envoyer: "Envoyer",
    reflechit: "Alexa réfléchit…",

    /** V2.2 — l'indisponibilité ne bloque JAMAIS le reste de l'application. */
    indisponible:
      "Alexa est indisponible. Toutes les fonctions restent accessibles.",

    argumentsInvalides:
      "Cette demande n'a pas pu être interprétée de façon sûre. Rien n'a été modifié. Reformulez-la.",
    propositionIntrouvable:
      "Cette proposition n'est plus disponible. Rien n'a été modifié.",
    actionSansEffet:
      "L'action n'a pas pu être effectuée : la cible est introuvable ou hors de votre périmètre. Rien n'a été modifié.",

    /**
     * DÉSAMBIGUÏSATION — V2.2. Jarvis ne choisit jamais entre deux homonymes.
     * La phrase est une QUESTION, pas une annonce : elle rend le choix à
     * l'humaine au lieu de lui présenter un résultat déjà tranché.
     */
    plusieursPatients: "Plusieurs dossiers correspondent. Lequel ouvrir ?",
    aucunPatient: "Aucun dossier ne correspond à cette recherche.",

    /** V2.3 / ADR-023 — le refus est cadré et propose une suite, jamais sec. */
    refusCasIndividuel:
      "Je ne conclus pas sur une patiente ou un patient nommé. Je peux relever les éléments du dossier et les points à explorer — la conclusion vous appartient.",
    registreConnaissance:
      "Connaissance générale — pas ce dossier. Aide-mémoire, non vérifié : le Vidal reste la référence.",

    /** V2.5 — la carte de confirmation. */
    carte: {
      confirmer: "Confirmer",
      annuler: "Annuler",
      /** Le bouton reste inactif 400 ms : anti-clic réflexe, pas une animation. */
      patienter: "Confirmer…",
      creerRendezVous: "Créer un rendez-vous",
      fixerTarif: "Fixer le tarif de la séance",
      /** 063 — les quatre écritures ajoutées. Un titre = un acte, jamais un vague « Modifier ». */
      decalerRendezVous: "Déplacer le rendez-vous",
      annulerRendezVous: "Annuler le rendez-vous",
      marquerArrivee: "Marquer le patient comme arrivé",
      encaisserPaiement: "Enregistrer l'encaissement",
      /** Les trois écritures que la base admettait déjà sans que l'assistant les offre. */
      creerBrouillonDocument: "Préparer un brouillon de document",
      champNouvelleDate: "Nouvelle date",
      champDuree: "Durée",
      champMotif: "Motif",
      champSeance: "Séance",
      champPatient: "Patient",
      champPraticienne: "Praticienne",
      champDate: "Date",
      champMontant: "Montant",
      champTypeDocument: "Type de document",
      champNature: "Nature",
    },

    /**
     * ÉCRITURES — préconditions refusées et vérification post-exécution.
     *
     * ⚠️ `nonVerifiee` EST LA PHRASE LA PLUS IMPORTANTE DE CE FICHIER. Elle est
     * dite quand la porte n'a pas levé MAIS que la relecture ne retrouve pas
     * l'état demandé. Annoncer « c'est fait » dans ce cas serait le mensonge le
     * plus coûteux que Jarvis puisse produire : la praticienne compterait sur
     * un rendez-vous déplacé qui ne l'est pas.
     */
    ecriture: {
      creneauOccupe:
        "Ce créneau est déjà pris. Rien n'a été modifié. Proposez-moi une autre heure.",
      dejaAnnule: "Ce rendez-vous est déjà annulé. Rien n'a été modifié.",
      dejaArrive: "Ce patient est déjà marqué comme arrivé. Rien n'a été modifié.",
      dejaEncaisse: "Cette séance est déjà encaissée. Rien n'a été modifié.",
      tarifFige:
        "Cette séance est déjà encaissée : son tarif ne peut plus être changé. Rien n'a été modifié.",
      /**
       * ⚠️ UN BROUILLON N'EST PAS UNE ÉMISSION. Émettre consomme un numéro de la
       * table compteur, et un numéro consommé ne se rend pas : un brouillon
       * refusé laisserait un TROU dans la numérotation d'un document médical.
       * Cette phrase doit donc dire exactement ce qui a eu lieu — une demande
       * enregistrée, pas un document produit.
       */
      brouillonPrepare:
        "J'ai enregistré votre demande de brouillon. Aucun document n'a été émis : l'émission se fait à l'écran des documents.",
      seanceIntrouvable: "Je ne retrouve pas cette séance. Rien n'a été préparé.",
      nonVerifiee:
        "L'action a été tentée, mais je n'ai pas pu vérifier qu'elle a bien abouti. Vérifiez à l'écran avant de compter dessus.",
      verifiee: "C'est fait, et je l'ai vérifié.",
    },

    /** V2.4 — la voix. Coupée, le panneau reste utilisable au clavier. */
    voix: {
      parler: "Maintenir pour parler",
      ecoute: "À l'écoute…",
      transcription: "Transcription…",
      indisponible: "La voix est indisponible. Le clavier reste utilisable.",
      dejaEnCours: "Un enregistrement est déjà en cours.",
      microIndisponible:
        "Ce navigateur n'expose pas de micro utilisable. Le clavier reste utilisable.",
      microRefuse:
        "L'accès au micro a été refusé ou aucun micro n'est disponible. Utilisez le clavier.",
      aucuneDictee: "Aucun son n'a été capté. Rien n'a été envoyé.",
      tropLongue:
        "L'enregistrement dépasse la durée prise en charge. Rien n'a été envoyé. Reformulez plus brièvement.",
      texteTropLong:
        "Cette réponse dépasse la longueur lisible à voix haute. Aucun son n'a été demandé.",
      lectureBloquee:
        "Le navigateur a bloqué la lecture automatique. Touchez de nouveau le bouton pour écouter.",
      /**
       * Le texte nomme une patiente : la voix EXTERNE est interdite (règle 1),
       * et la voix locale manque. On le dit — on ne bascule pas vers l'externe
       * « pour que ça marche quand même ».
       */
      /**
       * LE MOT DE RÉVEIL — huit états, et les raisons de son absence.
       *
       * ⚠️ `aucunDetecteur` DIT LA VÉRITÉ SUR UN CHOIX EN ATTENTE, pas sur une
       * panne. Aucun moteur n'est embarqué parce qu'aucun n'a encore été retenu :
       * l'API du navigateur écoute en continu vers un tiers (règle 1), et les
       * moteurs sous licence exigent une clé en ligne. L'écran le dit plutôt que
       * d'afficher un micro inerte que la praticienne croirait cassé.
       */
      reveil: {
        /**
         * L'état de DÉPART, et le plus fréquent : la voix n'a simplement pas
         * encore été activée sur ce poste. À ne pas confondre avec
         * `aucunDetecteur`, qui signale une installation incomplète — dire
         * « aucun moteur installé » à quelqu'un qui n'a rien allumé l'enverrait
         * chercher une panne qui n'existe pas.
         */
        nonActivee:
          "Voix désactivée. Cliquez sur l'orbe pour activer le mot de réveil sur ce poste.",
        aucunDetecteur:
          "Le mot de réveil n'est pas activé sur ce poste : aucun moteur de détection locale n'est installé. Le micro reste utilisable en maintenant le bouton.",
        moteurIndisponible:
          "Le moteur de détection est installé mais ses fichiers sont introuvables. Le micro reste utilisable en maintenant le bouton.",
        /**
         * Le seul endroit de l'interface où la praticienne apprend QUOI DIRE.
         * Le mot prononcé et le nom de l'assistant coïncident désormais : dire
         * « Alexa » réveille Alexa. Cette chaîne doit rester alignée sur le
         * modèle réellement chargé (`NEXT_PUBLIC_WAKEWORD_MODELE`) — enseigner
         * un mot que le détecteur ne reconnaît pas serait pire que se taire.
         */
        motAPrononcer: "Dites « Alexa » pour me réveiller.",
        desarme: "Mot de réveil désactivé.",
        microRefuse:
          "L'accès au micro a été refusé. Le mot de réveil ne peut pas fonctionner ; le clavier reste utilisable.",
        etats: {
          veille: "En veille",
          reveille: "Oui ?",
          ecoute: "Je vous écoute…",
          traitement: "Un instant…",
          parole: "Alexa parle",
          interrompu: "Arrêté.",
          erreur: "Voix indisponible",
          desactive: "Voix désactivée",
        },
      },

      localeIndisponible:
        "Ce navigateur n'a pas de voix locale, et cette réponse nomme un dossier : elle ne peut pas être lue à voix haute. Le texte reste affiché.",
    },

    /**
     * V-JARVIS-CORE — flux, interruption, persistance, plein écran.
     * Chaque mention dit ce qui s'est passé SANS citer de contenu modèle :
     * les libellés d'état viennent de l'INTERFACE, jamais du serveur ni du
     * LLM (ADR-023, garde-fou 3).
     */
    flux: {
      pleinEcran: "Ouvrir Alexa en plein écran",
      fermerPleinEcran: "Revenir à l'écran",
      stop: "Arrêter la réponse",
      relire: "Écouter cette réponse",
      stopLecture: "Arrêter l'écoute",
      /** La porte 058 a refusé l'écriture : l'écran le dit, une fois. */
      nonPersistee:
        "Cette réponse n'a pas pu être conservée dans l'historique. Elle reste affichée ici.",
      interrompue: "Réponse arrêtée à votre demande.",
    },

    /**
     * LA BOUCLE — ce que Jarvis dit quand il N'A PAS abouti.
     *
     * ⚠️ CHACUNE DE CES PHRASES EST UN AVEU, PAS UNE EXCUSE. Quand un budget
     * s'épuise, la seule issue honnête est de dire qu'on n'a pas abouti :
     * fabriquer une réponse plausible avec les données partielles déjà obtenues
     * serait précisément l'hallucination que toute l'architecture existe pour
     * rendre impossible. Elles disent aussi ce qui N'A PAS été modifié — sur un
     * écran médical, « rien n'a changé » est l'information qui rassure.
     */
    boucle: {
      tropDIterations:
        "Je n'ai pas réussi à aboutir avec les informations dont je dispose. Rien n'a été modifié. Reformulez, ou demandez-moi un point précis.",
      tropDAppels:
        "Cette demande a nécessité trop de consultations successives. Rien n'a été modifié. Posez-la en plusieurs fois.",
      tropLong:
        "Cette demande a pris trop de temps. Rien n'a été modifié. Réessayez, ou demandez-moi un point plus précis.",
      enBoucle:
        "Je tourne en rond sur cette demande. Rien n'a été modifié. Reformulez-la autrement.",
      /**
       * Le pare-feu a refusé la charge sortante. Le message ne nomme JAMAIS ce
       * qui a déclenché le refus — ce serait recréer à l'écran la fuite que le
       * garde vient d'empêcher.
       */
      frontiere:
        "Je n'ai pas pu traiter cette demande sans risquer d'exposer une donnée identifiante. Rien n'a été envoyé, rien n'a été modifié.",
      /** Mention d'étape, affichée pendant que la capacité tourne. */
      consulte: "Je consulte…",
    },

    /** Historique rejoué après rechargement — mentions d'état seulement. */
    historique: {
      outil: "Outil proposé :",
      interrompue: "— réponse interrompue —",
      echecChargement:
        "L'historique n'a pas pu être chargé. Vous pouvez continuer la conversation.",
    },

    /**
     * AMORCES — des gestes réels, pas un contenu : chaque phrase part telle
     * quelle dans le champ de saisie, l'utilisatrice la voit et l'édite.
     * Aucune donnée fictive derrière (règle 8) : ce sont des questions.
     */
    amorce1: "Résume-moi ma journée",
    amorce2: "Qui arrive ensuite ?",
    amorce3: "Explique-moi le score de Hamilton",
  },

  /**
   * L'ÉCRAN DU MATIN DE LA PRATICIENNE (V4).
   *
   * Le contrat de cet écran tient en une phrase, celle du checkpoint V4 :
   * ouvrir le tableau de bord un matin réel, et savoir en une seconde qui est
   * là, qui est le suivant, combien attendent, ce qui a été encaissé.
   *
   * ⚠️ CHAQUE LIBELLÉ CI-DESSOUS A UNE COLONNE DERRIÈRE LUI. Il n'y a ni
   * « objectif du mois » (décoratif, écarté par Q14), ni « taux de présence »,
   * ni « occupation », ni « alerte clinique », ni « activité des agents » : rien
   * dans la base ne les calcule, et un chiffre plausible sur un écran médical
   * est un mensonge, pas un ornement (règle 8).
   *
   * LE MOT « ENCAISSÉ » EST CHOISI, PAS SUBI. La porte compte les paiements
   * dont `collected_at` n'est pas nul — jamais les montants facturés. Le jour où
   * l'un des deux change, ce libellé change avec lui.
   *
   * LES ÉTATS VIDES DISENT POURQUOI, ET PROPOSENT UN GESTE (05-UX-CONTRACT §3).
   * Jamais d'illustration, jamais « aucune donnée », jamais « bientôt ».
   */
  tableauDeBord: {
    salutation: "Bonjour Docteur",
    sousTitre: "Votre journée",
    /** L'action d'en-tête. Distincte de `fil.videAction` bien que le mot soit
     *  le même aujourd'hui : l'une mène à l'agenda depuis un écran plein,
     *  l'autre depuis une journée vide. Les fusionner ferait changer les deux
     *  le jour où l'une seule doit changer. */
    ouvrirAgenda: "Voir l'agenda",

    maintenant: {
      seanceEnCours: "Séance en cours",
      depuis: "Depuis {duree}",
      reprendre: "Reprendre la séance",
      aucuneSeance: "Aucune consultation en cours.",
      demarrerSeance: "Démarrer une séance",

      suivant: "Patient suivant",
      aSonHeure: "à {heure}",
      dejaLa: "Déjà arrivé",
      demarrer: "Démarrer la séance",
      ouvrirDossier: "Ouvrir le dossier",
      aucunSuivant: "Plus personne après cette séance.",

      salleAttente: "Salle d'attente",
      personneAttend: "Personne n'attend.",
      /** Pluriel géré à l'appel : la base rend un nombre, pas une phrase. */
      attendUn: "patient attend",
      attendPlusieurs: "patients attendent",
    },

    fil: {
      titre: "Le fil de la journée",
      maintenant: "Maintenant",
      vide: "Votre journée est libre.",
      videAction: "Ouvrir l'agenda",
      /** Statuts repris tels quels du glossaire — jamais traduits deux fois. */
      statut: {
        confirmed: "Attendu",
        arrived: "Arrivé",
        in_session: "En séance",
        completed: "Terminé",
        no_show: "Absent",
      },
      seances: "{nombre} séances",
      terminees: "{nombre} terminées",
    },

    caisse: {
      titre: "Encaissé aujourd'hui",
      /** Le périmètre vient de la base ; l'écran ne le devine jamais. */
      perimetreCabinet: "Le cabinet",
      perimetrePraticienne: "Vos séances",
      seances: "{nombre} séances encaissées",
      rien: "Rien encaissé pour l'instant.",
      voirFinances: "Ouvrir les finances",
    },

    nouveaux: {
      titre: "Nouveaux patients ce mois",
      aucun: "Aucun dossier ouvert ce mois-ci.",
      voirPatients: "Ouvrir les patients",
    },

    jarvis: {
      titre: "Alexa propose",
      /**
       * ⚠️ CES PROPOSITIONS NAISSENT D'UNE CONVERSATION RÉELLE, jamais d'un
       * agent de fond — il n'en existe aucun. La carte vide est le cas normal,
       * et elle le dit sans s'excuser.
       */
      vide: "Aucune proposition en attente.",
      videIndication: "Alexa proposera ici ce que vous lui demanderez de préparer.",
      examiner: "Examiner & confirmer",
      refuser: "Refuser",
      confirmee: "Action confirmée.",
      refusee: "Proposition refusée.",
      indisponible: "Alexa est indisponible. Le reste de votre journée n'est pas affecté.",
    },

    erreur: {
      chargement:
        "Le tableau de bord n'a pas pu être chargé. Aucune donnée n'a été modifiée. Réessayez dans un instant.",
      reessayer: "Réessayer",
    },
  },

  /**
   * Le poste d'accueil — cockpit de l'assistante (D-08).
   *
   * ⚠️ COMPOSITION SÉPARÉE (I12), pas un écran praticien amputé : aucune chaîne
   * clinique n'y figure parce qu'aucune n'existe dans le contrat de lecture
   * (`app.reception_board`, 046). Les verbes reprennent le glossaire :
   * Enregistrer · Confirmer · Encaisser — jamais Soumettre, OK, Valider seul.
   * Un montant s'affiche « à encaisser » ; il ne se modifie pas ici.
   *
   * SURFACE D'ATTENTION ≤ 9 (critère d'acceptation du lot) : au-delà, la zone
   * principale affiche un débord honnête et renvoie aux files dédiées.
   */
  reception: {
    titre: "Poste d'accueil",
    pulse: {
      salleAttente: "En salle d'attente",
      retards: "Retards",
      aEncaisser: "À encaisser",
      demandes: "Demandes en attente",
    },

    frise: {
      titre: "Journée",
      maintenant: "Maintenant",
      praticienneFiltre: "Toutes les praticiennes",
      creneauLibre: "Créneau libre",
      nouveauRdv: "Nouveau rendez-vous",
      videJournee: "Aucun rendez-vous aujourd'hui.",
      selectionHint: "Sélectionnez un rendez-vous pour agir : A arrivé · P paiement · R déplacer.",
    },

    attention: {
      titre: "Ce qui demande attention",
      autres: "autres éléments — voir les files ci-dessous",
      vide: "Tout est à jour. Rien ne réclame votre geste.",
      voir: "Voir",
      voirEncaissement: "Voir l'encaissement",
    },

    arrivees: {
      titre: "Arrivées",
      marquerArrivee: "Marquer arrivé(e)",
      marquerAbsent: "Non présenté(e)",
      attenteDepuis: "attend depuis",
      vide: "Personne n'attend pour le moment.",
    },

    paiements: {
      titre: "Paiements",
      ongletDues: "À encaisser",
      ongletEncaisses: "Encaissés aujourd'hui",
      videDues: "Aucun paiement en attente. Les tarifs fixés en fin de séance apparaissent ici.",
      videEncaisses: "Aucun encaissement aujourd'hui.",
      montantAEncaisser: "Montant à encaisser",
      patiente: "Patiente / patient",
      methode: "Méthode",
      methodeEspeces: "Espèces",
      encaisser: "Encaisser maintenant",
      encaisserCourt: "Encaisser",
      confirmerTitre: "Confirmer l'encaissement",
      dejaEncaisse: "Déjà encaissé — rien à faire.",
      horsFenetre: "Hors fenêtre d'encaissement (24h). Voir Finances.",
      dejaEncaisseDetail: "Déjà encaissé à",
      recu: "Reçu",
      praticienne: "Fixé par",
      voirTous: "Voir tous les encaissements",
    },

    notifications: {
      titre: "Notifications",
      vide: "Aucune notification. Les tarifs fixés par la praticienne y arriveront.",
      marquerLu: "Marquer comme lu",
      paiementDue: "Nouveau paiement à encaisser",
      consultationTerminee: "Consultation terminée",
    },

    demain: {
      titre: "Préparation & clôture",
      rdvConfirmes: "rendez-vous confirmés ce jour",
      premierA: "Premier RDV à",
      annulesDuJour: "Annulations du jour à replanifier",
      annulesVide: "Aucune annulation à replanifier.",
      replanifier: "Replanifier",
      cloture: "Clôture du jour affiché",
      paiementsRestants: "paiement(s) restant(s) à encaisser",
    },

    recherche: {
      libelle: "Rechercher un patient",
      indication: "Nom, téléphone ou numéro de dossier — touche /",
      indicationCourte: "Nom, téléphone ou n°",
      ouvrirFiche: "Ouvrir la fiche",
      prochainRdv: "Prochain rendez-vous",
      aucunRdvAVenir: "Aucun rendez-vous à venir.",
    },

    dock: {
      nouveauRdv: "Nouveau rendez-vous",
      rechercher: "Rechercher",
      voirAgenda: "Voir l'agenda",
      voirFinances: "Voir les finances",
      demain: "Demain",
      aucunDemain: "Rien prévu demain",
    },

    deplacement: {
      titre: "Déplacer le rendez-vous",
      apercuAvant: "Actuellement",
      apercuApres: "Nouveau créneau",
      duree: "Durée (minutes)",
      enregistrer: "Enregistrer le déplacement",
    },

    feedback: {
      paiementEncaisse: "Paiement encaissé.",
      arriveeConfirmee: "Arrivée enregistrée.",
      absentConfirme: "Absence enregistrée.",
      rdvDeplace: "Rendez-vous déplacé.",
      notificationLue: "Notification lue.",
    },
  },
} as const;

export type Fr = typeof fr;

/**
 * Les douze écrans de la navigation.
 *
 * Extrait ici plutôt que redéclaré dans chaque consommateur : `AppShell` le
 * calculait déjà pour lui seul, et V3 en a désormais un second usage — le jeu
 * d'icônes, dont chaque nom d'écran DOIT avoir un tracé. Les deux dérivant du
 * même objet, ajouter un écran à `fr.nav.ecrans` sans lui dessiner d'icône
 * devient une erreur de compilation, et non un carré vide découvert à l'écran.
 */
export type NomEcran = keyof typeof fr.nav.ecrans;
