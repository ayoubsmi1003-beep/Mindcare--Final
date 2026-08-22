# SESSION-CONTRACTS.md
**Les 6 contrats de session — un par session, à ouvrir tel quel.**
v1 — 2026-08-09 · complète `SPRINT-V1.md` · format hérité de `S7A-FINANCE.md`

> `SPRINT-V1.md` dit **quoi** livrer. Ce fichier dit **comment ouvrir la session**.
> Chaque contrat tient en une page : l'agent, le modèle, ce qu'il lit, ce qu'il ne
> lit pas, le prompt d'amorçage à coller, et la condition de vert.
>
> **Un contrat ne se réduit pas, ne se simplifie pas, ne se réinterprète pas.**
> Toute divergence constatée à l'implémentation se remonte **avant** d'être codée.

---

## 0. LE RITUEL, IDENTIQUE AUX 6 SESSIONS

**Premier message, toujours :**
```
Lis dans cet ordre, rien d'autre : CLAUDE.md, DOC-AUTHORITY.md, STATE.md.
Ne lis aucun fichier de docs/ ni aucun fichier source.
Tâche du jour = le contrat V<n> de docs/SESSION-CONTRACTS.md.
Délègue au sous-agent indiqué. Tu ne codes pas toi-même.
Plan mode d'abord : montre-moi le plan en ≤ 20 lignes, attends mon accord.
Après chaque checkpoint vert : /handoff.
```

**Dernier message, toujours :** `/handoff` — commit, STATE.md, prochaine tâche en une phrase.

**Les quatre signaux d'arrêt** (`SESSION-PROTOCOL.md` §5) valent sans exception :
même test rouge 3 fois · règle réexpliquée · verdict > 30 lignes · envie d'ajouter
une fonctionnalité non listée.

---

## V1 — VÉRITÉ & VITESSE

| | |
|---|---|
| **Agent** | `feature-builder` · **sonnet** · revue finale `security-reviewer` · **opus** |
| **Lit** | `SPRINT-V1.md` §V1 · `06-PERF-BUDGET.md` · `02-SECURITY-BOUNDARY.md` §6 |
| **Ne lit pas** | `04-DESIGN-SYSTEM.md` — aucune décision visuelle dans cette session |
| **Touche** | `src/services/log.ts` · `src/services/jarvis.ts` · finance · consultation |
| **Checkpoint** | `bash scripts/checkpoint-v1.sh` |

**Ordre imposé à l'intérieur de la session.** V1.1 en premier, seul, et validé avant
tout le reste. Debugger avec des erreurs qui disent `"inattendu"` coûte plus cher que
d'écrire d'abord de vraies erreurs.

**Interdits de cette session, explicitement :**
```
✗ toute fonctionnalité nouvelle, même « pendant qu'on y est »
✗ toute modification visuelle
✗ NEXT_PUBLIC_ devant une clé d'API — c'est R3, il n'y a pas de cas particulier
✗ tout refactor non nécessaire au correctif
```

**Vert si, et seulement si :** les 7 contrôles du §V1 passent, dont
`grep OPENROUTER .next/static/` → 0 et Patients → Agenda < 400 ms en build.

---

## V2 — JARVIS VIVANT

| | |
|---|---|
| **Agent** | `jarvis-tooler` · **sonnet** |
| **Lit** | `SPRINT-V1.md` §V2 · `03-JARVIS-TOOLS.md` §1–4 · **ADR-023** · **ADR-024** |
| **Ne lit pas** | `JARVIS-DEMO-SPEC.md` — **archivé**, périmètre S6 périmé |
| **Prérequis** | ADR-023 et ADR-024 collés dans `00-DECISIONS.md`. `GROQ_API_KEY` et `ELEVENLABS_API_KEY` dans `.env`, **sans** `NEXT_PUBLIC_` |
| **Checkpoint** | `bash scripts/checkpoint-v2.sh` + les 9 contrôles du §V2 |

**Cinq outils, gelés.** `analyze_session` · `search_patients` · `get_agenda` ·
`create_appointment` · `set_consultation_price`. **Un sixième outil ajouté dans cette
session est un défaut de revue**, pas une amélioration.

**La frontière d'ADR-023 se code, elle ne se prompte pas.** Une question qui nomme un
patient et demande une conclusion doit être refusée par une règle du système, pas par
la bonne volonté du modèle. Les 7 questions du tableau d'ADR-023 sont le contrôle.

**Interdits :**
```
✗ SpeechRecognition / webkitSpeech — grep doit rendre 0, dans les deux modes
✗ un fetch('https://…') hors _shared/external-call.ts
✗ une écriture sans confirmed_at
✗ Jarvis qui choisit entre deux homonymes
```

---

## V3 — DESIGN v2

| | |
|---|---|
| **Agent** | `ui-builder` · **sonnet** |
| **Skills à charger** | `impeccable` **et** `frontend-design` — avant la première ligne |
| **Lit** | `04-DESIGN-SYSTEM.md` · **ADR-022** · `05-UX-CONTRACT.md` |
| **Prérequis** | ADR-022 approuvé · `mindcare-mark.svg` validé par la praticienne |
| **Checkpoint** | `bash scripts/checkpoint-v3.sh` |

**Cette session ne livre aucune fonctionnalité.** Elle pose les jetons, les primitives
et le mouvement, puis les applique aux écrans existants. Si un bouton manquant est
repéré, il est **noté dans STATE.md**, pas ajouté.

**La seule règle qui ne se négocie pas :** aucun dégradé, aucune transparence derrière
une dose, un score, une note, un montant, une heure, un nom. Le reste devient franchement
coloré — c'est l'objet même d'ADR-022.

