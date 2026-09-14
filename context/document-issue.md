# TASK: emettre-certificat
DOMAIN: documents
OBJECTIVE: Émettre un certificat du modèle v2 avec variables validées,
snapshot persisté. Preuve : checkpoint-v8 vert.
ALLOWED_FILES:
- `src/services/documents.ts` (section émission)
- `src/components/documents/FormulaireEmission.tsx`
- `src/components/documents/FeuilleDocument.tsx`
REQUIRED_CONTEXT: AGENTS.md + `docs/domains/documents.md` +
`docs/contracts/document-issue.md` + `docs/DOCUMENT-TEMPLATES-v2.md` (§ type visé).
FORBIDDEN_CONTEXT: finance, Jarvis (sauf brouillon déjà validé), agenda,
`fr.ts` entier, `STATE.md`, migrations hors `030`/`045`/`061`.
SECURITY_CONSTRAINTS: variables validées par type avant émission ; contenu
jamais inventé (règle 8) ; impression tracée ; aucune PII d'exemple recopiée.
VALIDATION: `scripts/checkpoint-v8-documents.sh` + relecture du rendu (marges).
STOP_CONDITION: checkpoint vert + document relu par la praticienne (D-22).
