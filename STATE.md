# STATE — MindCare OS
Dernière mise à jour : 2026-08-08 · **S7a CLOS** (checkpoint VERT 32 contrôles, 3 défauts réels trouvés et corrigés)


## Fait & vert
- S1-S4 (schéma 001→025, agenda, couche `DbPort`, suite complète) — VERT · checkpoint-s4 VERT 25, checkpoint-adr019 VERT 24
- S5 écran séance et note clinique sur migration 026 (9 portes) — build, typecheck, lint tous VERT · checkpoint-s5 VERT 11 · commit 07cc371 "fix(consultation): entrée visible" (2026-08-04)
- **S6 CLOS le 2026-08-05** — `analyze_session` fonctionnel de bout en bout, RLS vérifiée aux 3 rôles à chaque couche (SQL direct ET HTTP à travers la passerelle), `DEFAULT_MODEL = google/gemini-2.5-flash`. Trois défauts réels trouvés et corrigés en vérification locale Docker. Voir historique complet plus bas pour le détail.
- **S7a CLOS le 2026-08-08** — migration 029 (4 portes finances + `next_number`) + finance.ts + écran recettes · checkpoint-s7 VERT 32 contrôles (001→029 rejeu complet, 22 contrôles métier, 3 portes CLAUDE.md, 4 statiques) · 3 défauts réels trouvés et corrigés · 5 commits · 45814cd

## Décisions de session S7a (à verser au 00-DECISIONS.md)
12. **2026-08-08 : `checkpoint-s7.sh` accède à la base par `docker exec` sur le
    conteneur de `supabase start`**, pas par le conteneur jetable `postgres:15` de
    `scripts/lib/dburl.sh` (Docker Hub toujours injoignable sur ce réseau). Décision
    utilisateur explicite. Débloque aussi potentiellement checkpoint-s5/adr019/jarvis
    — non revérifiés cette session, à faire séparément.
13. **2026-08-08 : les contrôles de concurrence (19/20/21) sont joués pour de vrai**,
    deux sessions psql simultanées via FIFO/coproc, verrou mesuré par un délai
    bloquant — pas deux appels séquentiels. Décision utilisateur explicite.
