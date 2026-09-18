# Plan — Audit des comptes locaux & création minimale

> Mode PLAN — lecture seule. Aucune écriture en base n'a été effectuée. Toutes les données ci-dessous proviennent d'exécutions réelles (pg via `DATABASE_URL` et `MINDCARE_DATABASE_URL`), pas d'une lecture de code.

## 1. Cartographie réelle (vérifiée en base le 2026-08-31)

### 1.1 Deux bases, deux vérités — c'est le point central

| Base | URL | `app.schema_migrations` | `auth.users` | `app.profiles` |
|---|---|---|---|---|
| **CLOUD** (Supabase pooler `ftxaseynjvjevwybdoii`) | `DATABASE_URL` | 67 lignes, max `069_case_summary_schema2` (manque `070_local_auth`–`072`) | 3 lignes | 3 lignes |
| **LOCAL** (`mc-p3` 127.0.0.1:55441, `mindcare`) | `MINDCARE_DATABASE_URL` (`mindcare_app:p3app`) | `072` (complet, incluant `070_local_auth`) | 6 lignes | 6 lignes |

`Next.js` (`src/server/db/pool.ts:29`) lit `MINDCARE_DATABASE_URL` → **LOCAL** pour `/api/auth/sign-in` (`auth.verify_password`) et `/api/db/*` (`withCaller`). Le CLOUD est encore la source utilisée par les scripts `db-migrate.sh`/`dburl.sh` et par les anciens checkpoints. Un compte rendu `CONNEXION-IMPOSSIBLE` sur LOCAL est donc **inconnectable pour l'application**, même s'il est bcrypt sur CLOUD.

### 1.2 CLOUD — état détaillé

```
auth.users (3)
 id=a1  email=owner.dev@invalid.local        hp=$2a$06$fkf7...  len=60 sentinel=f confirmed=t last_sign_in=2026-08-31
 id=a2  email=praticien2.dev@invalid.local   hp=$2a$10$DOtw...  len=60 sentinel=f confirmed=t last_sign_in=2026-08-30
 id=a3  email=assistante.dev@invalid.local   hp=$2a$06$GjHI...  len=60 sentinel=f confirmed=t last_sign_in=2026-08-30

app.profiles (3) — cabinet_id=00000000-0000-0000-0000-000000000001
 a1 role=owner        full_name=LARBI. N   title=Dr. speciality_fr=Médecin Spécialiste en Psychiatrie et Psychothérapie  order=16 / 16780 phone=0554813911 is_active=t
 a2 role=practitioner full_name=Larbi N    title=Dr. speciality_fr=Médecin Spécialiste en Psychiatrie                  order=10/14523  phone=0550234512 is_active=t
 a3 role=assistant    full_name=Assistant  title=NULL speciality_fr=NULL                                               order=NULL       phone=NULL       is_active=t

cabinets: id=000...0001 name="Cabinet de developpement" (vide)
deployment: singleton=t environment=cloud-dev
```

Notes :
- **Tous bcrypt**, aucun sentinel. Tous `is_active=t`, tous `confirmed_at` non nul, `deleted_at` null.
- `a1` porte l'identité réelle attendue (`00-DECISIONS` : LARBI N, 16/16780, 0554813911). `a2` porte **aussi** un nom LARBI N mais avec `10/14523` — divergence non expliquée, probablement résidu d'un test.
- RLS `FORCE` sur `app.patients/profiles/appointments/clinical_notes` (vérifié via `pg_class.relforcerowsecurity=t`). Policies OK.

### 1.3 LOCAL — état détaillé

```
auth.users (6)
 a1 owner.dev@invalid.local        hp=CONNEXION-IMPOSSIBLE  sentinel=t confirmed=f (null)
 a2 praticien2.dev@invalid.local   hp=CONNEXION-IMPOSSIBLE  sentinel=t
 a3 assistante.dev@invalid.local   hp=CONNEXION-IMPOSSIBLE  sentinel=t
 e1 essai.phase3@invalid.local     hp=$2a$06$8MTZ... len=60  role practitioner  "Compte d'essai phase 3"
 f1 http.test@invalid.local        hp=$2a$06$Rc1L... len=60  role practitioner  "Compte HTTP"
 f2 drb@invalid.local              hp=$2a$06$L0RA... len=60  role practitioner  "Dr B"

app.profiles (6) — même cabinet_id
 a1 owner        "Praticienne 1 (données de test)" order=TEST/0000 is_active=t
 a2 practitioner "Praticienne 2 (données de test)" order=NULL     is_active=t
 a3 assistant    "Assistante (données de test)"     order=NULL     is_active=t
 e1 practitioner "Compte d'essai phase 3"           is_active=t
 f1 practitioner "Compte HTTP"                      is_active=t
 f2 practitioner "Dr B"                             is_active=t

cabinets: "Cabinet de développement (données de test)"
deployment: cloud-dev
auth schema: verify_password / create_session / resolve_session / destroy_session existent, owner=auth_gatekeeper, RLS FORCE sur auth.users/sessions
```

