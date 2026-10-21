# Correspondance Syglab → MindCare (migrations 126 + 127)

Référence d'exécution : `scripts/migrate-legacy-syglab.mjs` (`pnpm migration:legacy`).
Portes : `supabase/migrations/126_legacy_syglab_migration.sql` (12 portes),
`127_legacy_identity_scope.sql` (naissance + purge + `implausible_date`).
Tests : `tests/unit/legacy-migration-mapping.test.ts`,
`tests/integration/legacy-migration.test.ts`,
`scripts/checkpoint-legacy-126.sql`, `scripts/checkpoint-legacy-127.sql`.

## 0. Périmètre en vigueur (décision 2026-10-06 — remplace le clinique)

IDENTITÉ UNIQUEMENT : nom, téléphone, N° carte, naissance.
AUCUN historique, AUCUNE ordonnance, AUCUN médicament, AUCUN document.
Le clinique importé par le lot 126 a été purgé par
`legacy_purge_batch_clinical` (owner, borné au lot, DELETE journalisés) :
1556 historiques, 139 ordonnances (166 lignes), 6 orphelines + 11 revues
closes et signées. Patients et correspondances patient intacts.
Naissance : `Pat_Date_naissance` verbatim (plage source 1572–2222) ;
< 1900 ou future → stockée + revue `implausible_date` ; absente/illisible
→ NULL. Backfill via `update_patient` (018) seulement si NULL (jamais écrasé).

Référence d'exécution : `scripts/migrate-legacy-syglab.mjs` (`pnpm migration:legacy`).
Portes : voir en-tête (126 + 127).
Tests : voir en-tête (unit, intégration, checkpoints 126 + 127).

## 1. Source → destination (lot 126 : historique — PURGÉ, voir §0 ; identité : en vigueur)

## 1. Source → destination

| Legacy (lot `doctor_old_data/extract/`) | Destination | Porte |
|---|---|---|
| `patient.Pat_prenom` → `first_name`, `patient.Pat_nom` → `last_name` (verbatim, jamais réordonnés) | `app.patients` | `legacy_import_patient` |
| `Pat_Tel` → `phone`, NULL si absent (126 a rendu la colonne nullable ; le CHECK `^[0-9+ ]{8,20}$` subsiste) | `app.patients.phone` | idem (hors format → revue `weak_identity`, jamais corrigé) |
| `Num_CDI` → `id_document_number`, NULL si absent | `app.patients` | idem |
| Entrée baseline (`patient.IDPatient=…`) → UNE ligne d'historique, texte verbatim (antécédents + Note RTF byte-exact) | `app.legacy_clinical_history` (`history_kind='baseline_note'`) | `legacy_import_history` |
| Ordonnance (Numero, Observation, date) → en-tête ; lignes (display, posologie, texte_libre, quantités) → lignes | `app.prescriptions` (`consultation_id NULL`, `prescribed_at` = date legacy Africa/Algiers, `notes='Syglab N°…'`) + `app.prescription_lines` | `legacy_import_prescription` |
| 6 ordonnances orphelines (4 IDs) | `app.legacy_orphan_prescriptions` + lines (quarantaine) | `legacy_quarantine_orphan` |
| 49 groupes doublons + 71 cas manuels | `app.legacy_review_queue` (PENDING) | `legacy_open_review` / `legacy_resolve_review` |

## 2. Champs non repris (volontaire)

`dem_consultation` (fichier absent, irrécupérable — aucune consultation
structurée fabriquée), documents/blobs, montants, questionnaires, file
d'attente, RDV, staff/secrets, naissance/adresse/e-mail (hors périmètre des
4 catégories). `birth_date` reste NULL (la garde anti-doublon native exige
une naissance non nulle : elle ne se déclenche donc jamais sur import legacy —
les doublons passent par la file de revue, pas par l'exception 23505).

## 3. Provenance et idempotence

- Chaque ligne : `source_system='syglab'`, `source_record_ref`, `batch_id`,
  `content_sha256`, `imported_at` (= `created_at`, jamais confondu avec la
  date clinique).
- `app.legacy_id_map` : `syglab:patient:<ID>`, `syglab:ordonnance:<ID>`,
  `syglab:ligne:<ord>:<ligne>`, `syglab:note:<ref>` (+ `orphan:<pid>:<oid>`),
  UNIQUE globale → rejouer ne duplique rien (prouvé : 2ᵉ run = 0 créations,
  compteur `patient_record` inchangé). Lecture via `legacy_map_lookup`.
- RTF : hash calculé sur les octets UTF-8 du texte transmis, revérifié par
  `legacy_get_report` (`extensions.digest` recalculé en base).

## 4. Médicaments : aucun mapping automatique

`medication_id` reste TOUJOURS NULL à l'import (aucun référentiel croisé
faisant autorité entre IDs Syglab et uuids MindCare). Le texte legacy vit
dans `free_text` ; `legacy_id_map.meta` garde `{legacy_med_id, unresolved,
quantite}`. Les 7 lignes à ID inconnu remontent en revue
`unmatched_medication`. Un futur crosswalk validé humainement pourra
renseigner `medication_id` — jamais un appariement flou silencieux.

## 5. Doublons et identités faibles

49 groupes `possible_duplicate` (clé = membres + motif : une paire appariée
à la fois par N° carte et téléphone vaut deux faisceaux) → revue, 0 fusion
auto (aucun workflow de fusion n'existe — `find_similar_patients` ne fait
que scorer). 60 sans téléphone+carte importés normalement (NULL),
marqués `weak_identity` en revue.

## 6. Validation et rapports

`--validate` (sans base) → `--dry-run` (transaction annulée, rapport
`migration_dryrun_report.json`) → `--import --allow-write` (lots
transactionnels par patient, échec = revue, jamais de perte silencieuse) →
`legacy_finalize_batch` → `legacy_get_report` fusionné aux comptes source
(`migration_report.json`). Statut BLOCKED dès qu'une perte ou un hash
désaccordé est constaté.

## 7. Rollback / réversibilité (pas de DELETE destructeur)

1. Avant tout import réel : `scripts/backup.sh` (ou `sauvegarde.mjs`)
   VERT avec restauration de contrôle — seule réversion intégrale.
2. Après import : chaque ligne importée est retrouvable par lot
   (`legacy_id_map.batch_id`, `legacy_* .batch_id`) pour audit ciblé.
3. Retrait logique si ordonné par la praticienne : lots repassés en
   `failed` + revue des dossiers concernés (aucune suppression physique —
   les tables cliniques n'ont pas de chemin de DELETE).
4. Rejouer le même script est sans effet (idempotence globale §3).

## 8. Réexécution

`node scripts/migrate-legacy-syglab.mjs --import --allow-write
--practitioner-id <uuid> [--cabinet-id <uuid>] [--label <nom>]`.
Nouveau lot à chaque run ; les correspondances existantes sont réutilisées.
URI via `MINDCARE_MIGRATION_DB` sinon `MINDCARE_DATABASE_URL` (jamais affichée).
