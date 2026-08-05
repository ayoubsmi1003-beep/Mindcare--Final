# STATE — MindCare OS
Dernière mise à jour : 2026-08-05 · **S5 Entrée CLOS** · **S6 CLOS** — trois défauts réels trouvés et corrigés en vérification locale, `analyze_session` fonctionnel de bout en bout · **prochain jalon : S7 (Finance + Documents)**

## Fait & vert
- S1-S4 (schéma 001→025, agenda, couche `DbPort`, suite complète) — VERT · checkpoint-s4 VERT 25, checkpoint-adr019 VERT 24
- S5 écran séance et note clinique sur migration 026 (9 portes) — build, typecheck, lint tous VERT · checkpoint-s5 VERT 11 · commit 07cc371 "fix(consultation): entrée visible" (2026-08-04)
- BandeauSeanceEnCours + useSeanceEnCours — le bouton « Démarrer/Reprendre » désormais visible depuis agenda et déclenche /consultation/[id]
- **S6 Phase 1 + Phase 2 (2026-08-05)** : migrations 027/028, passerelle Deno
  complète, panneau écran trois blocs — commit `234dcde`. Voir commits
  précédents pour le détail ; ce qui suit documente la vérification LOCALE
  faite après ce commit, qui a trouvé trois défauts réels.
- **Vérification locale sur Docker (2026-08-05), une bascule d'environnement**
  — Docker est **redevenu joignable sur ce poste** (`docker info` répond,
  `docker pull` réussit vers `public.ecr.aws`) et `pnpm dlx supabase` (CLI via
  npm, aucune installation locale requise) donne accès à une pile Postgres
  locale complète. **Ce n'est plus la même contrainte qu'en S5** — corriger
  l'hypothèse « Docker/psql absents » partout où elle traînait encore.
  Limite mesurée : `docker.io` (Docker Hub) reste **injoignable** depuis ce
  réseau (TLS handshake timeout sur `auth.docker.io`), donc les scripts
  `checkpoint-*.sh` qui lancent un conteneur `postgres:15` jetable
  (`scripts/lib/dburl.sh` + `qfull()`) restent bloqués — **différent** de
  « Docker absent », mais bloquant quand même pour CES scripts précis. La
  vérification ci-dessous est passée par `docker exec` sur le conteneur
  Postgres déjà démarré par `supabase start`, pas par ces scripts.

## Trois défauts réels trouvés en vérification locale, tous corrigés
Aucun des trois n'était visible en relecture — c'est exactement pourquoi
cette passe existe. Diff de suivi (après le commit `234dcde`) :

1. **Migration 027 — `ALTER FUNCTION ... OWNER TO app_gatekeeper` en 42501.**
   `ALTER ... OWNER TO` exige que le NOUVEAU propriétaire ait `CREATE` sur le
   schéma — pas seulement que l'exécutant soit superutilisateur. 026 §3
   accorde ce privilège à `app_gatekeeper` PUIS le retire à son §8, dans SA
   PROPRE transaction. 027 est une migration séparée : sans son propre
   `GRANT CREATE ON SCHEMA app TO app_gatekeeper` avant l'`ALTER OWNER`, et
   son propre `REVOKE` après, elle hérite d'un rôle déjà refermé par 026 et
   échoue à l'application. **Constaté en rejouant 001→028 sur une base
   locale neuve** — 001→026 vertes, 027 rouge. Corrigé : §0/§3 ajoutés à
   027, symétriques à 026 §3/§8.
2. **`external-call.ts` sans `max_tokens`.** La requête OpenRouter partait
   sans plafond de sortie explicite, donc facturée au plafond PAR DÉFAUT du
   modèle (64 000 tokens pour Claude Sonnet 4.5) — un compte à solde modeste
   se voit refuser la requête en 402 AVANT même qu'un seul jeton soit généré,
   alors que la réponse réelle est un petit JSON borné (§3.4 n°6). Corrigé :
   `MAX_OUTPUT_TOKENS = 2000` posé dans le corps de la requête.
