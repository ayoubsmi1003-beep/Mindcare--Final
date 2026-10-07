# DOCUMENTS_CURRENT_STATE

Audit du 7 octobre 2026 — dépôt réel : G:\Final mindcare.
Statut : audit fonctionnel et architecture établis ; impression native partiellement vérifiée ; implémentation non commencée.

## Périmètre et autorité

TASK : refonte Documents / Certificats / Ordonnance.
SCOPE : modèle et édition des documents, brouillons, émission, aperçu, impression, identité contrôlée et catalogue médicamenteux existant.
ENTRYPOINT : /documents ; src/services/documents.ts ; portes SQL app.*.
STOP CONDITION : critères de la demande intégralement vérifiés, sans confondre rendu navigateur et tirage physique.
Les modifications préexistantes du dépôt ont été recensées et conservées. Aucun fichier applicatif n’a été modifié.
AGENTS.md, CLAUDE.md, docs/DOC-AUTHORITY.md, context/document-issue.md, domaine et contrat Documents ont été lus. Les références du manifeste à 061 ne suffisent plus : la fonction actuelle est redéfinie par 088 ; ce fichier a été inspecté pour tracer l’émission réelle. Aucune archive n’a été lue.

## Architecture actuelle

Next.js 15 / React 19 / PostgreSQL local / DbPort. La page appelle les services navigateur, puis /api/db/rpc, pgPort sous withCaller, et les portes SQL avec identité transactionnelle.
Les écritures métier et leur trace restent en base. RLS, app_gatekeeper, audit et compteur transactionnel sont les invariants à conserver.
Les modèles vivent dans app.document_templates : type, version, titre, header_html, body_html, footer_html, is_active. Quatre modèles actifs ont été constatés.
Les documents émis vivent dans app.documents : variables, rendered_html, numéro, date, praticienne, template_id/version, snapshot_header, content_hash, status, printed_count. Les triggers interdisent la mutation du contenu et la suppression.
Le service UI ne connaît que les statuts issued et voided. Une saisie avant émission n’est pas un brouillon métier : uniquement du useState, perdu à la navigation ou au changement de type.
Aucune table app.document_drafts n’existe dans la base contrôlée.

## Types et variables

| Type | Variables saisies |
| --- | --- |
| bonne_sante_mentale | id_document_number, mairie |
| suivi_medical | jours, jours_lettres calculé par SQL, date_debut |
| certificat_medical | date_naissance, traitement_1, traitement_2 facultatif mais clé obligatoire |
| justification | date_consultation |

Patient, civilité, âge, naissance, identité du médecin et cabinet sont ajoutés par SQL. Le domaine jours est 1–365 à l’émission. La naissance et le sexe sont obligatoires.
Ordonnance est absent de app.doc_type et de l’UI. Le catalogue existe déjà : services/medications.ts et app.search_medications / get_medication_variants. Les tables prescriptions et prescription_lines sont décrites dans 01-SCHEMA ; elles doivent être inspectées avant de raccorder l’ordonnance.

## Flux aperçu et sauvegarde

FeuilleApercu ne rend pas le modèle : elle affiche un en-tête provisoire et une liste de valeurs. Elle annonce elle-même un aperçu reconstitué. Les quatre types ont été ouverts et leurs champs saisis dans le navigateur ; aucun n’affiche le corps final avant émission.
FeuilleEmise affiche le rendered_html figé. L’en-tête historique et le corps final deviennent visibles seulement après émission/lecture.
Pas de bouton Enregistrer, persistance des brouillons, reprise, duplication ou historique des éditions dans ce parcours. Le changement de type réinitialise saisie.

## Cause exacte du refus Émettre reproduit

Le dossier utilisé dans les captures comporte une naissance mais aucun sexe. Seuls ces indicateurs de complétude ont été contrôlés ; aucune identité patiente n’est reproduite ici.
Parcours reproduit : sélectionner ce dossier, Justification, saisir une date valide, Vérifier, Émettre.
Résultat navigateur : POST /api/db/rpc -> HTTP 422, message générique de règle métier, aucun document créé.
Confirmation SQL dans une transaction annulée :
ERROR: Dossier incomplet : le certificat n'a pas ete emis.
HINT: Renseignez le sexe et la date de naissance dans le dossier, puis reessayez.

La fonction app.issue_document contrôle v_pat.sex et v_pat.birth_date avant rendu et numérotation. La page ne conserve pas sex dans DossierChoisi et ne bloque que birthDate === null. La readiness affichée vérifie l’en-tête, pas ce prérequis patient : « Prêt à émettre » est donc trompeur.
toAppError remplace ensuite le message/hint SQL par fr.erreurs.regle-metier. Le handler cherche le mot « En-tête » dans ce message déjà générique ; cette branche ne peut pas expliquer ce refus.
La correction doit exposer un résultat métier structuré et sûr, pas remonter tous les messages SQL bruts ni supprimer le contrôle clinique.

Contrôle différentiel : émission SQL réussie pour les quatre types sur un dossier vérifié synthétique, en ROLLBACK. Une justification a également été émise réellement par le bouton sur ce dossier de contrôle, puis relue avec numéro et hash. Elle est un artefact de test synthétique, pas un document clinique réel. Le moteur actuel n’est donc pas globalement en panne.
Une ancienne cause digest/search_path existe dans 061, mais 064 puis 088 l’ont corrigée et la base actuelle inclut extensions ; ce n’est pas la cause actuelle reproduite.

