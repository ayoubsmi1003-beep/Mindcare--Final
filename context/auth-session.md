# TASK: diagnostiquer-session (investigation, aucune modification attendue)
DOMAIN: authentication
OBJECTIVE: Comprendre pourquoi une ouverture/fermeture de session échoue,
sans toucher auth, RLS ni secrets. Preuve : cause nommée + test ciblé.
ALLOWED_FILES: (aucun — investigation seule ; tout correctif = nouveau périmètre)
REQUIRED_CONTEXT: AGENTS.md + `docs/domains/authentication.md` +
`src/services/auth.ts` (57 l.) + route concernée + `070` (§ porte concernée).
FORBIDDEN_CONTEXT: portes métier, Jarvis, finance, documents, `fr.ts` entier,
`STATE.md`, `.env` (illisible — hook), mots de passe en clair où que ce soit.
SECURITY_CONSTRAINTS: ne jamais journaliser e-mail/jeton ; ne pas désactiver
`limite-debit` ; ne pas contourner `withCaller` pour « tester ».
VALIDATION: `tests/integration/auth-locale.test.ts` si base dispo (sinon NOT RUN,
jamais PASS) + contrôles 11–12 `preflight.sh`.
STOP_CONDITION: cause racine nommée (code d'erreur exact) OU escalade avec preuves.
