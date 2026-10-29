# Contrat — portes diagnostic (CURRENT)

Deux gestes, deux portes, aucune écriture directe depuis le navigateur.

| Porte | Signature | Rôle |
|---|---|---|
| `app.record_diagnosis` | `(patient uuid, label text, code_system text, code text, is_primary boolean, onset_date date)` | Poser un diagnostic dans le périmètre du patient. |
| `app.resolve_diagnosis` | `(id uuid, resolved_at date)` | Marquer un diagnostic comme résolu, de façon idempotente. |

## Règles portées par la base

- **Périmètre.** Le patient est lu sous la RLS de l'appelant. Zéro ligne =
  inexistant ou hors périmètre, indistinctement (ADR-003). Aucune autorisation
  n'est décidée en JavaScript.
- **Verrou.** `record_diagnosis` verrouille la ligne patient (`FOR UPDATE`)
  avant de déclasser un éventuel diagnostic principal actif : deux poseurs
  concurrents ne peuvent pas laisser deux principaux actifs.
- **Transition.** Un seul diagnostic principal **actif** par patient. Le
  précédent est remis à `is_primary = false` dans la même transaction.
- **Validation.** Libellé non vide (≤ 500 caractères), système ≤ 64, code
  ≤ 32, date de début non future. `resolve_diagnosis` refuse une résolution
  antérieure au début ou future, et rend la ligne déjà résolue sans la
  réécrire.
- **Trace.** `trg_audit` (013) journalise INSERT et UPDATE. La migration 205
  ne crée **aucune table, colonne ni enum**. La migration 206 ajoute seulement
  `is_synthetic = app.is_cloud_dev()` à l’INSERT : le drapeau ADR-016 est
  dérivé de l’environnement, jamais choisi par l’appelant.

## Surface UI

`CarteDiagnostics` (dossier patient et onglet Clinique) :

- liste des actifs, puis des résolus ;
- formulaire avec libellé, code ICD-10/DSM-5/CIM-11, date de début, rôle
  principal/secondaire ;
- aide à la saisie par libellés fréquents — un choix pré-remplit le code,
  jamais un diagnostic imposé ;
- action « Marquer comme résolu » ;
- aucun diagnostic n'est inventé par l'écran.

## Vérifications

- `tests/unit/diagnoses-gates.test.ts` (contrat SQL statique) ;
- lecture RPC dans le navigateur avec un compte synthétique ;
- audit : une ligne `audit.log` par INSERT/UPDATE.

## Références de conception

- OMS, *The ICD-10 Classification of Mental and Behavioural Disorders —
  Clinical descriptions and diagnostic guidelines* : enregistrer autant de
  diagnostics que nécessaire, avec un diagnostic principal et des diagnostics
  subsidiaires.
- APA, *DSM-5-TR* : le diagnostic est une hypothèse clinique fondée sur les
  critères, à documenter avec les éléments qui le soutiennent ; les symptômes
  isolés ne sont pas des diagnostics.
- AAPL, *Diagnosing and Treating Psychiatric Patients: A Documentation Primer
  for Primary Care Physicians* : le diagnostic doit être étayé par les données
  factuelles du dossier, l’examen mental et les sources collatérales.

Ces références guident la **saisie** ; elles ne sont pas des règles automatiques
et ne remplacent jamais le jugement de la praticienne.
