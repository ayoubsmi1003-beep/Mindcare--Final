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
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { auditServerDependencies } from "./lib/electron-runtime-audit.mjs";
import {snapshotAlexaBuildSources,enablePackagedNativeEntrypoints,finalizeAlexaBuild} from './lib/alexa-package-integrity.mjs';

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
  "native-voice-worker.py",
  "garde-origine.mjs",
  "verifier-base.mjs",
  "sauvegarde.mjs",
  path.join("lib", "dburl.mjs"),
  path.join("lib", "pg-env.mjs"),
  path.join("lib", "base-locale.mjs"),
  path.join("lib", "alexa-migrations.mjs"),
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
const alexaBuildSource=snapshotAlexaBuildSources(RACINE);
const alexaAssets=spawnSync(process.execPath,[path.join(RACINE,"scripts/prepare-alexa-model.mjs")],{cwd:RACINE,stdio:"inherit",windowsHide:true});
if(alexaAssets.status!==0)throw new Error("LocalModelPackagingFailed");
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
    env: { ...process.env, MINDCARE_PAQUET: "1", ALEXA_NATIVE_AGENT_ENABLED: "1" },
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
if (path.relative(RACINE, CIBLE) !== path.join("resources", "serveur")) {
  throw new Error("cible d'assemblage hors du dossier attendu");
}
rmSync(CIBLE, { recursive: true, force: true });
mkdirSync(CIBLE, { recursive: true });

// ── 3. Le serveur autonome (server.js, .next/server, node_modules tracés) ────
etape("copie de la sortie autonome…");
cpSync(AUTONOME, CIBLE, {
  recursive: true,
  dereference: true,
  // Exclude build caches, credentials and separately bundled voice before copying.
  filter: source => {
    const relatif = path.relative(AUTONOME, source);
    const nom = path.basename(source);
    return ![".cache", "scripts", path.join("resources", "voix")].some(exclu => relatif === exclu || relatif.startsWith(exclu + path.sep))
      && nom !== ".env" && !nom.startsWith(".env.");
  },
});

// Le traçage peut recopier tout scripts/ et les dépendances voix. Les scripts
// seront recréés depuis SCRIPTS_LIVRES ; Electron fournit déjà la voix dans
// resources/voix, à côté du backend, avec ses chemins serveur explicites.
for (const relatif of ["scripts", ".cache", path.join("resources", "voix")]) {
  const copieTracee = path.resolve(CIBLE, relatif);
  const sousCible = path.relative(CIBLE, copieTracee);
  if (!sousCible || sousCible.startsWith("..") || path.isAbsolute(sousCible)) {
    throw new Error("copie tracée hors du backend assemblé");
  }
  rmSync(copieTracee, { recursive: true, force: true });
}

// ── 3ter. Les pairs d'exécution de Next que le traçage manque sous pnpm ─────
//
// ⚠️ MESURÉ, PAS SUPPOSÉ. Le serveur autonome mourait au lancement :
// `Cannot find module 'styled-jsx/package.json'` puis
// `Cannot find module '@swc/helpers/...'` puis `Cannot find module '@next/env'`
// (requires d'exécution de Next).
// Le traçage `standalone` ne voit pas ces `require`, et sous pnpm ils ne sont
// pas remontés à la racine de `node_modules` — ni tracés, ni trouvables. On
// les rapatrie depuis le magasin pnpm, versions résolues dynamiquement
// (jamais d'épinglage en dur ici). La liste est fermée et chaque absence est
// un refus : un pair manquant = un backend qui ne démarre pas (trouvé par
// échec réel du provisionnement packagé, 2026-10-07).
etape("rapatriement des pairs d'exécution Next manqués par le traçage…");
{
  const magasin = path.join(RACINE, "node_modules", ".pnpm");
  const dossierMagasin = (nom) => {
    const base = nom.replace("/", "+");
    return readdirSync(magasin).filter((d) => d === nom || d.startsWith(`${base}@`));
  };
  const PAIRS = ["styled-jsx", "@swc/helpers", "@next/env", "client-only"];
  for (const nom of PAIRS) {
    const source = dossierMagasin(nom)
      .map((d) => path.join(magasin, d, "node_modules", nom))
      .find((p) => existsSync(path.join(p, "package.json")));
    if (source === undefined) {
      console.error(`[paquet] ${nom} introuvable dans node_modules/.pnpm — lancer \`pnpm install\`.`);
      process.exit(1);
    }
    cpSync(source, path.join(CIBLE, "node_modules", nom), { recursive: true, dereference: true });
    console.log(`[paquet]   rapatrié : ${nom}`);
  }
}