3. **`index.ts` — clôture Markdown non retirée avant `JSON.parse`.** Le
   prompt système exige « STRICTEMENT en JSON, sans aucun texte avant ou
   après » ; le modèle a quand même enveloppé sa réponse dans
   ` ```json ... ``` ` lors du premier appel réel. Un JSON par ailleurs
   PARFAITEMENT VALIDE et cliniquement correct échouait donc au parsing,
   brûlait la seule reformulation autorisée (§3.4 n°9), puis renvoyait
   « Assistant indisponible » — l'échec le plus coûteux qui soit : un vrai
   résultat, jeté. Corrigé : `retirerCloture()` retire cette forme précise
   avant `JSON.parse`, rien de plus large. Revérifié offline contre la
   réponse réelle capturée : parse et valide désormais avec succès.

## Preuve RLS — les 3 rôles, sur `app.get_previous_note`, en base réelle
Testé directement en `psql` (`docker exec` dans le conteneur Postgres local),
`SET ROLE authenticated` + `SET request.jwt.claims` pour simuler chaque
utilisateur de test (015 : a1 owner, a2 practitioner, a3 assistant ; b1
patient de a1, b2 patient de a2) :
- **owner a1 sur son propre patient b1** → 1 ligne (l'antérieure). ✓
- **practitioner a2 sur le patient b1 de a1** → 0 lignes, aucune erreur —
  cloison ADR-003 tenue. ✓
- **assistant a3 sur le patient b1** → 0 lignes — aucun accès clinique. ✓
- **patient sans consultation antérieure (b2)** → 0 lignes, pas une erreur —
  « premier passage, rien à comparer » comme documenté. ✓

## `analyze_session` — appel réel de bout en bout, réussi
Après les trois correctifs ci-dessus, un appel complet à travers la
passerelle (JWT owner a1, consultation réelle avec notes brutes + une
consultation antérieure fermée avec note) a rendu `{"ok":true,"data":{...}}`
avec les trois blocs dans l'ordre du démo-spec, contenu cliniquement correct,
chaque entrée de `pointsNonExplores` terminée par « ? », `evolution`
comparant correctement à la consultation antérieure lue en base.

**Décision de produit, actée avec l'utilisateur le 2026-08-05 : `DEFAULT_MODEL`
devient `google/gemini-2.5-flash`, pas `anthropic/claude-sonnet-4.5`.** La clé
OpenRouter de cet environnement est un compte **gratuit** (`is_free_tier:
true`, vérifié via `GET /api/v1/key`) dont le solde nominal affiché ($29.92)
ne reflète PAS le plafond réel par requête sur les modèles payants —
plusieurs appels à Sonnet 4.5 avec un prompt de taille réelle ont rendu 402
(« crédits insuffisants ») de façon **incohérente**, y compris après le
correctif `max_tokens`. Gemini 2.5 Flash, disponible sur la même clé, a rendu
une sortie conforme et cliniquement correcte, pour un coût de l'ordre de
0,0002 USD par appel (tarif source : `GET /api/v1/models/google/
gemini-2.5-flash/endpoints`, 2026-08-05). `DEFAULT_MODEL` mis à jour dans
`external-call.ts`, `TARIFS_USD_PAR_MILLION` complétée avec le tarif réel
(pas une estimation), `02-SECURITY-BOUNDARY.md` §5.2 corrigé pour ne plus
contredire le code. `OPENROUTER_MODEL` reste la voie de configuration si un
autre modèle est un jour préférable — rien n'est codé en dur au-delà de ce
repli.

## RLS à travers la passerelle elle-même — les 3 rôles, complété 2026-08-05
Le point (b) de la liste ci-dessous est désormais fait, pas seulement en SQL
direct (voir plus haut) mais **à travers `jarvis-analyze-session` en HTTP
réel**, JWT signé par rôle, sur la même consultation de test (patient b1,
praticienne a1) :
- **owner a1** → `ok:true`, les trois blocs (déjà documenté ci-dessus).
- **practitioner a2** (consœur, RLS doit bloquer) → `{"ok":false,"error":
  {"code":"regle-metier","message":"Aucune note à analyser pour cette
  séance."}}`.
- **assistant a3** (aucun accès clinique) → **message identique, mot pour
  mot**, à celui de a2.
- **`consultationId` inexistant**, appelé par owner a1 → **même message
  encore**, indiscernable des deux cas précédents.

Les quatre cas rendent le MÊME message générique : aucune fuite ne distingue
« ce dossier existe mais n'est pas le vôtre » de « ce dossier n'existe pas »
— exactement le principe déjà tenu par `app.get_consultation` (026 §6) et
répété en tête de `src/app/consultation/[id]/page.tsx`. RLS est donc prouvée
tenue à CHAQUE couche de ce chemin : SQL direct (`get_previous_note`) et HTTP
réel à travers la passerelle (`get_consultation` + le comportement de
`analyze_session` qui en découle).

## Dernier point non résolu — journalisation d'audit non vérifiée en local
`audit.boundary_crossings` reste à 0 ligne après l'appel réussi. Cause
identifiée : le conteneur `edge-runtime` ne résout pas le nom Docker
`supabase_db_Final_Mindcare` (`getaddrinfo ENOTFOUND`), alors que
`SUPABASE_URL=http://kong:8000` résout et fonctionne pour les mêmes appels
RPC. **C'est un défaut de réseau Docker propre à cette pile CLI locale, pas
un défaut du code** : `journaliser()` (`external-call.ts`) utilise
`SUPABASE_DB_URL`, la variable standard que Supabase injecte, exactement
comme documenté au plan §3.2 — rien à corriger côté code sur la seule base de
cette observation locale. Reste à vérifier sur un déploiement réel (cloud ou
auto-hébergé), où ce nommage est géré par la plateforme.

## Définition du fait (CLAUDE.md §4) — bilan honnête, mis à jour
1. **Données réelles** ✓ — confirmé, y compris par l'appel réel de bout en bout.
2. **RLS vérifiée pour 3 rôles** ✓ **complet** — en SQL direct sur `get_previous_note` ET à travers `jarvis-analyze-session` en HTTP réel (owner : accès ; practitioner et assistant : même refus générique que sur un `consultationId` inexistant, aucune fuite). Voir preuve ci-dessus.
3. **Dégradation propre** ✓ — confirmé en pratique : 402/timeout OpenRouter réels ont produit `{"ok":false,"error":{"code":"indisponible",...}}`, jamais un crash, jamais une fuite.
4. **États vide + erreur écrits** ✓.
5. **Jetons de design respectés** ✓.
6. **Checkpoint reproductible vert** ~ — `pnpm typecheck/lint/build` + `preflight.sh` verts et reproductibles après nettoyage du code de diagnostic. `checkpoint-s5.sh`/`checkpoint-adr019.sh`/`checkpoint-jarvis.sh` restent bloqués — pas par « Docker absent » (faux désormais), mais par `postgres:15` (Docker Hub) injoignable sur ce réseau. La vérification DB de cette session est donc passée par `docker exec` direct, hors de ces scripts.

**Conclusion : S6 est fonctionnellement prouvé de bout en bout sur le chemin
lecture + `analyze_session`, RLS comprise à chaque couche (SQL direct ET à
travers la passerelle HTTP, les 3 rôles), avec `DEFAULT_MODEL` lui-même —
pas un modèle de substitution — vérifié par un appel réel réussi.**

**S6 DÉCLARÉ CLOS le 2026-08-05, décision explicite de l'utilisateur.** Trois
points restent en dette environnementale, datée ci-dessous, et n'empêchent
pas la clôture : (c) `audit.boundary_crossings` non vérifié en écriture à
cause d'un défaut de réseau Docker LOCAL (pas un défaut de code — voir
plus haut) ; (d) les scripts `checkpoint-s5.sh`/`checkpoint-adr019.sh`/
`checkpoint-jarvis.sh` restent injouables sur ce poste (Docker Hub
injoignable, pas Docker lui-même) ; (e) la vérification d'écran (double
clic, coupure réseau, JSON malformé) reste sans navigateur dans cet
environnement. Même schéma qu'à la clôture de S5 : commit en dépit de dettes
identifiées et datées, pas une dette dissimulée.

