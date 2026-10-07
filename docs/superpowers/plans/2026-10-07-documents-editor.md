# Documents éditables A5 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after the human chooses native execution, or superpowers:subagent-driven-development if explicitly chosen. Steps use checkbox syntax for tracking.

**Goal:** Livrer les quatre certificats éditables, brouillons fiables et ordonnance structurée avec aperçu identique à l'impression A5 et émission médicale explicite.
**Architecture:** Garder DbPort et portes SQL comme autorité, ajouter contenu JSON fermé et brouillons versionnés. Rendu SQL canonique, pagination commune, enveloppe documentaire locale/versionnée et snapshots émis immuables.
**Tech Stack:** Next.js 15, React 19, TypeScript, Zod, PostgreSQL 16, Tiptap/ProseMirror local, pnpm.
**Spec:** docs/superpowers/specs/2026-10-07-documents-editor-design.md, validée par « go » le 07/10/2026.

## Global Constraints

- Dépôt actuel G:\Final mindcare ; conserver les modifications préexistantes, aucun nouveau checkout sans nécessité.
- Services -> DbPort -> /api/db/rpc -> withCaller -> portes SQL ; RLS, audit et next_number restent autoritaires.
- Aucune IA/cloud ni seconde base patient/médicament ; lectures nominatives par portes auditées.
- JSON fermé : 200 Ko UTF-8, profondeur 12, 500 blocs, 50 lignes médicament ; aucun texte tronqué.
- Page 148 × 210 mm, marges internes initiales 12 mm, corps 10,5 pt/interligne 1,4 ; noir et polices locales/versionnées.
- Autosave 750 ms ; aucune promesse de récupération de frappes non acquittées ; pas de clinical localStorage.
- Chaînes françaises dans src/i18n/documents-editor.ts ; couleurs dans tokens.css uniquement ; ne pas modifier fr.ts.
- Migrations additives, aucune appliquée réécrite ; aucun DELETE clinique et aucune mutation des snapshots historiques.
- Aucun changement Alexa/RAG/agenda/finances/authentication ; infrastructure adjacente seulement si nécessaire et tracée.
- Prérequis patient jamais inventés ; émission seulement après confirmation explicite, sans numéro consommé en échec.

## Review Focus

1. Réponse d'émission perdue, puis retry : même pièce et même numéro ; test tâche 3.
2. Édition pendant autosave et changement de patient : aucune saisie écrasée ou enregistrée sous un autre dossier ; test tâche 5.
3. Changement d'identité ou de date à minuit avant confirmation : nouvel aperçu demandé ; test tâche 3.
4. Texte arabe/mixte, caractères hors BMP et paragraphes dépassant une page : partition sans perte/duplication ; test tâche 6.
5. Ordonnance annulée visible dans l'historique patient : état explicite, aucune déduction d'un traitement actif ; test tâche 8.

## Fichiers et interfaces communes

Créer src/shared/documents/{content,types,pagination-contract}.ts, src/services/document-drafts.ts, src/i18n/documents-editor.ts, src/components/documents/{DocumentWorkspace,DocumentEditor,DocumentPreview,DocumentFields,MedicationRows,DocumentHistory,document-extensions,document-printer,use-document-draft,document-pagination}.tsx/.ts suivant responsabilité.

DocumentKind = les quatre valeurs TypeDocument actuelles | ordonnance. DocumentContent = arbre JSON Tiptap validé, DocumentRevision = entier positif. Draft = {id, patientId, kind, templateId, templateVersion, content, variables, revision, documentDate, rendererVersion, issuedDocumentId, archivedAt}. Variables = Record<string,string>, jamais patient/praticienne/cabinet comme autorité envoyée.

DraftPreview = {draftId, revision, contentHash, rendererVersion, html, readiness:{canIssue, reasons:DocumentReason[]}, identityVersion}. PageManifest = {rendererVersion, contentHash, pages:PageSlice[][]}, PageSlice = {path:number[], from:number, to:number}; offsets en points de code Unicode, sans confiance dans du HTML soumis. Les partitions doivent couvrir chaque bloc sans trou/recouvrement et conserver ses marques et ordre. IssuedSnapshot = {documentId, draftId, revision, contentHash, rendererVersion, html, manifest}.

