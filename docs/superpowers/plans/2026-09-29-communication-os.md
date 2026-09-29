# MindCare Communications OS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phases 1-2: communication kernel (DB + services) and Composio session integration behind the single egress.

**Architecture:** New `app.communication_*` tables with RLS + `app.*` gates; services under `src/services/communication/`; Composio via extended `src/server/egress/external-call.ts` with closed tool registry; routes under `/api/communication/` + generic `/api/db/rpc` allowlist regen.

**Tech Stack:** Next.js 15, TypeScript strict, PostgreSQL 16 local, Zod, vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-communication-os-design.md`

## Global Constraints

- Règle 1: aucune donnée identifiante patient ne quitte la machine sans passer l'egress + pseudonymisation.
- Règle 2: aucun secret côté client, jamais `NEXT_PUBLIC_*` devant une clé.
- Règle 4: sécurité en base (RLS/portes), jamais `if (role)` en JS.
- Règle 5: une écriture métier = une fonction Postgres (périmètre·verrou·transition·écriture·trace).
- Règle 9: migrations `112_*`/`113_*` créées ici, jamais de modification d'une migration appliquée.
- UI français intégral, chaînes dans `src/i18n/fr.ts`, couleurs dans `src/styles/tokens.css` uniquement.
- `timestamptz`, bornes `Africa/Algiers`, montants `integer amount_dzd` (sans objet ici mais rappelé).
- Chaque tâche se termine par une preuve : test ciblé ou `tsc`/`eslint` pertinent.

---

### Task 1: Migration 112 — tables + RLS + portes kernel

**Files:**
- Create: `supabase/migrations/112_communication_kernel.sql`
- Test: `tests/unit/communication-kernel-sql.test.ts` (garde statique : noms de portes/tables présents, pas de SELECT clinique direct)

**Interfaces:**
- Consumes: conventions migrations (BEGIN/COMMIT, `schema_migrations`, OWNER app_gatekeeper, search_path figé)
- Produces: tables `app.communication_*`, portes `app.comm_*` utilisées par Task 3

- [ ] **Step 1: Write the failing test** — garde statique vérifiant que `112_communication_kernel.sql` contient les 10 tables et les portes `comm_create_conversation`, `comm_append_message`, `comm_transition_message`, `comm_set_consent`, `comm_register_delivery`, `comm_request_handoff`.

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const sql = readFileSync("supabase/migrations/112_communication_kernel.sql", "utf8");
describe("migration 112", () => {
  it("contient les tables canoniques", () => {
    for (const t of ["communication_conversations","communication_messages","message_deliveries","message_templates","communication_consents","external_connections","communication_actions","human_handoffs"]) {
      expect(sql).toContain(t);
    }
  });
  it("contient les portes", () => {
    for (const f of ["comm_create_conversation","comm_append_message","comm_transition_message","comm_set_consent","comm_register_delivery"]) {
      expect(sql).toContain(f);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run tests/unit/communication-kernel-sql.test.ts` — Expected: FAIL (file missing).
- [ ] **Step 3: Write migration 112** — tables + enums (`comm_channel`, `comm_message_state`, `comm_handoff_state`), RLS cabinet-scopée, portes SECURITY DEFINER (create/append/transition/set_consent/register_delivery/request_handoff + FK patient nullable, idempotence UNIQUE sur deliveries, audit via trg_audit existant), `INSERT INTO app.schema_migrations`.
- [ ] **Step 4: Run test** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add supabase/migrations/112_communication_kernel.sql tests/unit/communication-kernel-sql.test.ts && git commit -m "feat(communication): migration 112 kernel tables et portes"`

### Task 2: Migration 113 — templates + automations + connexions

**Files:**
- Create: `supabase/migrations/113_communication_gates.sql`
- Test: extend `tests/unit/communication-kernel-sql.test.ts` (portes `comm_upsert_template`, `comm_set_connection`, `comm_log_action`)

**Interfaces:**
- Consumes: tables de Task 1
- Produces: portes utilisées par Task 3/4

- [ ] **Step 1: Extend failing test** with template/connection/action assertions.
- [ ] **Step 2: Run test** — Expected: FAIL.
- [ ] **Step 3: Write migration 113** — seed-safe (aucune donnée fictive patient ; templates = gabarits vides FR/AR, contenus approuvés Meta à renseigner en exploitation), portes upsert_template/set_connection/log_action, RLS identique.
- [ ] **Step 4: Run test** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(communication): migration 113 templates connexions actions"`

