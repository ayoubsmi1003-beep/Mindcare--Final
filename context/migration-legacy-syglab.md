# TASK: migration-legacy-syglab
DOMAIN: patients + consultation + documents + finance(prescriptions)
OBJECTIVE: Importer les 1558 patients legacy Syglab (extraction `doctor_old_data/extract/`) dans MindCare sans perte, sans invention, avec provenance, idempotence, audit et file de revue. Preuve : rapport de migration reconciliant tous les comptes §19 + tests ciblés verts.
ALLOWED_FILES (phase 3+):
- `supabase/migrations/126_legacy_syglab_migration.sql` (APPLIQUÉE 2026-10-06 :
  conteneur preuve + mc-p3 ; 5 tables + **12 portes** + RLS + audit —
  `legacy_map_lookup` ajoutée pour reprise exacte)
- `scripts/migrate-legacy-syglab.mjs` (`pnpm migration:legacy` :
  --validate/--dry-run/--import, lookup d'abord, lots par patient, rapports)
- `src/services/legacy-migration.ts` (mapping pur + `legacy_get_report`,
  `legacy_list_reviews`, `legacy_resolve_review` — allowlist régénérée :
  100 fonctions)
- `src/i18n/fr.ts` (clés `migration.*` uniquement), lecture `tokens.css` (aucune couleur en dur)
- `tests/unit/legacy-migration-mapping.test.ts` (21 tests),
  `tests/integration/legacy-migration.test.ts` (6 tests, NOT RUN sans TEST DB),
  `scripts/checkpoint-legacy-126.sql` (25 contrôles, VERT conteneur + mc-p3)
- `docs/legacy-syglab-mapping.md` (correspondance + rollback + rerun),
  rapports dans `doctor_old_data/extract/` (`migration_report.json/.md`)
- STOP_CONDITION: **ATTEINT 2026-10-06, REPÉRIMÉTRÉ IDENTITÉ le même jour**
  (`migration_identity_report.md` : 1558 comptabilisés, 0 perdus, 1558
  naissances posées dont 4 invraisemblables en revue, clinique purgé à zéro
  via `legacy_purge_batch_clinical`, `checkpoint-legacy-127.sql` VERT).
  Reste (NEXT) : page admin de revue (portes + service prêts), import prod
  embarquée (backup.sh VERT requis), crosswalk médicaments humain (sans objet
  dans le périmètre identité).
REQUIRED_CONTEXT: AGENTS.md + `docs/domains/patients.md` + `docs/domains/database.md` + contrats `patient-search.md`, `consultation-gates.md`, `document-issue.md` + § DDL cité ci-dessous.
FORBIDDEN_CONTEXT: Jarvis/RAG/mémoire (`058/067/068`), finance (`029/039`), agenda (`022/025`), `fr.ts` entier, migrations appliquées (lecture seule), `STATE.md`, design-system, `supabase db reset`.
SECURITY_CONSTRAINTS: PII locale uniquement ; écritures via portes `SECURITY DEFINER` existantes + nouvelles portes `126` ; RLS décide ; `audit.log_read`/`trg_audit` ; `is_synthetic=false` réel (jamais cloud-dev) ; aucun `DELETE` prod (quarantaine, pas suppression) ; pas de `NEXT_PUBLIC_*`.
VALIDATION: `scripts/verify-migrations.sh` + `tsc --noEmit` + `vitest run tests/unit/legacy-migration` + dry-run sur conteneur jetable (modèle `checkpoint-pg-local.sh`) + rapport §29.
STOP_CONDITION: rapport PASS/PASS_WITH_REVIEW avec tous les comptes §19 reconciliés depuis l'exécution (jamais codés en dur), file de revue exposant 71 cas, RTF hash `source == importé`.

## 1. Source → destination (vérifié Phase 1)

| Legacy (extraction) | Destination | Porte / moyen | Note |
|---|---|---|---|
| name → first/last | `app.patients(first_name,last_name)` (`004:13-14`) | `app.create_patient` (`050`) — **BLOQUÉ si sans téléphone** (voir Décision D2) | split prénom/nom sur dernier espace, verbatim ; record_number auto `P-nnnn` |
| phone_numbers[0] | `app.patients.phone` (`004:17`, NOT NULL + CHECK `^[0-9+ ]{8,20}`) | idem | 204 absents → quarantaine ou assouplissement (D2) |
| id_card_number | `app.patients.id_document_number` (`004:20`, nullable ✓) | idem | 308 NULL restent NULL |
| baseline Note RTF | NOUVEAU `app.legacy_clinical_history(original_rtf BYTE-EXACT, sha256, …)` (D1) | porte `126` `legacy_import_history` | **jamais** dans `clinical_notes` SOAP (réinterprétation) ni `documents.rendered_html` (abus modèle médico-légal `030/061`) ; note orpheline `consultation_id NULL` invisible aux pipelines (`065:150`, `068`) |
| antécédents (32) | même table, `history_kind='antecedents'` + 4 colonnes texte verbatim | idem | séparer Note vs antécédents, pas de fusion narrative |
| 139 ordonnances | `app.prescriptions(patient, consultation_id NULL, prescribed_at=date legacy, notes='Syglab N°…')` (`009:69-78`) + `prescription_lines(medication_id NULL + free_text=dose/poso verbatim)` (`009:80-91`) | porte `126` `legacy_import_prescription` | date legacy réelle ✓ ; jamais de nouveau numéro d'ordonnance ; 7 lignes `medication_id NULL` + flag `unresolved` |
| 6 orphelines / 4 IDs | NOUVEAU `app.legacy_orphan_prescriptions` + lines (quarantaine, D1) | porte `126` | jamais rattachées par fuzzy |
| 49 groupes doublons | NOUVEAU `app.legacy_review_queue` (D1), `issue_type='possible_duplicate'`, statut PENDING | lecture via porte | 0 fusion auto ; pas de workflow merge existant (`051` = scoring seulement) |
| 71 revue (60 faible + 7 méd + 4 orphelins) | même file, statuts PENDING/CONFIRMED/REJECTED/RESOLVED/DEFERRED | portes lecture + `legacy_resolve_review` (audité) | chaque item : migration_id, entité, source ref, preuve, action proposée, reviewer, timestamps, résolution |
| idempotence | NOUVEAU `app.legacy_id_map(source_system, source_kind, source_id → mindcare_id UNIQUE)` (D1) : `syglab:patient:<ID>`, `syglab:ordonnance:<ID>`, lignes par `(ordID, ligneID)` | toute porte d'import fait `INSERT … ON CONFLICT DO NOTHING` + retourne existant | jamais le nom comme clé |
| batch/audit | NOUVEAU `app.legacy_migration_batches(batch_id, version, source_hashes, status, counts)` (D1) + `trg_audit` rattaché aux 5 tables + `audit.log_read` sur lectures | `db-migrate.sh` + script | backup `backup.sh` vérifié AVANT commit final (§18) ; rollback = archive/statut, jamais DELETE |

## 2. Portes (une écriture métier = une porte Postgres)
- Réutiliser `app.create_patient` pour les 1354 patients téléphonés (garde doublon `050:206` RLS-scopée : collision = revue, pas erreur fatale).
- Nouvelles portes `126` (owner `app_gatekeeper`, `SECURITY DEFINER`, `search_path` figé, `REVOKE PUBLIC` + `GRANT authenticated`, frontiere allowlist via `gen-db-allowlist.mjs`) : `legacy_import_history`, `legacy_import_prescription`, `legacy_quarantine_orphans`, `legacy_open_review`, `legacy_resolve_review`, lectures `legacy_*` (+ `audit.log_read` contexte `liste/fiche`).
- UI sobre : indicateur `Historique importé · Syglab` (clés `fr.ts` `migration.*`), timeline existante intacte (pas d'événements fabriqués ; `Date inconnue — historique importé` si sans date), Jarvis non exposé (pas de mémoire auto, §26), zéro-IA fonctionnel.

## 3. Phases d'exécution (§33)
1. ✅ Inspection (rapports subagents ci-dessus). 2. Design (ce manifeste) + DÉCISIONS HUMAINES (ci-dessous). 3. `126` + script + tests (TDD). 4. Dry-run conteneur jetable PG16. 5. Staging quarantaine. 6. Import contrôlé (cabinet/praticien cible humain). 7. Vérification comptes+hash. 8. File de revue. 9. Finalisation + rapports + procédure rollback/archive + doc de rerun.

## 4. DÉCISIONS HUMAINES REQUISES (bloquant avant Phase 3)
- **D1** Schéma : autoriser `126_legacy_syglab_migration.sql` (5 tables + 7 portes + RLS + audit, liste §1) ? Sans cela, seuls prescriptions-via-`009` et file hors-base sont possibles.
- **D2** Téléphone : `app.patients.phone NOT NULL + CHECK` bloque 204 patients (dont 60 sans aucun identifiant). Options : (a) assouplir en migration (constitutionnel, déconseillé), (b) quarantaine `legacy_*` + import différé à l'arrivée du numéro, (c) autre.
- **D3** Cible : quel `cabinet_id`/`practitioner_id` propriétaire (la praticienne ?) + base cible (locale `mc-p3:55441` d'abord ? prod embarquée ensuite ?) + acteur migration pour l'audit.
- **D4** Périmètre du run : staging/dry-run seul vs import complet jusqu'au rapport final.
