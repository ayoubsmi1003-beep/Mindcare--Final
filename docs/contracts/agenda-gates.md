# Contrat — agenda / rendez-vous (CURRENT)

> Source de vérité : migrations + code ci-dessous.

## INPUT
Lecture : `p_day date` / plage. Écriture : patient + praticien + créneau
(`Africa/Algiers`) ; annulation : `p_motif` obligatoire.

## OUTPUT
`list_agenda` : journée/semaine du cabinet. Transitions d'état gardées
(`assert_appointment_transition`, `022:445`) : prévu → confirmé → honoré,
ou annulé / non-présenté.

## AUTHORIZATION
RLS + portes `022` (gates) + `025` (approbation). Chevauchement non bloqué
(dette datée : `btree_gist` + `EXCLUDE`, mois 2 — jamais de vérif JS).

## DB GATE
- `app.list_agenda` — `022:99` (redéfinie `025:122`).
- `app.get_appointment` (`022:176`) · `create_appointment` (`022:239`) ·
  `update_appointment` (`022:313`) · `cancel_appointment` (`022:383`) ·
  `confirm_appointment` (`025:62`). Signatures exactes : lire la migration.

## SIDE EFFECTS
Création/transition + trace même transaction. Arrivée/no-show = portes
réception (`046`), pas l'agenda.

## ERRORS
Enveloppe `{ ok, data | error }`. Transition illégale = erreur nommée.
Créneau pris annoncé AVANT la carte (pas de clic vers un échec).

## TESTS
- `tests/e2e/agenda.spec.ts`
- `scripts/checkpoint-s4.sh` (module Agenda, portes, deux murs)

## DO NOT LOAD
Finance (sauf tarif), Jarvis, documents, `fr.ts` entier, `STATE.md`,
migrations hors `022`/`025`/`046`.
