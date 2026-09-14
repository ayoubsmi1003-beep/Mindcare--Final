# scripts/ — ce que contient ce répertoire (≤ 120 lignes)

> Ni catalogue exhaustif, ni autorité architecturale. Si un script contredit
> `ARCHITECTURE.md` ou une migration, le script a tort.

## Familles (préfixe = intention)

| Préfixe | Rôle | Exécuter sans crainte ? |
|---|---|---|
| `verifier-*.mjs`, `garde-*.mjs`, `gen-db-allowlist.mjs`, `inspect-env.mjs` | Gardes de démarrage / contrôles lecture seule | Oui (lecture seule) |
| `checkpoint-*.sh` / `checkpoint-*.sql` | Preuves rejouables par domaine (RLS, portes, écrans) | Oui, mais exigent une base (cf. Fail si base absente) |
| `eval-*.mjs` | Évaluations Jarvis hors-ligne (recompilent `src/services` dans `.eval-out/`, sans réseau ni clé) | Oui |
| `mesure-*.mjs` / `mesure-*.sql` | Mesures navigateur / SQL, résultats périmés dès que l'arbre bouge | Oui, résultat = périssable |
| `checkpoint-*.sql` + `test-chemin-*` | Jeux et clôtures de fixtures **synthétiques** (`is_synthetic`, `*.invalid.local`) | Oui sur base de dev, JAMAIS contre des données réelles |
| `db-migrate.sh`, `verify-migrations.sh`, `s0-provision.sh`, `preflight.sh` | Chaîne de migration / provisionnement | Lire avant d'exécuter (écrit en base) |
| `compte-*.sh`, `dev-account*.sh` | Comptes de dev | Lire avant (écrit en base) |
| `preparer-paquet.mjs`, `elaguer-pgsql.mjs`, `verifier-paquet.mjs`, `dev-electron.mjs`, `generer-icone.mjs`, `sync-wakeword-runtime.mjs`, `installer-windows.ps1`, `backup.sh`, `sauvegarde.mjs` | Empaquetage / bureau / sauvegarde | Lire avant (artefacts lourds, effets de bord) |
| `sonde-*.mjs`, `qa-*.mjs`, `apercu-*.mjs`, `attendre-*.mjs`, `preuve-*.mjs`, `audit-*.mjs` | Sondes et QA ponctuelles | Cas par cas, préférer `mesure-*` |
| `import-medicaments.mjs` | Import catalogue (prend `--file`) | Lire avant (écrit en base) |

## Règles

- **Prospection interdite en base.** `DROP` / `TRUNCATE` / `DELETE FROM app.*`
  et `supabase db reset` sont bloqués par `guard-bash.sh` : toute destruction
  passe par une migration relue.
- **Sonde temporaire** : vit le temps d'un diagnostic, nom en `*-temp.*`,
  auto-décrit « TEMP », supprimée à la clôture (cf. `DELETE-LEDGER.md`,
  artefact de phase, pas une procédure permanente).
- **Preuve > souvenir** : un résultat `mesure-*`/`checkpoint-*` ne vaut que pour
  l'arbre, le `HEAD` et l'heure de la prise. Ne jamais commiter de PNG/JSON
  de preuve : artefacts CI, pas livrables (`playwright-report/`,
  `test-results/`, `scripts/.mesures/` sont ignorés).
- **Base requise** : sans `MINDCARE_DATABASE_URL` (ou `MINDCARE_TEST_DATABASE_URL`
  pour les tests), les checkpoints SQL et les mesures navigateur échouent ou
  mesurent le vide — un vert sans base est un dispositif FAIL, pas un PASS.
- **Secrets** : aucun script ne lit `.env` pour afficher, aucun n'imprime de clé
  (`guard-bash.sh` bloque `cat .env` et `echo $*_KEY`).
