#!/usr/bin/env node
/**
 * Élague `resources/pgsql/` au strict RUNTIME dont MindCare a besoin — §C,
 * §I du plan (étape 9, corrigé après revue).
 *
 * ═══ CE QUI A DÉCLENCHÉ CE SCRIPT ═══════════════════════════════════════════
 *
 * `resources/pgsql/` est peuplé en copiant le CONTENU COMPLET du zip binaire
 * EDB (~161 Mio) : documentation HTML, en-têtes C, l'installateur graphique
 * StackBuilder, les outils de test/dev de PostgreSQL (`pg_regress`,
 * `isolationtester`, `pgbench`…), les bibliothèques d'imports `.lib`. Rien
 * de tout ça ne tourne dans le paquet MindCare — mais `docs/postgresql/html/
 * libpq-connect.html` contient un exemple d'URL `postgresql://user:pass@…`,
 * et `scripts/verifier-paquet.mjs` (à raison) a refusé l'artefact.
 *
 * La réponse n'est PAS d'exempter ce fichier du contrôle de fuite — un
 * exemple de mot de passe dans une doc tierce est indiscernable d'un vrai
 * secret pour ce contrôle, et un motif qui apprend des exceptions au premier
 * faux positif ne protège plus de rien. La réponse est que ce fichier n'a
 * aucune raison d'être dans un artefact livré à une patientèle.
 *
 * ═══ CE QUE CE SCRIPT DÉCIDE, ET COMMENT IL LE PROUVE ══════════════════════
 *
 * Trois sources, aucune approximative :
 *
 *   1. Les EXÉCUTABLES requis sont ceux, et SEULEMENT ceux, que
 *      `electron/main/pg-cluster.ts`, `pg-binaires.ts`, `provisionnement.ts`
 *      et `scripts/sauvegarde.mjs` invoquent réellement (grep, pas mémoire) :
 *      `initdb`, `pg_ctl`, `psql`, `postgres`, `pg_dump`, `pg_restore`.
 *   2. Les EXTENSIONS requises sont celles que `CREATE EXTENSION` nomme dans
 *      `supabase/{bootstrap,migrations}/*.sql` (grep, pas mémoire) :
 *      `pgcrypto`, `uuid-ossp`, `pg_trgm`, `unaccent`.
 *   3. Les DLL requises sont celles que la table d'imports RÉELLE (format
 *      PE/COFF, `scripts/lib/pe-imports.mjs`) de (1) et (2) nomme,
 *      RÉSOLUES RÉCURSIVEMENT — `libpq.dll` importe `libssl-3-x64.dll`, qui
 *      importe `libcrypto-3-x64.dll`. Deviner cette liste à l'œil se trompe
 *      dans les deux sens ; la lire dans le binaire ne se trompe pas.
 *
 * Le `share/` restant (catalogue de bootstrap, extensions utilisées, fuseaux
 * horaires, gabarits `pg_hba`/`postgresql.conf`) est celui que `initdb`
 * exécute par construction — documenté ligne à ligne plus bas, PAS deviné.
 *
 * ═══ LA PREUVE : UN VRAI CLUSTER, PAS UNE INSPECTION DE FICHIERS ═══════════
 *
 * Élaguer sur la seule foi d'une liste, aussi soignée soit-elle, resterait
 * une PROMESSE (§29 de la mission : « faire respecter, ne pas promettre »).
 * Ce script fait donc tourner, contre l'arbre ÉLAGUÉ et uniquement lui, un
 * `initdb` avec les arguments EXACTS de `commandeInitdb` (encodage UTF8,
 * ICU fr-DZ, `scram-sha-256`), démarre `postgres.exe`, s'y connecte,
 * installe les quatre extensions réellement utilisées, appelle `unaccent()`
 * (qui lit `tsearch_data/unaccent.rules` à la première utilisation — la
 * seule façon de savoir si ce fichier est vraiment nécessaire), fait tourner
 * `pg_dump` puis `pg_restore`, et n'accepte l'élagage que si TOUT réussit.
 *
 * ═══ SÉCURITÉ DE L'OPÉRATION ════════════════════════════════════════════════
 *
 * Rien n'est supprimé avant que le test ne réussisse. Les fichiers écartés
 * sont déplacés dans une quarantaine ; si le test échoue, ils reviennent
 * intégralement et le script sort en erreur — `resources/pgsql/` peuplé
 * n'est pas un artefact reconstructible par un script (200 Mio téléchargés
 * chez l'éditeur), une élagage raté ne doit jamais le laisser à moitié détruit.
 */
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dllImportees } from "./lib/pe-imports.mjs";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PGSQL = path.join(RACINE, "resources", "pgsql");
const BIN = path.join(PGSQL, "bin");
const LIB = path.join(PGSQL, "lib");
const SHARE = path.join(PGSQL, "share");
const QUARANTAINE = path.join(PGSQL, ".elaguer-quarantaine");

