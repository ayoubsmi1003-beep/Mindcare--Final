#!/usr/bin/env node
/**
 * L'artefact empaqueté ne contient QUE ce que le plan autorise — §D, §I.
 *
 * ═══ POURQUOI CE SCRIPT, ALORS QUE LA LISTE BLANCHE EST DÉJÀ ÉCRITE ════════
 *
 * `electron-builder.yml` DÉCLARE une liste blanche ; ce script la PROUVE sur
 * le binaire réellement produit. Ce n'est pas une redondance : entre les deux
 * il y a un empaqueteur, ses motifs par défaut, `extraResources`, et le
 * dossier `resources/serveur` assemblé par un autre script. Chacune de ces
 * couches peut réintroduire un fichier que la déclaration croyait exclu.
 *
 * §29 de la mission — « faire respecter, ne pas promettre ». Une garantie qui
 * ne se mesure pas sur l'artefact n'est qu'une intention.
 *
 * ═══ CE QUI EST REFUSÉ, ET CE QUE CHAQUE REFUS ÉVITE ═══════════════════════
 *
 * · `.env*`      — le paquet ne lit QUE `%ProgramData%\MindCare\mindcare.env`
 *                  (`electron/main/chemins.ts`). Un `.env` de développeur
 *                  embarqué, c'est un cabinet pointé sur la base d'un autre.
 * · `tests/`, `checkpoint-*`, `mesure-*`, `eval-*`, `probe-*`, `sonde-*`,
 *   `*.sh`, `checkpoints/`
 *                — outillage de vérification. Livré, il donne à l'application
 *                  installée des chemins d'exécution qui parlent à des bases
 *                  et à des fournisseurs qui ne sont pas ceux du cabinet.
 * · `docs/`, `*.xlsx`
 *                — documentation, tableurs, images de certificats. Aucun rôle
 *                  à l'exécution, et le tableur des médicaments pèse 240 Kio
 *                  de données qui vivent déjà en base.
 * · `*.map`      — cartes de source : le code serveur relisible chez le
 *                  patient, pour zéro bénéfice.
 * · une URL PostgreSQL AVEC identifiants
 *                — le seul motif de `postgresql://` qui trahisse une fuite.
 *                  Le motif nu apparaît légitimement dans le code qui
 *                  CONSTRUIT l'URL (`provisionnement.ts`) ; ce qui ne doit
 *                  jamais apparaître, c'est un mot de passe déjà écrit.
 * · un paquet SANS pgvector complet (M07, §4 ci-dessous : DLL épinglée par
 *   SHA-256 + `.control` + script de base de la version déclarée + parité
 *   des scripts de montée en version) — sans quoi la migration 092 ne peut
 *   pas s'appliquer sur le poste du cabinet.
 *
 * ═══ CE QUE CE SCRIPT NE PRÉTEND PAS FAIRE ═════════════════════════════════
 *
 * Il ne vérifie ni les noms de secrets fournisseurs dans le paquet renderer
 * (contrôle 2b de `preflight.sh`, déjà en place), ni la surface du preload,
 * ni les permissions Electron : ce sont les tests de sécurité de l'étape 13.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CIBLE = path.resolve(process.argv[2] ?? path.join(RACINE, "dist", "win-unpacked"));

let echecs = 0;
function refuser(titre, details) {
  echecs += 1;
  console.error(`🔴 ${titre}`);
  for (const d of details) console.error(`   ${d}`);
}

if (!existsSync(CIBLE)) {
  console.error(`🔴 artefact introuvable : ${CIBLE}`);
  console.error("   Lancer `pnpm build:desktop` d'abord, ou passer le chemin en argument.");
  process.exit(1);
}

// ── Inventaire : arborescence sur disque + contenu de app.asar ───────────────

function parcourir(racine) {
  const trouves = [];
  const pile = [racine];
  while (pile.length > 0) {
    const courant = pile.pop();
    for (const entree of readdirSync(courant, { withFileTypes: true })) {
      const complet = path.join(courant, entree.name);
      if (entree.isDirectory()) pile.push(complet);
      else trouves.push(path.relative(racine, complet).split(path.sep).join("/"));
    }
  }
  return trouves;
}

/**
 * L'en-tête d'une archive asar est un « pickle » Chromium : quatre entiers
 * 32 bits en tête, puis le JSON de l'arborescence. On ne lit QUE cet en-tête
 * — les noms suffisent, et extraire les charges utiles coûterait cher pour
 * une garantie que le contrôle de contenu ci-dessous couvre déjà en brut.
 */
