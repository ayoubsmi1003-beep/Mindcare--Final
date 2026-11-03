# QA Artifact — contents and restore

> **Confidential.** This artifact contains the 1,558 legacy Syglab identities
> (name, phone, ID-card number, birth date). It is for the clinic’s authorized
> QA/test PC only. Never copy it to a production PC or into the clean package.

## 1. Contents

```
MindCare-QA-<version>/
├─ app/                         the unpacked application (win-unpacked)
│  ├─ MindCare OS.exe
│  ├─ Installer-MindCare.cmd
│  ├─ Installer-Portable-MindCare.ps1
│  └─ resources/
│     ├─ serveur/               Next.js standalone backend
│     ├─ pgsql/                 PostgreSQL 16 binaries
│     ├─ voix/                  faster-whisper, Kokoro, Vosk, Python
│     ├─ alexa/local-model/     MiniCPM Q4_K_M + llama.cpp runtime
│     └─ snapshot/
│        ├─ purge-synthetic.sql
│        ├─ gates.sql
│        ├─ base.dump           the QA database dump (1,558 patients)
│        └─ manifest.json       counts + SHA-256
├─ documentation/
│  ├─ QA-ARTIFACT.md            this file
│  ├─ CLEAN_DATABASE_AND_IMPORT_GUIDE.md
│  ├─ PORTABLE_DEPLOYMENT_GUIDE.md
│  └─ DELIVERY-CHECKLIST.md
└─ manifests/
   └─ SHA256SUMS.txt
```

## 2. Why a folder, not the clean installer

The common installer deliberately contains **no** clinical snapshot
(`electron-builder.yml` copies only `purge-synthetic.sql`; the package verifier
refuses any other `resources/snapshot/*`). The QA artifact is therefore a
**portable folder** that carries the dump next to the application. The
application’s first-run provisioner restores it only when:

- the cluster is confirmed new (`clusterNeuf: true`);
- `base.dump` and `manifest.json` are present;
- `gates.sql` is present;
- the dump SHA-256 matches the manifest;
- the restored patient count matches `patient_count`;
- no `app.legacy_id_map` row exists before the restore (anti-overwrite guard).

## 3. Install on the QA PC

1. Copy the whole `MindCare-QA-<version>` folder to a local disk on the QA PC.
2. Open an elevated PowerShell in `app/`.
3. Run:
   ```powershell
   .\Installer-Portable-MindCare.ps1 -ConfigureHost
   ```
   The script copies the app to `C:\Program Files\MindCare OS`, protects the
   folder, creates the desktop shortcut, and configures the host service.
4. Open **MindCare OS**. Choose **« Utiliser ce PC comme PC médecin »** if asked.
5. The first preparation restores `resources/snapshot/base.dump`; wait for the
   login screen. Do not close the window during the restore.
6. Log in with the QA test accounts (`drlarbi` doctor, `admin` reception) and
   the passwords supplied separately.
7. Verify **Patients** shows **1,558** records.

## 4. If the restore is refused

The application refuses a partial or mismatched restore. Check, in order:

1. `%ProgramData%\MindCare\logs\clinic-task.log` and `backend.log`.
2. `%ProgramData%\MindCare\clinic-initialization.pending` (an interrupted first
   run leaves this marker; the app refuses to serve a partial database).
3. The dump SHA-256 against `manifest.json`.
4. The target cluster is new: the restore is refused if `app.legacy_id_map`
   already has rows.
5. The migration drift note: the QA database has **193** applied migrations
   (the 191 files on disk plus `186_alexa_treatment_and_draft_actions` and
   `187_alexa_prescription_posology_update`). The dump includes those rows. Do
   not edit the dump or invent the two files.

Do not delete `%ProgramData%\MindCare` to “start over”. Use a new Windows
profile or a disposable VM, and keep the failed cluster for diagnosis.

## 5. Verify the restored data

```sql
SELECT count(*) FROM app.patients;            -- 1558
SELECT count(*) FROM app.profiles;            -- 5
SELECT count(*) FROM app.knowledge_chunks;    -- 48760
SELECT count(*) FROM app.schema_migrations;   -- 193
```

Run `resources/snapshot/gates.sql` against the restored database; every gate
must pass. Compare the table counts with `manifest.json`.

## 6. Reset only disposable QA data

If the QA PC needs a fresh QA run, do **not** delete the cluster files. Create a
new disposable database and restore the same dump into it, or reinstall on a
fresh Windows profile. The source `mc-p3` database is never modified by this
procedure.