14. **2026-08-08 : ajout au contrat gelé `docs/S7A-FINANCE.md`, remonté avant codage**
    (comme le contrat l'exige lui-même) : porte `app.get_consultation_payment`
    (029 §2bis), nécessaire pour que le bloc de tarif en fin de séance affiche un
    tarif déjà fixé sans journaliser une fausse lecture à chaque ouverture d'écran.
    Additive, INVOKER, ne nomme personne, aucune permission nouvelle.

## En cours
**S7b** reste bloqué sur les actifs B1.1→B1.5 (scan de l'en-tête, arbitrage « Psychiatrie », logo SVG, 7 fontes `.woff2`, contenu des 4 modèles de certificat) — inchangé.

## Dette assumée, datée (inchangée depuis S6, reportée telle quelle)
- S5 §7 on-screen matrix → avant 2026-08-10, toujours bloqué (pas de navigateur)
- `audit.boundary_crossings` non confirmé en écriture (réseau Docker local)
- `checkpoint-s5.sh`/`checkpoint-adr019.sh`/`checkpoint-jarvis.sh` — la décision 12
  ci-dessus (docker exec) les débloque potentiellement, à revérifier
- Vérification d'écran S6 — pas de navigateur dans cet environnement

## En litige — voir WORKING-CONTEXT.md §7
**Q-D CLOSE** (2026-08-03, ADR-019 opérationnelle). **Q-A/Q-B/Q-C** référencées §8 de WORKING-CONTEXT — toutes en ADRs, aucune nouvelle question ouverte.
**Nota:** WORKING-CONTEXT.md §0 mentionne docs 05-BUILD-PLAN et 06 (inexistants sur disque) — l'autorité est en retard.

---

## Trois défauts réels trouvés et corrigés en S7a

1. **UUID `E2` malformé dans checkpoint-s7.sh** — test data UUID avait 11 caractères
   hex au lieu de 12. Silencieusement rejeté par `INSERT`, cascadait sur 6 contrôles
   en aval (indisponibilité de consultation pour lecture de tarif). **Corrigé** : UUID
   régénéré `E2AABBCCDDEE`.

2. **Migration 029 — `app.list_day_payments` déclarait pas les variables `v_debut`/`v_fin`.**
   Contrairement à `app.day_revenue` (même porte, mêmes bornes de jour), `list_day_payments`
   utilisait ces variables sans les déclarer — plantait à l'exécution pour owner/practitioner,
   cassant l'écran recettes en production. **Corrigé** : déclaration + calcul ajoutés au
   §3 de 029, même frontière `Africa/Algiers` que `day_revenue`.

3. **Contrôles de concurrence (19/20/21) utilisaient `mkfifo` (named pipes).** Peu fiable
   sous Windows/MSYS + Docker Desktop : lecteur pouvait mourir avant l'écriture, causant
   SIGPIPE qui tuait le **script entier** (code 141) au lieu de faire échouer le seul contrôle.
   **Corrigé** : remplacé par `coproc` (pipes anonymes gérés par bash). Ajouté `trap '' PIPE`
   en filet de sécurité. Plus robuste et conforme à l'intention documentée en tête de script.

**Détail supplémentaire :** `scripts/preflight.sh` scannait `.kilo/node_modules/` (outil
local, gitignoré) et remontait faux positifs sur le contrôle « hex en dur hors tokens ».
Exclu du `find`, comme `node_modules/`/`.git/`/`.next/`.

---

## Historique S1-S6 détaillé (conservé pour référence)

### Trois défauts réels trouvés en vérification locale S6, tous corrigés
1. **Migration 027 — `ALTER FUNCTION ... OWNER TO app_gatekeeper` en 42501.**
   `ALTER ... OWNER TO` exige que le NOUVEAU propriétaire ait `CREATE` sur le
   schéma. 026 §3 accorde ce privilège PUIS le retire à son §8, dans SA PROPRE
   transaction. 027 est une migration séparée : sans son propre GRANT/REVOKE,
   elle hérite d'un rôle déjà refermé. **Corrigé : §0/§3 ajoutés à 027**, et le
   même motif a été appliqué dès l'écriture de 029 cette session (§0/§6).
2. **`external-call.ts` sans `max_tokens`** — corrigé, `MAX_OUTPUT_TOKENS = 2000`.
3. **`index.ts` — clôture Markdown non retirée avant `JSON.parse`** — corrigé,
   `retirerCloture()`.

### Preuve RLS — les 3 rôles, `app.get_previous_note`, en base réelle et via HTTP
owner a1 → accès complet ; practitioner a2 et assistant a3 → même refus générique,
indiscernable d'un `consultationId` inexistant. Prouvé en SQL direct ET à travers
`jarvis-analyze-session` en HTTP réel.

### Portes & regressions (dernière vérification directe S6)
`preflight` ✓ · `typecheck` ✓ · `lint` ✓ · `build` ✓. La couche sécurité est gelée :
ADR-019 tient sur `app_gatekeeper` sans `BYPASSRLS`, membre `authenticated` avec
`INHERIT TRUE`, propriétaire des portes 004/007/008/026/027/**029 (day_revenue,
list_day_payments)**. Y toucher casse la cloison.

### Décisions de session S1-S6 (récapitulatif, voir git log pour le détail complet)
1-11 : nom du fichier gateway, S6 = Edge Function Deno, scope S6 resserré à
`analyze_session` seul, Docker/psql redevenus disponibles (Docker Hub reste
injoignable), `DEFAULT_MODEL = gemini-2.5-flash`, S6 clos malgré 3 dettes, S7
découpé en S7a/S7b, l'assistante n'encaisse pas au mois 1, recette cloisonnée en
base, notification payment_due écrite dès S7a, 5 renforcements d'ingénierie
(transaction, verrous FOR UPDATE, trace financière via trg_audit, temps serveur,
contrat de performance).