function etape(message) {
  console.log(`[pgsql] ${message}`);
}

if (!existsSync(path.join(BIN, "initdb.exe"))) {
  console.error(`[pgsql] ${BIN}\\initdb.exe introuvable.`);
  console.error("        peupler resources/pgsql/ d'abord — voir resources/pgsql/README.md.");
  process.exit(1);
}

// ── 1. Exécutables requis — nommés par le code, pas par habitude ────────────
//
// `pg_dump`/`pg_restore` : `scripts/sauvegarde.mjs` (§J du plan). Le reste :
// `electron/main/pg-binaires.ts` (initdb, pg_ctl, psql, postgres). Aucun
// autre binaire de `bin/` n'est invoqué nulle part dans ce dépôt — vérifié
// par grep sur `electron/main/*.ts` et `scripts/*.mjs`, pas supposé.
const EXECUTABLES_REQUIS = ["initdb.exe", "pg_ctl.exe", "psql.exe", "postgres.exe", "pg_dump.exe", "pg_restore.exe"];

// ── 2. Extensions requises — nommées par les migrations, pas par habitude ───
function extensionsUtilisees() {
  const noms = new Set();
  const motif = /CREATE EXTENSION(?:\s+IF NOT EXISTS)?\s+"?([a-zA-Z0-9_-]+)"?/g;
  const fichiers = [
    ...readdirSync(path.join(RACINE, "supabase", "bootstrap")).map((f) =>
      path.join(RACINE, "supabase", "bootstrap", f),
    ),
    ...readdirSync(path.join(RACINE, "supabase", "migrations")).map((f) =>
      path.join(RACINE, "supabase", "migrations", f),
    ),
  ].filter((f) => f.endsWith(".sql"));
  for (const f of fichiers) {
    const contenu = readFileSync(f, "utf8");
    for (const m of contenu.matchAll(motif)) noms.add(m[1]);
  }
  return [...noms].sort();
}
const EXTENSIONS_REQUISES = extensionsUtilisees();
etape(`extensions utilisées (supabase/{bootstrap,migrations}) : ${EXTENSIONS_REQUISES.join(", ")}`);

// ── 3. DLL requises — lues dans les binaires, résolues récursivement ────────
//
// Seules les DLL qui existent PHYSIQUEMENT sous bin/ ou lib/ entrent dans la
// fermeture : les autres (kernel32.dll, ws2_32.dll, vcruntime140.dll, la
// famille api-ms-win-crt-*.dll…) sont fournies par Windows ou par le
// Redistribuable Visual C++ — elles n'ont jamais été présentes dans le zip
// EDB, élaguer ne change donc rien à cette dépendance préexistante.
function cheminReel(nomDll) {
  for (const dossier of [BIN, LIB]) {
    const candidat = path.join(dossier, nomDll);
    if (existsSync(candidat)) return candidat;
  }
  return null;
}

function fermetureDll(racinesFichiers) {
  const gardees = new Set();
  const aVisiter = [...racinesFichiers];
  while (aVisiter.length > 0) {
    const chemin = aVisiter.pop();
    for (const nomImporte of dllImportees(chemin)) {
      const reel = cheminReel(nomImporte);
      if (reel === null) continue; // fournie par le système, hors périmètre
      const nomFichierReel = path.basename(reel);
      if (gardees.has(nomFichierReel)) continue;
      gardees.add(nomFichierReel);
      aVisiter.push(reel);
    }
  }
  return gardees;
}

