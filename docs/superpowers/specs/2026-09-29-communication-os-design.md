# MindCare Communications OS — Design (Phases 1-2)

> Décision humaine : demande initiale + approbation du plan (2026-09-29).
> Extension du schéma (tables `app.communication_*`) approuvée par ce même
> arbitrage — Règle 9 satisfaite par décision explicite, tracée ici.
> Règle 1 (loi 18-07) et Règle 4 (sécurité en base) : NON négociables.

## Goal

Fondation du domaine Communication : kernel DB + politique/consentement/
idempotence/file-hors-ligne/audit, puis intégration Composio session-scopée
derrière l'egress unique. WhatsApp + Facebook Page : SUPPORTED (comptes
connectés). Instagram : NOT_AVAILABLE (fail-closed) jusqu'à connexion.

## Architecture

```
Jarvis (capacités allowlistées, propose→confirm→execute→verify→log)
  → services/communication/* (kernel : politique + consentement + approbation)
  → portes app.* (RLS décide, FOR UPDATE, transition, écriture, trace trg_audit)
  → egress unique src/server/egress/external-call.ts (purpose "communication")
  → adaptateurs ComposioWhatsApp / ComposioFacebook (abstraction provider)
  → Composio REST session-scopée (cabinet_id stable, jamais d'IDs personnels)
  → Meta (WhatsApp Business / Page Facebook)
```

- Aucun appel Meta direct depuis le navigateur. Aucun secret côté client.
- Le modèle ne voit que des capacités MindCare, jamais les slugs Composio.
- Patient texte = donnée, jamais instruction. Aucune élévation de privilège.

## Canonical model (nouveau, 112/113)

`communication_conversations` (canal, état handoff, FK patient nullable) ·
`communication_participants` · `communication_messages` (state machine
received→classified→awaiting_action→draft→approval_required→approved→
sending→sent→delivered→read ; échecs failed/blocked/expired/rejected) ·
`message_deliveries` (clé d'idempotence UNIQUE) · `message_templates`
(Meta-approved, langue fr/ar/darija) · `communication_consents`
(opt-in/out par canal) · `external_connections` (statut/capacités, SANS token) ·
`external_message_refs` · `communication_actions` (mass-messaging approval-gated
à la frontière d'exécution) · `human_handoffs`
(AI_HANDLING/HUMAN_REQUIRED/HUMAN_HANDLING/RESOLVED) ·
`communication_automations` (déclencheur→conditions→action→vérification→audit).

Le patient maître reste `app.patients`. Aucune seconde base patients.
Aucun second système de RDV : l'Agenda (`022`/`025`) reste l'autorité.

## Policy boundary (fail-closed pragmatique)

- `classerCharge` existant tranche chaque charge sortante : C1/C2/INCONNU →
  BLOQUER + refus honnête + audit métadonnées seules. C4 (générique) → autorisé.
- Consentement requis par canal avant tout envoi ; refus = `blocked`, audité.
- Mass-messaging : proposition → carte d'approbation (audience, template,
  exclusions) → `confirmed_at` AVANT exécution → log (qui/quoi/audience/canal/
  template/horodatage/décision/résultat).
- Clinique détectée → pas de conseil médical, escalade humaine, réponse
  prédéfinie, audit.
- Hors-ligne : brouillons locaux OK, envois → QUEUED, jamais de faux `sent`.

## Provider reality (2026-09-29)

| Capacité | État |
|---|---|
| WhatsApp Business send text/template/status | SUPPORTED (compte connecté) |
| Facebook Page messaging/publish (approved) | SUPPORTED (page connectée) |
| Instagram DM/comments/publish | NOT_AVAILABLE (connexion ultérieure) |
| Fenêtre 24h / templates Meta | LIMITES préservées, erreurs réelles surfacées |

## Smart booking (Phase 5, jalon — rappelé ici car structurant)

Praticienne pose la date de révision (~+1 mois, état `requested`) →
agent demande confirmation avant J (heure "3la 9dach yji") →
patient répond sur WhatsApp → NLU (intent/langue/créneau, FR/AR/darija-mix) →
**re-lecture agenda** → `confirm_appointment` via porte existante →
confirmation + audit. Double-booking : `FOR UPDATE` + re-check ; le LLM
n'invente jamais de disponibilité et n'écrit jamais `appointments`.
Contrainte `EXCLUDE` anti-chevauchement : migration humaine-gatée en Phase 5.

## Approvals

Spec + plan approuvés par l'utilisateur le 2026-09-29 (chat). Prochaine gate :
revue du plan écrit avant exécution inline.
