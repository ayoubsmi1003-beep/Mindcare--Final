# STATE — MindCare OS
Dernière mise à jour : 2026-08-02 · commit à venir (lot T1.2)

## Fait & vert
- T1.2 — jetons CSS + i18n français + durcissement I10 · 4 portes vertes · 6 passes adversariales
- Nouvelle architecture d'agents installée (7 agents, modèles répartis) · docs d'autorité en place

### 6ᵉ passe — trois trous fermés, chacun prouvé par sonde jetable
- **ROUGE 7 — `.mts`/`.cts` invisibles.** `**/*.ts` ne matche pas `.mts`, ni dans ESLint ni dans
  `include` de `tsconfig.json` : un fichier `.mts` racine échappait à la FOIS au typecheck et à
  toutes les règles I9/I10. Un orphelin `tailwind.theme.mts` (couleurs en dur, importé par rien,
  sonde oubliée de la 5ᵉ passe) y avait survécu et allait partir dans le commit. Fichier supprimé,
  les deux extensions ajoutées aux deux endroits.
- **ROUGE 8 — I10-couleur absente hors `src/**` et hors racine.** Une sonde sous
  `supabase/functions/**` (le code qui touche `SERVICE_ROLE`) sortait verte : le contrôle 4 de
  preflight ne rattrape que les hex 6/8 chiffres, jamais `rgb()/rgba()/hsl()`.
- **ROUGE 9 — I10-dimension contournable par import.** Un module `config/theme-probe.ts` portant
  `padding:"17px"`, `duration:"250ms"` et `p-[17px]`, **importé par `src/app/page.tsx`**, passait
  les quatre portes. Borner le volet dimension à `src/**` ne protégeait rien : il suffisait de
  sortir la valeur d'un fichier pour la réimporter. I10 est désormais appliquée sur tout `.ts(x)`
  du dépôt ; l'exception des fichiers de config **racine** tient toujours (bloc racine placé en
  dernier, ne réinjectant que le volet couleur).