function fichiersAsar(cheminAsar) {
  const brut = readFileSync(cheminAsar);
  const tailleJson = brut.readUInt32LE(12);
  const entete = JSON.parse(brut.subarray(16, 16 + tailleJson).toString("utf8"));
  const trouves = [];
  const descendre = (noeud, prefixe) => {
    for (const [nom, valeur] of Object.entries(noeud.files ?? {})) {
      const chemin = prefixe === "" ? nom : `${prefixe}/${nom}`;
      if (valeur.files !== undefined) descendre(valeur, chemin);
      else trouves.push(chemin);
    }
  };
  descendre(entete, "");
  return trouves;
}

const surDisque = parcourir(CIBLE);
const cheminAsar = path.join(CIBLE, "resources", "app.asar");
const dansAsar = existsSync(cheminAsar) ? fichiersAsar(cheminAsar).map((f) => `app.asar!/${f}`) : [];
const inventaire = [...surDisque, ...dansAsar];

console.log(`[paquet] ${CIBLE}`);
console.log(`[paquet] ${surDisque.length} fichiers sur disque, ${dansAsar.length} dans app.asar`);

// ── 1. Ce qui NE DOIT PAS être là ───────────────────────────────────────────

/**
 * ⚠️ CES MOTIFS VISENT LES ARTEFACTS DU DÉPÔT, PAS LE CODE DES DÉPENDANCES.
 *
 * Mesuré sur le premier paquet produit : `eval-source-map-dev-tool-plugin.js`
 * (un greffon webpack de Next) déclenchait « script d'évaluation », et
 * `next/experimental/testmode/playwright.js` déclenchait « Playwright ». Ce
 * sont des faux positifs — du code de dépendance, tracé parce que le serveur
 * en dépend, qui ne parle ni à notre base ni à nos fournisseurs.
 *
 * Un contrôle qui crie sur ce genre de chose finit désarmé : on l'exclut,
 * parce que la question qu'il pose (« un outil de vérification du DÉPÔT
 * a-t-il été livré ? ») ne concerne que nos fichiers. Ce qui reste appliqué
 * SANS exception à `node_modules` : `.env`, `.git/`, les cartes de source,
 * les tableurs, les scripts shell, et le VRAI paquet Playwright.
 */
const HORS_DEPENDANCES = /(^|\/)node_modules\//;