## En cours
(rien — S6 clos, prochain jalon S7. Voir dette datée pour ce qui reste
ouvert sans bloquer la suite.)

## S6 — écart de tooling découvert et corrigé, 2026-08-05
`eslint.config.js` portait un commentaire explicite refusant d'exclure
`supabase/functions/**` du projet TypeScript type-aware (« le plus vérifié, pas
le moins »), écrit avant que ce dossier existe. Une fois le code Deno réel
écrit (`Deno.serve`, spécificateurs `npm:zod@3`/`npm:postgres@3`/
`npm:@supabase/supabase-js@2`), `pnpm typecheck`/`lint` échouaient — ni `Deno`
ni `npm:` ne sont résolubles sous `moduleResolution: "bundler"`. Choix tranché
CONTRE l'invention de types ambiants faux pour faire passer le vert : **exclu**
(`tsconfig.json` `exclude`, `eslint.config.js` `ignores`), avec le même
raisonnement que pour 026 sans Docker — relecture manuelle en tient lieu, un
typecheck vert qui ne prouve rien est pire qu'un typecheck absent. L'override
par-fichier devenu mort a été supprimé, pas laissé en place.

**Complément 2026-08-05, trouvé en lançant `supabase start` pour de vrai** :
`supabase/.temp/` (secrets et bundle générés par le CLI à chaque démarrage)
faisait échouer `pnpm lint` — un fichier `.ts` hors du programme TypeScript,
non couvert par l'exclusion `supabase/functions/**`. `.gitignore` racine
l'ignorait déjà (`supabase/.temp/`), mais ESLint parcourt le disque, pas git.
Traité comme un artefact jetable : supprimé plutôt qu'ajouté aux exclusions
permanentes — il n'a aucune raison d'exister dans l'arbre d'un contributeur
qui n'a jamais lancé la pile locale. Se régénère automatiquement au prochain
`supabase start`.