## En cours
- **S1 — les 16 migrations sont écrites et ÉPROUVÉES, pas encore appliquées au cloud.**
  Schéma complet du §16 de `01-SCHEMA.md` + `016_deployment_guard`. Épreuve hors ligne sur
  Postgres 15 jetable, en rôle **non superutilisateur** (fidèle à Supabase) :
  16 migrations vertes d'un bloc sur base neuve, `checkpoint-j1a.sh` **VERT sur 12 contrôles**,
  **rejoué trois fois de suite**. Sondes négatives : une table Tier 1 nue fait rougir T9 et T10,
  un patient réel est refusé par le garde-fou ADR-016.
  - **ADR-017** — `reason` sort de `app.appointments` vers `app.appointment_reasons`, sans policy
    assistante. Q-A refermé. Le §5.1 de `01-SCHEMA.md` est marqué périmé.
  - **ADR-018** — `integer amount_dzd`. Q-C refermé.
  - **Q-B** (audit des lectures) reste ouvert, requalifié en dette datée → S2.
  Cinq défauts trouvés **par exécution**, aucun par relecture : privilèges absents sur le schéma
  `app` (la RLS restreint, elle n'accorde pas) · `schema_migrations` sans RLS · le rattrapage de
  016 se heurtait au verrou d'immuabilité des notes signées · T8 non rejouable · `.env.example`
  disparu du disque, restauré.
- **ADR-016 — phase cloud encadrée, ouverte.** ADR-001 **suspendue**, pas annulée. Trois conditions :
  accès développeur seul · données synthétiques seules · migration à l'achat du serveur **ou** avant
  le premier patient réel, le premier des deux.
  Livré et **prouvé sur Postgres 15 jetable, 16 contrôles** : `supabase/migrations/016_deployment_guard.sql`
  (`app.deployment` en écriture interdite même pour `postgres` et `service_role`,
  `audit.deployment_transitions` en ajout seul, `assert_synthetic` attaché **par découverte** aux
  tables Tier 0/1) + contrôle 8 de preflight (sondé rouge puis vert).
  Un défaut réel trouvé par exécution : le rattrapage du seed tournait avant l'amorçage de
  `app.deployment`, laissant les lignes de seed marquées **réelles**. Corrigé, reprouvé de zéro.
- **S0 — préparé, non provisionné.** WSL2 et Docker sont opérationnels (WSL 2, Docker 29.6.1,
  Compose v5.2.0) mais **sur le poste de développement**, pas sur le serveur : i3 bicœur / 7,9 Go
  contre 16 Go dimensionnés au §1. Rien n'a été installé ici, volontairement.
  Livré prêt à tourner sur le PC serveur : `scripts/s0-provision.sh` (§2 → §2.3 d'un bloc) et
  `scripts/checkpoint-s0.sh` (verdict binaire). Le provisionnement refuse de démarrer sous 14 Go.

## Dette assumée, datée
- **D-01 RALLUMÉE par ADR-016** — phase cloud rouverte, mais le projet `fnrcxlewbuqgpgykwfwg` de
  `.mcp.json` reste **compromis** (clés passées par un chat, règle 3). **Action humaine bloquante :**
  créer un NOUVEAU projet Supabase, puis supprimer l'ancien. Ne réutiliser aucune de ses clés.
- **D-04** Transcription Groq absente → semaine 2, échéance 2026-08-13. `analyze_session` livré sans micro (D-10).
- **D-08** Front assistante absent → semaine 2, échéance 2026-08-13. Rôle + vues créés en base dès S1.
- Sauvegarde non testée → échéance 2026-08-06, avant la démo
- Ordonnances saisies non imprimées → mois 2
- Consentements papier → mois 2
- Réserves preflight §5 (fichier sans extension sous src/, coût ~10 s du contrôle 4) → non bloquantes
- **Leçon de la 6ᵉ passe, à appliquer à chaque lot** : une sonde de vérification non supprimée est
  une régression livrée. Contrôler l'arbre **par hash**, pas par `git status`, avant tout commit.

## Bloqué, attente humaine
- **7 fontes `.woff2` manquantes** dans `src/styles/fonts/` : Geist Sans 400/500/600 · Geist Mono 500 · Newsreader 400 · IBM Plex Sans Arabic 400/500/600 → **bloque S2**
- Logo SVG
- Liste des ~60 médicaments → bloque le seed de S1
- **Accès au PC serveur du cabinet** (16 Go / i7) → **bloque S0**. WSL2 + Docker sont installés et
  vérifiés, mais sur le poste de développement, qui ne peut pas héberger la pile. Sur le serveur :
  créer `.wslconfig` (§1), puis `bash scripts/s0-provision.sh /c/mindcare-db`.
- Arbitrage « Pychiaterie » dans l'en-tête → bloque S7
- Thème sombre : `darkMode`/`night.*` désarmés volontairement, réouverture sur rampe nocturne spécifiée

## Prochaine tâche
**Appliquer S1 au cloud** — bloqué sur une action humaine d'une minute :
`DATABASE_URL` dans `.env` pointe la connexion **directe** (`db.<ref>.supabase.co`), que Supabase
ne publie plus qu'en **IPv6** — le réseau Docker n'en a pas. Prendre la chaîne
**Session pooler** (Dashboard → Settings → Database → Connection string → « Session pooler »),
de la forme `postgresql://postgres.<ref>:<mdp>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
Le mot de passe se colle tel quel : `db-migrate.sh` l'encode lui-même.
Puis `bash scripts/db-migrate.sh` et `bash scripts/checkpoint-j1a.sh`.


**S1 — migrations 001→015 + seed, appliquées au NOUVEAU projet cloud** · agent `db-migrator`
Checkpoint : les 8 tests du §15 de `01-SCHEMA.md` (`checkpoint-j1a.sh`) **plus** les deux contrôles
de couverture d'ADR-016 à y ajouter : aucune table Tier 0/1 sans `is_synthetic` + trigger, aucune
table de `app` sans `relrowsecurity` **et** `relforcerowsecurity`.
Bloqué en amont par : le nouveau projet Supabase (D-01) et la liste des ~60 médicaments.

Reste d'ADR-016 non fait, faute de socle : le **bandeau « données fictives »** (étape 5 du plan)
attend la couche `src/services/*` — I3 interdit qu'un composant lise la base en direct, et cette
couche naît en S1.

**S0 (auto-hébergé)** devient la procédure de migration, à l'achat du serveur :
`scripts/s0-provision.sh` → `docker compose up -d` → `scripts/checkpoint-s0.sh`, puis le test
qui compte : `nc -zv <ip> 5432` depuis un autre poste **doit échouer**.
Puis **S1 — migrations 001→015 + seed** · agent `db-migrator` (opus) · checkpoint = 8 tests du §15 de `01-SCHEMA.md`.
