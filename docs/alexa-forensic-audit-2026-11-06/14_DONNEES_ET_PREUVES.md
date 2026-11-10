# Données et architecture — inventaire initial des migrations

**Statut : partiel, statique.** Les instructions de création repérées dans `supabase/migrations/` montrent des structures prévues par le dépôt. Elles ne prouvent pas que les migrations sont appliquées, que les tables existent dans une installation particulière, ni qu'elles contiennent des données. Aucun contenu patient ni secret n'a été interrogé. Le schéma final exige également l'analyse de tous les `ALTER`, suppressions, vues, fonctions, politiques et droits ultérieurs.

| Famille | Structures repérées dans les migrations | Provenance initiale |
|---|---|---|
| Cabinet et comptes | `cabinets`, `profiles` | `003_cabinets_profiles_helpers.sql` |
| Patients et admission | `patients`, `pending_patients`, `intake_forms`, `intake_questions` | `004`, `005` |
| Agenda | `appointments`, `appointment_reasons` | `006` |
| Consultation et contenu | `consultations`, `transcript_segments`, `live_insights`, `clinical_notes`, `clinical_note_amendments` | `007`, `008` |
| Données cliniques et prescription | `diagnoses`, `scales`, `scale_administrations`, `medications`, `prescriptions`, `prescription_lines` | `009` |
| Documents | `counters`, `documents`, `document_templates`, `document_drafts`, `document_draft_revisions` | `010`, `129` |
| Paiements et charges | `payments`, `charges` | `011`, `038` |
| Notifications et Alexa | `notifications`, `jarvis_actions`, `jarvis_conversations`, `jarvis_messages` | `011`, `012`, `058` |
| Résumés et analyses | `patient_case_summaries`, `case_summary_feedback`, `consultation_analyses` | `053`, `067` |
| Traitements | `patient_treatments`, `patient_treatment_history` | `074` |
| Connaissance et vecteurs | `knowledge_sources`, `knowledge_chunks`, `knowledge_chunk_vectors`, `knowledge_chunk_vectors_768` | `092`, `188`, `191` |
| Évaluation et exécution IA | `ai_replay_runs`, `ai_replay_cases`, `ai_live_runs`, `ai_live_calls`, `ai_live_proofs` | `094`, `097` |
| Communication | `communication_conversations`, `communication_participants`, `communication_messages`, `message_deliveries`, `message_templates`, `communication_consents`, `external_connections`, `external_message_refs`, `communication_actions`, `human_handoffs`, `communication_automations` | `112` |
| Reprise historique | `legacy_migration_batches`, `legacy_id_map`, `legacy_clinical_history`, `legacy_orphan_prescriptions`, `legacy_orphan_prescription_lines`, `legacy_review_queue` | `126` |
| Collaboration | `cabinet_events`, `assistant_calls`, `internal_messages` | `178` |
| Suivi médicamenteux | `patient_allergy_events`, `patient_adverse_events`, `patient_measurements`, `treatment_adherence_reports`, `treatment_interaction_reviews`, `interaction_review_treatments`, `prescription_renewal_links` | `212` |
| Exploitation et audit | `schema_migrations`, `deployment`, `audit.log`, `audit.deployment_transitions`, `audit.boundary_crossings` | `001`, `013`, `016`, `028` |

Les noms ci-dessus proviennent d'une recherche ciblée sur `CREATE TABLE` avec qualification `app` ou `audit`. Ce relevé peut omettre des variantes syntaxiques et les autres schémas ; ce n'est donc pas encore un dictionnaire complet. Deux préfixes de migration sont répétés (`188`, `191`) et une migration `214` était déjà supprimée dans l'arbre de travail au début de la session : aucune conclusion sur l'état appliqué ou sur une erreur ne peut être tirée sans examiner le mécanisme de migration et l'installation.

## Règles à vérifier dans le code et la base

Les exigences de `CLAUDE.md` prescrivent des portes de lecture auditées pour les patients, des autorisations en base, l'immuabilité des notes verrouillées, des montants entiers en dinars et des dates de cabinet en `Africa/Algiers`. `src/services/finance-calendrier.ts` expose les fonctions de calcul de périodes ; `src/services/consultations.ts` expose notamment signature et amendement. Ces éléments ne démontrent pas encore que l'ensemble des droits, déclencheurs et chemins en production sont corrects.

## Expériences nécessaires avant de parler des données réelles

1. Identifier explicitement l'installation, le processus et la base visés ; vérifier l'identité et le caractère synthétique d'un environnement d'évaluation avant toute écriture.
2. Examiner uniquement des métadonnées autorisées : versions de migrations, schémas, signatures de fonctions, droits, politiques, index et compteurs agrégés si nécessaire. Ne pas copier de lignes patients, de notes ni de secrets dans les rapports.
3. Reconstruire les champs et relations à partir des migrations successives, puis les comparer aux contrats de services, aux écrans et aux outils Alexa.
4. Pour chaque capacité, prouver l'appel effectif, les droits par rôle, le traitement des absences et erreurs, et la couverture des tests. Marquer toute absence de preuve `NON VÉRIFIÉ`.