### Task 3: Services kernel (politique + consentement + idempotence + file hors-ligne)

**Files:**
- Create: `src/services/communication/types.ts`, `politique.ts`, `consentement.ts`, `idempotence.ts`, `file-attente.ts`, `communication-service.ts`
- Modify: `src/i18n/fr.ts` (section `communication`, ~25 clés FR)
- Test: `tests/unit/communication-politique.test.ts`

**Interfaces:**
- Consumes: portes Task 1/2 via `db().rpc`, `classerCharge` pour la garde PII, `fr.communication.*`
- Produces: `deciderEnvoi()`, `verifierConsentement()`, `cleIdempotence()`, `mettreEnFile()` pour Task 4/5

- [ ] **Step 1: Write failing tests** — consentement refusé → `blocked`; charge C1 (nom + clinique) → `blocked`; doublon idempotence → même clé; hors-ligne → `QUEUED` jamais `sent`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** — machine à états TS miroir du SQL, `messagePorteUnSignalPatient` comme pré-filtre, clés `comm:<conversation>:<hash>`, file locale (table messages état `queued`, reprise explicite).
- [ ] **Step 4: Run** — Expected: PASS. Puis `node scripts/gen-db-allowlist.mjs` + `git diff --stat src/server/db/allowlist.generated.ts` (doit lister les nouvelles portes).
- [ ] **Step 5: Commit**

### Task 4: Composio — env + egress + registre d'outils fermé

**Files:**
- Modify: `src/server/env.ts` (ajout `COMPOSIO_API_KEY`, `COMPOSIO_BASE_URL` optionnel)
- Modify: `src/server/egress/external-call.ts` (purpose `"communication"`, fonction `appelComposio`)
- Create: `src/server/communication/registre-outils.ts`, `src/server/communication/adaptateurs.ts` (abstraction + ComposioWhatsApp/Facebook)
- Test: `tests/unit/communication-registre.test.ts`

**Interfaces:**
- Consumes: kernel Task 3, `withEgressGate`, `journaliser` boundary_crossings
- Produces: `executerCapaciteCommunication()` pour Task 5 (Jarvis)

- [ ] **Step 1: Write failing tests** — slug inconnu → refus; outil hors allowlist → refus; payload C1 → `frontiere` sans appel réseau (fetch mocké, 0 appel); secret jamais sérialisé côté client.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** — registre fermé ~8 outils (whatsapp.send_text/template/status, facebook.send_page_message, connection.status/test, inbound.ingest), session = `cabinet_id` stable, retry 1× transitoires uniquement (jamais policy/permission/fenêtre/template), timeouts 10s.
- [ ] **Step 4: Run** — Expected: PASS + `npx tsc --noEmit`.
- [ ] **Step 5: Commit**

### Task 5: Routes API + statuts connexion

**Files:**
- Create: `src/app/api/communication/statut/route.ts`, `envoyer/route.ts` (derrière approbation), `webhook/route.ts` (ingest inbound → porte append, dedup par provider_message_id)
- Modify: `src/services/communication/communication-service.ts` (appel rpc)
- Test: `tests/unit/communication-routes.test.ts` (Zod refusent payloads malformés ; webhook dupliqué → 1 seule ligne)

**Interfaces:**
- Consumes: Task 3/4
- Produces: surface UI Phase 4 (hors scope d'exécution, jalon)

- [ ] **Step 1-5:** même cycle TDD + commit. Vérifier `grep -r "COMPOSIO" .next/static/` → 0 après build ciblé (ou `eslint` si build trop lourd).

## Self-Review

- Spec coverage: kernel (T1-3) ✓, Composio/MCP boundary (T4) ✓, routes (T5) ✓, provider reality IG NOT_AVAILABLE ✓ (statut + UI honest, pas d'outil IG enregistré), booking/automation/marketing → jalons Phase 5+ hors plan (noté, pas de placeholder).
- Placeholders: aucun — chaque step porte son code/commande.
- Types: noms de portes `comm_*` identiques T1→T3 ; `executerCapaciteCommunication` T4→T5.
