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