Notes :
- Les **3 comptes canoniques sont tous sentinel** → `auth.verify_password` les rejette par `v_hash !~ '^[$]2[aby][$]'` (070 §4a, filtre bcrypt). Ils sont **inconnectables pour l'app**, contrairement au CLOUD.
- 3 comptes de test supplémentaires (`e1,f1,f2`) existent, tous practitioner, tous bcrypt, tous `is_active=t`. Ils violent l'exigence "exactement un praticien + une assistante".
- `mindcare_app` n'a **pas** `SELECT` sur `auth.users` (070 §6 vérifié) et n'a que `EXECUTE` sur les 4 portes via `withAuthGate` — correct.
- `auth_gatekeeper` sans `BYPASSRLS`, `NOLOGIN` (070 §1).

### 1.4 Ce que cela implique pour l'objectif utilisateur

- Préserver `owner.dev@invalid.local` = ne pas le supprimer, ne pas changer son `id`/`cabinet_id`. Sur LOCAL c'est déjà préservé (sentinel), sur CLOUD il est déjà réel.
- Réutiliser `assistante.dev@invalid.local` = sur LOCAL passer de sentinel à bcrypt, sur CLOUD déjà bcrypt mais profil générique à enrichir si besoin.
- Pour le praticien, **choix à trancher avant toute écriture** (voir §2). Créer un doublon serait pire que le statu quo : les deux bases partagent déjà le même `cabinet_id`, une seconde identité divergerait au premier changement de schéma.

## 2. Décision à trancher (ne pas deviner)

| Option | Id qui porte le vrai praticien | Sort de `a1` (owner) | Sort de `a2` (praticien2) | Quand la choisir |
|---|---|---|---|---|
| **A — Owner = vrai médecin (recommandée, conforme ADR-005)** | `a1` (`owner`) reste `LARBI. N` 16/16780 | Conservé, **reste connectable**, est le compte "médecin" quotidien | Fermé : `encrypted_password='CONNEXION-IMPOSSIBLE'`, `profiles.is_active` reste `t` mais inconnectable par `070§4a` (préférence : `is_active=t` + sentinel pour ne pas toucher à la RLS) | Si la praticienne exerce seule (cas actuel, 2ᵉ praticienne future) |
| **B — Practitioner = vrai médecin** | `a2` devient le vrai médecin | Conservé mais **fermé** (sentinel) | Réutilisé : `full_name/order/speciality` mis à `LARBI. N / 16 / 16780 / ...`, bcrypt posé | Si l'organisation veut que le rôle `practitioner` (et non `owner`) soit le compte quotidien |
| **C — Nouveau praticien** | Nouveau `uuid` | Conservé tel quel | Conservé tel quel (ou fermé) + 1 création | **À éviter** : duplique une identité existante, viole `015` ("N'INVENTE AUCUNE IDENTITÉ") — seulement si `a1` et `a2` doivent coexister tous deux actifs |

**Action planifiée : poser la question à l'utilisatrice et n'exécuter que l'option choisie.** Aucune création d'`uuid` supplémentaire dans A/B.

## 3. Périmètre d'exécution (10 contraintes utilisateur intégrées)

