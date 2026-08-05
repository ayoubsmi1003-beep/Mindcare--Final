# STATE — MindCare OS
Dernière mise à jour : 2026-08-05 · **S5 Entrée CLOS** · **S6 (Phase 1 + Phase 2) code-complet, PAS clos**

## Fait & vert
- S1-S4 (schéma 001→025, agenda, couche `DbPort`, suite complète) — VERT · checkpoint-s4 VERT 25, checkpoint-adr019 VERT 24
- S5 écran séance et note clinique sur migration 026 (9 portes) — build, typecheck, lint tous VERT · checkpoint-s5 VERT 11 · commit 07cc371 "fix(consultation): entrée visible" (2026-08-04)
- BandeauSeanceEnCours + useSeanceEnCours — le bouton « Démarrer/Reprendre » désormais visible depuis agenda et déclenche /consultation/[id]
- **S6 Phase 1 (2026-08-05)** : migrations 027 (`app.get_previous_note`) et 028
  (`audit.boundary_crossings`) écrites ; passerelle Deno complète
  (`supabase/functions/_shared/pseudonymize.ts`, `external-call.ts`,
  `jarvis-analyze-session/{prompt,index}.ts`) ; `DbPort.invokeFunction` +
  adaptateur Supabase ; `src/services/jarvis.ts`.
- **S6 Phase 2 (2026-08-05)** : `src/app/consultation/[id]/page.tsx`, section
  « ASSISTANCE » — bouton `Analyser la séance` (rang `secondaire`, désactivé
  dès le premier clic ET sans note à analyser), panneau trois blocs dans
  l'ordre du démo-spec (Note structurée · Évolution depuis la dernière fois ·
  Points non explorés), tout en LECTURE SEULE — aucune écriture dans `soap`,
  aucun appel à `saveNote`. Idempotence (§3.4 n°7) : `enAnalyse` désactive le
  bouton avant même la résolution de la promesse. Réponse tardive ignorée
  (§3.4 n°8) : compteur de génération + drapeau de démontage, sur le modèle du
  `annule` des pages de liste. État de chargement honnête (texte, pas de
  squelette). Erreur → message dédié rassurant («… le reste de l'écran reste
  pleinement utilisable »), jamais le message générique « service de données
  indisponible ». `fr.disclaimer` (I7) reste AVANT le bouton. Six nouvelles
  clés `fr.consultation.*`, `assistanceIndisponible` retirée (plus référencée
  nulle part ailleurs, vérifié par grep avant suppression).
- **Porte de vérification, Phase 1 + Phase 2 confondues** : `pnpm typecheck &&
  lint && build` VERT (chunk `/consultation/[id]` recompilé, 3.98 kB) ·
  `preflight.sh` VERT (contrôle 1 muet — seul fetch() du dépôt confirmé) · les
  trois greps CLAUDE.md muets · aucun `console.log`/TODO/FIXME dans le code
  neuf. `checkpoint-jarvis.sh` inchangé à son ROUGE préexistant (tests manuels
  jamais attestés, cf. plus bas — pas une régression de cette passe, vérifié
  par comparaison avant/après via `git stash`).

## Définition du fait (CLAUDE.md §4) — bilan honnête, PAS tous verts
1. **Données réelles** ✓ — aucune donnée fictive, l'écran lit `get_consultation`/`get_previous_note` via la passerelle.
2. **RLS vérifiée pour 3 rôles** ✗ **BLOQUÉ** — Docker/psql absents de l'environnement. Le pattern JWT-scopé (`index.ts` : client créé avec le token de l'appelante, jamais `service_role`) garantit QUE la RLS s'applique, mais aucun appel réel n'a été rejoué pour le PROUVER à l'écran. C'est la même faille qu'en S5 (gates 12-29), pas une nouvelle.
3. **Dégradation propre** ✓ — API/edge function en échec → message dans le panneau, le reste de l'écran (notes brutes, éditeur SOAP, signature, clôture) continue de fonctionner sans dépendance. Rôle `assistant` déjà exclu de `/consultation/[id]` par la garde existante (S5).
4. **États vide + erreur écrits** ✓ — `analyseAucuneNote` (rien à analyser), `analyseIndisponible` (échec), état de chargement honnête.
5. **Jetons de design respectés** ✓ — aucune classe/valeur nouvelle, réutilisation stricte des motifs déjà en place dans ce même fichier (`text-label`, `text-ink-500`, `uppercase tracking-label`…) ; préflight contrôle 4 (hex en dur) muet.
6. **Checkpoint reproductible vert** ~ — typecheck/lint/build/preflight verts et reproductibles ; `checkpoint-s5.sh`/`checkpoint-adr019.sh` **n'ont pas pu être rejoués** (les deux scripts restent bloqués en connexion DB, sans sortie, jusqu'au timeout — confirmé et arrêtés proprement plutôt que laissés tourner) — même blocage Docker/psql que le point 2, pas un nouveau symptôme.

**Conclusion : S6 est CODE-COMPLET (Phase 1 + Phase 2), mais N'EST PAS CLOS.**
Le point 2 de la Définition du fait ne peut être signé sans Docker/psql joignables.

## En cours
(rien côté code — la suite est entièrement environnementale, voir dette datée ci-dessous)

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

