# mobile/ — future application téléphone (emplacement réservé)

> Pas de code ici pour l'instant (décision : préparer seulement, pas d'échafaudage vide).
> Quand l'app téléphone naîtra (Expo/React Native probable), elle vit dans ce dossier.

## Règles non négociables (rappel — canon : `docs/00-DECISIONS.md` + `CLAUDE.md` §1)

- R1 localité (loi 18-07) : aucune donnée identifiante patient hors PC du cabinet.
- R2 pseudonymisation : tout appel externe passe par la passerelle serveur unique.
- R3 secrets : variables serveur uniquement, jamais `NEXT_PUBLIC_*`, jamais dans le repo.
- R4 propose → confirme → exécute → journalise (aucune écriture sans confirmation écran).
- R5 note clinique immuable (signature → gel, amendement visible).
- R6 audit dès J1 (qui, quoi, quand, depuis où).

## Partage avec le web (Next.js, `src/`)

- Noyau partageable SANS I/O : `src/shared/jarvis/` (routage, normalisation, lexique).
- L'app téléphone ne parle JAMAIS à Postgres en direct : elle passe par les mêmes
  portes HTTP même-origine (`/api/*`) et le même contrat (`src/i18n/fr.ts` pour les chaînes).
- Écriture métier = une porte Postgres (périmètre · verrou · transition · écriture · trace).

## Démarrage le jour J

1. Lire `AGENTS.md` (protocole L0→L6), `ARCHITECTURE.md`, `docs/00-DECISIONS.md`.
2. Créer le squelette Expo ici, brancher `src/shared/` (ou extraire `packages/shared/`).
3. Écrire d'abord `tests/` + portes `app.*`, jamais d'autorisation en JS.
