# STATE — MindCare OS
Dernière mise à jour : 2026-07-29 · Phase 1, tâche T1 (Fondations)

## Fait & vert
- [x] Ingestion du corpus (16 documents, ~290 Ko) · 24 contradictions relevées, 11 divergences
      HTML ↔ documents. Trace complète dans le plan de session.
- [x] `WORKING-CONTEXT.md` — **9 994 octets** (plafond 10 Ko). 20/20 invariants, 25 tokens
      couleur, 3 litiges. Seul contexte reçu par les agents.
- [x] `.claude/agents/` — 5 agents : `services-builder`, `ui-builder` (Sonnet 5),
      `security-reviewer` (Opus 5), `checkpoint-runner`, `scribe` (Sonnet 5).
- [x] `.claude/commands/` — `/task`, `/checkpoint`, `/preflight`, `/handoff`. **Actives.**
- [x] `.claude/settings.json` — deny-list + hooks `guard-bash.sh` (PreToolUse Bash) et
      `preflight.sh` (PostToolUse Write|Edit).

## En cours
- T1.0 terminé. **Bloqué sur un redémarrage de Claude Code** : les agents ne sont chargés
  qu'au démarrage (`06-EXECUTION.md` §2). Les 5 fiches existent sur disque, la session ne les
  voit pas. Sans redémarrage, T1.1 devrait être écrit par la session principale — interdit
  par `06-EXECUTION.md` §9.3.

## Décisions prises (à reporter dans 00-DECISIONS.md)
- **D1 · Autorité** : `00-DECISIONS` > `01-SCHEMA` > `02-SECURITY` > `03`–`06` >
  `MindCare-Domain-*` > `Constitution` > `Features.md` > HTML. Tranche 16 contradictions.
- **D2 · Architecture** : navigateur → Supabase avec `ANON_KEY`, la RLS est la frontière.
  Pas de serveur REST. I3 tenu par une couche `src/services/*` obligatoire.
- **D3 · Périmètre** : T1 → T5, stop après Agenda. `05-BUILD-PLAN`/`06-EXECUTION` = référence,
  pas calendrier.
- **D4 · Non délégué** : migrations, RLS, auth, audit, `ConfirmationGate`, numérotation écrits
  à la main. Pas d'agent `db-migrator`. Modèles `haiku` relevés à Sonnet 5.
- Conséquences de D1 — hors Phase 1 : `invoices` (ADR-010) · `domain_events` ·
  `appointment_requests` · rôle `admin` · cycle d'émission d'ordonnance · consentements
  structurés · détection de risque (ADR-015). Auth = Supabase GoTrue.

## Points ouverts — bloquent T2
- **Q-A** Motif de consultation : la policy assistante accorde `FOR ALL` sur la table
  `app.appointments` ; `reason` n'est protégé que par une vue et une convention de code.
  Contradiction interne à `01-SCHEMA` (§0 contre §5.1). Le test T7 vérifie la vue, jamais la
  table. **La plus lourde du corpus.**
- **Q-B** Audit des lectures : exigé par R6 et I4, implémenté nulle part — un déclencheur
  Postgres ne voit pas les `SELECT`.
- **Q-C** Monnaie : `numeric(10,2) amount_dzd` contre « DZD sans décimales ».
- **Q-D** `01-SCHEMA` §10.1 : les 3 policies `payments` sont `FOR ALL` avec `USING` seul, sans
  `WITH CHECK`. Une praticienne peut insérer un paiement au nom d'une consœur. À corriger par
  moi en migration 011 + ADR-016. Pas d'arbitrage nécessaire.

## Dette assumée, datée
- 2026-07-29 · `Features.md` (module 01 seulement) et la `Constitution` sont en anglais.
  Neutralisé par D1 : aucun agent ne les reçoit en brief. Non corrigé.
- 2026-07-29 · Le mockup `Mindcare OS HTML` n'est pas conforme au design system (palette,
  violet, fontes Google, rouge sur score clinique, scores de risque calculés). Traité comme
  référence de niveau d'exigence, jamais de valeur.
- 2026-07-29 · Checkpoints J0-A / J0-B de `05-BUILD-PLAN` §1 non exécutés (Docker, Supabase,
  réseau, comptes Windows). Requis avant T2.

## Prochaine tâche
1. Commit `chore(exec): rétablit l'outillage d'agents et le contexte de travail`
2. **Redémarrer Claude Code** — sans cela les 5 agents restent invisibles
3. `/task T1.1 — scaffold Next.js App Router, TS strict, ESLint anti-any, Tailwind sur tokens`
   → `services-builder`