DocumentReason fermé = patient-sex-missing | patient-birth-missing | header-incomplete | required-field | medication-invalid | draft-conflict | preview-stale | layout-invalid. Les erreurs normales conservent Result<T> et les codes existants ; les raisons documentaires sont des réponses métier structurées, jamais des messages SQL libres.

Migrations prévues 128_document_editor_kind.sql puis 129_document_editor.sql : revérifier le dernier numéro au démarrage, consigner tout décalage avant d'écrire. 128 ajoute seulement la valeur enum (commit distinct avant son usage). 129 contient schéma, contraintes/RLS/triggers, contenu JSON, portes et versions templates. Aucune dépendance aux migrations non appliquées sans inventaire préalable.

### Task 1: Contrat de contenu et dates civiles

**Files:** Create src/shared/documents/content.ts et types.ts, src/i18n/documents-editor.ts ; modify src/server/db/pool.ts et package.json/pnpm-lock.yaml ; tests/unit/document-content.test.ts, tests/unit/document-date.test.ts.
**Interfaces:** Produces parseDocumentContent(input:unknown):DocumentContent ; resolveFields(content:DocumentContent,variables:Variables):DocumentContent ; date civile pg OID 1082 rend string.

- [ ] Écrire les tests refusant script, link, image, style/couleur/URL, attribut inconnu, profondeur 13, 200 Ko dépassés ; accepter gras/listes/directions et préserver caractères arabes/hors BMP. Tester remplacement d'un champ lié sans changer texte manuel.
- [ ] Exécuter pnpm exec vitest run tests/unit/document-content.test.ts tests/unit/document-date.test.ts : constater RED sur contrats absents/défaut de date, pas seulement infrastructure.
- [ ] Installer les seules extensions Tiptap nécessaires avec versions compatibles React 19 ; implémenter schéma et conversion date OID 1082 au seul import pg autorisé, sans toucher timestamptz.
- [ ] Réexécuter mêmes tests : GREEN ; vérifier dates YYYY-MM-DD identiques sous UTC/Africa-Algiers/America-Los_Angeles.
- [ ] Commit ciblé des fichiers de cette tâche uniquement.

### Task 2: Brouillons, révisions et isolation SQL

**Files:** Create migrations 128/129, scripts/checkpoint-document-editor.sql, tests/integration/document-drafts.live.test.ts ; modify docs/01-SCHEMA.md et créer docs/ADR-DOCUMENTS-EDITOR.md.
**Interfaces:** SQL create_editable_document_draft(p_patient_id uuid,p_type app.doc_type,p_variables text) -> jsonb Draft ; save_editable_document_draft(p_id uuid,p_revision integer,p_content text,p_variables text,p_date date) -> jsonb Draft ou raison draft-conflict ; get/list_editable_document_drafts, list_document_draft_revisions, archive/restore_editable_document_draft et duplicate_editable_document_draft -> réponses jsonb validées. Ces noms évitent une collision avec le brouillon Jarvis existant.

- [ ] Écrire checkpoint transactionnel pour create/save/reload, révision append-only, deux saves même révision (un conflit), archive/restore, duplication sans numéro, aucun DELETE et accès refusé inter-cabinet/assistant ; identité toujours issue SQL.
- [ ] Exécuter le checkpoint sur base locale de test isolée utilisant les helpers d'intégration existants : RED sur portes absentes. Aucune fixture conservée sur base active.
- [ ] Inventorier tables et droits actifs ; ajouter tables/colonnes, FORCE RLS, grants minimaux, trigger audit existant et immutabilité des révisions. JSON validé en SQL avec les mêmes bornes que tâche 1. Lectures journalisées ; zéro oracle hors périmètre.
- [ ] Migrer base isolée puis checkpoint : GREEN, contenu sauvegardé exactement ; vérifier rollback atomique écriture/trace.
- [ ] Documenter schéma/ADR approuvés par conception puis commit ciblé ; aucune migration active silencieuse.

### Task 3: Rendu canonique et émission idempotente

