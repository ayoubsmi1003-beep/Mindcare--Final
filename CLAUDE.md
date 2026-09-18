# CLAUDE.md — MindCare OS

> Tu construis le logiciel de gestion d'un cabinet de psychiatrie à Alger, utilisé
> quotidiennement par une médecin, avec de vraies données patients, sous la loi 18-07.
> Lis ce fichier entièrement avant toute action.

**v2 — 2026-08-09.** Remplace la v1, qui décrivait Fastify · React/Vite · Postgres natif ·
routes `/v1/` — une pile qui n'a jamais existé dans ce dépôt. Si tu lis un document qui
parle d'API REST versionnée ou d'ORM, **tu lis un fichier archivé** : arrête-toi et
ouvre `DOC-AUTHORITY.md` §2.

---

## 1. LES DIX RÈGLES ABSOLUES

Elles ne se discutent pas et ne se contournent jamais.
⚠️ **Les numéros 1, 4 et 8 sont cités par ADR-019, D-14 et S7B. Ne les renumérote pas.**

**1 — Aucune donnée identifiante patient ne quitte la machine.**
Ni vers un cloud, ni dans un log, ni dans une requête de télémétrie, ni dans un message
d'erreur affiché. Tout appel externe passe par `src/server/egress/external-call.ts`, **point de
sortie unique**, après pseudonymisation. Un `fetch('https://…')` ailleurs n'est pas une
entorse de style : c'est l'architecture qui tombe.

**2 — Aucune clé, aucun secret dans le code ni côté client.**
Variables d'environnement serveur uniquement. `NEXT_PUBLIC_` devant une clé d'API est
interdit, sans cas particulier. Contrôle : `grep -r "OPENROUTER\|GROQ\|ELEVENLABS" .next/static/`
doit rendre 0.

**3 — Aucun `DELETE` sur une donnée clinique ou financière.**
`deleted_at`. Et aucun `UPDATE` sur une note dont `locked_at` n'est pas nul : la base
le refuse (ADR-004), ne tente pas de contourner.

**4 — La sécurité vit en base, jamais en JavaScript.**
Le filtrage par rôle, le cloisonnement par praticien, les transitions d'état : RLS,
contraintes, déclencheurs, portes SQL. Un `if (role === …)` dans un service est un
**bug de conception**, pas une précaution supplémentaire. Le front-end n'est jamais
une frontière de sécurité.

**5 — Une écriture métier = une transaction.**
Changement d'état + trace d'audit dans la **même** transaction, écrite en fonction
Postgres. PostgREST n'expose pas de transaction multi-requêtes : une atomicité promise
côté client serait fausse, ce qui est pire que son absence (ADR-020).

**6 — La lecture d'un dossier patient passe par une porte qui journalise.**
`app.search_patients` et `app.get_patient`. Le `SELECT` direct sur `app.patients` est
**révoqué** (ADR-019). Lire un dossier sans laisser de trace n'est pas un manque de
rigueur, c'est un `permission denied`.

**7 — Jarvis propose, l'humain confirme, la base journalise.**
Aucune écriture sans `confirmed_at`, écrit **avant** l'exécution. Aucun outil hors
allowlist. Jarvis hérite des permissions de l'utilisateur, il ne les élève jamais.
La sécurité par le prompt n'existe pas.

**8 — Aucune donnée fictive dans une fonctionnalité livrée.**
Ni patient d'exemple, ni chiffre plausible, ni graphique décoratif, ni certificat
approximatif. Une fixture de test vit **dans la transaction du checkpoint**, jamais
dans un seed livré. Un écran sans donnée affiche son état vide.

**9 — Ne jamais modifier une migration déjà appliquée.**
Créer `0NN_nom.sql`. Et ne jamais créer une table, une colonne, un type ou une valeur
d'enum absents de `01-SCHEMA.md` ou des ADR. Si tu penses qu'il en manque un :
**arrête-toi et demande.**

**10 — Ne jamais dépasser le périmètre de la tâche demandée.**
Pas de refactor spontané, pas de fonctionnalité bonus, pas de « tant qu'on y est ».
Une idée hors périmètre se note dans `STATE.md`, elle ne se code pas.

---

## 2. STACK RÉELLE

| Couche | Choix |
|---|---|
| Framework | **Next.js 15, App Router**, React 19 |
| Langage | TypeScript strict (`strict`, `noUncheckedIndexedAccess`) |
| Écritures | Routes internes **`/api/*`** (`db/select`, `db/rpc`) — aucune API REST versionnée (ADR-003) |
| Base | **PostgreSQL 16 local auto-hébergé** — RLS, Auth locale, Electron embarqué (ADR-001) |
| Accès données | **`DbPort`** (`select`, `rpc`, auth, provision) — ADR-020 |
| Adaptateur | `src/server/db/pool.ts` — **seul fichier autorisé à importer `pg`** (valeur) |
| SQL | Écrit à la main, dans les migrations. **Pas d'ORM.** |
| Validation | Zod, sur chaque entrée |
| Style | Tailwind + jetons de `src/styles/tokens.css` |
| Fontes | `next/font` — auto-hébergées au build, zéro réseau à l'exécution |
| Paquets | pnpm |

**Pourquoi pas d'ORM.** Le schéma contient des déclencheurs, des contraintes, du RLS et
des portes `SECURITY DEFINER`. Un ORM les masque et génère des requêtes qui les violent.

