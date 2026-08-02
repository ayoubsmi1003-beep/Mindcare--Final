# STATE — MindCare OS
Dernière mise à jour : 2026-08-02 · commit 2fd1acb + S1 schéma

## Fait & vert
- 5cd3d3e T1.2 jetons CSS, i18n FR, durcissement I10 · 4 portes vertes · 6 passes adversariales → VERT
- 7fcc34d S0 provision scripté `s0-provision.sh` · checkpoint testés · 4 refus → VERT
- 2fd1acb ADR-016 garde-fou synthétique, Postgres 15 jetable, 16 contrôles → VERT
- S1 migrations 001→016 · checkpoint-j1a.sh VERT 12 contrôles, rejoué 3× · non appliquées cloud

## En cours
DATABASE_URL actuel = connexion directe (IPv6 Docker-incompatible). **Action 1min bloquante :**
Dashboard Supabase → Settings → Database → Session pooler → copier chaîne `postgresql://postgres.<ref>:<mdp>@aws-0-<region>.pooler.supabase.com`. Puis `bash scripts/db-migrate.sh` et checkpoint.

## Dette assumée, datée
- D-01 RALLUMÉE — projet fnrcxlewbuqgpgykwfwg (clés compromises, .mcp.json) → supprimer + nouveau
- D-04 Transcription Groq absent → 2026-08-13
- D-08 Front assistante absent → 2026-08-13
- Sauvegarde non testée → 2026-08-06
- Ordonnances saisies non imprimées → mois 2 (Phase 2)
- Consentements papier → mois 2 (Phase 2)
- Bandeau « données fictives » ADR-016 → S2 (attend `src/services/*`, I3)
- **Q-B — audit des LECTURES (I4), SEUL litige encore ouvert.** Aucun trigger Postgres ne voit un
  SELECT → S2, dans `src/services/*`, après évaluation de `pgaudit`. Ne rien inventer d'ici là.
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
S1 migrations → cloud : Session pooler DATABASE_URL, puis `bash scripts/db-migrate.sh` et checkpoint. Agent db-migrator. Ensuite S2 = `src/services/*` + rôle assistant, agent feature-builder.
