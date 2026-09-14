# Contrat — arrivée / no-show à l'accueil (CURRENT)

> Source de vérité : `046_reception_gates.sql` + `services/reception.ts`.

## INPUT
`p_id uuid` (rendez-vous du jour). Aucune donnée clinique requise ni acceptée.

## OUTPUT
Transition `prévu → arrivé` ou `→ non-présenté`, tracée. Board relit les 3 files.

## AUTHORIZATION
RLS + portes `046`. L'assistante ne voit que les champs administratifs (TYPE) ;
ne touche ni motif, ni notes, ni recettes.

## DB GATE
- `app.mark_appointment_arrived` — `046:84`.
- `app.mark_appointment_no_show` — `046:141`.
- Lecture : `app.reception_board` — `046:255` (3 files, contrat figé).
- Garde colonnes paiement : `046:423`. Signatures exactes : lire la migration.

## SIDE EFFECTS
Transition + trace même transaction. Encaissement assistante : périmètre D-13
uniquement, jamais au-delà.

## ERRORS
Enveloppe `{ ok, data | error }`. RDV hors journée/périmètre = erreur nommée,
pas d'écran vide ambigu.

## TESTS
- `scripts/checkpoint-reception.sql`
- `scripts/mesure-reception.mjs`

## DO NOT LOAD
Consultation, Jarvis, documents cliniques, finance (sauf lecture périmètre),
`fr.ts` entier, `STATE.md`, migrations hors `006`/`011`/`046`.
