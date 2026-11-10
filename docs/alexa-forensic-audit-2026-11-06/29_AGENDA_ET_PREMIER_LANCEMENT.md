# Agenda et premier lancement — trace d’écrans ciblée

**Périmètre : lecture statique de l’arbre de travail, non validation des droits ou de l’installation.** Aucune donnée patient ni opération réelle. Les commentaires sur les garanties de base sont des intentions à confirmer par tests de porte, pas des preuves de l’état déployé.

## Nouveau rendez-vous : deux opérations distinctes

`src/app/agenda/nouveau/page.tsx` charge les praticiennes via `listPractitioners`, présélectionne l’utilisateur s’il figure dans la liste, sinon la première entrée. La recherche de patient démarre à deux caractères après 120 ms et demande jusqu’à 25 résultats à `searchPatients`. Le formulaire permet aussi de créer un patient : prénom, nom et téléphone sont requis côté écran, téléphone normalisé et contrôlé ; date de naissance facultative. `creerEtSelectionner` appelle `creerPatient` et sélectionne le patient obtenu.

Le rendez-vous est ensuite soumis par une fonction distincte, `enregistrer`, à `createAppointment` : patient, praticienne, date/heure convertie en ISO, durée, notes administratives optionnelles et type optionnel. Un succès navigue vers `/agenda/{id}` ; une erreur reste affichée, avec traitement particulier hors ligne. Les contrôles locaux visibles exigent un patient, une praticienne, une date convertible et une durée numérique ; ils ne démontrent pas les règles serveur. La durée initiale est de 30 minutes.

**Conséquence confirmée par l’ordre des appels :** la création du patient et celle du rendez-vous sont deux appels séparés de l’interface. Si la première réussit et que l’utilisateur abandonne ou que la seconde échoue, le dossier créé peut subsister sans rendez-vous créé par ce formulaire. Ce n’est pas la preuve d’un incident ni d’une suppression de données ; l’état effectif et les éventuelles compensations hors écran sont NON VÉRIFIÉS. Un futur parcours Alexa ne doit pas promettre une opération atomique sur la seule foi du formulaire. Test proposé : base synthétique isolée, création patient réussie puis refus simulé du rendez-vous, vérifier les deux états par des lectures autorisées.

## Détail du rendez-vous

`src/app/agenda/[id]/page.tsx` attend la session, appelle `getAppointment`, puis initialise les champs de début, durée, notes administratives et type. Le fichier branche `updateAppointment`, `confirmAppointment`, `cancelAppointment` et `startConsultation` ; leur présence ne prouve pas qu’une transition particulière soit autorisée pour chaque rôle et statut. Treize types sont déclarés dans l’écran, de la première consultation au suivi, psychothérapies, téléconsultation, certificat, renouvellement, évaluations et entretiens. Les issues d’appel proposées sont joint, sans réponse, rappel et mauvais numéro ; la page détecte une trace antérieure avec `notesAdmin.includes("Appel ")`. Cette détection est textuelle : elle ne démontre pas à elle seule qu’un appel a effectivement eu lieu.

L’en-tête du fichier décrit le regroupement voulu entre rendez-vous introuvable et hors périmètre et l’usage de portes distinctes pour confirmer ou annuler. Les autorisations et transitions réelles restent à vérifier avec les tests et une base isolée ; ne pas présenter le commentaire comme une preuve de politique effective. Les notes administratives sont un canal distinct des notes cliniques : la page indique qu’elles peuvent être visibles par l’assistante.

## Première configuration

`src/app/premiere-configuration/page.tsx` appelle `getInstallationStatus` ; seul le résultat réussi `environment === "self-hosted"` et `!provisionne` laisse apparaître `FormulairePremierLancement`. Tout autre résultat, erreur comprise, redirige vers `/connexion`. La soumission appelle `provisionOwnerAccount` ; le succès affiche une confirmation et un lien vers la connexion, sans ouvrir automatiquement une session. Un conflit a son message dédié, les autres erreurs utilisent le message du service. La protection serveur, la concurrence entre deux demandes et l’état d’une installation donnée sont NON VÉRIFIÉS par cette seule lecture.

## Vérifications restantes

Tests des transitions par rôle, du fuseau et des chevauchements ; champs et validation détaillés du formulaire de premier lancement ; capture visuelle synthétique ; rapprochement des droits et portes SQL avec la version effectivement déployée. Aucune de ces vérifications n’a été exécutée pour ce document.