/**
 * ⚠️ `dict_snowball` DÉCOUVERT PAR ÉCHEC RÉEL, PAS PAR LECTURE DE
 * `snowball_create.sql`. Un premier essai sans cette DLL a fait échouer
 * `initdb` : `could not access file "$libdir/dict_snowball"` — ce script
 * exécute INCONDITIONNELLEMENT `snowball_create.sql` pour peupler le
 * catalogue des configurations de recherche plein texte par langue, et cette
 * exécution CHARGE la bibliothèque au moment même de `initdb`, avant même
 * qu'une seule extension applicative n'existe. Ce n'est donc pas une
 * extension « utilisée par MindCare » comme les quatre autres — c'est une
 * dépendance du BOOTSTRAP `initdb` lui-même, requise même si le dépôt
 * n'appelle jamais `to_tsvector`.
 *
 * `plpgsql` : même découverte, même méthode. `initdb` installe cette
 * extension dans la base `postgres` par défaut — indépendamment de toute
 * migration — et son absence fait échouer `initdb` avec
 * `extension "plpgsql" is not available`. Ce dépôt en dépendrait de toute
 * façon : 61 fichiers de migration écrivent `LANGUAGE plpgsql`.
 */
const MODULES_BOOTSTRAP = ["dict_snowball.dll", "plpgsql.dll"];
const CONTROLES_BOOTSTRAP = ["plpgsql"]; // entrent dans share/extension/ comme les extensions applicatives

const dllExtensions = [...EXTENSIONS_REQUISES.map((n) => `${n}.dll`), ...MODULES_BOOTSTRAP].filter((n) =>
  existsSync(path.join(LIB, n)),
);
const manquantes = [...EXTENSIONS_REQUISES.map((n) => `${n}.dll`), ...MODULES_BOOTSTRAP].filter(
  (n) => !existsSync(path.join(LIB, n)),
);
if (manquantes.length > 0) {
  console.error(`[pgsql] module(s) requis mais absent(s) du paquet : ${manquantes.join(", ")}`);
  process.exit(1);
}

const racinesFermeture = [
  ...EXECUTABLES_REQUIS.map((n) => path.join(BIN, n)),
  ...dllExtensions.map((n) => path.join(LIB, n)),
];
const dllFermeture = fermetureDll(racinesFermeture);

const KEEP_BIN = new Set(EXECUTABLES_REQUIS);
const KEEP_LIB = new Set(dllExtensions);
for (const nom of dllFermeture) {
  if (existsSync(path.join(BIN, nom))) KEEP_BIN.add(nom);
  if (existsSync(path.join(LIB, nom))) KEEP_LIB.add(nom);
}

// ── `share/` — ce que `initdb` exécute par construction ─────────────────────
//
// · `postgres.bki`, `system_{constraints,functions,views}.sql`,
//   `information_schema.sql`, `sql_features.txt`, `snowball_create.sql` :
//   `initdb` les ouvre INCONDITIONNELLEMENT pour peupler le catalogue —
//   qu'on utilise ou non la recherche plein texte que `snowball_create.sql`
//   enregistre. Absents, `initdb` échoue — le test plus bas le vérifierait.
// · `pg_hba.conf.sample`, `pg_ident.conf.sample`, `postgresql.conf.sample` :
//   gabarits qu'`initdb` COPIE dans `$PGDATA` avant que
//   `electron/main/pg-cluster.ts` (`contenuPgHba`, `contenuEcouteLocale`) ne
//   les réécrive entièrement — nécessaires à la création, pas à l'usage.
// · `timezone/`, `timezonesets/` : requis en continu — chaque horodatage de
//   ce dépôt se calcule en `Africa/Algiers` (CLAUDE.md §4).
// · `extension/` : uniquement les 4 extensions RÉELLEMENT créées par les
//   migrations — `.control` + tous les scripts `--X.Y.sql` (la chaîne de
//   montée en version), jamais les ~30 autres extensions du paquet EDB.
// · `tsearch_data/unaccent.rules` SEUL : c'est le seul fichier de ce dossier
//   que l'extension `unaccent` (utilisée, §001) lit — à la première
//   utilisation de la fonction, jamais à sa création. Prouvé par le test
//   plus bas, qui appelle `unaccent()` pour de vrai.
const SHARE_FICHIERS_FIXES = [
  "postgres.bki",
  "system_constraints.sql",
  "system_functions.sql",
  "system_views.sql",
  "information_schema.sql",
  "sql_features.txt",
  "snowball_create.sql",
  "pg_hba.conf.sample",
  "pg_ident.conf.sample",
  "postgresql.conf.sample",
];
const SHARE_DOSSIERS_FIXES = ["timezone", "timezonesets"];