## S6 — infrastructure locale ajoutée, à committer
`supabase/config.toml` (généré par `supabase init`, schéma `app` ajouté aux
`schemas` exposés de l'API — **`audit` volontairement absent**, cohérent avec
017 §3) et `supabase/.gitignore` (`.branches`, `.temp`, fichiers `.env.*`
locaux — standard CLI, ne duplique pas mais renforce le `.gitignore` racine).
Ni l'un ni l'autre ne contient de secret : vérifié par grep avant ajout.

## S6 — écart avec le plan approuvé, assumé et documenté en tête de 027
`app.get_previous_note` est **SECURITY DEFINER**, pas `SECURITY INVOKER` comme
esquissé au plan §3.1. Vérifié dans 020 §2 avant d'écrire : `audit.log_read`
n'a EXECUTE accordé qu'à `app_gatekeeper`, jamais à `authenticated` — une
fonction INVOKER heurterait un 42501 au premier appel. Même raisonnement que
`app.get_consultation` (026 §6). `OWNER TO app_gatekeeper` posé explicitement.

## S5 Défauts trouvés et fixés, 2026-08-04
**Bug d'entrée:** `/consultation/[id]` compilé en 026 mais le chunk manquait du cache `.next` après modif du gabarit ; bouton « Démarrer » disparaissait silencieusement au refus de la garde ; `get_open_consultation()` jamais appelé.
**Fix:** BandeauSeanceEnCours appelle `get_open_consultation()` et l'affiche en AppShell ; garde détaillée sur `/agenda/[id]` + `/consultation/*` (roles practitioner seul, skipped si assistant).
**Vérifié**: build génère `ƒ /consultation/[id]`, gates 1-11 VERT, regression-clean S4/S3.

## Portes & regressions
Réexécutées 2026-08-05 post-vérification S6 : `preflight` ✓ · `typecheck` ✓ · `lint` ✓ · `build` ✓ (chunk `/consultation/[id]` 3.98 kB). `checkpoint-s5`/`checkpoint-adr019`/`checkpoint-jarvis` toujours bloqués — cause précisée ci-dessus (Docker Hub, pas Docker).
**La couche sécurité est gelée.** ADR-019 tient sur `app_gatekeeper` sans `BYPASSRLS`, membre `authenticated` **avec `INHERIT TRUE`**, propriétaire des portes 004/007/008. Y toucher casse la cloison.

