# ARCHITECTURE.md — ce que le dépôt EST (≤ 150 lignes)

> Réalité vérifiée le 2026-09-06 (`rg` + lecture ciblée). En cas de doute :
> migrations + code > ce fichier. Détail historique : `docs/00-DECISIONS.md` (gelé).

## COUCHES (réel, imposé par ESLint — 0 violation bloquante)

`UI` (`app/*/page.tsx`, `components/*` — importe `@/services/*`, jamais `@/server/*`)
→ `Services` (45 : métier + `jarvis-*`×12 + voix) → `DbPort`
(`services/db/port.ts` : `select`/`rpc`/auth/provision)
→ `httpDbPort` (`services/db/http.ts`, `fetch` même-origine `/api/*`, cookie httpOnly)
→ `/api/db|auth|jarvis|health` (13 routes, pas de `/v1/`)
→ `frontiere.ts` (Zod + `allowlist.generated.ts`, 74 RPC générés)
→ `withCaller/withAuthGate/withEgressGate` (GUC, `SET LOCAL ROLE`, `DISCARD ALL`)
→ `PgDataPort` (`server/db/pgPort.ts`) → portes `app.*`
(165 fonctions, RLS décide, `FOR UPDATE` ×45, `trg_audit`)
→ Kernel Jarvis (`server/jarvis/*`, sans I/O) → egress UNIQUE
(`server/egress/external-call.ts`) → OpenRouter / Groq / ElevenLabs.

## ÉCARTS DOCUMENTÉS (déviations assumées, pas des bugs)

- **D2 Écritures :** routes `/api/*` internes, PAS de Server Actions
  (`"use server"` = 0 dans `src/`). `CLAUDE.md` §2 corrigé ; mention
  « Server Actions » de `DOC-AUTHORITY` §2 en attente humaine.
- **D3 Sortie :** `src/server/egress/external-call.ts` (pas `_shared/`).
  Seul import `pg` (valeur) : `src/server/db/pool.ts`.
- **D8 `DbPort` :** `select`/`rpc`/auth/provision (pas `query`/`rpc`/`paginate`).
- **Registre Jarvis :** 16 lectures + 6 écritures (`capacites`/`ecritures`,
  cycle propose→confirm→execute→verify→log) ; `jarvis-tools.ts` + `jarvis.ts`
  = legacy (retraite Phase 5, pas de suppression aveugle).

## INVARIANTS (rappels — canon : `CLAUDE.md` §1 + migrations)

1 écriture = 1 porte (périmètre · verrou · transition · écriture · trace) ·
compteur table, jamais `SEQUENCE` · `timestamptz` + bornes `Africa/Algiers` ·
`amount_dzd` entier · `confirmed_at` AVANT exécution · `SELECT` clinique direct
révoqué (`search/get_patient`) · audio jamais sur disque · pseudonymisation
avant tout appel externe (`server/jarvis/pseudonymize.ts`).

## ÉCARTS EN ATTENTE (notés, non réconciliés)

| DOCUMENT | CODE | RÉALITÉ VÉRIFIÉE | ACTION |
|---|---|---|---|
| `DOC-AUTHORITY` D-17 (dev Supabase Cloud) | pg embarqué, `resources/pgsql`, `070_local_auth`, commit `e841955` | base locale | ratification humaine |
| Prose « 87 migrations » | 85 fichiers sur disque | `verifier-base` lit le disque | corriger la prose (hors `STATE.md`) |
| `01-SCHEMA.md` (intention) | 85 migrations + fix-chains | migrations font foi | régénérer (Phase 4+) |
| `02` §5 modèles cités | `env.ts` + `OPENROUTER_MODEL` | à vérifier | Phase 3 |
| `SESSION-*`, `WORKING-CONTEXT` | app locale actuelle | docs morts | archivage humain |
| Re-bascule → `cloud-dev` d'une base réelle | trigger `assert_synthetic` ne requalifie pas le passé (`016:246-248`) | écritures futures barrées, lignes existantes non vérifiées | ne JAMAIS rebasculer ; futur : garde anti-retour (décision humaine, 3B-D3) |
| `audit_append` / `nom_recherche` TO PUBLIC | risque LOW vérifié (Phase 3) | inchangés en 3B | durcissement = migration dessinée, jamais de grep-chasse (décision humaine, 3B-D4) |

## CHIFFREMENT (état, pas intention — REQUIRED = constitution)

| Mesure | Statut | Preuve |
|---|---|---|
| Sauvegarde chiffrée | PARTIAL (mécanisme existant, phrase optionnelle) | `scripts/backup.sh` (GPG AES256 si `BACKUP_PASSPHRASE`, sinon avertissement) + `scripts/sauvegarde.mjs` |
| Chiffrement at-rest base | UNKNOWN (non vérifié ici) | aucune trace `pgcrypto`/TDE dans les migrations |
| Chiffrement champs sensibles / map pseudo | UNKNOWN (non vérifié ici) | — |
| Full-disk hôte clinique | REQUIRED, UNKNOWN côté dépôt (config machine) | — |

## POINTEURS (Phase 4)

Domaines : `docs/domains/` · Contrats : `docs/contracts/` · Manifestes :
`context/` · Tests : `tests/MAP.md` · Scripts : `scripts/README.md` ·
Portes : `supabase/migrations/` (+ `MIGRATION-INDEX.md` à générer).
