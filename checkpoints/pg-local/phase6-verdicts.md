# Phase 6 — retrait de Supabase et jeu doré

Base `mc-p3` **reconstruite depuis zéro** dans l'ordre de l'installateur :
`000_platform_compat` → 69 migrations (071 incluse) → `010_app_role`.

## Verdicts

| # | Propriété | Moyen | Verdict |
|---|---|---|---|
| 1 | `@supabase/supabase-js` retiré des dépendances | package.json | ✅ 0 |
| 2 | CLI `supabase` retiré | package.json | ✅ 0 |
| 3 | `node_modules/@supabase` absent | disque | ✅ |
| 4 | `src/services/db/supabase.ts` supprimé | disque | ✅ |
| 5 | `src/lib/env.ts` supprimé (n'existait que pour lui) | disque | ✅ |
| 6 | `supabase/functions/` supprimé (5 fonctions + `_shared`) | git rm | ✅ |
| 7 | `scripts/deploy-edge.sh` supprimé | disque | ✅ |
| 8 | `NEXT_PUBLIC_SUPABASE_*` retirées de `.env.example` | grep | ✅ |
| 9 | Aucun import du SDK dans `src/` | grep | ✅ 0 |
| 10 | `grep SUPABASE .next/static/` | build | ✅ **0** |
| 11 | Jeu doré : 20 patientes, 50 séances, 50 notes | SQL | ✅ 8/8 |
| 12 | Intégrité référentielle : 0 orphelin | SQL | ✅ |
| 13 | 431 traces d'audit produites par le semis | SQL | ✅ |
| 14 | Numérotation sans trou : 20 numéros distincts | SQL | ✅ |
| 15 | **ADR-004 : note verrouillée refuse la réécriture** | SQL | ✅ |
| 16 | **ADR-003 : la Dr #2 ne voit rien du jeu doré** | SQL | ✅ |
| 17 | `ROLLBACK` — la base revient à son état initial | SQL | ✅ |
| 18 | 106 tests · typecheck · lint · build · preflight | outillage | ✅ |
| 19 | Frontière HTTP · Jarvis · 7 écrans | 3 checkpoints | ✅ 24+22+31 |

## Le défaut trouvé — troisième occurrence du même piège

**`071_egress_gatekeeper.sql` échouait sur toute installation NEUVE.**

Son assertion appelait `has_table_privilege('mindcare_app', …)`, or
`has_table_privilege()` **lève** quand le rôle n'existe pas — et sur une base
fraîche il n'existe pas encore : le bootstrap 010 est joué APRÈS la chaîne de
migrations. La migration passait sur la base déjà provisionnée de la phase 5, et
échouait sur une base propre.

Le correctif est double, parce que le défaut l'était :

* l'assertion est gardée par l'existence du rôle ;
* **`010_app_role.sql` accorde désormais aussi la porte 071**, geste symétrique
  qui manquait — sans lui, le bloc conditionnel de 071 est sauté et
  l'application ne peut plus écrire le journal de franchissement.

⚠️ **Pourquoi c'était plus grave que les deux occurrences précédentes.** Un
défaut d'authentification se voit immédiatement : personne ne peut entrer. Ici,
`journaliser()` **avale délibérément ses échecs**, pour qu'une panne de journal
ne fasse jamais échouer l'appel clinique qu'elle documente. La conséquence
aurait donc été un journal des sorties vers l'IA qui **cesse d'être écrit sans
que rien ne le dise**, pendant qu'on continue de lui faire confiance — exactement
ce que l'en-tête de 071 décrit comme pire que pas de journal du tout.

Seule une reconstruction depuis zéro l'a montré. C'est la troisième fois dans
cette migration : **le vert incrémental ne prouve rien de l'installation neuve.**

## Le jeu doré accuse le schéma à tort — et c'était le test qui avait tort

La première rédaction du contrôle d'immutabilité clôturait la séance, tentait de
réécrire la note, et concluait « ADR-004 est tombée ». **Verdict ROUGE, schéma
parfaitement sain.**

Ce que dit réellement la migration 008 :

* `close_consultation` ferme la SÉANCE — elle ne verrouille pas la note ;
* `sign_note` pose `status='signed'`, et `trg_note_sign` pose alors
  `lock_after = now() + 15 minutes` ;
* `trg_note_immutable` ne refuse que si `status='signed' AND now() > lock_after`.

Il y a donc une **fenêtre de grâce de quinze minutes** après signature — un choix
clinique délibéré. Le test réécrit éprouve les deux moitiés : le verrou différé
est bien posé, et une fois la fenêtre passée la réécriture est refusée.

## Trois invariants du schéma découverts en semant

Le semis passe par les PORTES, jamais par des `INSERT`. Trois règles ont fait
échouer des versions plus naïves, et chacune est une garantie clinique réelle :

1. une séance se rattache toujours à un rendez-vous (026) ;
2. une seule séance ouverte par praticienne à la fois (026) ;
3. une séance sans tarif ne peut pas être close (037) — le geste clinique et le
   geste comptable sont noués en base.

Un `INSERT` direct les aurait contournées toutes les trois, et le checkpoint
serait passé au vert sans rien prouver.

Le comptage des numéros de dossier a lui aussi dû passer par
`app.search_patients` : `FROM app.patients` est refusé — « permission denied » —
parce qu'ADR-019 tient, même pour un checkpoint.

## Ce qui reste, et pourquoi

* **`supabase/migrations/` et `supabase/bootstrap/`** sont conservés : c'est le
  chemin du schéma, pas une dépendance à Supabase. Artefact documenté, prévu par
  le plan.
* **Des commentaires** mentionnent encore Supabase dans `src/` — ils expliquent
  d'où vient le code et pourquoi il a cette forme. Les supprimer détruirait le
  raisonnement sans retirer une seule dépendance. Le critère retenu est donc
  **zéro dépendance fonctionnelle**, vérifié ci-dessus, et non zéro occurrence
  du mot.
* ⚠️ **`.env.openrouter-edge-orphelin` à la racine.** `supabase/functions/.env`
  contenait une clé OpenRouter **différente** de celle de la racine. Elle n'a
  jamais été commitée. Plutôt que de détruire un secret distinct, il est déplacé
  et couvert par `.gitignore` (vérifié). **Décision à prendre : la conserver ou
  la révoquer.**

## Non prouvé à ce stade

* Aucune migration de données réelles n'a eu lieu — conformément à la décision
  initiale (ADR-016 : cloud-dev en données synthétiques uniquement). Le §19
  « source == cible » est donc prouvé sur le jeu doré, pas sur un export.
* Ordonnances, documents émis et paiements encaissés ne sont pas dans le jeu
  doré : ils demandent des gabarits et un contexte de rendu que le semis
  n'installe pas. `verify_document_hash` reste donc non exercé.
