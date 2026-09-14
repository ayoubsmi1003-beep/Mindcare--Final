# Contrat — encaissement finance / caisse (CURRENT)

> Source de vérité : migrations + code ci-dessous.

## INPUT
`p_payment_id uuid` + montant encaissé (`integer amount_dzd`, jamais de flottant).

## OUTPUT
Paiement marqué encaissé + écriture de caisse, numérotation par compteur table
(jamais `SEQUENCE`).

## AUTHORIZATION
RLS + portes `029` (paiements), `036`/`039`–`041` (période, caisse, correctifs).
Correction de montant possible uniquement AVANT encaissement ; `trg_audit` trace.

## DB GATE
- `app.record_payment_collected` — `029:392` (signature exacte : lire la migration).
- Portes période/caisse/charges : fichiers `036`–`041` (noms de fonctions : voir migrations).
- Montants : `integer amount_dzd`. Dates : `timestamptz`, bornes `Africa/Algiers`.

## SIDE EFFECTS
Écriture + trace audit même transaction. Narration IA des chiffres INTERDITE
(`finance.ts` refuse ; dette datée DOC-AUTHORITY §4 — ne pas rouvrir).

## ERRORS
Enveloppe `{ ok, data | error }`. Conflit d'état (déjà encaissé) = erreur nommée,
pas d'exception brute.

## TESTS
- `tests/e2e/finances.spec.ts`
- `scripts/checkpoint-v6-finance.sql` (+ `checkpoints/finances-caisse/`)

## DO NOT LOAD
Patients, Jarvis, consultation, documents, agenda, `fr.ts` entier, `STATE.md`.
`SPRINT-V1.md` §V4/V6 = historique (objectifs financiers tranchés ABSENTS).
