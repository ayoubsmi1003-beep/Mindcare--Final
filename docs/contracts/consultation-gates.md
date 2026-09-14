# Contrat — portes consultation (CURRENT)

> Source de vérité : migrations + code ci-dessous.

## INPUT
`p_id uuid` (consultation), `expected_version` pour les transitions (anti-conflit).

## OUTPUT
Consultation ouverte → tenue (notes SOAP + dictée) → fermée. Fermeture exige un
tarif (`037`). Note signée/verrouillée (`locked_at`) = intouchable (`008`) ;
correction = amendement, jamais d'UPDATE.

## AUTHORIZATION
RLS + portes `026` (gates), `024` (kind). Transcription/dictée : audio jamais
sur disque (ADR-009) ; `DicteeChamp` insère dans la rubrique SOAP ciblée.

## DB GATE
- `app.close_consultation` — `037:56` (signature exacte : lire la migration ;
  version antérieure `026:307`).
- Notes : `008` (immuabilité). Historique : `app.get_patient_notes_history` (`065:82`).

## SIDE EFFECTS
Fermeture + tarif + trace même transaction (`FOR UPDATE` sur la consultation).
Analyse de séance (`analyze_session`) : LLM après pseudonymisation, latence
modèle 5–180 s (pas un bug d'UI).

## ERRORS
Enveloppe `{ ok, data | error }`. Note verrouillée : erreur nommée imposant
l'amendement. Version inattendue : conflit `40001`.

## TESTS
- `tests/e2e/consultation-sans-notes.spec.ts`, `critical-chain.spec.ts`
- `tests/unit/` : `dictee-chaine`, `regles-dictee`, `insertion-dictee`, `resume-chronologie`
- `scripts/checkpoint-clinique-http.mjs`
- `scripts/checkpoint-s5.sh` (séance, note clinique, verrou juridique)

## DO NOT LOAD
Finance, Jarvis (sauf `analyze_session`), documents, agenda, `fr.ts` entier,
`STATE.md`, `consultation/[id]/page.tsx` entier (lire la section ciblée).
