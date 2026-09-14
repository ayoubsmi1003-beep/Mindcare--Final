# Contrat — émission de documents (CURRENT)

> Source de vérité : migrations + code ci-dessous. Contenu des modèles :
> `docs/DOCUMENT-TEMPLATES-v2.md` (v2 ; remplace le v1 retiré).

## INPUT
Type (`app.doc_type` ; `'ordonnance'` = ajout Mois 2, pas encore dans l'enum) +
contexte de variables validé par type. Jamais de contenu inventé (règle 8).

## OUTPUT
Document émis (snapshot + cycle de vie, `061`), impression tracée
(`mark_document_printed`). Contenu rendu par `render_template` (échappement HTML).

## AUTHORIZATION
RLS + portes `030` (gates) + `061` (snapshot/lifecycle) + templates v2 (`045`).
Suppression interdite par trigger (`forbid_document_delete`, `030:174`) ;
document immuable (`assert_document_immutable`, `030:137`).

## DB GATE
- `app.issue_document` — `061:186` (versions antérieures `030:358`, `043:100`, `045:115`).
- `app.get_document` (`030:691`) · `list_patient_documents` (`030:765`) ·
  `mark_document_printed` (`030:847`). Signatures exactes : lire la migration.

## SIDE EFFECTS
Émission + snapshot + trace même transaction. Le checkpoint papier a changé
de nature : nouveau papier à en-tête, approbation praticienne (D-22).

## ERRORS
Enveloppe `{ ok, data | error }`. Variables manquantes = erreur nommée avant
émission. Référence d'impression exigée pour caler les marges (dette : tirage
papier de référence).

## TESTS
- `tests/e2e/documents.spec.ts`
- `scripts/checkpoint-v8-documents.sh` + `scripts/mesure-a5-documents.mjs`

## DO NOT LOAD
Finance, Jarvis (sauf `create_document_draft`), agenda, `fr.ts` entier,
`STATE.md`, migrations hors `030`/`043`–`045`/`061`.
