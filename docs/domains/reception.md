# Domaine réception / accueil (CURRENT)

PURPOSE: Poste de l'assistante (D-08) : arrivées, no-show, encaissements
assistante, demandes web — SANS accès clinique.
OWNER: `services/reception.ts` (ne requête AUCUNE table : porte `reception_board`
+ 2 transitions, contrat étroit figé).
ENTRYPOINTS: `src/app/tableauDeBord/page.tsx` (vue `CockpitReception` si
`role === "assistant"`, sinon `TableauDeBordPraticienne` — affichage seul) ·
`src/components/reception/` (17 fichiers).
SERVICES: `reception.ts`.
DB GATES: `app.reception_board(p_day)` (`046:255`, 3 files : journée/demandes/
paiements) · `mark_appointment_arrived` (`046:84`) · `mark_appointment_no_show`
(`046:141`) · `mark_notification_read` (`046:193`) ·
`assert_payment_columns_for_assistant` (`046:423`).
SECURITY: ZÉRO décision d'autorisation en JS (en-tête du service) · porte DEFINER
`app_gatekeeper`, policies `006`/`011` décident · motif de consultation et notes
EXCLUS par conception (ADR-017) · champs visibles = champs autorisés (ADR-005,
garanti par le TYPE) · l'assistante n'encaisse pas au-delà de son périmètre (D-13).
DEPENDENCIES: agenda (RDV) · patients (identité admin seule) · finance (paiements 24 h).
TESTS: `scripts/checkpoint-reception.sql` (contrôle 1 : contrat étroit) ·
`scripts/mesure-reception.mjs`.
KNOWN RISKS: écran vide = rien de VISIBLE, jamais rien (ne pas confondre) ·
`demandes` web 60 jours (`requested`).
FORBIDDEN: lire motif/notes/recettes depuis ce poste · SELECT hors portes ·
`if (role)` comme autorisation · élargir les 3 files sans porte.
