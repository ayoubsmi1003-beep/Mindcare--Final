# AUTONOMOUS_BLOCKERS

Only genuine external or human-approval blockers are listed here.

## B1 — No Git binary

- **Why**: `git.exe` is absent from PATH and from the usual install locations.
- **Impact**: no `git status`, `git diff`, `git commit`, no clean rollback.
- **Attempted**: `where.exe git`, `C:\Program Files\Git`,
  `C:\Program Files (x86)\Git`, `%LOCALAPPDATA%\Programs\Git`, Chocolatey bin.
- **Safe alternative**: the source tree is edited in place; every changed file is
  listed in the final report. A source snapshot can be produced before further
  edits. The user may install Git for Windows to restore commit/diff.

## B2 — Writing to `C:\Program Files` / `%ProgramData%\MindCare`

- **Why**: the current account is denied on `%ProgramData%\MindCare\mindcare.env`
  and on the installed application directory; elevation is required.
- **Impact**: the installed application cannot be updated by this session.
- **Authorization**: the user explicitly chose “build + verify, stop before
  install”.
- **Safe alternative**: build and verify the bundle; hand the exact elevated
  command to the user.

## B3 — Creating a disposable evaluation database

- **Why**: the user forbids creating or cloning a database; the existing
  `alexa_eval*` containers are stopped and must not be reused.
- **Impact**: the historical 300-case runner (which requires a disposable DB)
  cannot be executed.
- **Safe alternative**: the 100-case suite is written against read-only access to
  the cabinet database; mutation-dependent cases are marked `BLOCKED`.

## B4 — Model runtime for 100 end-to-end turns

- **Why**: 45–60 s per model turn on this CPU; 100 turns would exceed a single
  bounded run.
- **Impact**: the 100-case suite will be executed in bounded batches; cases not
  reached are recorded as `NOT RUN`, never as `PASS`.
- **Safe alternative**: deterministic retrieval cases run without the model;
  model cases run in small batches.
