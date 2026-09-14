# TASK: corriger-graphique-caisse
DOMAIN: finance
OBJECTIVE: Le panneau d'évolution affiche les montants encaissés corrects
(entiers DZD, bornes Africa/Algiers). Preuve : checkpoint-v6 vert.
ALLOWED_FILES:
- `src/services/finance-cash.ts` (section lecture)
- `src/components/finance/PanneauEvolution.tsx`
- `src/components/ui/Graphes.tsx` (section ciblée)
REQUIRED_CONTEXT: AGENTS.md + `docs/domains/finance.md` +
`docs/contracts/finance-cash.md` + fichiers ci-dessus.
FORBIDDEN_CONTEXT: patients, Jarvis, consultation, documents, écritures `029`
(sauf lecture), `fr.ts` entier, `STATE.md`, narration IA des chiffres (INTERDITE).
SECURITY_CONSTRAINTS: lecture seule ; aucun changement de porte ; montants entiers.
VALIDATION: `scripts/checkpoint-v6-finance.sql` + test navigateur ciblé si UI.
STOP_CONDITION: checkpoint vert + montants vérifiés sur 2 périodes.
