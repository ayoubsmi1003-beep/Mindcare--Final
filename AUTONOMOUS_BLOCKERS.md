# AUTONOMOUS_BLOCKERS

## B1 — Git binary (RESOLVED)

- PortableGit 2.56.0.4 is installed at
  `C:\Users\ABC Informatique\AppData\Local\Programs\PortableGit`.
- Git is invoked by full path (`...\cmd\git.exe`); it is not on the system PATH.
- The `github` remote points to
  `https://github.com/ayoubsmi1003-beep/Mindcare--Final.git`; `origin` was set
  to the same URL.
- Commits `b32af25` and `5acd0fc` were pushed to `v8-alexa-final`.
- The working tree still contains pre-existing local changes in `electron/`,
  `scripts/`, `supabase/bootstrap/010_app_role.sql`, several unit tests, and the
  local deletion of `214_purge_documents_synthetiques.sql`. They were preserved,
  not committed.

## B2 — Writing to `C:\Program Files` / `%ProgramData%\MindCare`

- **Why**: the current account is denied on `%ProgramData%\MindCare\mindcare.env`
  and on the installed application directory; elevation is required.
- **Impact**: the installed application and its private runtime flags (including
  `KNOWLEDGE_VECTOR=1`) cannot be updated by this session.
- **Authorization**: the user explicitly chose “build + verify, stop before
  install”.
- **Safe alternative**: the development app uses the hybrid flags from `.env`;
  the packaged app needs an elevated one-time update.

## B3 — Creating a disposable evaluation database

- **Why**: the user forbids creating or cloning a database; the existing
  `alexa_eval*` containers are stopped and must not be reused.
- **Impact**: the historical 300-case runner (which requires a disposable DB)
  cannot be executed.
- **Safe alternative**: the 100-case suite is written against read-only access to
  the cabinet database; mutation-dependent cases are marked `BLOCKED`.

## B4 — Model quality for open-ended generation

- **Why**: MiniCPM 1B is wrong on some public facts and often copies English
  evidence into the compact synthesis; the French guard then refuses to publish
  the draft.
- **Impact**: some paraphrases retrieve the right evidence but display
  « synthèse indisponible, références consultables ».
- **Attempted**: verified public-fact cards, hybrid retrieval, original-question
  search, French reformulation guard. Publishing the rejected draft would
  violate the existing safety tests.
- **Safe alternative**: a stronger local model or a faithful translation layer,
  both outside the current approved scope.
