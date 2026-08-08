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

## 3bis. DÉCISIONS PRISES LE 2026-08-05 — S7

| # | Décision | Portée |
|---|---|---|
| **D-11** | **S7 découpé en S7a (Finance) puis S7b (Documents).** Plans écrits, approuvés et gelés : `docs/S7A-FINANCE.md`, `docs/S7B-DOCUMENTS.md`. S7a n'est bloqué par rien ; S7b l'est par des actifs manquants (D-12). Ordre imposé par la règle du sacrifice §2 du sprint. | Remplace « S7 en une session » |
| **D-12** | **S7b est bloqué, pas conçu autour de son blocage.** Scan de l'en-tête, arbitrage « Pychiaterie », logo SVG, 7 fontes `.woff2`, contenu des 4 modèles : aucun de ces actifs ne sera remplacé par un substitut inventé. Un certificat approximatif est un faux, pas un brouillon. | §B1 de `S7B-DOCUMENTS.md` |
| **D-13** | **L'assistante n'encaisse pas au mois 1.** `011` ne lui accorde que `SELECT` sur `app.payments`. Aucune permission n'est élargie ; le constat d'écart avec `01-SCHEMA.md` §10.1 reste signalé, non comblé. À rouvrir avec le front assistante (D-08). | ADR-005, D-08 |
| **D-14** | **La recette est cloisonnée par rôle, en base.** owner → cabinet · practitioner → sa seule recette · assistant → 0 ligne, pas une erreur. Le filtrage vit dans la porte SQL, **jamais** en JavaScript. | ADR-005, règle 4 de CLAUDE.md |
| **D-15** | **`payment_due` est écrite dès S7a**, sans lecteur (front assistante reporté). Payload sans donnée clinique. Évite une migration sur une porte finance en service, en semaine 2. | ADR-010, I5 |
| **D-16** | **Cinq renforcements d'ingénierie intégrés aux deux contrats S7**, chacun adossé à un contrôle de checkpoint : transaction explicite · concurrence par `FOR UPDATE` · trace financière **réutilisant `trg_audit` (013), sans mécanisme parallèle** · temps canonique = serveur · contrat de performance avec index documentés. Une exigence non vérifiable n'est qu'une intention. | S7a §§1bis-2quater, S7b §§B1bis-B5 |

---

## 3ter. CLÔTURE — S7a (2026-08-08)

**S7a est clos.** `checkpoint-s7` VERT sur 32 contrôles : rejeu complet 001→029, 22 contrôles métier, 3 portes CLAUDE.md, 4 statiques. Trois défauts réels trouvés et corrigés en exécution :

1. UUID de test malformé dans le script de checkpoint → cascade sur 6 contrôles. Corrigé.
2. `app.list_day_payments` ne déclarait pas ses variables bornes (`v_debut`/`v_fin`) — plantage réel en production. Corrigé : déclaration + calcul, même frontière `Africa/Algiers` que `day_revenue`.
3. Contrôles de concurrence utilisaient `mkfifo` (failles de robustesse sous Windows/Docker Desktop). Remplacé par `coproc` + `trap '' PIPE`.

**5 commits créés :**
- `980a733 feat(finance): portes 029 — tarif, encaissement, recette cloisonnée`
- `206a884 feat(finance): couche service sur les portes 029`
- `96aeb44 feat(finance): saisie du tarif en fin de séance`
- `285898f feat(finance): écran recette du jour`
- `45814cd test(finance): checkpoint-s7`

**Vérifications terminées :** revue adversariale `security-reviewer` sur 029 (session précédente, 4 défauts corrigés) · rejeu 001→029 sur base neuve VERT 29 migrations · 3 grep/find CLAUDE.md retournent 0 occurrence chacun.

**S7b demeure bloqué** sur les actifs B1.1→B1.5 (décision D-12 inchangée).

---

## 4. DETTE ASSUMÉE, DATÉE — à ne pas re-débattre

| Dette | Échéance | Sortie |
|---|---|---|
| ~~Données patient hors Algérie~~ | — | **Éteinte par D-07.** Révoquer le projet Supabase Cloud et ses clés. |
| Pas de transcription | Semaine 2 | Edge Function + Groq, aucun changement de schéma |
| Consentements papier | Mois 2 | Table `consents` |
| Ordonnances saisies, non imprimées | Mois 2 | Modèle de document |
| Fontes locales absentes | ~~Avant S2~~ · **échue, et devenue bloquante** | 7 `.woff2` dans `src/styles/fonts/` + câblage `next/font/local`. **Bloque S7b (B1.4)** : `--font-doc` retombe sur Georgia, donc l'aperçu A4 n'est pas ce que l'imprimante produit. |
| Scan de l'en-tête + arbitrage « Pychiaterie » | **bloquant S7b (B1.1, B1.2)** | Scan haute résolution + décision de la praticienne sur son propre titre |
| Logo SVG absent | **bloquant S7b (B1.3)** | Seul `lOGO.JPG.jpg` (raster) existe — s'imprime crénelé |
| 4 `document_templates` jamais semés | **bloquant S7b (B1.5)** | `015` ne pose que le compteur `document`. Contenu à fournir par la praticienne — un texte de certificat ne s'invente pas. |
| Front assistante absent | 2026-08-13 | Vue `appointments_admin` + notification Realtime |
| Sauvegarde non testée | 2026-08-06 | `pg_dump` + restauration prouvée sur second dossier |

**Règle :** une dette non écrite ici n'existe pas. Une dette écrite ici ne se rediscute pas avant son échéance.

---

*Ce fichier se met à jour à chaque décision structurante. Il ne grossit pas : une ligne remplacée est supprimée, pas empilée.*
