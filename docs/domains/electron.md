# Domaine Electron / bureau local (CURRENT)

PURPOSE: Paquet Windows local-first : PostgreSQL embarqué + backend Next
autonome + coquille sécurisée. Étapes 1–10 câblées (état Phase bureau).
DÉMARRAGE (machine à états, `orchestrateur.ts` — jamais `loadURL` avant READY,
jamais de `setTimeout` comme synchro, jamais de fenêtre blanche) :
BOOTING → binaires pg → cluster (`pg-cluster.ts`, construction de commandes,
`provisionnement.ts` seul exécuteur) → provisionnement (bootstrap `000` →
migrations dans l'ordre → bootstrap `010`, cf. `provisionnement.ts:118-148`) →
backend Next autonome (`resources/serveur/`, assemblé par `preparer-paquet.mjs`) →
sonde `/api/health` (vivacité backend UNIQUEMENT, sans auth, sans données) +
sonde pg séparée par `pg.Client` → READY (`loadURL` + `show`) ou FAILED
(fenêtre d'erreur FR actionnable).
FRONTIÈRES: renderer NON FIABLE (`contextIsolation` + `sandbox` +
`nodeIntegration:false`, `index.ts`) · preload = `contextBridge` SEUL
(`preload/index.cts`, extension imposée par échec réel documenté en-tête) ·
aucune URL de base ni secret vers le renderer · IPC minimale
(`ouvrirJournaux`/`lancerSauvegarde` refusés tant que non implémentés).
POSTGRESQL: version attendue **16** (`VERSION_ATTENDUE`, `pg-cluster.ts:30` —
`WITH INHERIT` de `020`/`010` l'exige ; mentions « 15 » ailleurs = STALE,
voir ci-dessous) · binaires `resources/pgsql/` (téléchargés, README suivi) ·
service `mindcare-postgres` · secrets jamais journalisés/affichés.
ARRÊT: `before-quit` → `tuerBackend` (`index.ts:66`, `orchestrateur`) ·
`window-all-closed` → `quit` (hors darwin).
SANTÉ: `/api/health` (backend) + `demarrage.ts`/`verifier-base.mjs` (refus si
disque ≠ base) + `garde-origine.mjs` (port) + `verifier-paquet.mjs` (paquet).
PAQUET: `preparer-paquet.mjs` → `elaguer-pgsql.mjs` → `build:electron` →
`electron-builder --win` (`electron-builder.yml`).
TESTS: unit `electron-chemins`/`electron-etat-demarrage`/`electron-pg-cluster`
(sans pg réel, par construction) · `scripts/installer-windows.ps1` (procédure) ·
`verifier-paquet.mjs`.
STALE CONNU (non corrigé ici — hors fichiers autorisés): `CLAUDE.md` §2,
`installer-windows.ps1` et `postgres:15` des checkpoints disent « 15 » ;
l'exécutable exige 16.
FORBIDDEN: secret/DB-URL vers le renderer · `loadURL` avant READY · réparation
silencieuse d'un schéma incomplet · `supabase db reset` (hook).

MISE À JOUR 2026-10-21 : un cabinet déjà approuvé utilise sa confiance persistée,
sans nouvelle fenêtre de découverte. Le moniteur ne masque plus la fenêtre
principale après un échec de santé ; le démarrage et les erreurs restent dans
cette même fenêtre, avec une nouvelle tentative explicite. Le serveur local
reste nécessaire et fonctionne en arrière-plan. Sa tâche protégée peut être
démarrée par un utilisateur normal, sans droit de modifier son action.
Les arrêts intentionnels attendent la fermeture du backend avant une reprise
et ne stoppent pas le service PostgreSQL partagé. Les diagnostics de cycle de
vie sont bornés et limités aux codes techniques.

Le runtime de production ne contient aucun mode `synthetic-eval` ni cabinet de
démonstration. Les essais avec fixtures doivent préparer une base jetable
isolée, sans restaurer ni modifier le cabinet. Le modèle conserve ses contrôles
de droits et d'intégrité ; les résumés et le chat partagent un créneau
d'inférence avec annulation et délai borné. Les compteurs simples reconnus
passent par les portes SQL auditées existantes. La disponibilité de la synthèse
exige encore un modèle capable de produire une réponse dont les sources sont
validées.

Les sorties locales de build et d'évaluation ne sont pas une source de vérité.
Un test de stabilité sur ce PC ne vaut pas qualification sur Windows vierge ou
sur deux PC physiques. L'ancien cabinet installé conserve un schéma de 149
migrations : ne pas y activer le chemin Alexa natif avant la mise à niveau
contrôlée des migrations 159–170 et sa validation.