// ── Élagage : déplacement en quarantaine, jamais une suppression directe ────
rmSync(QUARANTAINE, { recursive: true, force: true });
mkdirSync(QUARANTAINE, { recursive: true });

function versQuarantaine(cheminAbsolu) {
  const relatif = path.relative(PGSQL, cheminAbsolu);
  const destination = path.join(QUARANTAINE, relatif);
  mkdirSync(path.dirname(destination), { recursive: true });
  renameSync(cheminAbsolu, destination);
}

etape("mise en quarantaine des fichiers hors périmètre d'exécution…");

// Dossiers entiers hors périmètre : documentation, en-têtes C (développement
// d'extensions, jamais chargés par le serveur), l'installateur graphique
// StackBuilder, les métadonnées de liaison (`.lib`, `pkgconfig`) — toutes
// des dépendances de COMPILATION ou de DOCUMENTATION, aucune d'EXÉCUTION.
for (const nom of ["doc", "include", "StackBuilder"]) {
  const p = path.join(PGSQL, nom);
  if (existsSync(p)) versQuarantaine(p);
}
if (existsSync(path.join(LIB, "pkgconfig"))) versQuarantaine(path.join(LIB, "pkgconfig"));

// Notices de licence des composants NON livrés (pgAdmin, StackBuilder) — ni
// une obligation légale (on ne redistribue pas ce logiciel), ni un artefact
// d'exécution. `server_license.txt` et `commandlinetools_3rd_party_licenses.
// txt` COUVRENT ce qui reste (`postgres.exe` et les outils en ligne de
// commande) : ceux-là restent, à la racine, tels que l'éditeur les distribue.
for (const nom of ["pgAdmin_license.txt", "pgAdmin_3rd_party_licenses.txt", "StackBuilder_3rd_party_licenses.txt"]) {
  const p = path.join(PGSQL, nom);
  if (existsSync(p)) versQuarantaine(p);
}

for (const entree of readdirSync(BIN, { withFileTypes: true })) {
  if (entree.isFile() && !KEEP_BIN.has(entree.name)) versQuarantaine(path.join(BIN, entree.name));
}
for (const entree of readdirSync(LIB, { withFileTypes: true })) {
  if (entree.isFile() && !KEEP_LIB.has(entree.name)) versQuarantaine(path.join(LIB, entree.name));
}

for (const entree of readdirSync(SHARE, { withFileTypes: true })) {
  if (entree.isDirectory()) {
    // `extension/` et `tsearch_data/` sont traités PLUS BAS, fichier par
    // fichier — les sauter ici entiers, sinon ce passage sur les dossiers de
    // premier niveau les mettrait en quarantaine AVANT que le tri fin n'ait
    // eu l'occasion de repêcher `unaccent.rules` (bogue trouvé par échec
    // réel : `CREATE EXTENSION unaccent` refusait faute de ce fichier, en
    // quarantaine malgré le code plus bas qui croyait le garder).
    if (["extension", "tsearch_data", ...SHARE_DOSSIERS_FIXES].includes(entree.name)) continue;
    versQuarantaine(path.join(SHARE, entree.name));
  } else if (!SHARE_FICHIERS_FIXES.includes(entree.name)) {
    versQuarantaine(path.join(SHARE, entree.name));
  }
}

// `share/extension/` : les 4 extensions utilisées + `plpgsql`, requise par
// `initdb` lui-même (voir MODULES_BOOTSTRAP ci-dessus).
const nomsExtensionGardes = [...EXTENSIONS_REQUISES, ...CONTROLES_BOOTSTRAP];
const prefixesExtension = nomsExtensionGardes
  .map((n) => `${n}.control`)
  .concat(nomsExtensionGardes.map((n) => `${n}--`));
for (const nom of readdirSync(path.join(SHARE, "extension"))) {
  const garde = prefixesExtension.some((p) => nom === p || nom.startsWith(p));
  if (!garde) versQuarantaine(path.join(SHARE, "extension", nom));
}

// `share/tsearch_data/` : uniquement `unaccent.rules`, prouvé nécessaire par
// le test ci-dessous.
const TSEARCH = path.join(SHARE, "tsearch_data");
if (existsSync(TSEARCH)) {
  for (const nom of readdirSync(TSEARCH)) {
    if (nom !== "unaccent.rules") versQuarantaine(path.join(TSEARCH, nom));
  }
}

etape("quarantaine posée — vérification par cluster réel…");

