#!/usr/bin/env node
/**
 * Assemble `resources/serveur/` — la RACINE d'exécution du backend dans
 * l'application installée. §I du plan (étape 9).
 *
 * ═══ CE QUE CE SCRIPT EST, ET CE QU'IL N'EST PAS ═══════════════════════════
 *
 * Il n'ajoute aucune fonctionnalité et ne réécrit rien : il COPIE, dans un
 * arbre unique et fermé, exactement les fichiers que le plan autorise à
 * quitter le dépôt. Tout ce qui n'est pas nommé ici n'entre pas dans
 * l'installateur — c'est le principe de LISTE BLANCHE de §I, et c'est la
 * seule forme d'exclusion qui vieillit bien : une liste noire oublie
 * silencieusement le fichier sensible ajouté demain.
 *
 * ═══ POURQUOI UN SEUL ARBRE, `resources/serveur` ═══════════════════════════
 *
 * Trois consommateurs cherchent leurs fichiers par la MÊME convention « la
 * racine, c'est le dossier parent » :
 *
 *   · `scripts/verifier-base.mjs`  → `<racine>/supabase/migrations` (l. 134) ;
 *   · `electron/main/provisionnement.ts` → `<racine>/supabase/{bootstrap,migrations}` ;
 *   · le serveur Next autonome    → `<racine>/.next`, `<racine>/public`.
 *
 * Les réunir sous une racine unique évite d'inventer une variable de chemin
 * par consommateur — et évite surtout que `verifier-base.mjs` ne résolve `pg`
 * dans le vide : placé DANS l'arbre autonome, il trouve `node_modules/pg` par
 * la résolution normale de Node, sans `NODE_PATH` ni copie de dépendance.
 *
 * ═══ CE QUI N'ENTRE PAS, ET POURQUOI ═══════════════════════════════════════
 *
 * Ni `.env` (le paquet lit `%ProgramData%\MindCare\mindcare.env`, et lui
 * seul — cf. `electron/main/chemins.ts`), ni `tests/`, ni `checkpoints/`, ni
 * `docs/` (dont les `.xlsx` de médicaments et les images de certificats), ni
 * les `scripts/checkpoint-*` / `mesure-*` / `eval-*` / `*.sh`, ni Playwright.
 * `scripts/verifier-paquet.mjs` le VÉRIFIE sur l'artefact final : ici c'est
 * une intention, là-bas c'est une preuve.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUTONOME = path.join(RACINE, ".next", "standalone");
const CIBLE = path.join(RACINE, "resources", "serveur");

/**
 * Les seuls scripts que l'application installée exécute (§I) :
 * la garde de port, le contrôle de schéma au démarrage, la sauvegarde.
 * `lib/dburl.mjs` est la dépendance interne de `sauvegarde.mjs` ;
 * `lib/base-locale.mjs` celle de `verifier-base.mjs` (LM54.3 — cycle de
 * vie de la base de développement : dans le paquet installé, le Docker
 * y est absent et `attendreDemon` rendra son diagnostic structuré au
 * lieu de casser l'import).
 */
const SCRIPTS_LIVRES = [
  "garde-origine.mjs",
  "verifier-base.mjs",
  "sauvegarde.mjs",
  path.join("lib", "dburl.mjs"),
  path.join("lib", "base-locale.mjs"),
];

function etape(message) {
  console.log(`[paquet] ${message}`);
}

// ── 1. Construire le backend en sortie autonome ──────────────────────────────
//
// ⚠️ LANCÉ PAR `node --import`, PAS PAR `pnpm exec`, ET POUR UNE RAISON PRÉCISE.
//
// La sortie autonome recopie l'arborescence `node_modules` tracée. Sous pnpm
// cette arborescence est faite de LIENS SYMBOLIQUES, que Next recrée à
// l'identique — et créer un lien symbolique sous Windows exige un privilège
// que ni le mode développeur désactivé ni une session non élevée n'accordent.
// Mesuré : `next build` échouait en `EPERM: operation not permitted, symlink`
// sur `@next/env`, après une trentaine d'avertissements du même ordre.
//
// `scripts/lib/jonction-windows.mjs` fait retomber CE SEUL processus sur une
// jonction NTFS — le mécanisme que pnpm et npm emploient déjà sous Windows
// pour la même raison. Rien d'autre dans le dépôt n'en dépend, et un lien de
// fichier ou une erreur d'un autre code remontent intacts.
etape("construction Next.js (sortie autonome)…");
// Le binaire de Next par son CHEMIN, pas par `createRequire` : la règle
// `no-restricted-imports` du dépôt interdit `node:module`, et un chemin
// explicite dit aussi plus clairement ce qui est lancé.
const binNext = path.join(RACINE, "node_modules", "next", "dist", "bin", "next");
if (!existsSync(binNext)) {
  console.error(`[paquet] binaire Next introuvable : ${binNext} — lancer \`pnpm install\`.`);
  process.exit(1);
}
const build = spawnSync(
  process.execPath,
  ["--import", "./scripts/lib/jonction-windows.mjs", binNext, "build"],
  {
    cwd: RACINE,
    stdio: "inherit",
    env: { ...process.env, MINDCARE_PAQUET: "1" },
  },
);
if (build.status !== 0) {
  console.error("[paquet] échec de `next build`. Rien n'a été assemblé.");
  process.exit(build.status ?? 1);
}
if (!existsSync(path.join(AUTONOME, "server.js"))) {
  console.error(
    "[paquet] `.next/standalone/server.js` est absent : la sortie autonome n'a pas été produite.\n" +
      "         Vérifier que `MINDCARE_PAQUET=1` atteint bien `next.config.ts`.",
  );
  process.exit(1);
}

