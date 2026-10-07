# Documents éditables et impression A5 — conception

Date : 7 octobre 2026. Dépôt : G:\Final mindcare.
Statut : conception proposée, avant implémentation. Diagnostic : DOCUMENTS_CURRENT_STATE.md.

## Résultat et périmètre

Modèle -> instance persistée -> édition libre -> aperçu réel -> confirmation médicale -> pièce immuable -> impression. Les quatre certificats gardent leur rédaction par défaut et leurs variables. L'ordonnance réutilise le catalogue existant. Aucun appel IA, cloud ou nouvelle base de médicaments. Services, DbPort, withCaller, RLS, audit et next_number restent l'architecture métier. Aucun changement Alexa, RAG, agenda, finances ou authentification.

## Édition et contenu

Éditeur Tiptap/ProseMirror local avec seulement texte, paragraphes, gras, italique, souligné, listes, sauts de ligne/page, alignement, direction et undo/redo. Ce choix apporte un schéma JSON fermé et un historique clavier fiable sans construire un traitement de texte complet. Sources : https://tiptap.dev/docs/editor/core-concepts/schema et https://tiptap.dev/docs/editor/getting-started/overview . Compatibilité React 19 vérifiée et versions verrouillées avant intégration.

Le contenu JSON est la source éditable ; HTML reste une représentation déterministe. Validation côté service ET SQL : types et attributs autorisés, pas de lien/image/embed/script/style libre, pas de ressource externe. Bornes initiales : 200 Ko, profondeur 12, 500 blocs et 50 lignes de médicaments. Dépassement explicite, saisie conservée, jamais tronquée. Le collage passe par ce schéma.

La création résout les données patient/identité autorisées. Les champs intelligents restent liés tant que la praticienne ne les remplace pas par du texte normal. Elle peut ajouter, supprimer et modifier librement phrases et paragraphes. Une modification structurée actualise uniquement les champs encore liés, jamais le texte manuel. Repartir du modèle est explicite et conserve une révision.

L'identité professionnelle reste un bloc contrôlé distinct du corps. Les dates civiles restent YYYY-MM-DD sans conversion de fuseau. Le défaut du parseur pg DATE confirmé sur une date neutre sera corrigé à la frontière concernée, avec tests multi-fuseaux.

## Persistance et histoire

Migrations additives uniquement, numéros réservés après vérification des migrations présentes, dont les fichiers préexistants 123–127. Aucun fichier déjà appliqué réécrit.

- Nouvelles versions document_templates avec JSON et même rédaction/variables ; versions HTML antérieures conservées.
- document_drafts : id, patient, cabinet/praticienne dérivés SQL, type, template/version, variables, content_json, date, schema_version, renderer_version, revision, updated_at, archived_at, issued_document_id et source_document_id.
- document_draft_revisions : snapshots append-only des sauvegardes acceptées.
- documents : colonnes additives content_json, renderer_version, source_draft_id et prescription_id. Corps/numéros/hashes historiques intacts.
- Type ordonnance ajouté ; lien aux prescriptions et prescription_lines existantes lors de l'émission.

Statuts métier : brouillon, émis, annulé. Aperçu disponible/prêt à émettre sont calculés pour la révision courante. Impression est un événement et un compteur d'envois, jamais une preuve de tirage matériel. Une pièce émise s'édite seulement via un nouveau brouillon lié puis un nouveau numéro. Archiver un brouillon est récupérable ; pas de suppression clinique.

## Sauvegarde

Enregistrer explicite et autosave après 750 ms d'inactivité ; une seule écriture en vol, éditions suivantes coalescées, révision attendue obligatoire. Portes create/save/get/list/revisions/archive/restore/duplicate avec autorité clinique et audit.

États visibles Enregistrement/Enregistré/Non enregistré. Échec conserve l'éditeur et permet Réessayer. Conflit entre onglets ne remplace rien : choix explicite entre versions. Navigation interne attend la sauvegarde ou permet de rester ; fermeture/crash reprend la dernière version confirmée en base. Ne jamais promettre la récupération de frappes non acquittées. Pas de contenu clinique dans localStorage. Changer dossier/type sauvegarde puis ouvre une autre instance, sans vider silencieusement le texte.

## Rendu et papier

Une fonction SQL de rendu des nœuds échappe tous les textes et produit la représentation canonique. Le même contenu et la même enveloppe documentaire autonome alimentent aperçu, snapshot et impression. Le DOM contenteditable n'est pas imprimé.

Page 148 × 210 mm, marges internes initiales 12 mm, corps 10,5 pt/interligne 1,4. Polices françaises et arabes locales/versionnées. En-tête équilibré : identité FR/AR centrée à gauche, marque discrète au centre, patient/date à droite, séparateurs sobres ; titre centré et réserve de signature sur la dernière page. Données réelles du cabinet, jamais les valeurs des images hardcodées. Valeurs typographiques ajustables après QA, sans rapetisser pour masquer l'overflow.

Style documentaire isolé : blanc et noir, traits noirs, aucune variable de thème UI, couleur verte ou opacité. Aucune copie globale des styles de l'application. Ressources locales explicitement résolues. Attendre styles et document.fonts.ready ; éliminer les temporisateurs fixes de démarrage/nettoyage.

Pagination commune à l'aperçu et l'impression après chargement des polices : mesurer les blocs dans une feuille physique, fragmenter les textes trop longs sans perdre marques/direction, continuer les listes, respecter les sauts explicites. Zoom externe à la page, jamais contraction de sa largeur interne. Les pages réellement approuvées sont capturées avec révision et version du moteur ; l'émission vérifie l'association au hash canonique et la conservation intégrale du contenu. Aperçu périmé ou ressources absentes empêchent la confirmation avec raison explicite. L'impression réutilise la représentation paginée figée et ses ressources versionnées.

