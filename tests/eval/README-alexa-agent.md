# Alexa qualification: French and Arabic

The native path remains off by default. A successful SQL or unit run does not qualify the model, browser or voice.

Use only a disposable PostgreSQL database named `alexa_eval` or `alexa_eval_*`, on loopback, outside the cabinet's port 55441. Prepare its schema using the existing bootstrap and migrations through 161, with reference catalogues/templates available. Do not restore patient data from the cabinet. The historical synthetic-cohort migration requires its reference catalogue prerequisites; a schema-only copy from an already validated synthetic database is also suitable.

From the repository root, set `MINDCARE_ALEXA_EVAL_ADMIN_URL` explicitly to that disposable database's administrative connection, then run:

```powershell
node scripts/seed-alexa-agent-fixture.mjs --check
node scripts/seed-alexa-agent-fixture.mjs
node scripts/check-alexa-agent-sql.mjs
```

The seed refuses non-synthetic patients, inserts fixed synthetic IDs without overwriting existing rows, and never creates, drops or clones a database. SQL checkpoints run their business changes inside transactions that are rolled back. The fixture clock is frozen in `alexa-agent-cases.json`; expected counts are independently recorded in `alexa-agent-fixture.json`. Fixture login credentials are synthetic and must only be used in this isolated database.

Set `MINDCARE_ALEXA_EVAL_DATABASE_URL` explicitly to the same isolated database using the application role. Keep Gemini voice off for text evaluation. The existing pinned MiniCPM assets must be present with protected ACLs in `.cache/alexa/minicpm`.

```powershell
node scripts/eval-alexa-agent.mjs --cases 2-fr,2-ar,21-fr,21-ar --out .eval-out/alexa-agent/report.json
```

Omit `--cases` to select all cases. The runner reports multi-turn, endpoint, browser and natural-voice cases as NOT RUN when their dedicated acceptance harness is needed; this is an explicit incomplete gate. Current model qualification is FAIL. There is no fresh pre-implementation end-to-end baseline, so improvement percentages cannot be claimed.

The evaluator keeps requested-part identification, outcome accounting and material-filter preservation separate from tool choice. Scenarios 21, 23, 24 and 25 require semantic matching against the independent manifest; ledger length alone does not pass. Compound predicates must reach one typed database query together.

For HTTP/browser checks, start a separate loopback app process with its database URL explicitly set to the synthetic database, `ALEXA_NATIVE_AGENT_ENABLED=1`, and voice off. Never enable the cabinet's native path or apply its migrations as part of fixture testing. Browser rendering, microphone admission, Gemini provider quality, playback, installed packaging and clinician acceptance remain separate release gates.