**Pourquoi `DbPort`.** Le jour du passage à l'auto-hébergé, puis à Electron, on branche
un second adaptateur sans toucher un service. Garanti par `no-restricted-imports`, donc
par une erreur de compilation — pas par une consigne.

---

## 3. STRUCTURE

```
src/
  app/                     routes App Router + routes `/api/*` internes
  services/
    db/http.ts             adaptateur navigateur (même origine, cookie httpOnly)
    db/port.ts             l'interface DbPort
    <domaine>.ts           patients, agenda, consultations, finance, documents, jarvis
    log.ts                 journal — porte toujours la cause, jamais un nom
  components/              primitives partagées
  styles/tokens.css        SEUL endroit où vit une couleur
  i18n/                    aucune chaîne en dur ailleurs
supabase/migrations/       001 … NNN — jamais modifiées
docs/                      les documents d'architecture
docs/archive/              INTERDIT à tout agent (guard-bash.sh)
scripts/                   provisionnement et checkpoints
```

**Dépendances vers l'intérieur uniquement.** Un composant appelle un service ; un service
appelle `DbPort` ; `DbPort` appelle une porte SQL. Jamais l'inverse, jamais en travers.

---

## 4. CONVENTIONS

| Élément | Convention | Exemple |
|---|---|---|
| Tables, colonnes | `snake_case`, pluriel | `clinical_notes` |
| Portes SQL | `app.<verbe>_<objet>` | `app.issue_document` |
| Fonctions, variables | `camelCase` | `confirmAppointment` |
| Types, composants | `PascalCase` | `PatientCard` |
| Fichiers TS | `kebab-case` | `patient-service.ts` |
| Migrations | `0NN_sujet.sql` | `031_seed_document_templates.sql` |

**Dates :** `timestamptz`. Toute borne de journée se calcule en **`Africa/Algiers`** —
Postgres tourne en UTC, une recette « du jour » calculée en UTC est fausse une heure par nuit.

**Montants :** `integer amount_dzd`, dinars **entiers**. Aucun centime, aucun flottant (ADR-018).

**Langue :** interface intégralement en français. Aucune chaîne en dur, y compris les
messages d'erreur et les états vides (ADR-008).

---

## 5. LE PATRON D'ÉCRITURE — en base, pas en TypeScript

Toute opération qui modifie l'état est une **fonction Postgres**, appelée par `rpc`.

```sql
CREATE FUNCTION app.<action>(…) RETURNS … AS $$
BEGIN
  -- 1. valider les arguments et le périmètre
  -- 2. SELECT … FOR UPDATE   → sérialiser les appels concurrents
  -- 3. vérifier la transition d'état (déclencheur ou test explicite)
  -- 4. écrire
  -- 5. tracer via trg_audit (013) — jamais un mécanisme parallèle
END $$;
```

**Cinq éléments, toujours : périmètre · verrou · transition · écriture · trace.**

**Ce que la fonction ne fait jamais :**
- tester un rôle applicatif — **la RLS décide** (règle 4) ;
- accepter `cabinet_id` ou `practitioner_id` de l'appelant — ils viennent de
  `app.current_cabinet()` et `auth.uid()` ;
- distinguer « introuvable » de « hors périmètre » dans son message d'erreur : les deux
  rendent la même chose, sinon on a fabriqué un oracle d'existence (ADR-003).

---

## 6. NUMÉROTATION SANS TROU

`app.next_number(cabinet, type, periode)` — table compteur, **jamais** une `SEQUENCE`.
Une séquence Postgres saute un numéro à chaque rollback : sur un reçu ou un certificat,
un trou est une anomalie comptable. La période se calcule en `Africa/Algiers`.

---

## 7. AVANT DE DIRE « TERMINÉ »

```
1. Fonctionne avec des données réelles, pas un jeu d'essai
2. RLS vérifiée pour les 3 rôles — même ceux dont le front n'existe pas encore
3. Se dégrade proprement si le réseau tombe
4. Les 5 états de docs/design-system/UX_CONTRACT.md sont écrits ET déclenchables à la demande
5. Jetons du design system respectés — aucun hex hors tokens.css
6. Budget de 06-PERF-BUDGET.md tenu, mesuré en build
7. Checkpoint vert reproductible par script
```

---

## 8. LES QUATRE SIGNAUX D'ARRÊT

Arrête la session immédiatement si :
1. **Le même test échoue trois fois.** Le problème n'est pas où tu cherches. `/handoff`.
2. **Tu réexpliques une règle déjà écrite.** Elle manque ici ou dans le prompt de l'agent.
3. **Un sous-agent rend plus de 30 lignes.** Son prompt est trop vague.
4. **Tu es tenté d'ajouter une fonctionnalité non listée.** Note-la dans `STATE.md`.

---

## 9. ORDRE DE LECTURE, ET RIEN D'AUTRE

```
CLAUDE.md → DOC-AUTHORITY.md → STATE.md → le contrat de la session
```

`DOC-AUTHORITY.md` §2 liste les documents **interdits**. Ils contredisent le schéma
actif et coûtent des sessions entières en reprise. Ne les ouvre pas, même par curiosité,
même pour vérifier.

---

*Si un choix technique contredit ce fichier, ce fichier gagne — sauf face à une migration
appliquée, qui gagne sur tout.*