@page A5 portrait, margin:0 et marges internes identiques. Aide pilote : A5, portrait, taille réelle/100 %, sans en-têtes navigateur. Aucun fit-to-A4. Le compteur décrit seulement l'envoi/ouverture du dialogue ; un défaut d'audit n'est pas présenté comme une réussite.

Les anciennes pièces gardent rendered_html et snapshot_header. Une enveloppe de compatibilité restaure les marges manquantes à l'impression, sans changer corps/données. Leur ancien habillage n'avait pas été figé : cette limite historique est documentée ; les nouvelles pièces figent aussi renderer et ressources.

## Émission

Readiness du brouillon avec raisons métier fermées : sexe/naissance manquants, en-tête incomplet, champ requis, médicament invalide, révision en conflit. Messages français i18n dédiés ; jamais de SQL brut exposé ni de prérequis clinique supprimé.

Émettre attend sauvegarde et aperçu de la révision courante. Confirmation explicite du médecin sur le contenu final. issue_document_draft verrouille le brouillon, vérifie identité/cabinet/RLS/prérequis/révision/hash, fige les snapshots puis alloue next_number et insère pièce/audit dans la même transaction.

source_draft_id unique et issued_document_id donnent l'idempotence : réponse perdue/retry retrouve la même pièce, sans second numéro. Échec ne consomme pas de compteur et ne change pas le statut. Brouillon modifié exige nouvel aperçu/confirmation. L'ancien issue_document reste compatible.

Annulation motivée, auditée et non destructive. Les HTTP 503 reproduits sur mark_document_printed et void_document restent à isoler dans la frontière : ces portes ont réussi sous même autorité en transaction annulée, mais pas dans le navigateur. Ajouter des diagnostics de codes techniques sans données identifiantes, sans affaiblir l'autorisation.

## Ordonnance

Autocomplete search_medications et variantes existantes. Lignes : identifiant catalogue/snapshot désignation-forme-dosage, posologie, quantité, fréquence, durée, administration, instructions libres. Ajouter/supprimer/reordonner au clavier et souris ; aucune dose/durée proposée automatiquement.

Les lignes sont des blocs structurés dans le corps. Les contrôles de ligne éditent leurs valeurs ; les paragraphes autour sont libres. Leur JSON est la seule source des lignes et du rendu : pas de deuxième liste qui diverge du texte imprimé. Précision de désignation possible tout en gardant provenance/identifiant. Hors catalogue explicitement signalé comme saisie libre.

La confirmation fige ces lignes puis crée prescriptions/prescription_lines existantes dans la transaction de la pièce. Colonnes additives pour quantité/fréquence libre et état de la prescription liée si nécessaires ; pas de deuxième base médicamenteuse. Ne pas modifier patient_treatments ni inférer un traitement actif. Annulation documentaire conserve la prescription historique et son état explicite.

## En-tête et configuration

Paramètres Documents : identité en lecture seule, seul N° d'Ordre éditable avec porte dédiée bornée et auditée. Retirer les autres champs de la UI et fermer leur chemin ordinaire d'écriture serveur ; provisionnement contrôlé conservé. Snapshots émis gardent leur ancien numéro d'ordre. Une évolution d'identité/configuration est signalée avant un nouvel aperçu de brouillon, jamais appliquée silencieusement à une pièce émise.

## Espace clinique et clavier

Barre compacte type/patient/statut, Enregistrer, Modifier/Aperçu, Émettre, Imprimer, Dupliquer, Annuler/Archiver selon statut. Feuille centrale/gauche, champs et médicaments à droite, liste pour reprise/historique. UI française centralisée, thème MindCare uniquement autour du document.

Sélection/copie/collage natifs, Ctrl/Cmd+Z, Y et Shift+Ctrl+Z, focus après création/confirmation, commandes accessibles et annonces d'enregistrement. Aucune bibliothèque distante recevant du texte clinique.

## Vérification et livraison

SQL : RLS par cabinet/praticienne/rôle, audit, conflits/révisions, validation JSON/attaques HTML-URLs, immutabilité, annulation, retries et numérotation concurrente/rollback. Services : variables des quatre modèles, dates multi-fuseaux, jours en lettres, ordonnance, erreurs sûres, lectures historiques.

Navigateur : édition libre/formatage/listes/RTL/collage/undo-redo, save-reload/navigation/crash/conflict et échecs de sauvegarde ; émission réelle des cinq types sur dossiers vérifiés synthétiques, prérequis manquants, réouverture/révision/annulation.

Matrice visuelle : cinq types A5, FR/AR/mixte, noms/paragraphes longs, optionnels vides, 1/plusieurs/maximum médicaments et instructions longues ; comparer pages aperçu et dialogue print/PDF, dimensions, noir, fontes, sauts, zéro clipping/blank page/en-tête doublé. Tirage matériel distinct.

Exécuter typecheck, lint, tests unitaires, intégrations Documents et build de production. Isoler les échecs préexistants, ne pas affaiblir les tests. Rapport PASS/PARTIAL/FAIL/NOT RUN avec fichiers/migrations/captures et limites pilotes.

Après revue : plan détaillé puis contrats/tests, migrations/portes, renderer/éditeur/save, pagination/en-tête/print, ordonnance et QA complète. Migrations d'abord sur base de test locale isolée sans exporter de données patient ; passage sur base active via garde-fous existants, état préalable vérifié, aucune migration silencieuse ou contournement de verifier-base.mjs.

Revue interne : périmètre couvert, séparation identité/variables/corps/lignes, SQL autoritaire, compatibilité historique et limites de récupération explicites. Aucune implémentation applicative ni migration appliquée à ce stade.
