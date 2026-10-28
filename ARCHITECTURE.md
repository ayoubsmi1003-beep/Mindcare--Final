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
| Portes connaissance (tests unitaires : payloads string) | `ligneValide` écartait `Date` (ligne jugée malformée) | node-pg rend `timestamptz` en `Date` → corpus approuvé INVISIBLE sur substrat réel (trouvé R3-D, aurait rendu R3 aveugle) | corrigé : `normaliserHorodatage` (service, frontière pg) + 2 tests Date (connaissance-service.test.ts) |
| `stockage.ts` historique proposé | ajoutait `p_inclure_historique` aux deux RPC | PostgreSQL local et migrations 092/093 : signatures à 3 et 2 paramètres, aucun paramètre historique | corrigé le 2026-09-30 : signatures installées exactes ; historique explicitement refusé ; migrations inchangées ; preuve `alexa-knowledge-gates.test.ts` |
| Workspace 053 : champ optionnel `resume` | Workspace 089 omet ce champ | Résumé sauvegardé absent du workspace ; checkpoint PostgreSQL 21 contrôles PASS | Lecture auditée `get_alexa_case_summary` ajoutée par 121, appliquée ; migrations antérieures immuables ; persistance UI après actualisation PASS |
| Historique fournisseur Alexa des 2–3 octobre | `model-policy.ts` / `external-call.ts` : OpenRouter `:free` 0/0, quotas gratuits Gemini/Groq confirmés, déploiement synthétique vérifié, 2 tentatives bornées | Fournisseurs synthétiques PASS ; navigateur authentifié PARTIAL, bascules avec timeouts observées ; aucune preuve acoustique. La continuation globale est demandée explicitement | Plans `2026-10-04-alexa-free-routing.md` et `2026-10-05-alexa-rag-browser.md` ; conserver refus policy/auth et annulation ; but global incomplet |
| RAG Alexa disponible dans l’audit logiciel | Porte lexicale protégée : scan source avant prédicat plein texte ; passages >4000 exclus dans Alexa | Navigateur FAIL puis diagnostic réel Hamilton 104556 ms. Migration 123 revue/appliquée localement : rôle sans login/bypass, RLS cabinet conservée, prédicat restrictif GIN ; répétitions 229/138 ms, garde 113 migrations PASS. Retrieval navigateur rétabli mais extraits seuls insuffisants | Synthèse C4 issue des seuls livres approuvés/figés, aucune question brute ni identité ; inférences explicitement à vérifier avec citations littérales visibles. Nouvelle réception navigateur en cours ; gel hybride inchangé |

| `docs/domains/connaissance-provenance-contract.md` (ADR-040) | fichier **absent** du dépôt ; `docs/domains/` ne contient ni `connaissance` ni `knowledge` | ADR-040 référence une proposition « approuvée » qui n'existe pas sur disque | **à recréer ou ADR-040 à corriger** (décision humaine) — signalé le 2026-10-20 pendant l'ingestion Stahl |
| Chargeurs DSM (`charger-connaissance-corpus-dsm.mjs`) et Taylor v2 (`charger-connaissance-corpus-taylor-v2.mjs`) | `ON CONFLICT (id) DO UPDATE SET … statut = EXCLUDED.statut` | le pipeline écrit toujours `inactive` : **rejouer le chargeur après activation rétrograde les chunks actifs en `inactive`** (la source reste `active` avec 0 chunk actif → le livre disparaît de la recherche) | **signalé le 2026-10-20, non corrigé** (hors périmètre de l'ingestion Stahl). Le chargeur Stahl (`charger-connaissance-stahl.mjs`) est NON rétrogradeur (`CASE WHEN statut = 'active' THEN 'active' ELSE 'inactive' END`) |
| `MOTS_VIDES` (`src/server/knowledge/rerank.ts`) | liste de mots vides **française, arabe et anglaise** — vérifié le 2026-10-28 | la porte lexicale est un AND (`plainto_tsquery`) : un mot-outil **anglais** résiduel (`is`, `are`, `does`) rend toute correspondance impossible sur un livre anglais. Mesure Stahl 7e (100 questions réelles) : MRR 0,133 → 0,378 avec le correctif. **Même constat sur le livre Maudsley déjà actif** | **patch appliqué** (le code contient bien la liste anglaise) ; l'entrée qui le disait « non appliqué » était périmée — corrigée le 2026-10-28 |
| Dérive de migrations : 12 fichiers `159_alexa_*` … `170_alexa_reminder_context` sur le disque, **non appliqués** en base | `scripts/snapshot-production.mjs` **refuse** de figer la base (« Migrations source et disque incohérentes ; aucune migration appliquée ») — comportement fail-closed **correct** | l'instantané de production est **indisponible** tant que ces 12 migrations ne sont pas appliquées (travail en cours d'une autre session) ; l'ingestion Stahl dispose d'un **retour arrière circonscrit et vérifié** : `scripts/rollback-connaissance-stahl.mjs --verifier --socket` (exécute puis ROLLBACK, état restauré à l'identique) |
| `src/server/alexa/knowledge-query.ts` `BOOKS` | **trois** titres approuvés (DSM-5, Maudsley, Stahl 7e) ; garde `stahl → null` retiré ; `matchesRequestedBook()` refuse toujours toute source hors liste | un 3ᵉ livre actif en base était **invisible** pour l'Alexa ; l'invariant à deux livres était encodé dans `tests/unit/alexa-final-two-books.test.ts` | **corrigé le 2026-10-28** (ADR-041 appliqué) : `BOOKS` à trois titres, test de gouvernance réécrit, livre inconnu toujours refusé |
| `src/server/knowledge/editions.ts` `EDITIONS` | **deux** ouvrages seulement (DSM-5, Maudsley) | une preuve Stahl n'obtenait ni `bookId` ni page : `preuveAffichable()` refuse la localisation faute d'identité bibliographique, alors que le marqueur `[stahl… p.NNN\|src:NNN]` est présent dans **3 076/3 076** chunks — la page existait dans l'artefact et disparaissait à l'affichage | **corrigé le 2026-10-28** : Stahl ajouté (book_id, 7ᵉ éd., 2021, version épinglée) ; test de dérive `book.json` étendu aux trois ouvrages ; page vérifiée (`p. 2073`, `p. 2375`) |

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
