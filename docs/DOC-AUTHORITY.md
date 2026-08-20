# DOC-AUTHORITY.md
**Qui a raison quand deux documents se contredisent.**
v2 — 2026-08-09 · réécrit à l'ouverture de la phase v1

> Lis ce fichier avant d'ouvrir n'importe quel autre `.md`.
> Il existe parce que le dépôt a contenu **trois modèles de données incompatibles**.
> Un agent qui lit le mauvais document écrit la mauvaise migration, et on perd une session.

---

## 1. HIÉRARCHIE — du plus fort au plus faible

```
1. supabase/migrations/*.sql      ← SOURCE DE VÉRITÉ. Exécutable, testé.
2. CLAUDE.md                      ← les règles. Battent tout sauf le SQL appliqué.
3. 00-DECISIONS.md                ← les ADR. Gèlent les choix.
4. 01-SCHEMA.md                   ← intention du schéma (régénéré, jamais écrit à la main)
   02-SECURITY-BOUNDARY.md        ← frontière des données
   03-JARVIS-TOOLS.md             ← contrat des outils
   04-DESIGN-SYSTEM.md            ← jetons visuels (amendé par ADR-022)
   05-UX-CONTRACT.md              ← états d'écran obligatoires
   06-PERF-BUDGET.md              ← budget de performance
   DOCUMENT-TEMPLATES.md          ← contenu des certificats
5. SPRINT-V1.md                   ← quoi construire, dans quel ordre
   SESSION-CONTRACTS.md           ← comment ouvrir chaque session
   MODULE-MAP.md                  ← où vit chaque module
   SESSION-PROTOCOL.md            ← discipline de session
6. STATE.md                       ← l'état réel. Périssable, jamais normatif.
```

**Si `01-SCHEMA` et une migration appliquée divergent : la migration a raison.**
On corrige `01-SCHEMA`, on ne « répare » pas la base pour coller au document.

---

## 2. ARCHIVÉS — INTERDITS À TOUT AGENT

Ces fichiers vivent dans `docs/archive/`. **Aucun agent ne les lit. Jamais.**

| Fichier | Pourquoi archivé |
|---|---|
| 🔴 **`CLAUDE.md` du dossier de projet** | Décrit **Fastify · React/Vite · Postgres natif sans Docker · ORM interdit · routes `/v1/`**. Le dépôt réel est **Next.js 15 · Supabase · `DbPort` · Server Actions**. Ce fichier ment à chaque agent qui l'ouvre. **Seul le `CLAUDE.md` de la racine du dépôt fait foi.** |
| `SPRINT-4-DAYS.md` | Plan des 4 jours, exécuté. Remplacé par `SPRINT-V1.md` |
| `S7A-FINANCE.md` · `S7B-DOCUMENTS.md` | Contrats exécutés. Leurs blocages restants sont repris au §4 |
| `JARVIS-DEMO-SPEC.md` | Périmètre S6. Remplacé par `SPRINT-V1.md` §V2 + ADR-023 |
| `MindCare-Architecture-et-Roadmap.md` | Tables `users`, `invoices`, `appointment_requests` — pas le schéma actif |
| `MindCare-API-Contract.md` | API REST `/v1/…` inexistante. On fait Server Actions + `DbPort` |
| `MindCare_OS_Engineering_Constitution.md` | Vision (696 lignes). Utile à l'humain, ruineux pour un agent |
| `MindCare-Domain-Model.md` · `MindCare-Domain-Events.md` | Modèle qui n'est pas le schéma actif |
| `Chapter_*.md` (les 51) | Vision produit. Zéro valeur d'exécution |
| `Features.md` · `MODULE-01-*.md` | Remplacés par `MODULE-MAP.md` v2 |
| `05-BUILD-PLAN.md` · `06-EXECUTION.md` · `PLAN-CHECKPOINTS.md` | Plans en heures, agents périmés |

> **L'archivage est une opération humaine.** Aucun agent ne lit ni n'écrit dans
> `docs/archive/` — le hook `guard-bash.sh` règle 6 le bloque quel que soit le chemin
> (`Read`, `Grep`, `Glob`, `cat`, `less`, `sed`, redirection…).

⚠️ Le dossier est en **minuscules**. Sous Windows, `docs/Archive` et `docs/archive`
désignent le même dossier sur le disque mais **pas** le même motif dans la deny-list :
une majuscule suffit à désactiver l'interdiction sans aucun message d'erreur.
Contrôle : `ls -d docs/*rchive*` doit rendre exactement `docs/archive`.

---

## 3. DÉCISIONS ANTÉRIEURES — toujours en vigueur

D-02 Next.js web · D-03 Server Actions, pas d'API REST · D-04 transcription Groq
reportée · D-05 sprint en sessions · D-06 un seul exécuteur, Claude Code ·
D-08 front assistante en semaine 2 · D-09 finance dans le périmètre ·
D-10 `analyze_session` sans micro · D-11 S7 découpé · D-13 l'assistante n'encaisse pas ·
D-14 recette cloisonnée en base · D-15 `payment_due` écrite sans lecteur ·
D-16 cinq renforcements d'ingénierie.

**D-01 / D-07 — auto-hébergement : suspendus, jamais annulés.** Voir D-17.

---

## 3bis. DÉCISIONS DU 2026-08-09 — ouverture de la phase v1

