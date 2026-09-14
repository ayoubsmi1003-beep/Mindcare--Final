# AGENTS.md — MindCare OS · cerveau L0 (protocole + pointeurs, ≤ 120 lignes)

> Les 10 règles absolues vivent dans `CLAUDE.md` §1 — les lire avant tout changement.
> Les décisions gelées vivent dans `docs/00-DECISIONS.md`. La vérité exécutable :
> `supabase/migrations/` + tests. Rien ici n'est dupliqué : ce fichier pointe.

## 1. Identité

Logiciel de gestion d'un cabinet de psychiatrie (Alger), loi 18-07. Monolithe
modulaire local-first : Next.js 15 + PostgreSQL 16 local + Electron.
Sûreté clinique et auditabilité > commodité. La praticienne tranche ;
l'IA propose, l'humain confirme, la base journalise.

## 2. Hiérarchie d'autorité (détail : `docs/DOC-AUTHORITY.md` §1)

`CODE + TESTS EXÉCUTABLES` > `migrations` > `contrats actifs` >
`ARCHITECTURE.md` > `index ADR` > `STATE-INDEX.md` > `histoire`.
Un document ne bat jamais le code vérifié. Contradiction →
noter `DOCUMENT / CODE / RÉALITÉ VÉRIFIÉE / ACTION` dans `ARCHITECTURE.md`
§ Écarts, corriger le doc si sûr, sinon décision humaine.
⚠️ `DOC-AUTHORITY` D-17 (« dev sur Supabase Cloud ») est dépassé par la réalité
locale (pg embarqué, ADR-001, commit `e841955`) — ratification humaine en attente.

## 3. Protocole de contexte (L0 → L6)

Tâche → manifeste `context/<tâche>.md` (ou le plus proche) → README du domaine
→ contrat → fichiers cibles → tests cibles. L6 (archive, `STATE.md`, preuves
PNG) : jamais par défaut. Le `DO NOT LOAD` d'un manifeste est une interdiction.
Budget : L0+L1 ~3–6 Ko, tâche ordinaire ~20–40 Ko. Au-delà → rescoper, pas lire.

## 4. Protocole no-loop (canonique ici)

`TASK / SCOPE / ENTRYPOINT / STOP CONDITION` avant toute action. Ne suivre une
référence que si la tâche l'exige. Découverte hors périmètre → `OUT-OF-SCOPE`,
on continue. Succès → `STOP`, aucun refactor opportuniste.
Budget de changement : seuls les fichiers requis ; tout élargissement
s'explique et s'ajoute au périmètre.

## 5. Règles d'exécution

- Une écriture métier = une porte Postgres
  (périmètre · verrou · transition · écriture · trace). Jamais d'autorisation en JS.
- Lecture d'un dossier : portes `app.search_patients` / `app.get_patient` uniquement.
- Aucun `DELETE` clinique/financier ; note verrouillée (`locked_at`) intouchable.
- Montants : `integer amount_dzd`. Dates : `timestamptz`, bornes `Africa/Algiers`.
- UI en français, aucune chaîne en dur hors `src/i18n/`. Couleurs : `tokens.css` seul.
- Migration appliquée : jamais éditée (`0NN_sujet.sql`). Colonne/table/enum
  hors `01-SCHEMA`/ADR → **stop, demander**.
- Secrets : env serveur uniquement, jamais `NEXT_PUBLIC_*`, jamais au terminal
  (`.env` illisible — hook `guard-bash.sh`).

## 6. Vérification = preuve minimale suffisante

Doc → relecture ciblée. Code → test ciblé (+ checkpoint/eval si surface touchée).
`tsc`/`eslint` si pertinent. E2E/navigateur seulement si l'UI est touchée.
« Ça compile » ≠ terminé. Distinguer `PASS / FAIL / NOT RUN`
(un skip silencieux = dispositif FAIL).

## 7. NE PAS TOUCHER (sans décision humaine)

`STATE.md` (journal actif) · `docs/archive/` (hook) · migrations appliquées ·
PII dans les docs · fusion du registre Jarvis (Phase 5) ·
`fr.ts` et god-files (découpe Phase 6).

## 8. Fin de tâche — rapport court

`DONE / CHANGED / DELETED / VERIFIED / NOT DONE / OUT-OF-SCOPE / NEXT`.
Pas de roman pour 3 fichiers.

Pointeurs : `ARCHITECTURE.md` · `STATE-INDEX.md` · `docs/domains/` · `docs/contracts/` ·
`context/` · `tests/MAP.md` · `scripts/README.md`
