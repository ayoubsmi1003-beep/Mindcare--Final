# STATE — MindCare OS
Dernière mise à jour : 2026-08-02 · commit 2fd1acb + S1 schéma

## Fait & vert
- 5cd3d3e T1.2 jetons CSS, i18n FR, durcissement I10 · 4 portes vertes · 6 passes adversariales → VERT
- 7fcc34d S0 provision scripté `s0-provision.sh` · checkpoint testés · 4 refus → VERT
- 2fd1acb ADR-016 garde-fou synthétique, Postgres 15 jetable, 16 contrôles → VERT
- S1 migrations 001→016 · checkpoint-j1a.sh VERT 12 contrôles, rejoué 3× · non appliquées cloud

## SESSION 2026-08-03 — cloud appliqué, ADR-019 mise en défaut
**19 migrations appliquées sur `ftxaseynjvjevwybdoii`** (Session pooler, IPv4). Les schémas
`app` et `audit` **existent** : l'étape « Exposed schemas » du Dashboard est enfin possible.

`checkpoint-j1a` : **10 VERT, 2 ROUGE** (T2, T8) — même cause unique, Q-D.

**ADR-019 n'avait jamais été exécutée, seulement vérifiée statiquement.** Au premier passage en
base elle s'est révélée inapplicable, puis sa réparation évidente s'est révélée dangereuse :
- 017 (`SECURITY INVOKER` + `SELECT` révoqué) → les deux portes butent sur leur propre révocation.
- 018 (`SECURITY DEFINER`) → **a fait tomber la cloison praticiennes**, parce que `postgres` porte
  `rolbypassrls = t`. Mesuré, pas supposé. **Annulé par 019.** Leçon à ne pas réapprendre :
  pour juger si la RLS s'applique, `rolsuper` ne suffit pas — **lire `rolbypassrls`.**
- 019 rétablit l'état sûr : portes inutilisables, **aucune fuite**. On prend le blocage plutôt
  que la fuite : une porte fermée se rouvre, une donnée lue ne se dé-lit pas.

Détail et piste de réparation : **Q-D, §7 de WORKING-CONTEXT**. Rien à coder avant arbitrage.

**Toujours pas de commit** : S2 ne peut pas être vert tant que Q-D est ouverte.

## En cours
**S2 écrit et statiquement vert ; NON COMMITTÉ** — `checkpoint-s2.sh` rend BLOQUÉ (11 VERT,
3 BLOQUÉ, 0 ROUGE). Les 3 exigent la base. Aucun commit tant que les six portes ne sont pas vertes.

Séquence de déblocage, dans cet ordre — l'exposition du schéma vient APRÈS la migration, le
sélecteur du Dashboard ne listant que les schémas qui existent :
1. `.env` → chaîne **Session pooler** (Dashboard → Settings → Database → Connection string →
   onglet Session pooler ; utilisateur `postgres.<ref>` avec un point, hôte
   `aws-0-<région>.pooler.supabase.com`). L'actuelle est la connexion directe, IPv6 seul,
   incompatible avec le réseau Docker.
2. `bash scripts/verify-migrations.sh` → VERT (déjà vérifié)
3. `bash scripts/db-migrate.sh` → crée `app` et `audit`, applique 001→017
4. `bash scripts/checkpoint-j1a.sh` → 12 contrôles (passe par psql, pas par PostgREST)
5. Dashboard → **Data API → Exposed schemas → ajouter `app`** (possible seulement maintenant).
   ⚠️ `audit` apparaîtra dans le même sélecteur : **ne pas le cocher** — c'est ce qui rend le
   journal d'audit illisible par l'API, et toute la conception de 017 repose dessus.
6. `bash scripts/checkpoint-s2.sh` → attendu VERT sur 14
7. Commits : T1 (garde-fou statique + seed synthétique), puis T2 (couche services)

## Dette assumée, datée
- D-01 RALLUMÉE — projet fnrcxlewbuqgpgykwfwg (clés compromises, .mcp.json) → supprimer + nouveau
- D-04 Transcription Groq absent → 2026-08-13
- D-08 Front assistante absent → 2026-08-13
- Sauvegarde non testée → 2026-08-06
- Ordonnances saisies non imprimées → mois 2 (Phase 2)
- Consentements papier → mois 2 (Phase 2)
- ~~Bandeau « données fictives » ADR-016~~ **FAIT** — `SyntheticDataBanner.tsx`, valeur lue en
  base, jetons `--attention`, défaut sûr (s'affiche pendant le chargement ET en erreur)
- ~~**Q-B — audit des LECTURES**~~ **TRANCHÉ — ADR-019.** `pgaudit` rejeté en cloud : il
  journalise le texte de la requête, donc le `patient_id`, vers un log qui quitte la machine (I5).
  `SELECT` révoqué sur `app.patients` ; lecture par `app.get_patient` / `app.search_patients`,
  qui journalisent avant de retourner. Migration `017`.
  **Nouvelle dette datée :** `pgaudit` en SECOND FILET à la migration auto-hébergée (ADR-001),
  où le log ne quitte plus le PC du cabinet. Ni avant, ni à la place.
- **Limite écrite, à ne pas enjoliver :** un superutilisateur Postgres lit toujours `app.patients`
  en direct. Même portée qu'ADR-016 §3 — *effectivement* fermé pour l'application, PostgREST,
  les edge functions et Jarvis ; pas *inviolable*.
- `app.payments` : l'assistante n'a que SELECT, donc ne peut pas renseigner
  `collected_by`/`collected_at`. Constat du §10.1 de 01-SCHEMA, non comblé volontairement.
- Décisions en base (ADR-016 cloud, ADR-017 `reason`, ADR-018 `integer amount_dzd`) → 00-DECISIONS.md

## Bloqué, attente humaine
- 7 fontes .woff2 (Geist Sans/Mono · Newsreader · Plex Arabic) → bloque S2
- Logo SVG de cabinet
- Liste des ~60 molécules réellement prescrites → 015 n'en sème AUCUNE, exprès ; les échelles
  (PHQ-9, GAD-7, HDRS, YMRS) sont semées **inactives et sans barème** pour la même raison :
  inventer une posologie ou un seuil vraisemblable est plus dangereux qu'une table vide (I19)
- PC serveur cabinet (16–32 Go) → déclenche la migration hors cloud (ADR-016 → ADR-001)

## Prochaine tâche
Dérouler les 7 étapes de « En cours ». Rien à écrire : S1 et S2 sont prêts, seul
l'environnement bloque. Après le vert, S3 = écrans Patients et Agenda sur la couche services
(agent feature-builder) — toujours en attente des 7 fontes `.woff2`.

## Leçon de cette session, à ne pas réapprendre
**Trois garde-fous de ce dépôt ont mordu sur leurs propres commentaires** (`preflight` contrôles
1/2/8b, `verify-migrations` contrôle 6, `checkpoint-s2` contrôle 5). Un contrôle qui inspecte du
CODE doit dépouiller les commentaires avant de chercher ; sinon il crie à tort, et un contrôle qui
crie à tort finit désactivé — donc protège moins. **Exception délibérée : le contrôle 2 du
préflight (secrets) n'est PAS dépouillé.** Qu'il morde aussi dans un commentaire est une qualité :
c'est ce qui attrape une clé collée « juste pour tester ».
