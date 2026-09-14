# Domaine documents (CURRENT)

PURPOSE: Certificats et documents à en-tête, modèles v2, impression tracée.
OWNER: `services/documents.ts`.
ENTRYPOINTS: `src/app/documents/page.tsx` · `src/components/documents/`
(`FormulaireEmission`, `FeuilleDocument`, `ListeDocuments`, …) ·
`parametres/documents/` (réglages + print, `062`).
SERVICES: `documents.ts`.
DB GATES: `issue_document` (`061:186`) · `get_document` (`030:691`) ·
`list_patient_documents` (`030:765`) · `mark_document_printed` (`030:847`) ·
`render_template` (`030:255`). Détail : `docs/contracts/document-issue.md`.
CONTENU: `docs/DOCUMENT-TEMPLATES-v2.md` (4 certificats, fautes corrigées D-22 ;
nom/n° d'ordre/téléphone saisis sur l'instance, jamais commités).
SECURITY: suppression interdite (trigger) · immuabilité · snapshot+lifecycle ·
contexte de variables validé par type (règle 8) · brouillon Jarvis = `create_document_draft`
(contrat variables, cf. contrat Jarvis).
DEPENDENCIES: patients · consultation (ordonnances Mois 2) · Jarvis (brouillon).
TESTS: e2e `documents.spec.ts` · `scripts/checkpoint-v8-documents.sh` ·
`scripts/mesure-a5-documents.mjs` · `checkpoints/v8-preuves/`.
KNOWN RISKS: marges calées sur tirage papier de référence (dette) · `'ordonnance'`
absent de l'enum (Mois 2) · PII d'exemple dans le doc de templates (ne pas copier).
FORBIDDEN: DELETE (trigger) · contenu inventé · impression non tracée.