// ── Preuve par exécution : un vrai cluster contre l'arbre élagué ────────────
async function testerCluster() {
  const dataDir = path.join(os.tmpdir(), `mindcare-elaguer-pg-${randomBytes(6).toString("hex")}`);
  const fichierMotDePasse = path.join(os.tmpdir(), `mindcare-elaguer-pwd-${randomBytes(6).toString("hex")}.tmp`);
  const dumpFichier = path.join(os.tmpdir(), `mindcare-elaguer-dump-${randomBytes(6).toString("hex")}.sql`);
  const port = 43119; // port de test dédié — jamais celui de l'application (43117)
  const motDePasse = randomBytes(24).toString("base64url");
  writeFileSync(fichierMotDePasse, motDePasse, "utf8");

  const bin = {
    initdb: path.join(BIN, "initdb.exe"),
    pgCtl: path.join(BIN, "pg_ctl.exe"),
    psql: path.join(BIN, "psql.exe"),
    pgDump: path.join(BIN, "pg_dump.exe"),
    pgRestore: path.join(BIN, "pg_restore.exe"),
  };

  function executer(cmd, args, opts = {}) {
    return new Promise((resoudre, rejeter) => {
      const p = spawn(cmd, args, { ...opts });
      let sortie = "";
      let erreur = "";
      p.stdout?.on("data", (d) => (sortie += d.toString()));
      p.stderr?.on("data", (d) => (erreur += d.toString()));
      p.on("error", rejeter);
      p.on("exit", (code) => {
        if (code === 0) resoudre({ sortie, erreur });
        else rejeter(new Error(`${path.basename(cmd)} ${args.join(" ")} → code ${code}\n${erreur.slice(0, 2000)}`));
      });
    });
  }

  async function attendrePret(budgetMs) {
    const echeance = Date.now() + budgetMs;
    const envPsql = { ...process.env, PGPASSWORD: motDePasse };
    while (Date.now() < echeance) {
      const r = spawnSync(bin.psql, ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres", "-tAc", "SELECT 1"], {
        env: envPsql,
      });
      if (r.status === 0 && r.stdout.toString().trim() === "1") return true;
      await new Promise((r2) => setTimeout(r2, 300));
    }
    return false;
  }

  let serveur = null;
  try {
    etape("  · initdb (UTF8, ICU fr-DZ, scram-sha-256 — les arguments exacts de pg-cluster.ts)…");
    await executer(bin.initdb, [
      "--pgdata",
      dataDir,
      "--encoding=UTF8",
      "--locale-provider=icu",
      "--icu-locale=fr-DZ",
      "--auth-local=scram-sha-256",
      "--auth-host=reject",
      "--username=postgres",
      `--pwfile=${fichierMotDePasse}`,
    ]);

    // `pg_hba.conf` : ce test écrit EXACTEMENT ce que `contenuPgHba()`
    // (`electron/main/pg-cluster.ts`) écrit en production — redite
    // volontaire plutôt qu'un import, pour ne pas faire dépendre ce script
    // d'empaquetage du code Electron compilé. `--auth-host=reject` ci-dessus
    // ne vaut que pour la fenêtre entre `initdb` et cette réécriture, comme
    // en production.
    writeFileSync(
      path.join(dataDir, "pg_hba.conf"),
      [
        "# Écrit par le test d'élagage — reproduit contenuPgHba()",
        "local   all             all                                     scram-sha-256",
        "host    all             all             127.0.0.1/32            scram-sha-256",
        "host    all             all             ::1/128                 scram-sha-256",
        "",
      ].join("\n"),
      "utf8",
    );

    etape("  · démarrage de postgres.exe sur l'arbre élagué…");
    serveur = spawn(bin.pgCtl, [
      "start",
      "--pgdata",
      dataDir,
      "--wait",
      "--log",
      path.join(dataDir, "test.log"),
      "--options",
      `-p ${port} -c listen_addresses=127.0.0.1`,
    ]);
    await new Promise((resoudre, rejeter) => {
      serveur.on("exit", (code) => {
        if (code !== 0) rejeter(new Error(`pg_ctl start → code ${code}`));
      });
      // `--wait` bloque jusqu'à ce que le serveur accepte les connexions ou
      // échoue ; on résout dès que la sonde psql répond, sans dépendre d'un
      // timing arbitraire.
      attendrePret(15000).then((pret) => (pret ? resoudre() : rejeter(new Error("postgres.exe n'a pas répondu à temps"))));
    });

    const envPsql = { ...process.env, PGPASSWORD: motDePasse };
    const psqlArgs = ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"];

    etape(`  · CREATE EXTENSION pour chacune des extensions utilisées (${EXTENSIONS_REQUISES.join(", ")})…`);
    for (const nom of EXTENSIONS_REQUISES) {
      await executer(bin.psql, [...psqlArgs, "-c", `CREATE EXTENSION IF NOT EXISTS "${nom}"`], { env: envPsql });
    }

    etape("  · appel réel de unaccent() — prouve que tsearch_data/unaccent.rules suffit…");
    // Littéral Unicode PostgreSQL (`U&'…\00E9…'`), PAS les octets UTF-8 de
    // « café à Alger » directement dans l'argument : Windows redécode
    // l'argv d'un processus fils selon la page de code active de la
    // console, pas selon UTF-8, et corrompait les octets accentués avant
    // même que `psql` ne les voie (« invalid byte sequence », un artefact du
    // test, pas du paquet élagué). L'échappement Unicode reste de l'ASCII
    // pur sur la ligne de commande et exerce exactement le même chemin de
    // code — la table `unaccent.rules` — une fois interprété côté serveur.
    const { sortie: sortieUnaccent } = await executer(
      bin.psql,
      [...psqlArgs, "-c", "SELECT unaccent(U&'caf\\00e9 \\00e0 Alger')"],
      { env: envPsql },
    );
    if (sortieUnaccent.trim() !== "cafe a Alger") {
      throw new Error(`unaccent() a rendu un résultat inattendu : "${sortieUnaccent.trim()}"`);
    }

    etape("  · pg_dump puis pg_restore sur une base annexe…");
    await executer(bin.pgDump, ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres", "-Fc", "-f", dumpFichier], {
      env: envPsql,
    });
    await executer(bin.psql, [...psqlArgs, "-c", "CREATE DATABASE mindcare_elaguer_restauration"], { env: envPsql });
    await executer(
      bin.pgRestore,
      [
        "-h",
        "127.0.0.1",
        "-p",
        String(port),
        "-U",
        "postgres",
        "-d",
        "mindcare_elaguer_restauration",
        "--no-owner",
        dumpFichier,
      ],
      { env: envPsql },
    );

    etape(`✅ cluster élagué : initdb, démarrage, ${EXTENSIONS_REQUISES.length} extensions (${EXTENSIONS_REQUISES.join(", ")}), unaccent(), pg_dump, pg_restore — tous réussis.`);
  } finally {
    if (serveur !== null) {
      spawnSync(bin.pgCtl, ["stop", "--pgdata", dataDir, "--mode", "fast"]);
    }
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(fichierMotDePasse, { force: true });
    rmSync(dumpFichier, { force: true });
  }
}