1. **Préserver `a1`** : aucun `DELETE`, aucun `UPDATE` de `profiles` hors `order_number/full_name` si B choisi ; sinon zéro toucher.
2. **Réutiliser `a3`** : `UPDATE auth.users SET encrypted_password=crypt($1,gen_salt('bf'))` + `email_confirmed_at=now()` via `psql \getenv` (jamais interpolé, jamais loggué), pas de nouvel `INSERT`.
3. **Praticien : minimum safe** : A ou B, pas de second praticien. Si C devait être demandé, créer **exactement 1** `auth.users`+`profiles` avec le bon `cabinet_id` (000...0001), `role='practitioner'`, `is_active=t`, vérifié par `030_document_gates` et `050_create_patient` qui valident contre `app.profiles`.
4. **Ne jamais affaiblir RLS** : aucun `GRANT` sur `auth.users` à `mindcare_app`, aucun `BYPASSRLS`, aucun `DISABLE TRIGGER`, aucun `SET search_path` élargi. Vérifications `070§6` et `020§1` rejouées après chaque écriture.
5. **Mots de passe jamais en migration/code** : lecture depuis `.env` (`DEV_ACCOUNT_PASSWORD` / `DOCTOR_ACCOUNT_PASSWORD` ou nouvelle var `ASSISTANT_ACCOUNT_PASSWORD` si assistante séparée), `crypt()` côté serveur, `gen_salt('bf')`. Logs purgés (`grep -v` + `$out` jamais réimprimé).
6. **Ne pas changer l'environnement pour faire passer** : `app.deployment.environment` reste `cloud-dev` tant que `is_synthetic` guard est actif. Si un test demande `self-hosted`, refuser (garde-fou `dev-account.sh` §3).
7. **Exactement 1 praticien + 1 assistante utilisables** : après écriture, `SELECT count(*) FROM auth.users WHERE encrypted_password != 'CONNEXION-IMPOSSIBLE'` doit rendre 2 (ou 3 si `a1` reste ouvert en A). Les 3 test accounts locaux (`e1,f1,f2`) passent en `sentinel` + `profiles.is_active=false`.
8. **Test via `/connexion` HTTP réel** : `POST /api/auth/sign-in` avec `fetch` (pas `verify_password` direct seul), vérif cookie `mc_session` `httpOnly`, puis `GET /api/auth/session` → `{userId}`; négatif aussi (`mauvais mdp` → 401 `identifiants-refuses`, pas `non-authentifie`).
9. **RLS après création** : rejouer `checkpoint-patients-v3` §§A-F + `checkpoint-adr019` + test ciblé `assistant ne voit pas clinical_notes/diagnoses/prescriptions/appointment_reasons` (attendu 0 ligne, pas 42501).
10. **Ne pas toucher aux fichiers V8/UI** : seuls `scripts/compte-*` (si besoin) et vérifs ; aucun `src/components/**` ni `tailwind.config`.

## 4. Séquence détaillée (une fois le choix A/B tranché)

### 4.1 Pré-contrôles (lecture seule, déjà partiellement faits)
- Re-vérifier `app.deployment = cloud-dev` sur la base cible (LOCAL si app en `MINDCARE_DATABASE_URL`, CLOUD si déploiement reste Supabase — **trancher**).
- Vérifier `pgcrypto` joignable (`SELECT crypt('x',gen_salt('bf'))`) avant d'envoyer un secret.
- Capturer `md5(encrypted_password)` des 3 `a*` avant/après (sans jamais afficher le mot de passe).

### 4.2 Écritures minimales

**Assistante (`a3`) — commun aux deux options :**
```sql
-- via psql \getenv (comme dev-account.sh §4-5)
UPDATE auth.users
   SET encrypted_password = crypt(:'pw', gen_salt('bf')),
       email_confirmed_at = now(), confirmed_at = now(),
       updated_at = now(),
       confirmation_token='', recovery_token='', email_change_token_new='',
       email_change_token_current='', email_change='', phone_change='',
       phone_change_token='', reauthentication_token='',
       raw_app_meta_data = coalesce(raw_app_meta_data,'{"provider":"email","providers":["email"]}'::jsonb),
       raw_user_meta_data = coalesce(raw_user_meta_data,'{}'::jsonb)
 WHERE id='00000000-0000-0000-0000-0000000000a3'
 RETURNING 1;
-- profiles.is_active reste t ; si l'assistante réelle a un nom/téléphone, UPDATE app.profiles SET full_name/phone WHERE id='a3' (une seule ligne, pas de cabinet_id modifié)
```

**Option A (owner = médecin) :**
- CLOUD : rien à faire (déjà bcrypt). Vérifier que `DOCTOR_ACCOUNT_PASSWORD` n'est pas utilisé pour `a3`.
- LOCAL : ouvrir `a1` et `a3`, fermer `a2+e1+f1+f2` :
```sql
-- ouvrir a1 (owner)
UPDATE auth.users SET encrypted_password=crypt(:'owner_pw',gen_salt('bf')), email_confirmed_at=now() ... WHERE id='a1';
-- fermer a2 et tests
UPDATE auth.users SET encrypted_password='CONNEXION-IMPOSSIBLE', updated_at=now() WHERE id IN ('a2','e1','f1','f2');
UPDATE app.profiles SET is_active=false WHERE id IN ('e1','f1','f2'); -- a2 reste is_active=t mais sentinel
```

