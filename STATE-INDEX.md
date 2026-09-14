# STATE-INDEX.md — où on en est (≤ 80 lignes, périssable)

> Snapshot du 2026-09-06 depuis `STATE.md` (2 232 l., journal actif d'une session
> en cours — **ne pas lire en tâche courante**). Mettre à jour à chaque session,
> jamais empiler.

## OÙ ON EN EST

Phase bureau Windows livrée (étapes 1-9, preload CommonJS corrigé). Base locale
embarquée (ADR-001 exécuté : `pg`, plus de `supabase-js`). Domaine traitements
versionné (ADR-028). Session active « fixtures enrichies » : patients
synthétiques renommés (`086`) + purge étendue (`087`).

## VÉRIFIÉ

85 fichiers de migration (`001`–`087`, trous volontaires `031`/`035`) · RLS décide,
portes `DEFINER` cloisonnées · egress unique vérifié (11 `fetch`, tous légitimes) ·
0 secret `NEXT_PUBLIC_*` · checkpoints patients/finance/documents verts ·
boucle vocale prouvée (latence modèle 5–180 s).

## CASSÉ / RISQUE

Écritures Jarvis non prouvées en prod (J2-E T1–T5 ROUGE) · `014 run_purges()`
propriété `postgres` (durcir) · `016` exception `TO PUBLIC` (justifier) ·
`fetch` dans 3 routes jarvis (auditer, Phase 3) · `if (role)` affichage à marquer ·
`.mcp.json` SUPPRIMÉ en 3B (tronqué + mauvais projet, 0 consommateur) ·
`db-migrate.sh` CONSERVÉ (3B bloqué : une autre session l'améliore en ce moment,
+31 staged — décision humaine requise avant tout retrait) ·
tests d'intégration en skip silencieux possible.

## EN COURS

Reset intelligence dépôt : Phases 0–3B closes (verdict YELLOW, 0 changement sécu).
Phase 4 (contexte IA) exécutée le 2026-09-06 : `docs/contracts/` (4) +
`docs/domains/` (5) + `context/` (4) + `tests/MAP.md`.
Ne pas mélanger avec les ~67 fichiers modifiés non stagés de l'arbre (travail autre).

## NEXT

Décisions humaines D2 (`db-migrate.sh` conservé, autre session active) / D3
(re-bascule `cloud-dev`) / D4 (durcissement audit) — voir `ARCHITECTURE.md` § Écarts.
Domaines REPORTÉS (README à créer après passe de vérification) : réception,
auth, Electron (agenda + documents couverts en Phase 6).

## NE PAS TOUCHER

`STATE.md` · migrations appliquées · `docs/archive/` (hook) ·
secrets (`.env` illisible au terminal).

## DÉRIVE DOC CONNUE

Prose « 87 migrations » = 85 fichiers (`verifier-base.mjs:172` lit le disque,
le disque fait foi) · `DOC-AUTHORITY` D-17 cloud dépassé · `SESSION-*` et
`WORKING-CONTEXT` décrivent l'app Supabase morte (archivage = op humaine).
