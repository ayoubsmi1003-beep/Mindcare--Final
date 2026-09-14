# Domaine agenda (CURRENT)

PURPOSE: Prise de RDV, semaine praticienne, confirmations, annulations motivées.
OWNER: `services/appointments.ts`.
ENTRYPOINTS: `src/app/agenda/page.tsx` · `nouveau/` · `[id]/` ·
`src/components/GrilleSemaine.tsx`.
SERVICES: `appointments.ts`.
DB GATES: `list_agenda` (`022:99`, `025:122`) · `get/create/update/cancel_appointment`
(`022:176/239/313/383`) · `confirm_appointment` (`025:62`) · transitions (`022:445`).
Détail : `docs/contracts/agenda-gates.md`.
SECURITY: RLS + portes ; annulation motivée ; arrivée/no-show = réception (`046`),
jamais l'agenda ; chevauchement non bloqué (dette, pas de vérif JS).
DEPENDENCIES: patients · consultation (séance) · finance (tarif) · réception.
TESTS: e2e `agenda.spec.ts` · `scripts/checkpoint-s4.sh`.
KNOWN RISKS: `update_appointment(p_changes text)` — charge sérialisée, lire la porte
avant usage · `appointment_synthetic_flag` (`023`) en cloud-dev.
FORBIDDEN: double-booking masqué côté client · RDV sans patient/praticien ·
modification d'un RDV honoré (transition gardée).
