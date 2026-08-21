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
      "Assistant indisponible. Le reste de l'écran reste pleinement utilisable — notes, note clinique et signature ne dépendent pas de Jarvis.",
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
    titre: "Jarvis",
    ouvrir: "Ouvrir Jarvis",
    fermer: "Fermer",
    invite: "Posez une question, ou dictez-la.",

    /** V2.2 — l'indisponibilité ne bloque JAMAIS le reste de l'application. */
    indisponible:
      "Jarvis est indisponible. Toutes les fonctions restent accessibles.",

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
    },

    /** V2.4 — la voix. Coupée, le panneau reste utilisable au clavier. */
    voix: {
      parler: "Maintenir pour parler",
      ecoute: "À l'écoute…",
      transcription: "Transcription…",
      indisponible: "La voix est indisponible. Le clavier reste utilisable.",
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