**Files:** Extend migration 129 ; tests/integration/document-issue-editor.live.test.ts ; tests/unit/document-template-compatibility.test.ts ; contrat docs/contracts/document-issue.md.
**Interfaces:** SQL render_document_content(p_content jsonb,p_variables jsonb) -> text ; preview_editable_document_draft(p_id uuid,p_revision integer) -> jsonb DraftPreview ; issue_editable_document_draft(p_id uuid,p_revision integer,p_content_hash text,p_identity_version text,p_manifest text) -> jsonb IssuedSnapshot.

- [ ] Tests : défauts patient/identité/champs donnent raisons sûres ; pas de numéro ; retry après émission rend même ID/numéro ; révision/hash/identité changés refusent ; concurrence crée une seule pièce ; aucun UPDATE du corps émis accepté. Date/header sont identiques à l'aperçu même au changement de jour.
- [ ] RED sur base de test ; reprendre les quatre textes actifs sans réécriture clinique, convertir leurs placeholders en nœuds liés dans nouvelles versions. Vérifier texte normalisé/variables correspondant aux anciens modèles, hors en-tête redesigned.
- [ ] Implémenter renderer HTML fermé échappant tout texte et readonly patient/header ; snapshot de date/identité associé à chaque aperçu. Verrouiller draft/patient selon portes existantes ; snapshot + next_number + document + audit + lien draft dans une transaction, unique source_draft_id.
- [ ] Étendre assert_document_immutable aux nouvelles colonnes ; garder ancien issue_document compatible. Aucun marqueur ou HTML du client accepté comme snapshot.
- [ ] GREEN des tests ; comparer hash et identité/template des anciens documents avant/après migration de test ; commit ciblé.

### Task 4: Services, erreurs et compatibilité historique

**Files:** Create services/document-drafts.ts ; modify services/documents.ts, components/documents/ListeDocuments.tsx et SectionDocumentsPatient.tsx, server/db/allowlist.generated.ts (généré) ; tests/unit/document-services.test.ts ; diagnostic serveur seulement src/app/api/db/_commun.ts et rpc/route.ts si confirmé nécessaire.
**Interfaces:** createDraft(patientId:string,kind:DocumentKind,variables:Variables):Promise<Result<Draft|null>> ; saveDraft(draft:Draft,content:DocumentContent,variables:Variables,date:string):Promise<Result<Draft>> ; get/list/archive/restore/duplicateDraft ; previewDraft(id:string,revision:number):Promise<Result<DraftPreview>> ; issueDraft(preview:DraftPreview,manifest:PageManifest):Promise<Result<IssuedSnapshot>>. Paramètres RPC nommés scalaires, JSON sérialisé. Zod valide chaque réponse.

- [ ] Tests mapping/codes sûrs, dates et lecture d'une pièce legacy sans content_json ; label ordonnance compatible avec les listes, sans modifier fr.ts.
- [ ] RED puis implémenter services, types et labels communs. Régénérer node scripts/gen-db-allowlist.mjs et vérifier diff sans supprimer entrées préexistantes.
- [ ] Diagnostiquer HTTP503 impression/annulation avec codes techniques non identifiants : distinguer startup/session/connection/transaction. Reproduire sur navigateur et corriger uniquement la cause prouvée ; ne pas relâcher RLS/timeouts/grants pour masquer une panne.
- [ ] GREEN unitaires/contrats ; vrai appel HTTP lecture/print-audit/void sur base de test, puis commit fichiers ciblés (pas tout allowlist préexistant sans revue du diff).

### Task 5: Éditeur clinique et sauvegarde fiable

**Files:** Create DocumentWorkspace.tsx, DocumentEditor.tsx, document-extensions.ts, DocumentFields.tsx, DocumentHistory.tsx, use-document-draft.ts ; replace integration app/documents/page.tsx ; tests/unit/document-save-state.test.ts et tests/e2e/documents-editor.spec.ts.
**Interfaces:** useDocumentDraft(id:string|null) -> {draft,content,saveState,setContent,save,flush,conflict,error} ; DocumentEditor({content,onChange}) ; DocumentWorkspace({patientId,initialDocumentId}) utilise tâche 4 ; state idle/saving/saved/dirty/conflict, aucune autorisation JS.

