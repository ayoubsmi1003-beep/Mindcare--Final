# TASK: diagnostiquer-demarrage-bureau (investigation, aucune modification attendue)
DOMAIN: electron
OBJECTIVE: Nommer pourquoi le paquet ne passe pas BOOTING→READY (pg ?
migrations ? backend ? sonde ?), sans modifier le runtime.
Preuve : étape fautive + message exact.
ALLOWED_FILES: (aucun — investigation seule ; tout correctif = nouveau périmètre)
REQUIRED_CONTEXT: AGENTS.md + `docs/domains/electron.md` +
`electron/main/orchestrateur.ts` (en-tête + étape fautive) + `etat-demarrage`
+ réponse `/api/health` si backend joint.
FORBIDDEN_CONTEXT: portes métier, Jarvis, migrations (lecture seule du constat,
jamais d'application), `fr.ts` entier, `STATE.md`, secrets/URLs de base.
SECURITY_CONSTRAINTS: ne jamais afficher `MINDCARE_DATABASE_URL`/`PGPASSWORD` ;
ne pas contourner les refus de démarrage ; ne pas « réparer » un schéma.
VALIDATION: `scripts/verifier-paquet.mjs` + unit `electron-etat-demarrage` /
`electron-pg-cluster` si ciblés (sinon NOT RUN).
STOP_CONDITION: étape fautive nommée (BOOTING/…/READY/FAILED) + cause exacte,
OU escalade avec journal.
