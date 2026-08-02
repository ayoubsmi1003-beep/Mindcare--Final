# STATE — MindCare OS
Dernière mise à jour : 2026-08-02 · commit bcdb4c3

## Fait & vert
- T1.2 — jetons CSS + i18n français + durcissement I10 · 4 portes vertes · 6 passes adversariales · commit bcdb4c3
- Nouvelle architecture d'agents installée (7 agents, modèles répartis) · docs d'autorité en place

## En cours
- (rien — prochaine session = S1)

## Dette assumée, datée
- **D-01 ÉTEINTE** — auto-hébergement décidé (D-07). Révoquer le projet Supabase Cloud et ses clés.
- **D-04** Transcription Groq absente → semaine 2, échéance 2026-08-13. `analyze_session` livré sans micro (D-10).
- **D-08** Front assistante absent → semaine 2, échéance 2026-08-13. Rôle + vues créés en base dès S1.
- Sauvegarde non testée → échéance 2026-08-06, avant la démo
- Ordonnances saisies non imprimées → mois 2
- Consentements papier → mois 2
- Réserves preflight §5 (fichier sans extension sous src/, coût ~10 s du contrôle 4) → non bloquantes

## Bloqué, attente humaine
- **7 fontes `.woff2` manquantes** dans `src/styles/fonts/` : Geist Sans 400/500/600 · Geist Mono 500 · Newsreader 400 · IBM Plex Sans Arabic 400/500/600 → **bloque S2**
- Logo SVG
- Liste des ~60 médicaments → bloque le seed de S1
- WSL2 + Docker Desktop non installés → **bloque S0, à lancer en téléchargement maintenant**
- Arbitrage « Pychiaterie » dans l'en-tête → bloque S7
- Thème sombre : `darkMode`/`night.*` désarmés volontairement, réouverture sur rampe nocturne spécifiée

## Prochaine tâche
**S0 — Supabase auto-hébergé sur le PC serveur** · pas d'agent, procédure `docs/SELF-HOST-SETUP.md`
Checkpoint : 9 conteneurs healthy · `lc_collate = fr-DZ` · `nc -zv <ip> 5432` depuis un autre poste **échoue**.
Puis **S1 — migrations 001→015 + seed** · agent `db-migrator` (opus) · checkpoint = 8 tests du §15 de `01-SCHEMA.md`.