**Défaut de mesure: gates 12-29 inre-vérifiés** — Docker unreachable, psql absent de l'env. C'est une vraie faille (DB-backed gates), pas une fausse info. État: **BLOQUÉ**, non résolu.
**§7 vérification visuelle (13 contrôles, screenshot + navigation)** — pas exécutée (pas de browser). État: **BLOQUÉ**, non résolu.
**User call explicite**: commit en dépit des deux failles. Enregistré comme délibéré, non accidental.

## Portes & regressions
Réexécutées 2026-08-04 post-fix : `preflight` ✓ · `typecheck` ✓ · `lint` ✓ · `build` ✓ · `checkpoint-s5` VERT 1-11 · `checkpoint-s4` VERT 25 · `checkpoint-adr019` VERT 24. Aucune régression S1–S4.
**La couche sécurité est gelée.** ADR-019 tient sur `app_gatekeeper` sans `BYPASSRLS`, membre `authenticated` **avec `INHERIT TRUE`**, propriétaire des portes 004/007/008. Y toucher casse la cloison.

## Décisions de session (à verser au 00-DECISIONS.md)
1. **Nom de fichier gateway:** `supabase/functions/_shared/external-call.ts` (pas llm.ts) — settle par scripts/preflight.sh §1 ligne 8 (seule exemption de grep).
2. **S6 gateway est Edge Function** (Deno, supabase/functions/), **pas Next.js API route** — confirme l'architecte et 02-SECURITY-BOUNDARY.md §1. Limite acceptée: pas de typecheck/build pnpm sur Deno; requiert Docker+`supabase functions serve`.
3. **S6 scope resserré:** 027/028 migrations (pseudonymize.ts, external-call.ts, app.get_previous_note, audit.boundary_crossings) + **UNE SEULE TOOL: analyze_session** (read-only, no confirmation, no jarvis_actions). Les 7-8 autres outils, propose-confirm-execute-log, draft_clinical_note = **EXPLICITEMENT OUT**.

## Dette assumée, datée
- checkpoint-s5.sh gates 12-29 inrévérifiés (Docker/psql absent) → **avant le prochain S5 call (avant 2026-08-10)**
- S5 §7 on-screen matrix (13 lignes, f5, focus, 390px, offline, assistant role) → **avant 2026-08-10**
- graphify-out/ non tracké, pas en .gitignore → `git rm --cached` ou `.gitignore` avant le prochain `git add .*`
- Un DROP de FUNCTION emporte son propriétaire → **ne pas recopier sur app.get_consultation** (read-only, SECURITY INVOKER, safe si DROP)
- **S6 §5.8-10 du plan approuvé, non joués (Docker/psql absents)** : appliquer
  027/028 et vérifier `get_previous_note` à la main ; `supabase functions
  serve` et un appel réel à `jarvis-analyze-session` ; JWT assistante → échec
  propre sans fuite ; `OPENROUTER_API_KEY` absente → « indisponible » sans
  casser l'écran ; à l'écran réel : deux clics rapides sur « Analyser la
  séance » = un seul appel, coupure réseau en cours d'appel + retour sur
  l'écran = pas de résultat obsolète affiché, JSON malformé (mock/proxy) =
  une reformulation puis un échec propre. **S6 n'est PAS clos tant que ces
  points ne sont pas verts** → au plus tard **avant 2026-08-10** (même
  échéance que la dette S5, pour ne pas la reperdre de vue).
- `checkpoint-s5.sh`/`checkpoint-adr019.sh` n'ont pas pu être rejoués en
  régression après la Phase 2 (même blocage Docker/psql) → à rejouer dans le
  même geste que le point précédent, avant 2026-08-10.
- `supabase/migrations;G/` — répertoire parasite (coquille shell), à
  supprimer manuellement, jamais committé jusqu'ici → avant le prochain
  `git add`.

## En litige — voir WORKING-CONTEXT.md §7
**Q-D CLOSE** (2026-08-03, ADR-019 opérationnelle). **Q-A/Q-B/Q-C** référencées §8 de WORKING-CONTEXT — toutes en ADRs, aucune nouvelle question ouverte.
**Nota:** WORKING-CONTEXT.md §0 mentionne docs 05-BUILD-PLAN et 06 (inexistants sur disque) — l'autorité est en retard.

## Prochaine tâche — clore S6 : vérification environnementale, puis écran réel
Code de S6 (Phase 1 + Phase 2) complet et commité. Ce qui reste n'est plus du
code : c'est de rejouer §5.8-10 du plan approuvé dès que Docker/psql sont
joignables (dette datée ci-dessus), PUIS de faire la vérification à l'écran
réel listée au même endroit (deux clics rapides, coupure réseau, JSON
malformé). Plan technique, toujours autorité :
`C:\Users\ABC Informatique\.claude\plans\s5-completed-but-i-declarative-simon.md`
— le découpage d'exécution de la Phase 1 est dans
`C:\Users\ABC Informatique\.claude\plans\start-the-s6-plan-hazy-cat.md`.

Une fois ces points verts : signer le point 2 de la Définition du fait
ci-dessus, et alors seulement déclarer S6 clos. Les 7-8 autres outils Jarvis
et la boucle proposer-confirmer restent explicitement hors périmètre (§4 du
plan approuvé) — un chantier séparé, pas une suite immédiate.
