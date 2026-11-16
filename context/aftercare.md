# TASK: Aftercare master — clinic slice1
DOMAIN: aftercare
OBJECTIVE: authorized assignment/publication, explicitly shared patient submissions,
human read/review/reply, versioned consent/binding and authenticated V2 delivery.
SCOPE: approved schema doc, forward227, SQL clinical/technical gates, DbPort
service/types, generated clinical RPC allowlist, synthetic native-PG/Vitest checks.
ENTRYPOINT: docs/aftercare/ADR-aftercare-master.md; shared website MASTER-CONTRACT.
STOP_CONDITION: source candidate + isolated SQL/service evidence and slice1 report.
FORBIDDEN: live DB, installed app, .env, ProgramData, migrations001–226, fr.ts,
STATE.md, archive, automatic EMR insertion, medication changes, inference.
DEFERRED: UI/dossier tab, HTTP/HMAC/egress transport, source report-content fetch,
real activation, installed app, full two-app acceptance.
VALIDATION: checkpoint-aftercare.mjs (fresh disposable native PG only), aftercare
unit suite, targeted lint, main/test typechecks. No existing database URL accepted.
