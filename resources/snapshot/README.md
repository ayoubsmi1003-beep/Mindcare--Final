# Instantané de production (§D)

Dossier d'accueil du cliché de production. Seuls les fichiers **versionnés**
vivent dans git :

- `README.md` (ce fichier)
- `purge-synthetic.sql` — purge des fixtures post-restauration (aucune PII)
- `gates.sql` — portes d'intégrité G1–G5 (aucune PII)

Produits par `node scripts/snapshot-production.mjs` (JAMAIS commités,
`.gitignore`) :

- `base.dump` — `pg_dump -Fc` de la base canonique (PII : 1500+ dossiers)
- `manifest.json` — version, comptes par table, sha256 (métadonnées)

Séquence de production :

```text
node scripts/snapshot-production.mjs   # VERDICT VERT exigé
pnpm build:desktop                      # empaquette resources/snapshot → snapshot/
```

Au premier lancement packagé, `provisionnement.ts#restaurerInstantaneSiPresent`
restaure `base.dump`, applique `purge-synthetic.sql` + `gates.sql`, vérifie
`patient_count`, puis écrit `%ProgramData%\MindCare\bootstrap.json`.
Les lancements suivants ne restaurent jamais.
