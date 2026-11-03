# Clean Database and Import Guide — MindCare OS

> This guide separates the **QA/test database** from the **clean deployment
> database**. It does not perform the doctor’s historical import. It prepares
> the later OpenCode task and the rollback.

## 1. Two databases, two purposes

| | QA/test database | Clean deployment database |
|---|---|---|
| Identity | Docker container `mc-p3`, `127.0.0.1:55441/mindcare` | The clinic PC’s local PostgreSQL cluster under `%ProgramData%\MindCare\data` |
| Patients | **1,558** legacy Syglab identities (real PII) | **0** |
| Purpose | Reproduce the clinic’s existing records on the authorized test PC | A new clinic, empty clinical database |
| Distribution | Artifact A, confidential, clinic test PC only | Artifact B, clean installer, no dump |
| Schema | Migration head `213_medication_phase2_gates` | Same migration chain, applied by the installer |

The 1,558 rows are **not generated fixtures**. They are the legacy identities
imported from Syglab (`app.legacy_id_map`, `source_kind = 'patient'`). Never
seed them into the clean database and never delete them from `mc-p3`.

## 2. Clean database bootstrap (supported path)

The supported path is the packaged application’s first run on the doctor PC:

1. Install Artifact B with the installer.
2. Open MindCare and choose **« Utiliser ce PC comme PC médecin »**.
3. The application:
   - creates the PostgreSQL 16 cluster with ICU `fr-DZ`, UTF-8;
   - starts the `mindcare-postgres` service;
   - creates the `mindcare` database;
   - applies `supabase/bootstrap/000`, all `supabase/migrations/*.sql` in
     lexical order, then `supabase/bootstrap/010_app_role.sql`;
   - runs `resources/snapshot/purge-synthetic.sql` to remove demonstration
     fixtures (it preserves the 1,558 only if a dump was restored; a clean
     database has none);
   - writes `%ProgramData%\MindCare\mindcare.env` with a generated application
     password;
   - switches the deployment to `self-hosted`.
4. The login screen appears only after the migration head and health checks
   pass. An interrupted initialization leaves
   `clinic-initialization.pending`; the next start refuses to serve a partial
   database.

The clean package ships **no** universal doctor/receptionist password. The
practitioner account is created through the documented first-configuration
screen; the receptionist account is created from **Paramètres → Cabinet &
postes** with the `assistant` role.

## 3. Verify the clean database

Run these read-only checks as the cluster superuser (never paste the password
into a terminal; use `PGPASSWORD` from the protected environment file):

```sql
SELECT current_database(), current_user, version();
SELECT count(*) FROM app.patients;              -- must be 0
SELECT count(*) FROM app.profiles;              -- only the accounts you created
SELECT version FROM app.schema_migrations ORDER BY version DESC LIMIT 3;
-- expected head: 213_medication_phase2_gates
SELECT extname FROM pg_extension ORDER BY extname;  -- vector present if used
```

Also verify that `pg_hba.conf` rejects remote PostgreSQL connections and that
only the application role can reach the `app.*` doors.

## 4. Backup and restore (QA database)

The supported snapshot script is `scripts/snapshot-production.mjs`. It:

1. dumps `mc-p3/mindcare` with `pg_dump -Fc`;
2. restores into a **new disposable database**;
3. compares every table by row count and fingerprint;
4. runs `resources/snapshot/gates.sql`;
5. writes `resources/snapshot/base.dump` + `manifest.json` only after the
   comparison passes;
6. drops the verification database.

Run it from the repository root:

```powershell
node scripts/snapshot-production.mjs
```

The script refuses to promote a snapshot if the migration files on disk and
`app.schema_migrations` disagree. Do not edit the dump or the manifest.

To restore a copy on an isolated machine:

```powershell
# Create an empty database first; never drop an existing one.
& "<install>\resources\pgsql\bin\createdb.exe" -h 127.0.0.1 -p 54333 -U postgres mindcare_restore
& "<install>\resources\pgsql\bin\pg_restore.exe" -h 127.0.0.1 -p 54333 -U postgres `
  --exit-on-error -d mindcare_restore "<path>\base.dump"
& "<install>\resources\pgsql\bin\psql.exe" -h 127.0.0.1 -p 54333 -U postgres `
  -d mindcare_restore -v ON_ERROR_STOP=1 -f "<install>\resources\snapshot\gates.sql"
```

Then compare `app.patients` = 1,558 and the table fingerprints in
`manifest.json`. Do not point the application at the restore database until the
comparison passes.

## 5. Preflight for the doctor’s historical import (later OpenCode task)

Do **not** run the real import now. Before it:

1. **Freeze the target.** Take a verified snapshot of the clean clinic database
   and record its SHA-256. The import runs against a disposable clone first.
2. **Identify the source.** The legacy extract is under
   `doctor_old_data/extract/` on the old machine; record its file hashes and row
   counts. Never copy it into the repository or a release package.
3. **Map identities.** Confirm the source patient key → `app.patients.id`
   mapping in `app.legacy_id_map` (`source_kind = 'patient'`). Stable IDs must be
   preserved; do not regenerate UUIDs.
4. **Check duplicates.** Run the duplicate review queue
   (`app.legacy_review_queue`) and the name/phone/ID-card comparison before any
   insert. Resolve manually; never auto-merge clinical records.
5. **Import in order:** patients → identity fields → appointments → consultations
   → notes → prescriptions → documents → payments. Each step is a door
   (`app.legacy_import_*`), audited, in one transaction where possible.
6. **Validate counts and relationships:**
   - patients: source count = target count, no orphan;
   - consultations and notes: every note belongs to the right patient and
     consultation;
   - prescriptions/lines: no orphan line, amounts integer DZD;
   - documents: every document has a patient and a source revision;
   - payments: sum and count match the source;
   - no duplicate patient (same name + phone + ID card) unless reviewed.
7. **Clinical safety.** Do not invent history, notes, treatments, appointments
   or payments to fill gaps. Missing source data stays missing and is reported.
8. **Rollback.** Keep the pre-import snapshot and the exact migration head. If
   validation fails, restore the snapshot into a new database, verify the
   1,558/clean count, and point the app back only after the comparison passes.
   Never run `DROP DATABASE` on the clinic database.

## 6. What “lossless” means here

The import is not claimed lossless until the preflight above passes on a clone
and the source/target counts and relationships are compared. The current
repository preserves the migration chain and the stable-ID mapping; it does not
guarantee that every legacy field has a destination. Report unmapped fields
explicitly.