// ── 3quater. L'arbre `pg` COMPLET, pas sa seule racine ────────────────────────
//
// ⚠️ MESURÉ, PAS SUPPOSÉ. Le traçage recopie `node_modules/pg` (serveur) mais
// PAS ses voisins pnpm (`pg-types`, `pg-connection-string`, `pg-pool`,
// `pgpass`…) : toute route adossée à la base rendait 500 sur le paquet
// (`/api/auth/session` anonyme en 500 là où le dev rend 200 `data:null` —
// trouvé par échec e2e réel C1.1 sur le bundle empaqueté, 2026-10-07).
// Pire : les dépendances TRANSITIVES (`postgres-array` via `pg-types`…)
// vivent dans leurs propres entrées `.pnpm/postgres-array@*/…`, hors de portée
// d'une copie des seuls voisins directs (trouvé par refus du §7, 2026-10-07).
// On rapatrie donc la FERMETURE complète (liste fermée ci-dessous, versions
// résolues dynamiquement, liens déréférencés — cf. §3ter). Sans cela, l'EMR
// empaqueté ne lit AUCUNE donnée.
etape("complétude de l'arbre pg…");
{
  const magasin = path.join(RACINE, "node_modules", ".pnpm");
  // Fermeture de `pg@8` (package.json du paquet + graphe transitif) + `tslib`
  // (requis par `@swc/helpers` du §3ter). Sont EXCLUS à dessein : `pg-native`
  // (liaison native optionnelle, jamais chargée par le chemin par défaut —
  // `pg/lib/native` n'est exigé par personne), `tape`/`pff` (tests de
  // `pg-types`, jamais chargés) et `babel-plugin-macros` (outillage babel de
  // `styled-jsx`, temps de compilation uniquement) — fermeture calculée par
  // analyse statique des `require` de l'arbre empaqueté, 2026-10-07.
  const FERMETURE_PG = [
    "pg",
    "pg-cloudflare",
    "pg-connection-string",
    "pg-int8",
    "pg-pool",
    "pg-protocol",
    "pg-types",
    "pgpass",
    "postgres-array",
    "postgres-bytea",
    "postgres-date",
    "postgres-interval",
    "split2",
    "tslib",
    "xtend",
  ];
  const dossierMagasinPg = (nom) => {
    const base = nom.replace("/", "+");
    const candidats = existsSync(magasin) ? readdirSync(magasin).filter((d) => d === nom || d.startsWith(`${base}@`)) : [];
    if (candidats.length !== 1) {
      console.error(
        `[paquet] ${nom} : ${candidats.length} candidats dans node_modules/.pnpm (${candidats.join(",") || "aucun"}) — résolution ambiguë, mettre à jour FERMETURE_PG.`,
      );
      process.exit(1);
    }
    return path.join(magasin, candidats[0], "node_modules", nom);
  };
  for (const nom of FERMETURE_PG) {
    const source = dossierMagasinPg(nom);
    if (!existsSync(path.join(source, "package.json"))) {
      console.error(`[paquet] ${nom} introuvable dans node_modules/.pnpm — lancer \`pnpm install\`.`);
      process.exit(1);
    }
    // `dereference: true` — OBLIGATOIRE : dans le magasin pnpm, les
    // dépendances secondaires sont des LIENS vers `../../<nom>@x/…`.
    // Recopiés tels quels, ce seraient des liens pendants dans l'arbre du
    // paquet (trouvé par refus du §7, 2026-10-07).
    cpSync(source, path.join(CIBLE, "node_modules", nom), { recursive: true, dereference: true });
  }
  console.log("[paquet]   arbre pg complet rapatrié");
}

// ONNX est importé dynamiquement par le serveur. Les versions web et Node
// diffèrent : résoudre le pair via le chemin pnpm réel du runtime Node.
etape("complétude des runtimes React, Zod et ONNX…");
{
  for (const name of ["react-dom", "zod"]) {
    cpSync(realpathSync(path.join(RACINE, "node_modules", name)), path.join(CIBLE, "node_modules", name), { recursive: true, dereference: true });
  }
  const reactResolver = createRequire(path.join(realpathSync(path.join(RACINE, "node_modules", "react-dom")), "package.json"));
  let schedulerRoot = path.dirname(reactResolver.resolve("scheduler"));
  while (!existsSync(path.join(schedulerRoot, "package.json"))) {
    const parent = path.dirname(schedulerRoot);
    if (parent === schedulerRoot) throw new Error("Racine scheduler introuvable");
    schedulerRoot = parent;
  }
  cpSync(schedulerRoot, path.join(CIBLE, "node_modules", "scheduler"), { recursive: true, dereference: true });
  const sourceOnnx = realpathSync(path.join(RACINE, "node_modules", "onnxruntime-node"));
  const resolver = createRequire(path.join(sourceOnnx, "package.json"));
  let sourceCommon = path.dirname(resolver.resolve("onnxruntime-common"));
  while (!existsSync(path.join(sourceCommon, "package.json"))) {
    const parent = path.dirname(sourceCommon);
    if (parent === sourceCommon) throw new Error("Racine onnxruntime-common introuvable");
    sourceCommon = parent;
  }
  cpSync(sourceCommon, path.join(CIBLE, "node_modules", "onnxruntime-common"), { recursive: true, dereference: true });
}

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

