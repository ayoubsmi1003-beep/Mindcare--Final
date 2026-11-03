# Delivery Checklist — 2026-11-03

## 1. What to carry

| Item | Where | Notes |
|---|---|---|
| QA/test package (Artifact A) | `release/MindCare-QA-<version>/` | installer + `qa-database.dump` + restore procedure + SHA-256 manifest. **Confidential: 1,558 real legacy identities.** |
| Clean package (Artifact B) | `release/MindCare-Clinic-Release-<version>/` | installer + documentation + SHA-256 manifest. **No dump, no patients.** |
| This checklist | `docs/release-audit-2026-11-02/DELIVERY-CHECKLIST.md` | print or keep on a phone |

Do not put the QA dump on the clean PC. Do not put the clean installer alone on
the QA PC without the dump and the restore procedure.

## 2. Doctor PC

1. Copy the **clean** package (or the QA package if this is the authorized test
   PC) to a local disk.
2. Run `MindCare Setup <version>.exe` as administrator.
3. Open **MindCare OS** from the desktop icon.
4. Choose **« Utiliser ce PC comme PC médecin »**; wait for the preparation.
5. Create the practitioner account at first configuration.
6. Open **Patients**; on the clean package the list is empty. On the QA package
   it must show **1,558** records.
7. Open **Alexa**; ask “Bonjour”. The answer must be spoken by Kokoro.
8. Click **Mains-libres**, say **« Alexa »**, wait for the acknowledgement, then
   say “Quel est le prochain patient ?”. The transcript and the spoken answer
   must appear.
9. Create the receptionist account in **Paramètres → Cabinet & postes**.
10. Generate the pairing code for the receptionist PC.

## 3. Receptionist PC

1. Install the **same** `MindCare Setup <version>.exe` as administrator.
2. Open **MindCare OS**; wait for the clinic discovery.
3. Enter the 24-character code from the doctor PC.
4. Accept the one-time Windows certificate trust prompt.
5. Log in with the receptionist account.
6. Verify: sidebar **Patients** and **Agenda** only; no clinical tabs, no
   finances.
7. Create a test appointment; verify it appears on the doctor PC.
8. Close and reopen MindCare; verify it reconnects without a new code.

## 4. Credentials (QA/test database only)

| Role | Username |
|---|---|
| Doctor | `drlarbi` |
| Receptionist | `admin` |

The QA test passwords are supplied separately; they are not written in this
repository or in the clean package. These accounts exist only in the QA
database `mc-p3`. The clean database uses the first-run account creation.

## 5. On-site checks that are still NOT RUN

Record PASS/FAIL for each on the two real PCs:

- [ ] Normal desktop icon launches the app, no terminal.
- [ ] Login screen appears without the old server screen.
- [ ] Doctor login; patient list loads.
- [ ] Receptionist pairing; no IP/certificate typed.
- [ ] Receptionist role restrictions.
- [ ] Real microphone: “Alexa” at normal volume.
- [ ] Real microphone: quiet voice / distance / office noise.
- [ ] Kokoro audible on the doctor PC speakers at a usable volume.
- [ ] Clinical question answered and spoken.
- [ ] Disconnect/reconnect the receptionist PC.
- [ ] Reboot the doctor PC; the clinic returns.
- [ ] Reboot the receptionist PC; it reconnects.
- [ ] No duplicate appointment/payment after retry.
- [ ] Clean first run on a fresh Windows profile (if applicable).

## 6. If voice is silent on site

1. Check the Alexa panel mute button: it must say **« Couper la lecture
   automatique »** (auto-read is ON).
2. Check Windows **per-app volume** for MindCare and the default output device.
3. Ask “Bonjour”; the answer must appear as text first. If the text appears but
   no sound, the TTS route or the output device is the cause, not the model.
4. Click **Mains-libres**; the status must show
   **« Mains-libres en veille. Dites “Alexa” pour me réveiller. »**
5. If “Alexa” is not detected, check the default recording device and the
   microphone permission. The first cold start can take up to a minute; wait for
   **« Préparation de la voix »**.

## 7. If the app does not start

1. Open `%ProgramData%\MindCare\logs\clinic-task.log`.
2. Check the `MindCare-Clinic-Server` scheduled task and the
   `mindcare-postgres` service.
3. Check ports `43117`, `43118`, `54333`.
4. Do not reinstall blindly; the log names the failing stage
   (`STARTUP_REFUSED`, `BACKEND_UNEXPECTED_EXIT`, `HTTPS_START_FAILED`).
