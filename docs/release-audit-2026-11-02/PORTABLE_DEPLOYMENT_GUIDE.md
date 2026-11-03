# Portable Deployment Guide — MindCare OS (Alexa V8)

> Version: `0.1.4-rc1.20261028`. This guide describes the supported package and
> the on-site checks. It contains no secrets and no patient data.

## 1. The two deliverables

| Artifact | Contents | Use |
|---|---|---|
| **A — QA/test package** | The same installer + `qa-database.dump` (1,558 legacy identities) + restore procedure + SHA-256 manifest | The clinic’s authorized QA/test PC only. Confidential: the 1,558 rows are real imported identities, not generated fixtures. |
| **B — Clean deployment package** | The same installer + documentation + SHA-256 manifest; **no dump, no patients** | A new clinic PC. First run creates an empty clinical database. |

Never install Artifact A on a production PC, and never copy its dump into the
clean package.

## 2. What to copy

Copy the **whole** release folder, not a single `.exe`. The installer needs its
adjacent resources (the Electron runtime, the Next.js server, PostgreSQL 16
binaries, the voice models, the local MiniCPM model). Keep the folder structure
exactly as delivered.

The installer is unsigned. Windows SmartScreen may ask for confirmation; this is
expected for an in-clinic, hand-delivered build.

## 3. Doctor PC — first installation

1. Copy the release folder to the doctor PC (local disk, not a network share).
2. Run `MindCare Setup <version>.exe` as a Windows administrator. Accept the
   elevation prompt once.
3. Open **MindCare OS** from the desktop/Start-menu icon.
4. On a new clinic, choose **« Utiliser ce PC comme PC médecin »** and confirm.
   The app creates the PostgreSQL cluster, applies the migrations, installs the
   Windows service and the scheduled task, and generates the HTTPS certificate.
   The first preparation can take several minutes; do not close the window.
5. When the login screen appears, create the practitioner account through the
   documented first-configuration screen. The clean package does **not** ship a
   universal doctor/receptionist password.
6. Create the receptionist account from **Paramètres → Cabinet & postes**. It
   receives the `assistant` role: identity, contact, appointments, waiting room
   and payments; never clinical notes.

The doctor PC must remain powered on during opening hours: it hosts the
database, the backend and the HTTPS proxy. The receptionist PC does not create a
second database.

## 4. Receptionist PC — pairing

1. Install the **same** `MindCare Setup <version>.exe` on the receptionist PC.
2. Open **MindCare OS**. It discovers the clinic on the local network.
3. On the doctor PC: **Paramètres → Cabinet & postes → Connecter un autre
   poste**. A 24-character code is displayed for 5 minutes.
4. On the receptionist PC: enter the code, accept the one-time Windows
   certificate trust prompt, then log in with the receptionist account.
5. If discovery fails, use **« Le cabinet n’apparaît pas ? »** and type the
   doctor PC’s network name (shown in the invitation dialog). Do not disable the
   firewall.

The pairing code is single-use and expires after 5 minutes. The device token is
stored in the Windows user profile and sealed with DPAPI.

## 5. Network and firewall

- Both PCs must be on the same private clinic LAN, not a guest network.
- The doctor PC hosts PostgreSQL on loopback only (`54333`), the backend on
  `43117`, and the HTTPS proxy on `43118`.
- The installer creates the firewall rules for the MindCare program and the
  local subnet. Do not open PostgreSQL to the LAN.
- No internet connection is required for discovery, pairing, login, patient
  records, agenda, payments or local voice. Cloud AI features remain optional
  and separate.

## 6. Verify the installation

On the doctor PC:

1. **Login:** the QA test accounts (`drlarbi` doctor, `admin` reception) with
   the passwords supplied separately. On a clean production database, use the
   account created at first run.
2. **Patients:** open **Patients**; the list loads. On the QA package it must
   show 1,558 records.
3. **Alexa text:** open **Alexa**, ask “Bonjour”. The answer must appear and be
   spoken by the local Kokoro voice (`ff_siwis`).
4. **Alexa clinical:** ask “Combien de patients avons-nous ?”. The answer must
   match the record count.
5. **Microphone:** click **Mains-libres**, say **« Alexa »**, wait for
   “Oui docteur, je vous écoute”, then say “Quel est le prochain patient ?”.
   The transcript must appear as a human bubble and the answer must be spoken.
6. **Voice self-check (no microphone):** from the install folder, the packaged
   voice bundle can be verified with the shipped checker; the expected engines
   are `faster-whisper-small-int8`, `kokoro-82m-v1.0-ff_siwis` and
   `vosk-fr-FR-small`.

On the receptionist PC:

1. Open **MindCare OS**; it reconnects without a new code.
2. Log in with the receptionist account.
3. The sidebar shows **Patients** and **Agenda** only; no clinical tabs, no
   finances.
4. Create a test appointment; it must appear on the doctor PC.

## 7. If something fails

| Symptom | First action |
|---|---|
| “Recherche du cabinet…” frozen without a counter | Close and reopen; if repeated, read `%ProgramData%\MindCare\logs\clinic-task.log` |
| “Cabinet introuvable” on the receptionist PC | Check the doctor PC is on and MindCare is open; use the unicast fallback with the doctor PC name |
| “Le service du cabinet ne répond pas” on the doctor PC | Open the logs; do not reinstall blindly |
| Voice answers are text-only | Check the mute button in the Alexa panel; check Windows per-app volume and the default output device; the TTS route is local Kokoro, not browser speech |
| “Alexa” does nothing | Mains-libres must be armed; check the default recording device and microphone permission; wait for “Préparation de la voix” on the first cold start |
| Pairing code expired | Generate a new code on the doctor PC |

## 8. Upgrade without losing data

1. Close MindCare on both PCs.
2. Run the new `MindCare Setup <version>.exe` on the doctor PC. The installer
   replaces the application folder and leaves `%ProgramData%\MindCare` intact.
3. Re-run it on the receptionist PC.
4. Open MindCare; the database and the paired device token are preserved.
5. If the certificate changed, the receptionist PC shows **« Reconnecter ce
   poste »**; generate a new invitation. Data is not touched.

## 9. Uninstall

Uninstalling removes the application and the shortcuts. It does **not** delete
`%ProgramData%\MindCare` (database, backups, private configuration) or the
clinic data. A reinstall reconnects to the existing database.

## 10. Evidence still required on site

The following are **NOT RUN** in the 2026-11-02 audit because the hardware was
not available: two real PCs, Windows reboot, real microphone (distance, noise,
quiet speech), real speakers, and a clean Windows first run. Use
`docs/QUALIFICATION-DEUX-PC.md` and record PASS/FAIL for each row.