const INTERDITS = [
  [/(^|\/)\.env($|\.)/, "un fichier .env", "partout"],
  [/(^|\/)\.git\//, "des métadonnées git", "partout"],
  // `app-update.yml` : descripteur de mise a jour automatique deduit du dépôt
  // git par electron-builder. Aucun mécanisme de mise à jour n'existe dans
  // cette phase (§E) ; livré, il pointerait le poste du cabinet vers un dépôt
  // public que personne ne lui a donné. Neutralisé par `publish: null`.
  [/(^|\/)app-update\.yml$/, "un descripteur de mise à jour automatique", "partout"],
  [/\.map$/, "une carte de source", "partout"],
  [/\.xlsx$/i, "un tableur", "partout"],
  [/\.sh$/, "un script shell", "partout"],
  // Le paquet Playwright lui-même, pas un fichier qui le nomme.
  [/(^|\/)node_modules\/(@playwright|playwright(-core)?)\//, "le paquet Playwright", "partout"],
  [/(^|\/)tests\//, "le dossier tests/", "dépôt"],
  [/(^|\/)checkpoints?\//, "le dossier checkpoints/", "dépôt"],
  [/(^|\/)checkpoint-[^/]*$/, "un script de checkpoint", "dépôt"],
  [/(^|\/)mesure-[^/]*$/, "un script de mesure", "dépôt"],
  [/(^|\/)eval-[^/]*$/, "un script d'évaluation", "dépôt"],
  [/(^|\/)(probe|sonde)-[^/]*$/, "une sonde de diagnostic", "dépôt"],
  [/(^|\/)docs\//, "le dossier docs/", "dépôt"],
];

for (const [motif, quoi, portee] of INTERDITS) {
  const candidats = portee === "partout" ? inventaire : inventaire.filter((f) => !HORS_DEPENDANCES.test(f));
  const fautifs = candidats.filter((f) => motif.test(f));
  if (fautifs.length > 0) {
    refuser(`le paquet contient ${quoi} (${fautifs.length}) :`, fautifs.slice(0, 10));
  }
}

// ── 2. Ce qui DOIT être là ──────────────────────────────────────────────────
//
// Une liste blanche trop zélée produit un installateur propre et inutilisable.
// On vérifie donc aussi la présence de ce sans quoi l'application ne démarre
// pas — c'est le même contrôle, vu de l'autre côté.

const REQUIS = [
  ["MindCare OS.exe", "l'exécutable de l'application"],
  ["resources/app.asar", "le paquet applicatif"],
  ["app.asar!/dist-electron/main/index.js", "le processus principal"],
  ["app.asar!/dist-electron/preload/index.cjs", "le preload"],
  ["resources/serveur/server.js", "le backend Next.js autonome"],
  ["resources/serveur/scripts/verifier-base.mjs", "le contrôle de schéma au démarrage"],
  ["resources/serveur/scripts/lib/base-locale.mjs", "le cycle de vie de la base (dépendance de verifier-base)"],
  ["resources/serveur/scripts/garde-origine.mjs", "la garde de port"],
  ["resources/serveur/scripts/sauvegarde.mjs", "la sauvegarde"],
  ["resources/serveur/supabase/bootstrap/010_app_role.sql", "le bootstrap du rôle applicatif"],
  ["resources/pgsql/bin/initdb.exe", "les binaires PostgreSQL empaquetés"],
  ["resources/pgsql/lib/vector.dll", "l'extension pgvector (M07, RAG)"],
  ["resources/pgsql/share/extension/vector.control", "le contrôle d'extension pgvector"],
  ["resources/pgsql/share/extension/vector--0.8.6.sql", "le script de base pgvector 0.8.6"],
];

const manquants = REQUIS.filter(([f]) => !inventaire.includes(f));
if (manquants.length > 0) {
  const details = manquants.map(([f, quoi]) => `${quoi} — ${f}`);
  // Les binaires PostgreSQL ne sont pas dans le dépôt (200 Mio, téléchargés
  // chez l'éditeur) : c'est le seul manque dont la réparation est une
  // procédure, pas un correctif. On la nomme, plutôt que de laisser
  // quelqu'un chercher.
  if (manquants.some(([f]) => f.startsWith("resources/pgsql/"))) {
    details.push("→ peupler resources/pgsql/ : voir resources/pgsql/README.md, puis réempaqueter.");
  }
  refuser("le paquet est incomplet — il s'installerait sans pouvoir démarrer :", details);
}

const migrations = inventaire.filter((f) =>
  /^resources\/serveur\/supabase\/migrations\/\d+.*\.sql$/.test(f),
);
if (migrations.length === 0) {
  refuser("aucune migration empaquetée :", ["resources/serveur/supabase/migrations/ est vide"]);
}

// ── 3. Aucune URL PostgreSQL porteuse d'identifiants ────────────────────────

const URL_AVEC_IDENTIFIANTS = /postgres(?:ql)?:\/\/[^\s'"`$;]+:[^\s'"`$;@]+@/;
const porteurs = [];
for (const relatif of surDisque) {
  const complet = path.join(CIBLE, relatif);
  if (statSync(complet).size > 64 * 1024 * 1024) continue; // binaires PostgreSQL
  const contenu = readFileSync(complet).toString("latin1");
  if (URL_AVEC_IDENTIFIANTS.test(contenu)) porteurs.push(relatif);
}
if (porteurs.length > 0) {
  refuser("une URL PostgreSQL avec identifiants est empaquetée :", porteurs.slice(0, 10));
}

// ── 4. Contrat pgvector (M07) — fail-closed ─────────────────────────────────
//
// `CREATE EXTENSION vector` (migration 092) exige dans le paquet : la DLL
// prouvée contre EDB 16.15, le `.control` dont la version par défaut est
// vérifiée, le script de base correspondant, et l'INTÉGRALITÉ des scripts
// de montée en version présents dans l'arbre source (`nmake install` les
// copie tous ; electron-builder ne doit en perdre aucun en route).
//
// La DLL est compilée depuis la source officielle, pas téléchargée : son
// SHA-256 est donc épinglé. Toute reconstruction volontaire met à jour
// cette constante — et prouve le nouvel artefact avant (mission M07).
// Source : tag v0.8.6, commit 8ee86c96f0fd72390f890aa8a336fda6d3ab4c6c.
const VECTOR_DLL_SHA256_ATTENDU =
  "57984F7662DFC1AF443884D4F9D79ED4D50D16C8143C817B1E96BCB6DCCA43EB";

const cheminDllVector = path.join(CIBLE, "resources", "pgsql", "lib", "vector.dll");
if (existsSync(cheminDllVector)) {
  const reel = createHash("sha256").update(readFileSync(cheminDllVector)).digest("hex").toUpperCase();
  if (reel !== VECTOR_DLL_SHA256_ATTENDU) {
    refuser("vector.dll ne correspond pas à l'artefact prouvé (M07) :", [
      `attendu ${VECTOR_DLL_SHA256_ATTENDU}`,
      `lu      ${reel}`,
      "→ reconstruire depuis la source officielle v0.8.6 et prouver avant d'empaqueter.",
    ]);
  }
}

const cheminControlVector = path.join(CIBLE, "resources", "pgsql", "share", "extension", "vector.control");
if (existsSync(cheminControlVector)) {
  const control = readFileSync(cheminControlVector).toString("latin1");
  const version = /^\s*default_version\s*=\s*'([^']+)'/m.exec(control)?.[1];
  if (version === undefined) {
    refuser("vector.control illisible :", ["default_version introuvable"]);
  } else if (!existsSync(path.join(CIBLE, "resources", "pgsql", "share", "extension", `vector--${version}.sql`))) {
    refuser("le script de base pgvector manque pour la version déclarée :", [
      `vector.control déclare default_version='${version}'`,
      `resources/pgsql/share/extension/vector--${version}.sql absent`,
    ]);
  }
}

// Parité source → paquet des scripts de montée en version : ce qui a été
// prouvé dans `resources/pgsql/` du dépôt doit se retrouver dans l'artefact.
// Référence = l'arbre source (déterministe), jamais un simple compteur.
const dirExtensionSource = path.join(RACINE, "resources", "pgsql", "share", "extension");
const dirExtensionPaquet = path.join(CIBLE, "resources", "pgsql", "share", "extension");
if (!existsSync(dirExtensionSource)) {
  refuser("l'arbre source pgvector est absent du dépôt :", [dirExtensionSource]);
} else {
  const attendus = readdirSync(dirExtensionSource).filter((f) => f.startsWith("vector--") && f.endsWith(".sql"));
  if (attendus.length === 0) {
    refuser("aucun script vector--*.sql dans l'arbre source :", [dirExtensionSource]);
  }
  const perdus = attendus.filter((f) => !inventaire.includes(`resources/pgsql/share/extension/${f}`));
  if (perdus.length > 0) {
    refuser("des scripts de montée en version pgvector ont été perdus à l'empaquetage :", perdus.slice(0, 10));
  }
}

if (echecs === 0) console.log("✅ paquet conforme à la liste blanche du plan (§I)");
process.exit(echecs === 0 ? 0 : 1);
