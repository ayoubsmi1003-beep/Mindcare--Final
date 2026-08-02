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
- (rien — prochaine session = S0)

## Dette assumée, datée
- **D-01 ÉTEINTE** — auto-hébergement décidé (D-07). Révoquer le projet Supabase Cloud et ses clés.
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
- WSL2 + Docker Desktop non installés → **bloque S0, à lancer en téléchargement maintenant**
- Arbitrage « Pychiaterie » dans l'en-tête → bloque S7
- Thème sombre : `darkMode`/`night.*` désarmés volontairement, réouverture sur rampe nocturne spécifiée

## Prochaine tâche
**S0 — Supabase auto-hébergé sur le PC serveur** · pas d'agent, procédure `docs/SELF-HOST-SETUP.md`
Checkpoint : 9 conteneurs healthy · `lc_collate = fr-DZ` · `nc -zv <ip> 5432` depuis un autre poste **échoue**.
Puis **S1 — migrations 001→015 + seed** · agent `db-migrator` (opus) · checkpoint = 8 tests du §15 de `01-SCHEMA.md`.