## Autre défaut de donnée reproduit

La naissance préremplie dans le formulaire est un jour avant celle rendue par SQL sur le dossier synthétique de contrôle. Le transport d’une colonne date via Date/JSON est à contrôler et corriger : une date civile doit rester YYYY-MM-DD, sans conversion de fuseau. Le formulaire slice(0,10) ne doit pas masquer une sérialisation erronée.

## Impression, dimensions, couleur et fontes

Le CSS contient déjà @page A5 portrait et des dimensions 148 × 210 mm. Ajouter seulement @page ne résoudrait donc pas le problème.
À l’écran, FeuilleEmise enveloppe le HTML dans article.doc-feuille.doc-corps. Dans imprimer(), l’iframe reçoit seulement div.doc-racine + rendered_html : l’enveloppe doc-feuille manque. Ses marges physiques, son corps typographique et sa réserve de signature ne sont donc pas appliqués comme dans l’aperçu.
L’iframe copie toutes les feuilles de style de l’application et utilise un délai fixe 350 ms ; elle n’attend ni styles ni document.fonts.ready. Le retrait repose sur un autre délai fixe. Le compteur d’envois est appelé avant que le dialogue ait effectivement été ouvert.
Les couleurs viennent de --brand-700, --ink-900, --card et de la décoration verte du titre. @media print conserve ces couleurs et demande print-color-adjust:exact sur l’en-tête. Aucun thème document noir indépendant ne les neutralise.
Le rendu historique a été vu : spécialité coupée dans un mot, arabe trop petit, en-tête vert, forte dépendance aux fontes/thème UI. Le max-width:100% de la feuille peut aussi la contracter selon le panneau au lieu de représenter une page physique avec zoom.
Le bouton Imprimer a été déclenché sur le document synthétique ; l’inspection du dialogue natif bloque l’API du navigateur intégré. Les dimensions choisies par le pilote, le nombre de pages, le scaling et le tirage papier ne sont PAS validés à ce stade. Aucun tirage physique n’a été volontairement envoyé.

## En-tête et réglages

L’identité réelle est lue en base dans profiles / cabinets, puis figée dans snapshot_header. Le N° d’Ordre est déjà un champ profiles.order_number persistant.
La page /parametres/documents expose actuellement nom, titre, spécialités FR/AR, téléphone et nom arabe comme champs ordinaires éditables : cela contredit explicitement la nouvelle demande. Elle doit afficher l’identité en lecture seule et conserver un chemin contrôlé pour order_number.
Les modèles fournis sont des références visuelles ; les anciennes versions et leur rédaction corrigée restent l’autorité historique. Pas de remplacement de contenu clinique par les noms/numéros des images.

## Numérotation et cycle de vie

next_number(cabinet,'document',année Africa/Algiers), compteur transactionnel ; format DOC-YYYY-00000. Le numéro est attribué après les contrôles et dans la même transaction que le document. Historique immuable, annulation motivée par void_document.
Un double envoi de issue_document crée deux pièces ; pas de clé d’idempotence. Le verrou UI seul ne couvre pas une réponse perdue puis une relance.
La confirmation affirme à tort qu’un document ne peut pas être annulé, alors que void_document et le bouton Annuler existent.

## Matrice d’audit réalisée

- PASS : lecture des sources/contrats et métadonnées SQL, quatre formulaires et aperçus, sélection patient, lecture historique.
- PASS : émission SQL des quatre certificats en transaction annulée ; émission navigateur et réouverture d’une justification synthétique.
- FAIL REPRODUIT : refus 422 sur dossier avec sexe manquant malgré « Prêt à émettre ».
- FAIL REPRODUIT : décalage d’un jour de naissance entre formulaire et rendu SQL.
- ABSENT : brouillon persistant, édition du corps, duplication et ordonnance.
- PARTIAL : déclenchement impression, styles A5 inspectés ; dialogue natif non inspectable par l’outil.
- NOT RUN : annulation, tirage physique, matrice longue/mixte/prescriptions, checks du futur code (aucun code encore écrit).

## Architecture recommandée

Instance de brouillon persistée et versionnée, contenu JSON fermé, validation SQL, rendu canonique de l’aperçu et de l’émission, snapshot figé à la confirmation, même enveloppe A5 dédiée à l’impression. Identité contrôlée séparée des variables et du corps. Ordonnance structurée via le catalogue existant. Détail dans docs/superpowers/specs/2026-10-07-documents-editor-design.md.

## Compléments après contrôle d'impression

La capture fournie par l'utilisateur montre un rendu presque sans CSS : police serif par défaut, en-tête empilé, marge gauche absente, grille perdue. Elle confirme le défaut d'enveloppe/chargement des ressources ; les millimètres et le scaling du pilote restent à vérifier.

Cause du décalage de naissance confirmée avec le parseur pg OID 1082 sur une date neutre : DATE devient Date à minuit local, sérialisé au jour UTC précédent. Corriger la frontière date civile plutôt que slice(0,10).

FAIL REPRODUIT : mark_document_printed et void_document répondent HTTP 503 dans le navigateur, y compris après retry d'annulation. La pièce synthétique DOC-2026-00062 reste issued/compteur 0. Les deux portes réussissent sous même autorité SQL en transaction annulée ; cause exacte HTTP à isoler. Aucun effacement ou nettoyage historique forcé.