**Interdits :**
```
✗ un hex en dur hors tokens.css
✗ un dégradé hors de la liste fermée d'ADR-022
✗ une illustration dans un état vide (§9.8) — une phrase et une action
✗ toucher à une requête, un service, une migration
```

---

## V4 — TABLEAU DE BORD

| | |
|---|---|
| **Agent** | `feature-builder` · **sonnet** · porte SQL par `db-migrator` · **opus** |
| **Lit** | `SPRINT-V1.md` §V4 · `05-UX-CONTRACT.md` · `06-PERF-BUDGET.md` |
| **Prérequis** | V3 clos — le tableau de bord se construit **avec** le design v2, jamais avant |
| **Checkpoint** | `bash scripts/checkpoint-v4.sh` |

**Un seul appel serveur pour tout l'écran.** `app.dashboard_today()`, porte SQL,
même discipline que `029` et `030` : transaction unique, bornes `Africa/Algiers`,
cloisonnement par rôle **en base** (D-14), jamais en JavaScript.

**Aucun chiffre inventé.** Pas d'objectif mensuel : il est décoratif, donc absent
(réponse Q14). Un indicateur sans donnée réelle affiche son état vide, il ne s'invente
pas une valeur plausible.

**Interdits :**
```
✗ plus d'un appel réseau au chargement — vérifié dans l'onglet Réseau
✗ un chiffre dont on ne peut pas montrer la ligne en base
✗ un graphique décoratif
```

---

## V5 — PATIENTS & AGENDA

| | |
|---|---|
| **Agent** | `feature-builder` · **sonnet** |
| **Lit** | `SPRINT-V1.md` §V5 · `05-UX-CONTRACT.md` · `MODULE-MAP.md` §2 |
| **Checkpoint** | `bash scripts/checkpoint-v5.sh` + le parcours humain complet |

**Le vert de cette session est un parcours, pas un script.** Créer un vrai patient,
lui prendre un rendez-vous, le déplacer, le marquer arrivé, démarrer sa séance —
**sans aide, sans documentation, sans Ayoub à côté**. Si une seule étape demande une
explication, c'est rouge.

**Limite connue à ne pas masquer.** `appt_no_overlap` (`006`) ne bloque qu'un
`starts_at` identique. Deux rendez-vous qui se chevauchent passent. La fermer demande
`btree_gist` + `EXCLUDE` : **hors périmètre**, écrit dans STATE.md, **jamais**
contourné par une vérification en JavaScript qui ne serait qu'une convention de plus.

**Interdits :**
```
✗ un bouton d'action caché dans un menu — « Nouveau patient » est visible ou n'existe pas
✗ une recherche qui rate « bel-kacem » : un doublon en psychiatrie est un risque
✗ toucher au design system
```

---

## V6 — FINANCE, DOCUMENTS, FINITION

| | |
|---|---|
| **Agent** | `feature-builder` · **sonnet** · migration `031` par `db-migrator` · **opus** |
| **Lit** | `SPRINT-V1.md` §V6 · `DOCUMENT-TEMPLATES-v2.md` · `S7A-FINANCE.md` §recette |
| **Prérequis** | `031_seed_document_templates.sql` appliquée · logo validé · nom, n° d'ordre et téléphone saisis dans `app.profiles` |
| **Checkpoint** | `bash scripts/checkpoint-v6.sh` + **le contrôle papier** |

**Le contrôle papier a changé de nature — et c'est écrit ici pour qu'on ne le rate pas.**
Les fautes sont corrigées (A1→A10) et le logo est nouveau : l'objectif n'est plus
« reproduire son papier à l'identique », c'est **« établir son nouveau papier à
en-tête »**. Le critère devient : *elle imprime, elle regarde, elle approuve.*
Cette approbation est **la clôture du jalon**. Aucune autre signature ne la remplace.

**Conversion nombre → lettres.** Code testé, jamais saisi à la main. Cas obligatoires :
`71` soixante et onze · `80` quatre-vingts · `81` quatre-vingt-un · `100` cent ·
`180` cent quatre-vingts · `200` deux cents. Plage à couvrir : **1 → 365 jours**.

**Interdits :**
```
✗ un graphique financier sans chiffre réel derrière
✗ un modèle de certificat écrit ou complété par l'agent
✗ le nom, le n° d'ordre ou le téléphone en dur dans une migration — voir 031
✗ imprimer doc_number sur le papier (ADR-010 : il reste interne)
```

---

## 2. RÉPARTITION DES MODÈLES — la règle qui tient le quota

| Rôle | Modèle | Raison |
|---|---|---|
| `db-migrator` | **opus** | Une RLS fausse expose un dossier psychiatrique. Irréversible. |
| `security-reviewer` | **opus** | Le coût d'une faille est infini. |
| `feature-builder` · `ui-builder` · `jarvis-tooler` | **sonnet** | Volume, contrat déjà écrit, risque faible. |
| `checkpoint-runner` · `scribe` | **haiku** | Lance un script, lit vert ou rouge. Réécrit 40 lignes. |

**Opus ne touche que le schéma et la revue de sécurité.** Deux sessions sur six.
C'est ce ratio qui fait tenir le quota jusqu'au bout.

---

## 3. SI UNE SESSION MEURT SANS `/handoff`

La suivante commence par ceci, et **ne fait rien d'autre** avant d'avoir reconstruit
l'état :
```bash
git log --oneline -5 && git status --short && cat STATE.md
```

---

*Ce fichier ne change pas pendant les 6 sessions. Si tu veux le changer, tu as un
problème de plan, pas de protocole.*
