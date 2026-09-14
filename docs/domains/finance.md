# Domaine finance (CURRENT)

PURPOSE: Recette cloisonnée, caisse, charges, correctifs. Périmètre : espèces,
aucune facture (ADR-010).
OWNER: `services/finance-cash.ts` (caisse) · `finance.ts` (lecture) ·
`finance-calendrier.ts` (dates).
ENTRYPOINTS: `src/app/finances/page.tsx` · `src/components/finance/` (11 fichiers).
SERVICES: `finance.ts` · `finance-cash.ts` · `finance-calendrier.ts`.
DB GATES: `record_payment_collected` (`029:392`) · période (`036`) · charges
(`038`, `041`) · caisse (`039`, `040`) · montants en lettres (`042`).
Détail : `docs/contracts/finance-cash.md`.
SECURITY: montants `integer amount_dzd` · `timestamptz` + `Africa/Algiers` ·
correction AVANT encaissement seul, `trg_audit` trace · narration IA des
chiffres INTERDITE (dette datée, ne pas rouvrir) · objectifs/aging tranchés ABSENTS.
DEPENDENCIES: patients (payeur) · agenda (séance tarifée) · documents (reçus).
TESTS: e2e `finances.spec.ts` · `scripts/checkpoint-v6-finance.sql` ·
`test-chemin-ecriture-finance.sql` · `checkpoints/finances-caisse/`.
KNOWN RISKS: `payment_due` sans lecteur · résultat net sans source (pas de table
charges-produits unifiée — ne pas inventer) · annulation = future colonne
`voided_at`, pas de DELETE.
FORBIDDEN: flottants monétaires · « net » calculé à la main · table inventée (règle 9).