- [ ] Tests du reducer de sauvegarde : une écriture en vol, edits tardifs conservés, réponse tardive après changement dossier ignorée, échec garde dirty, conflit sans écrasement. Ajouter E2E pour reprendre après reload et naviguer pendant autosave.
- [ ] RED puis intégrer schéma Tiptap, toolbar minimale, champs liés détachables, formatage/liste/direction et undo/redo natifs. Corps principal sur feuille, panneau champs à droite.
- [ ] Autosave 750 ms et Save explicite, flush avant navigation/émission, dirty indicator et conflits visibles ; fermeture reprend dernière sauvegarde acquittée. Modifier un issued ouvre une nouvelle révision explicite, jamais l'ancien.
- [ ] GREEN reducer puis vrai navigateur : Ctrl+Z/Y/A/C/V, RTL/FR/collage unsafe, souris/focus, perte réseau/save-refus/reload, historique et liens depuis dossier patient.
- [ ] Commit ciblé. Captures sans données réelles dans docs.

### Task 6: Pagination, aperçu et impression A5

**Files:** Create pagination-contract.ts, document-pagination.ts, DocumentPreview.tsx, document-printer.ts et public/documents/v1/ ressources locales stables ; modify tokens.css, FeuilleDocument.tsx legacy ; tests/unit/document-pagination.test.ts, tests/unit/document-print.test.ts et tests/e2e/documents-print.spec.ts.
**Interfaces:** paginateDocument(root:HTMLElement,preview:DraftPreview):Promise<PageManifest> ; validatePageManifest(content:DocumentContent,manifest:PageManifest):void (miroir SQL tâche 3) ; printDocument(snapshot:IssuedSnapshot):Promise<{dialogOpened:boolean}> ; DocumentPreview({preview,onLayout}) affiche pages avec zoom externe.

- [ ] Tests partition de texte arabe/FR/hors BMP, marques coupées, longue liste, saut explicite et dernière page signature : couverture intégrale sans trou/duplication. Refuser manifest d'un autre hash/version et offsets incorrects.
- [ ] RED puis implémenter pagination après styles/fonts prêts, offsets Unicode convertis pour les Range DOM. Mesurer blocs dans 148x210 mm et fragments sur 124 mm de largeur ; jamais shrink-to-fit ni hidden overflow.
- [ ] Valider partition côté SQL avant issue ; renderer reconstruit les pages depuis JSON/slices, pas depuis HTML fourni. Garder version/fonts/CSS sous chemin public/documents/v1 stable. Styles sans thème ni ressources externes.
- [ ] print autonome même pages, @page A5 portrait margin0, fonts.ready, événements afterprint/nettoyage sans timers arbitraires. Audit print distinct et error visible ; compteur = envoi et non feuille sortie.
- [ ] GREEN tests puis navigateur : noir #000, dimensions mm, polices présentes/RTL, longue phrase et médicaments multipages, optionnels vides, pas de blank/clipping/header doublé. Comparer aperçu et vraie preview native ; la capture utilisateur actuelle est le point de comparaison. Tirage matériel reste explicitement NOT RUN sans papier imprimé.
- [ ] Vérifier réimpression legacy avec son corps intact et enveloppe corrigée ; commit ciblé.

### Task 7: Identité contrôlée et numéro d'ordre

**Files:** Modify parametres/documents/page.tsx et services/cabinet.ts ; dedicated header markup in DocumentPreview renderer ; extend migration 129 ; tests/integration/document-header.live.test.ts ; i18n documents-editor.
**Interfaces:** SQL update_document_order_number(p_order_number text) -> void ; service updateDocumentOrderNumber(value:string):Promise<Result<void>>. Identity snapshot inclut values et identityVersion, valeur immutable après émission.

- [ ] Tests update order persisted/audited, autorité bornée, identité professionnelle refusée par chemin ordinaire, pièce émise garde ancien order ; changement pendant brouillon force nouvel aperçu.
- [ ] RED puis remplacer settings par identité readonly + seul ordre editable ; fermer portes ordinaires d'édition des attributs contrôlés en conservant voie de provisionnement. Longueur ordre 1–64, aucun champ médecin arbitraire ajouté.
- [ ] GREEN puis navigateur en-tête FR/AR centré/hierarchisé/traits noir, noms longs sans coupure étrange, actual data plutôt que valeurs des JPG ; compare références.
- [ ] Commit ciblé.

