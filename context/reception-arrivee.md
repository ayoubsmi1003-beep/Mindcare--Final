# TASK: pointer-arrivee-accueil
DOMAIN: reception
OBJECTIVE: Marquer un RDV arrivé / non-présenté depuis le poste accueil, sans
élargir les données visibles. Preuve : checkpoint-reception vert.
ALLOWED_FILES:
- `src/services/reception.ts` (section transition)
- `src/components/reception/FileArrivees.tsx` (section ciblée)
REQUIRED_CONTEXT: AGENTS.md + `docs/domains/reception.md` +
`docs/contracts/reception-arrivee.md` + fichiers ci-dessus.
FORBIDDEN_CONTEXT: consultation, Jarvis, documents, finance (sauf périmètre),
motif/notes/recettes (non exposés par conception), `fr.ts` entier, `STATE.md`,
migrations hors `006`/`011`/`046`.
SECURITY_CONSTRAINTS: transitions via portes `046` uniquement ; aucun champ
clinique ajouté au board ; écran vide ≠ absence de données.
VALIDATION: `scripts/checkpoint-reception.sql` (contrôle 1 : contrat étroit).
STOP_CONDITION: checkpoint vert + diff limité aux fichiers autorisés.