try {
  await testerCluster();
  rmSync(QUARANTAINE, { recursive: true, force: true });
  const tailleApres = (() => {
    let total = 0;
    const pile = [PGSQL];
    while (pile.length > 0) {
      const c = pile.pop();
      for (const e of readdirSync(c, { withFileTypes: true })) {
        const complet = path.join(c, e.name);
        if (e.isDirectory()) pile.push(complet);
        else total += statSync(complet).size;
      }
    }
    return total;
  })();
  etape(`élagage confirmé et conservé — ${(tailleApres / 1048576).toFixed(1)} Mio restants sous resources/pgsql/`);
} catch (e) {
  console.error(`[pgsql] 🔴 le cluster élagué a échoué : ${e.message}`);
  console.error("[pgsql]    restauration de la quarantaine — resources/pgsql/ n'a pas été modifié durablement.");
  // Restaurer : chaque fichier déplacé revient à son chemin d'origine.
  const pile = [QUARANTAINE];
  const fichiers = [];
  while (pile.length > 0) {
    const c = pile.pop();
    for (const entree of readdirSync(c, { withFileTypes: true })) {
      const complet = path.join(c, entree.name);
      if (entree.isDirectory()) pile.push(complet);
      else fichiers.push(complet);
    }
  }
  for (const f of fichiers) {
    const relatif = path.relative(QUARANTAINE, f);
    const destination = path.join(PGSQL, relatif);
    mkdirSync(path.dirname(destination), { recursive: true });
    renameSync(f, destination);
  }
  rmSync(QUARANTAINE, { recursive: true, force: true });
  process.exit(1);
}