### Task 8: Ordonnance et prescription existante

**Files:** Create MedicationRows.tsx ; extend content schema/renderer/migration129 et services/document-drafts.ts ; modify patient prescription read mapping services/patients.ts et affichage PanneauTraitements.tsx/SectionsDeterministes.tsx uniquement pour statut ordonnance annulée ; tests/unit/document-medications.test.ts, tests/integration/document-prescription.live.test.ts, E2E documents-editor.
**Interfaces:** MedicationBlock attrs = {rowId,medicationId:null|string,source:catalogue|free-text,designation,strength,posology,quantity,frequency,duration,administration,instructions}. Aucun tableaux de lignes parallèle ; searchMedications existant est consommé.

- [ ] Tests ajout/reorder/removal, 50 lignes et dépassement, id catalogue faux/refus, raw_name snapshot, optional empty, posologie jamais inventée et ordonnance vide non émissible.
- [ ] RED puis blocs structurés éditables ; autocomplete debounce300 ms, réponses de recherche périmées ignorées, sélection explicite et libre clairement marquée.
- [ ] À l'émission, créer prescriptions/prescription_lines + document lié dans même transaction ; nouvelles colonnes quantité/fréquence libre/statut uniquement si nécessaires. Pas de patient_treatments write.
- [ ] Annulation de pièce liée marque prescription correspondante annulée sans effacement ; lecture historique montre l'état sans présenter traitement comme actif. Tests rollback compteur/prescription si refus et doublon retry absent.
- [ ] GREEN puis navigateur ordonnance 1/multiples/longues lignes, confirmation explicite et réouverture/annulation ; commit ciblé.

### Task 9: Intégration et validation finale

**Files:** Update DOCUMENTS_CURRENT_STATE.md, plan checkboxes, docs/domains/documents.md et contract ; créer DOCUMENTS_IMPLEMENTATION_REPORT.md ; tests pertinents ci-dessus et legacy existants.
**Interfaces:** Tous les contrats des tâches précédentes ; aucune nouvelle fonctionnalité.

- [ ] Revue manuelle de diff/SQL/portes/grants/unsafeHTML/ressources, puis revue indépendante de l'ensemble si méthode choisie l'autorise. Aucun commit non lié intégré.
- [ ] Préparer migration de base active : inventory version/table/grants, sauvegarde locale conforme aux scripts existants, tests isolés verts. Appliquer uniquement les migrations approuvées via mécanisme existant, sans appliquer 123–127 non liés par opportunisme ni contourner garde.
- [ ] pnpm typecheck ; pnpm lint ; pnpm test ; intégrations Documents sur vraie base de test ; pnpm build. Lire chaque sortie, distinguer défaut préexistant/infrastructure/fonctionnel ; aucun skip présenté PASS.
- [ ] Exécuter matrice navigateur cinq types, FR/AR/mixte, nom/paragraphe longs, optionnels vides, max meds/texte, save/recover/edit/preview/issue/print/reopen/duplicate/void et clavier. Lancer les tests E2E pertinents selon politique navigateur du contexte ; inspection utilisateur via CUA obligatoire même si suites automatiques vertes.
- [ ] Montrer capture finale de l'en-tête/A5 et comparaison preview/print ; régler les défauts visuels puis répéter seulement les cas concernés.
- [ ] Rapport demandé : causes, modèle, templates, preview, issue/number, ordonnance/header/order, A5/AR-FR, fichiers/migrations, tests, QA et limitations. DONE seulement si critères logiciels vérifiés ; tirage physique/pilote reste catégorie explicite.
- [ ] Commit final ciblé, aucune fusion/push/publish sans demande.

## Revue du plan

Les tâches couvrent le périmètre de la conception ; contrats communs et noms SQL/services sont cohérents. Les cinq risques Review Focus possèdent chacun un test propriétaire. Les colonnes nouvelles sont additives et l'approbation de conception constitue la décision humaine sur l'évolution de schéma. L'exécution reste à choisir/revoir selon writing-plans ; aucun code applicatif ou migration modifié dans cette étape.