// ── 7. Preuve de démarrage du serveur assemblé ───────────────────────────────
//
// Un pair manquant (§3ter) ou un arbre incomplet (§3quater) ne se voit qu'au
// lancement, sur le poste du cabinet. On démarre donc le `server.js` assemblé
// ici même, sur un port de sonde fixe (43119, jamais un port de production),
// et on exige son « Ready » PUIS une session anonyme saine : `GET
// /api/auth/session` sans cookie doit rendre 200 `{"ok":true,"data":null}`
// SANS toucher la base (`resoudreSession(undefined)` rend null avant tout
// accès). Cette sonde charge toute la chaîne d'import des routes
// (`session → withCaller → pool → pg`) : un `pg-types` manquant la fait
// passer en 500 et refuse l'assemblage (trouvé par échec e2e C1.1, 2026-10-07).
// Le serveur de sonde est tué aussitôt — preuve, jamais backend.
const erreursRuntime = auditServerDependencies(CIBLE);
if (erreursRuntime.length > 0) {
  console.error("[paquet] dépendances runtime incomplètes :", erreursRuntime.join("; "));
  process.exit(1);
}
etape("chargement des dépendances runtime vérifié");
enablePackagedNativeEntrypoints(CIBLE);
etape("preuve de démarrage du serveur assemblé…");
{
  const { spawn } = await import("node:child_process");
  const sonderSessionAnonyme = async () => {
    const ctl = new AbortController();
    const garde = setTimeout(() => ctl.abort(), 10_000);
    try {
      const r = await fetch("http://127.0.0.1:43119/api/auth/session", { signal: ctl.signal });
      const corps = (await r.text()).slice(0, 200);
      return r.status === 200 && corps.includes('"data":null');
    } catch {
      return false;
    } finally {
      clearTimeout(garde);
    }
  };
  await new Promise((resoudre) => {
    const fils = spawn(process.execPath, [path.join(CIBLE, "server.js")], {
      cwd: CIBLE,
      env: { ...process.env, PORT: "43119", HOSTNAME: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let sortie = "";
    let pret = false;
    let fini = false;
    let ferme = false;
    fils.once("close", () => { ferme = true; });
    const minuteur = setTimeout(() => {
      fils.kill();
      console.error("[paquet] le démarrage et l'arrêt contrôlés du serveur assemblé n'ont pas abouti sous 120 s.");
      console.error(sortie);
      process.exit(1);
    }, 120_000);
    const terminer = (ok, message) => {
      if (fini) return;
      fini = true;
      const conclure = () => {
        clearTimeout(minuteur);
        if (!ok) { console.error(message); process.exit(1); }
        console.log(message);
        resoudre(undefined);
      };
      if (ferme) conclure();
      else { fils.once("close", conclure); fils.kill(); }
    };
    const refuserManquant = () => {
      const manquant = /Cannot find module '([^']+)'/.exec(sortie);
      if (manquant !== null) {
        terminer(false, `[paquet] module d'exécution manquant : ${manquant[1]} — compléter §3ter/§3quater.`);
      }
    };
    const sonderApresPret = async () => {
      for (let essai = 0; essai < 10; essai += 1) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await sonderSessionAnonyme()) {
          terminer(true, "[paquet]   serveur assemblé : Ready + session anonyme saine (preuve de démarrage)");
          return;
        }
      }
      terminer(false, "[paquet] /api/auth/session anonyme ne rend pas 200 data:null — chaîne d'import des routes brisée.");
    };
    fils.stdout?.on("data", (d) => {
      sortie += d.toString();
      if (sortie.length > 6000) sortie = sortie.slice(-6000);
      if (!pret && /Ready in|started server on/i.test(sortie)) {
        pret = true;
        void sonderApresPret();
      }
      refuserManquant();
    });
    fils.stderr?.on("data", (d) => {
      sortie += d.toString();
      if (sortie.length > 6000) sortie = sortie.slice(-6000);
      refuserManquant();
    });
    fils.on("exit", (code) => {
      if (!sortie.includes("Ready")) {
        clearTimeout(minuteur);
        console.error(`[paquet] le serveur assemblé s'est terminé (code ${String(code)}) sans dire « Ready ».`);
        console.error(sortie.slice(-1500));
        process.exit(1);
      }
    });
    fils.on("error", (e) => {
      clearTimeout(minuteur);
      console.error(`[paquet] lancement du serveur assemblé impossible : ${e.message}`);
      process.exit(1);
    });
  });
}

finalizeAlexaBuild(RACINE,CIBLE,alexaBuildSource);
etape(`prêt : ${path.relative(RACINE, CIBLE)}`);