**Option B (practitioner = médecin) :**
- CLOUD : même fermeture de `a1` côté CLOUD si besoin (ou laisser ouvert en read-only).
- LOCAL : ouvrir `a2`+`a3`, fermer `a1` :
```sql
UPDATE auth.users SET encrypted_password=crypt(:'doc_pw',gen_salt('bf')), ... WHERE id='a2';
UPDATE app.profiles SET full_name='LARBI. N', title='Dr.', speciality_fr='Médecin Spécialiste en Psychiatrie et Psychothérapie', speciality_ar='...', order_number='16 / 16780', phone='0554813911', signature_block='{"full_name_ar":"الدكتورة العربي-ن"}'::jsonb WHERE id='a2';
UPDATE auth.users SET encrypted_password='CONNEXION-IMPOSSIBLE' WHERE id='a1';
```

Dans les deux cas, `cabinet_id` ne change jamais (contrainte `profiles.cabinet_id = 000...0001`).

### 4.3 Vérifications post-écriture
- `SELECT id, email, length(encrypted_password), encrypted_password='CONNEXION-IMPOSSIBLE' FROM auth.users ORDER BY email` → exactement 2 (ou 3) bcrypt, reste sentinel.
- `SELECT auth.verify_password('assistante.dev@invalid.local', $pw)` → `a3` (via `withAuthGate`), et `verify_password('owner...', 'mauvais')` → null (oracle fermé).
- `pnpm dev` + `fetch http://localhost:3000/api/auth/sign-in` pour chaque compte (bon + mauvais mot de passe) → 200 `{userId}` vs 401 `identifiants-refuses`, cookie `mc_session` présent, `GET /api/auth/session` → `userId`.
- RLS : `withCaller(a3, q=>q.query("SELECT * FROM app.clinical_notes"))` → 0 ligne ; `withCaller(a1_or_a2, ...)` → lignes du praticien seul ; `app.search_patients` audit `audit.log` +1 ligne par lecture.
- `has_table_privilege('mindcare_app','auth.users','SELECT')=f`, `auth_gatekeeper` sans `BYPASSRLS`.

### 4.4 Nettoyage
- Révoquer `ASSISTANT_ACCOUNT_PASSWORD` de l'env si créé éphémère, ou le garder dans `.env` (gitignore).
- `Remove-Item audit*.mjs` créés pour l'audit.

## 5. Risques identifiés & garde-fous

- **Divergence CLOUD/LOCAL** : si on ouvre les comptes sur LOCAL mais que Next.js pointe encore sur CLOUD en prod, les comptes restent inconnectables. **Mitigation** : aligner `.env` (`MINDCARE_DATABASE_URL` vs `DATABASE_URL`) et documenter la cible avant écriture.
- **Doublon `LARBI. N` avec deux `order_number`** (16/16780 vs 10/14523) : le 10/14523 n'apparaît nulle part dans `00-DECISIONS` ; le conserver créerait un certificat médical opposable avec un mauvais numéro. **Mitigation** : en option B, écraser `10/14523` par `16 / 16780`.
- **Comptes de test locaux (`e1,f1,f2`)** : les laisser actifs violerait "exactement un praticien". **Mitigation** : sentinel + `is_active=false`, pas de `DELETE`.
- **Fuite de mot de passe dans les logs PG** (`log_statement`) : même mitigation que `dev-account.sh` §4 — `crypt()` testé avant, sortie brute jamais réimprimée, seul `SQLSTATE` extrait.

## 6. Critères d'acceptation (avant de poursuivre au checkpoint suivant)

- `audit` initial rendu (tableaux §1 ci-dessus).
- Choix A/B validé par l'utilisatrice.
- Après écriture : `SELECT` + `/api/auth/sign-in` verts pour les 2 comptes cible, rouge pour les autres.
- RLS `checkpoint-patients-v3` vert (40/40) et `checkpoint-adr019` vert.
- Aucun nouveau `auth.users` hors `a1/a2/a3` avec bcrypt.
- `STATE.md` notée si divergence CLOUD/LOCAL doit être résolue hors périmètre.

## 7. Hors périmètre (noté, non codé)

- Migration `070_local_auth` vers CLOUD (si CLOUD reste la cible, il faut `supabase db push` — hors ce lot, voir `s0-provision.sh`).
- Mise à jour du `name` de `app.cabinets` ("Cabinet de développement" → réel) — décision humaine, pas technique.
- Refonte `document_templates` logo — déjà `031`.

---
*Sources : `supabase/migrations/001,003,015,016,070,072`, `scripts/dev-account.sh`, `scripts/compte-praticienne.sh`, `scripts/compte-assistante.sh`, `src/server/auth/session.ts`, `src/server/db/withCaller.ts`, `src/app/api/auth/sign-in/route.ts`, exécutions pg `2026-08-31` sur les deux bases.*
