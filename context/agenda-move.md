# TASK: deplacer-rendez-vous
DOMAIN: agenda
OBJECTIVE: Déplacer un RDV vers un créneau libre, transition gardée, sans
double-booking silencieux. Preuve : checkpoint-s4 vert.
ALLOWED_FILES:
- `src/services/appointments.ts` (section transition)
- `src/app/agenda/[id]/page.tsx`
- `src/components/GrilleSemaine.tsx` (section ciblée)
REQUIRED_CONTEXT: AGENTS.md + `docs/domains/agenda.md` +
`docs/contracts/agenda-gates.md` + fichiers ci-dessus.
FORBIDDEN_CONTEXT: finance (sauf lecture tarif), Jarvis, documents, patients
(sauf `get_patient` si affichage), `fr.ts` entier, `STATE.md`,
migrations hors `022`/`025`.
SECURITY_CONSTRAINTS: transition via portes uniquement ; créneau vérifié côté
porte (`check_slot_available`), jamais calculé en TS ; annulation motivée.
VALIDATION: `scripts/checkpoint-s4.sh` (ciblé) + `tsc --noEmit` si TS touché.
STOP_CONDITION: checkpoint vert + aucun RDV chevauchant créé en test.