// ── 2. Repartir d'un arbre propre ────────────────────────────────────────────
// Un assemblage INCRÉMENTAL garderait le fichier retiré de la liste blanche
// hier — exactement le genre de résidu qu'une liste blanche existe pour
// empêcher. On efface, toujours.
etape("nettoyage de resources/serveur…");
rmSync(CIBLE, { recursive: true, force: true });
mkdirSync(CIBLE, { recursive: true });

// ── 3. Le serveur autonome (server.js, .next/server, node_modules tracés) ────
etape("copie de la sortie autonome…");
cpSync(AUTONOME, CIBLE, { recursive: true });

// ── 3bis. LE `.env` QUE NEXT RECOPIE DE LUI-MÊME ─────────────────────────────
//
// ⚠️ MESURÉ, PAS SUPPOSÉ. La première exécution de ce script a produit un
// `resources/serveur/.env` : `next build` recopie les fichiers d'environnement
// du dépôt dans la sortie autonome, parce qu'en déploiement serveur classique
// c'est ce qu'on veut. Ici c'est précisément ce que §F du plan interdit — le
// paquet ne doit lire QUE `%ProgramData%\MindCare\mindcare.env`, et un `.env`
// de développeur embarqué, c'est une installation cabinet silencieusement
// pointée sur la base d'un autre, avec ses patients.
//
// On les retire, et on VÉRIFIE qu'il n'en reste aucun : la suppression seule
// serait une intention, la vérification en fait une garantie.
etape("retrait des fichiers d'environnement recopiés par Next…");
for (const entree of readdirSync(CIBLE)) {
  if (entree === ".env" || entree.startsWith(".env.")) {
    rmSync(path.join(CIBLE, entree), { force: true });
    console.log(`[paquet]   retiré : ${entree}`);
  }
}
const residus = readdirSync(CIBLE).filter((f) => f === ".env" || f.startsWith(".env."));
if (residus.length > 0) {
  console.error(`[paquet] fichiers d'environnement toujours présents : ${residus.join(", ")}`);
  process.exit(1);
}

// ── 4. Les actifs que `standalone` ne copie pas lui-même ─────────────────────
// Next le documente : `.next/static` et `public/` restent à la charge de
// l'empaqueteur, parce qu'ils sont normalement servis par un CDN. Ici il n'y
// a pas de CDN — le serveur local les sert, et sans eux l'application
// s'ouvre sans style et sans le runtime ONNX du mot de réveil.
etape("copie de .next/static et public/…");
cpSync(path.join(RACINE, ".next", "static"), path.join(CIBLE, ".next", "static"), { recursive: true });
cpSync(path.join(RACINE, "public"), path.join(CIBLE, "public"), { recursive: true });

// ── 4bis. Élagage des fichiers sans rôle à l'exécution ───────────────────────
//
// L'arbre `node_modules` tracé apporte, avec le code, ~2 400 cartes de source
// (`*.js.map`) et les README de chaque dépendance. Aucun des deux ne sert à
// l'exécution, et §I du plan exclut explicitement les cartes de source.
//
// Les README ne sont pas retirés « pour faire de la place » : plusieurs
// contiennent des URL de connexion PostgreSQL d'exemple
// (`postgresql://user:pass@…` dans `pg-connection-string/README.md`), et §O
// du plan pose qu'un grep de l'artefact ne doit ramener AUCUNE URL de ce
// motif. Un contrôle qu'on apprend à ignorer parce qu'il crie sur des
// exemples de documentation ne protège plus de rien : on retire la source du
// bruit plutôt que d'affaiblir le contrôle.
//
// ⚠️ LES LICENCES RESTENT. `LICENSE.md`, `COPYING.md`, `NOTICE.md` sont des
// obligations légales de redistribution, pas de la documentation.
etape("élagage des cartes de source et des README des dépendances…");
const MODULES = path.join(CIBLE, "node_modules");
let elagues = 0;
if (existsSync(MODULES)) {
  const pile = [MODULES];
  while (pile.length > 0) {
    const courant = pile.pop();
    for (const entree of readdirSync(courant, { withFileTypes: true })) {
      const complet = path.join(courant, entree.name);
      if (entree.isDirectory()) {
        pile.push(complet);
        continue;
      }
      const nom = entree.name;
      const juridique = /^(licen[cs]e|copying|notice)/i.test(nom);
      if (nom.endsWith(".map") || (/\.(md|markdown)$/i.test(nom) && !juridique)) {
        rmSync(complet, { force: true });
        elagues += 1;
      }
    }
  }
}
console.log(`[paquet]   ${elagues} fichiers élagués`);

// ── 5. Le SQL — source unique, jamais dupliquée dans le code ─────────────────
etape("copie de supabase/{bootstrap,migrations}…");
cpSync(path.join(RACINE, "supabase", "bootstrap"), path.join(CIBLE, "supabase", "bootstrap"), {
  recursive: true,
});
cpSync(path.join(RACINE, "supabase", "migrations"), path.join(CIBLE, "supabase", "migrations"), {
  recursive: true,
});

// ── 6. Les scripts livrés, nommés un par un ──────────────────────────────────
etape("copie des scripts livrés…");
for (const relatif of SCRIPTS_LIVRES) {
  const source = path.join(RACINE, "scripts", relatif);
  if (!existsSync(source)) {
    console.error(`[paquet] script livrable introuvable : scripts/${relatif}`);
    process.exit(1);
  }
  const destination = path.join(CIBLE, "scripts", relatif);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination);
}

etape(`prêt : ${path.relative(RACINE, CIBLE)}`);
