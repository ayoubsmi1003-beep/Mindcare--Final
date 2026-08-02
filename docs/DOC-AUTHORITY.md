# DOC-AUTHORITY.md
**Qui a raison quand deux documents se contredisent.**
v1 — 2026-08-02

> Lis ce fichier avant d'ouvrir n'importe quel autre `.md`.
> Il existe parce que le dépôt contient trois modèles de données incompatibles.
> Un agent qui lit le mauvais document écrit la mauvaise migration, et on perd une session.

---

## 1. HIÉRARCHIE — du plus fort au plus faible

```
1. supabase/migrations/*.sql      ← SOURCE DE VÉRITÉ. Exécutable, testé.
2. CLAUDE.md                      ← les 10 règles. Battent tout sauf le SQL appliqué.
3. 00-DECISIONS.md                ← les ADR. Gèlent les choix.
4. 01-SCHEMA.md                   ← intention du schéma
   02-SECURITY-BOUNDARY.md        ← frontière des données
   03-JARVIS-TOOLS.md             ← contrat des outils
   04-DESIGN-SYSTEM.md            ← jetons visuels
5. SPRINT-4-DAYS.md               ← quoi construire, dans quel ordre
   MODULE-MAP.md                  ← où vit chaque module
   SESSION-PROTOCOL.md            ← comment démarrer une session
6. STATE.md                       ← l'état réel. Périssable, jamais normatif.
```

**Si 01-SCHEMA et une migration appliquée divergent : la migration a raison.**
On corrige 01-SCHEMA, on ne « répare » pas la base pour coller au document.

---

## 2. ARCHIVÉS — INTERDITS À TOUT AGENT

Ces fichiers vivent dans `docs/archive/`. **Aucun agent ne les lit. Jamais.**
Ils contredisent le schéma actif et coûtent des sessions entières en reprise.

| Fichier | Pourquoi archivé |
|---|---|
| `MindCare-Architecture-et-Roadmap.md` | Tables `users`, `invoices`, `appointment_requests` — ce ne sont PAS les tables du schéma actif |
| `MindCare-API-Contract.md` | Décrit une API REST `/v1/…` qui n'existe pas. On fait Next.js Server Actions + Supabase |
| `MindCare_OS_Engineering_Constitution.md` | Document de vision (696 lignes). Utile à l'humain, ruineux pour un agent |
| `MindCare-Domain-Model.md` | Excellent, mais redondant avec `01-SCHEMA.md`. Le lire double le coût sans rien ajouter |
| `MindCare-Domain-Events.md` | Événements d'un modèle qui n'est pas le schéma actif |
| `Chapter_*.md` (les 51) | Vision produit. Zéro valeur d'exécution |
| `Features.md` | Un module sur douze. Remplacé par `MODULE-MAP.md` |
| `05-BUILD-PLAN.md` | Plan en heures. Remplacé par `SPRINT-4-DAYS.md` (D-05) |
| `06-EXECUTION.md` | Décrit les 7 anciens agents et un plan en heures. Périmé sur les deux points |

> **L'archivage d'un document est une opération humaine.** Aucun agent ne peut écrire
> ni lire dans `docs/archive/` — le hook `guard-bash.sh` règle 6 le bloque quel que soit
> le chemin d'accès (`Read`, `Grep`, `Glob`, `cat`, `less`, `sed`, redirection…).
> Tout déplacement vers l'archive se fait dans un terminal humain, jamais par Claude Code.

**Commande de mise en place — à lancer par un humain :**
```bash
mkdir -p docs/archive
mv docs/MindCare-Architecture-et-Roadmap.md docs/archive/
mv docs/MindCare-API-Contract.md docs/archive/
mv docs/MindCare_OS_Engineering_Constitution.md docs/archive/
mv docs/MindCare-Domain-Model.md docs/archive/
mv docs/MindCare-Domain-Events.md docs/archive/
mv docs/Features.md docs/archive/
mv docs/05-BUILD-PLAN.md docs/archive/
mv docs/06-EXECUTION.md docs/archive/
echo "Lecture interdite aux agents. Voir DOC-AUTHORITY.md §2." > docs/archive/README.md
```
⚠️ Le nom du dossier est en **minuscules**. Sous Windows, `docs/Archive` et `docs/archive`
désignent le même dossier sur le disque mais **pas** le même motif dans la deny-list :
une majuscule suffit à désactiver l'interdiction sans aucun message d'erreur.
Contrôle : `ls -d docs/*rchive*` doit rendre exactement `docs/archive`.

---

## 3. DÉCISIONS PRISES LE 2026-08-02 — remplacent tout texte antérieur

| # | Décision | Remplace |
|---|---|---|
| **D-01** | ~~Supabase Cloud~~ → **ANNULÉE par D-07.** | — |
| **D-02** | **Next.js web dans le navigateur.** Tauri au mois 2, enveloppe seulement. | « Tauri v2 » comme cible immédiate |
| **D-03** | **Server Actions + client Supabase.** Aucune API REST versionnée. | `MindCare-API-Contract.md` en entier |
| **D-04** | **Transcription Groq reportée en semaine 2.** Mode Séance livré sans micro. | §9.15 de `05-BUILD-PLAN.md` |
| **D-07** | **Supabase AUTO-HÉBERGÉ** sur le PC serveur du cabinet (i7 · 16 GB · Win 10 Pro). Données en Algérie. | D-01. Voir `SELF-HOST-SETUP.md` |
| **D-08** | **Front assistante reporté en semaine 2.** Rôles et vues créés en base dès S1. | `MODULE-MAP.md` |
| **D-09** | **Finance dans le sprint** — encaissement + recette du jour, dès le premier jour. | §1 de SPRINT v1 |
| **D-10** | **`analyze_session` sans micro** : notes brutes → note structurée + évolution + points non explorés. La transcription alimentera le **même** outil. | — |
| **D-05** | Sprint = **8 sessions Claude Code**, pas 2 jours-homme. | `05-BUILD-PLAN.md` en entier |
| **D-06** | Un seul exécuteur : **Claude Code**. Pas de DeepSeek/GLM en parallèle. | §4 de la roadmap archivée |

---

## 4. DETTE ASSUMÉE, DATÉE — à ne pas re-débattre

| Dette | Échéance | Sortie |
|---|---|---|
| ~~Données patient hors Algérie~~ | — | **Éteinte par D-07.** Révoquer le projet Supabase Cloud et ses clés. |
| Pas de transcription | Semaine 2 | Edge Function + Groq, aucun changement de schéma |
| Consentements papier | Mois 2 | Table `consents` |
| Ordonnances saisies, non imprimées | Mois 2 | Modèle de document |
| Fontes locales absentes | Avant S2 | 7 `.woff2` dans `src/styles/fonts/` |
| Front assistante absent | 2026-08-13 | Vue `appointments_admin` + notification Realtime |
| Sauvegarde non testée | 2026-08-06 | `pg_dump` + restauration prouvée sur second dossier |

**Règle :** une dette non écrite ici n'existe pas. Une dette écrite ici ne se rediscute pas avant son échéance.

---

*Ce fichier se met à jour à chaque décision structurante. Il ne grossit pas : une ligne remplacée est supprimée, pas empilée.*
