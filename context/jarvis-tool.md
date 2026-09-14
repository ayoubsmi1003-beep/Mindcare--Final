# TASK: modifier-outil-jarvis
DOMAIN: jarvis
OBJECTIVE: Ajouter/modifier une capacité Jarvis SANS élargir la surface
d'écriture. Preuve : eval-registre + eval-frontière verts.
ALLOWED_FILES:
- `src/services/jarvis-capacites.ts` OU `jarvis-ecritures.ts` (un seul)
- `src/services/jarvis-projections.ts` (DTO Safe si nouveau retour)
- `src/server/jarvis/routing.ts` (si nouvelle intention)
REQUIRED_CONTEXT: AGENTS.md + `docs/domains/jarvis.md` +
`docs/contracts/jarvis-tools.md` + `docs/03-JARVIS-TOOLS.md` §0+§1 (Lois).
FORBIDDEN_CONTEXT: finance, patients, documents, `jarvis-tools.ts`/`jarvis.ts`
(legacy), migrations hors `033`/`063`, `fr.ts` entier, `STATE.md`.
SECURITY_CONSTRAINTS: lecture→capacités, écriture→cycle confirm/execute +
allowlist ; egress + pseudonymisation inchangés ; jamais d'exécution directe.
VALIDATION: `scripts/eval-jarvis-registre.mjs` + `eval-jarvis-frontiere.mjs` +
`eval-jarvis-injection.mjs` si entrée libre.
STOP_CONDITION: 3 evals vertes + J2-E manuel rejoué si écriture touchée.