| # | Décision | Portée |
|---|---|---|
| **D-17** | **Le développement reste sur Supabase Cloud, données synthétiques.** Le PC serveur est éloigné d'Ayoub et le poste de développement fait 8 Go — `s0-provision.sh` refuse sous 14 Go. La migration auto-hébergée cesse d'être un préalable et devient **la porte de livraison** : franchie avant le premier patient réel, jamais après. Les 3 conditions d'ADR-016 restent intactes. | Remplace « migration avant les 6 sessions » |
| **D-18** | **6 sessions, ordre imposé** : V1 vérité & vitesse · V2 Jarvis · V3 design · V4 tableau de bord · V5 patients & agenda · V6 finance & documents. V1 avant tout : on ne débugge pas une application dont les erreurs disent `"inattendu"`. V3 avant V4 : le tableau de bord se construit avec le design v2. | `SPRINT-V1.md`, `SESSION-CONTRACTS.md` |
| **D-19** | **ADR-022 · la couleur revient, la donnée reste opaque.** Palette dérivée du teal réel du logo (`#7CB5AC` pipetté), dégradés autorisés sur les agrégats et le mobilier, interdits derrière toute valeur clinique. `--teal-600: #1B6B63` était une estimation, pas la marque. | Amende `04-DESIGN-SYSTEM.md` |
| **D-20** | **ADR-023 · Jarvis répond en psychiatre sur la connaissance, jamais sur le patient.** La frontière passe entre le savoir général et le cas individuel, pas entre les sujets. Dès qu'un patient identifié entre dans la question, L4 s'applique intégralement. | Amende L4 de `03-JARVIS-TOOLS.md` |
| **D-21** | **ADR-024 · la voix bascule par un flag.** `cloud` (Groq + ElevenLabs) en développement synthétique, `local` (whisper.cpp + Piper) dès le premier patient réel. L'API `SpeechRecognition` du navigateur est **interdite dans les deux modes** : elle envoie l'audio à Google et aucun flag ne peut l'éteindre. | Complète ADR-002 et ADR-009 |
| **D-22** | **Les 4 certificats : fautes corrigées, logo refait.** Arbitrages A1→A10 tranchés « corriger » par la praticienne. Nouveau logo vectoriel. **Conséquence : le checkpoint papier change de nature** — ce n'est plus « reproduire son papier à l'identique » mais « établir son nouveau papier à en-tête ». Le critère devient : elle imprime, elle regarde, elle approuve. | `DOCUMENT-TEMPLATES.md`, migration `031` |

---

## 3ter. CLÔTURES

**S7a — clos le 2026-08-08.** `checkpoint-s7` VERT sur 32 contrôles. 3 défauts réels
trouvés et corrigés en exécution (UUID de test malformé · `list_day_payments` sans
variables de bornes · `mkfifo` remplacé par `coproc`). 5 commits.

**S7b — moteur clos, contenu débloqué le 2026-08-09.** `030_document_gates.sql` en
place, 3 passes de revue adversariale, 8 défauts corrigés. Le seed arrive par `031`.
**Il reste bloquant : aucun certificat imprimé de référence pour caler les marges.**

---

## 4. DETTE ASSUMÉE, DATÉE — à ne pas re-débattre

| Dette | Échéance | Sortie |
|---|---|---|
| Données patient sur Supabase Cloud | **avant le 1er patient réel** | D-17, porte de livraison, 7 lignes de checklist |
| Pas de transcription de séance | Semaine 2 | Groq → `analyze_session`, aucun changement de schéma |
| Voix cloud, pas locale | Jour de la migration | `VOICE_PROVIDER=local`, whisper.cpp + Piper (D-21) |
| ~~Fontes locales absentes~~ | ~~V3~~ | **ÉTEINTE le 2026-08-20.** 4 familles par `next/font/google`, 26 `.woff2` auto-hébergés au build, 0 URL Google dans le CSS émis — mesuré, pas supposé |
| Primitives `Toast` et `Tableau` absentes | **V4** | Aucune n'a d'appelant dans `src/` ; livrer une primitive non exercée serait du code non vérifié. Le tableau de bord leur donnera un consommateur réel |
| Porte V2 non rejouable — crédit fournisseur épuisé | **achat des crédits** | `secrets unset OPENROUTER_MODEL` (retour à `google/gemini-2.5-flash`) puis rejeu de `checkpoint-v2.sh`. Dette d'ENVIRONNEMENT, pas de code |
| Aucun certificat imprimé de référence | **bloque le vert de V6** | Un tirage papier, une approbation de la praticienne |
| Nom, n° d'ordre, téléphone absents de la base | **bloque V6** | Saisis dans `app.profiles` sur l'instance, **jamais** commités |
| Modèle d'ordonnance | Mois 2 | `'ordonnance'` à ajouter à l'enum `app.doc_type` |
| Chevauchement de rendez-vous non bloqué | Mois 2 | `btree_gist` + `EXCLUDE`. **Jamais** une vérification en JavaScript |
| Consentements papier | Mois 2 | Table `consents` |
| Front assistante absent | Semaine 2 | Vue `appointments_admin` + Realtime (D-08) |
| Sauvegarde non testée | **porte de livraison** | `pg_dump` + restauration prouvée sur second dossier |

**Règle :** une dette non écrite ici n'existe pas. Une dette écrite ici ne se rediscute
pas avant son échéance.

---

*Ce fichier se met à jour à chaque décision structurante. Il ne grossit pas : une ligne
remplacée est supprimée, pas empilée.*