## Décisions de session (à verser au 00-DECISIONS.md)
1. **Nom de fichier gateway:** `supabase/functions/_shared/external-call.ts` (pas llm.ts) — settle par scripts/preflight.sh §1 ligne 8 (seule exemption de grep).
2. **S6 gateway est Edge Function** (Deno, supabase/functions/), **pas Next.js API route** — confirme l'architecte et 02-SECURITY-BOUNDARY.md §1.
3. **S6 scope resserré:** 027/028 migrations (pseudonymize.ts, external-call.ts, app.get_previous_note, audit.boundary_crossings) + **UNE SEULE TOOL: analyze_session** (read-only, no confirmation, no jarvis_actions). Les 7-8 autres outils, propose-confirm-execute-log, draft_clinical_note = **EXPLICITEMENT OUT**.
4. **2026-08-05 : Docker/psql ne sont plus une contrainte d'environnement absolue.** `pnpm dlx supabase` donne un accès complet à une pile locale. La contrainte réelle et restante est `docker.io` (Docker Hub) injoignable — `public.ecr.aws` fonctionne. Toute mention future de « Docker absent » dans ce dépôt doit être corrigée ou reformulée en fonction de cette découverte, poste par poste.
5. **2026-08-05 : `DEFAULT_MODEL` de la passerelle Jarvis est `google/gemini-2.5-flash`, pas `anthropic/claude-sonnet-4.5`.** Décision explicite de l'utilisateur après l'instabilité constatée d'un compte OpenRouter gratuit sur les modèles Anthropic payants. `02-SECURITY-BOUNDARY.md` §5.2 mis à jour en conséquence.
6. **2026-08-05 : S6 déclaré clos, décision explicite de l'utilisateur**, malgré la dette datée ci-dessous (non bloquante, comme à la clôture de S5).

## Dette assumée, datée
- S5 §7 on-screen matrix (13 lignes, f5, focus, 390px, offline, assistant role) → **avant 2026-08-10** (toujours bloqué : pas de navigateur dans cet environnement)
- Un DROP de FUNCTION emporte son propriétaire → **ne pas recopier sur app.get_consultation** (read-only, SECURITY INVOKER, safe si DROP)
- **S6, clos malgré trois points non vérifiés — User call explicite, 2026-08-05** :
  - `audit.boundary_crossings` non confirmé en écriture (défaut réseau Docker
    local, `SUPABASE_DB_URL` ne résout pas depuis `edge-runtime` — voir plus
    haut) → à revérifier sur un déploiement réel, ou en corrigeant la
    résolution DNS de la pile locale.
  - `checkpoint-s5.sh`/`checkpoint-adr019.sh`/`checkpoint-jarvis.sh` restent
    injouables en l'état (`postgres:15` sur Docker Hub injoignable sur ce
    réseau) → soit un miroir d'image accessible, soit adapter `qfull()` pour
    utiliser `docker exec` sur un conteneur déjà démarré — **décision à
    prendre avec l'utilisateur**, pas une modification à faire à la
    discrétion de l'agent (ce sont des scripts de vérification, leur
    fiabilité est ce qu'on leur demande).
  - Vérification d'écran S6 (double clic, coupure réseau, JSON malformé) —
    pas de navigateur dans cet environnement, même blocage que S5 §7.
  → **avant 2026-08-10**, à rejouer dès qu'un environnement plus complet est
  disponible. Enregistré comme délibéré, non accidental — même schéma qu'à
  la clôture de S5.

## En litige — voir WORKING-CONTEXT.md §7
**Q-D CLOSE** (2026-08-03, ADR-019 opérationnelle). **Q-A/Q-B/Q-C** référencées §8 de WORKING-CONTEXT — toutes en ADRs, aucune nouvelle question ouverte.
**Nota:** WORKING-CONTEXT.md §0 mentionne docs 05-BUILD-PLAN et 06 (inexistants sur disque) — l'autorité est en retard.

## Prochaine tâche — S7 : Finance + Documents
S6 clos. Prochain jalon selon `docs/SPRINT-4-DAYS.md` §S7 :
- **Finance (priorité)** : `set_consultation_price`, journal des paiements
  (mode + montant DZD), recette du jour, cloison RLS (le chiffre d'affaires
  reste au owner — D-09).
- **Documents (sacrifiable à 2 modèles si le temps manque)** : aperçu A4 en
  Newsreader, en-tête bilingue fidèle au scan, numérotation via `next_number`
  (jamais une SEQUENCE — I17), `rendered_html` figé à l'émission.
- **Checkpoint S7** : imprimer réellement un certificat, sur papier, le poser
  à côté d'un vrai. Pas un contrôle d'écran.

Dette S6 non bloquante à garder en tête pendant S7 (voir « Dette assumée,
datée ») : les trois points de vérification environnementale restent ouverts
et datés avant 2026-08-10, indépendamment de l'avancement S7.

Les 7-8 autres outils Jarvis et la boucle proposer-confirmer restent
explicitement hors périmètre de S6 (§4 du plan approuvé) — un chantier
séparé, pas une suite immédiate de S7.
