#!/usr/bin/env node
/**
 * Assemble le dossier de livraison du cabinet.
 *
 * Entrée  : `dist/MindCare Setup <version>.exe` (produit par `pnpm build:desktop`)
 * Sortie  : `release/MindCare-Clinic-Release-<version>/`
 *           ├─ installer/            l'installateur réel, non signé
 *           ├─ manifests/            manifeste + SHA256SUMS
 *           ├─ documentation/        FR, AR, dépannage, sauvegarde, qualification
 *           └─ diagnostics/          mode d'emploi du rapport assaini
 *
 * Le script REFUSE de produire un dossier qui contiendrait un secret, un dump,
 * un `.env`, un certificat privé, un `node_modules` ou du code source. La liste
 * est volontairement stricte : mieux vaut un build qui échoue qu'un paquet qui
 * diffuse une clé.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(RACINE, "dist");
const DOCS = path.join(RACINE, "docs", "quick-start");
const RELEASE = path.join(RACINE, "release");
const paquet = JSON.parse(readFileSync(path.join(RACINE, "package.json"), "utf8"));
const version = paquet.version;

function refuser(message, details = []) {
  console.error(`\n[release] ÉCHEC — ${message}`);
  for (const d of details) console.error(`  · ${d}`);
  process.exit(1);
}
function sha256(fichier) {
  const h = createHash("sha256");
  h.update(readFileSync(fichier));
  return h.digest("hex").toUpperCase();
}
function lister(dossier) {
  const out = [];
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const complet = path.join(dossier, entree.name);
    if (entree.isDirectory()) out.push(...lister(complet));
    else if (entree.isFile()) out.push(complet);
  }
  return out;
}
function relatif(fichier) {
  return path.relative(destination, fichier).split(path.sep).join("/");
}

const installerAttendu = path.join(DIST, `MindCare Setup ${version}.exe`);
if (!existsSync(installerAttendu)) {
  const candidats = existsSync(DIST) ? readdirSync(DIST).filter((f) => /^MindCare Setup .+\.exe$/i.test(f)) : [];
  refuser(`installateur absent pour la version ${version}`, [
    `attendu : ${path.relative(RACINE, installerAttendu)}`,
    ...(candidats.length ? [`trouvés : ${candidats.join(", ")}`] : ["aucun installateur dans dist/ — lancer pnpm build:desktop"]),
  ]);
}

const destination = path.join(RELEASE, `MindCare-Clinic-Release-${version}`);
const modeVerification = process.argv.includes("--verify");

if (modeVerification) {
  const manifesteFichier = path.join(destination, "manifests", "release-manifest.json");
  if (!existsSync(manifesteFichier)) refuser("manifeste absent", [manifesteFichier]);
  const manifeste = JSON.parse(readFileSync(manifesteFichier, "utf8"));
  let erreurs = 0;
  for (const artefact of manifeste.artifacts) {
    const fichier = path.join(destination, artefact.path);
    if (!existsSync(fichier)) { console.error(`  MANQUANT ${artefact.path}`); erreurs += 1; continue; }
    const hash = sha256(fichier);
    if (hash !== artefact.sha256) { console.error(`  HASH ${artefact.path}\n    attendu ${artefact.sha256}\n    réel    ${hash}`); erreurs += 1; }
  }
  const sums = readFileSync(path.join(destination, "manifests", "SHA256SUMS.txt"), "utf8").trim().split("\n");
  for (const ligne of sums) {
    const [hash, ...reste] = ligne.trim().split(/\s+/);
    const rel = reste.join(" ");
    if (!hash || !rel) { erreurs += 1; continue; }
    const fichier = path.join(destination, rel);
    if (!existsSync(fichier) || sha256(fichier) !== hash) { console.error(`  SOMME ${rel}`); erreurs += 1; }
  }
  if (erreurs > 0) refuser(`${erreurs} écart(s) d'intégrité`);
  console.log(`[release] VÉRIFIÉ — ${manifeste.artifacts.length} fichiers, version ${manifeste.version}`);
  process.exit(0);
}

if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
mkdirSync(path.join(destination, "installer"), { recursive: true });
mkdirSync(path.join(destination, "manifests"), { recursive: true });
mkdirSync(path.join(destination, "documentation"), { recursive: true });
mkdirSync(path.join(destination, "diagnostics"), { recursive: true });

copyFileSync(installerAttendu, path.join(destination, "installer", path.basename(installerAttendu)));

const documents = [
  ["QUICK-START-FR.md", "QUICK-START-FR.md"],
  ["QUICK-START-AR.md", "QUICK-START-AR.md"],
  ["TROUBLESHOOTING.md", "TROUBLESHOOTING.md"],
  ["BACKUP-AND-RESTORE.md", "BACKUP-AND-RESTORE.md"],
  ["RELEASE-NOTES.md", "RELEASE-NOTES.md"],
];
for (const [source, cible] of documents) {
  const fichier = path.join(DOCS, source);
  if (!existsSync(fichier)) refuser(`documentation absente : ${source}`, [fichier]);
  copyFileSync(fichier, path.join(destination, "documentation", cible));
}
const qualification = path.join(RACINE, "docs", "QUALIFICATION-DEUX-PC.md");
if (existsSync(qualification)) copyFileSync(qualification, path.join(destination, "documentation", "QUALIFICATION-DEUX-PC.md"));
const technique = path.join(RACINE, "docs", "deploiement-cabinet.md");
if (existsSync(technique)) copyFileSync(technique, path.join(destination, "documentation", "DEPLOYMENT-TECHNIQUE.md"));

writeFileSync(
  path.join(destination, "diagnostics", "README.md"),
  [
    "# Diagnostic du cabinet",
    "",
    "Depuis **Paramètres → Cabinet & postes**, le médecin peut exporter un rapport",
    "assaini. Le rapport contient : version, rôle du poste, état de la découverte,",
    "postes appairés (libellés et dates), état de la connexion, dernière sauvegarde,",
    "état des migrations et des ports. Il ne contient **aucun** nom de patient, note",
    "clinique, jeton de session, jeton de poste, clé privée ni mot de passe.",
    "",
    "Le rapport est destiné au support. Ne le publiez pas sur un forum public.",
    "",
    "Exemple de champs (sans données réelles) :",
    "",
    "```",
    "version=0.1.4-rc1.20261028",
    "role=doctor",
    "mode=host",
    "origin=https://cabinet-pc:43118",
    "certificate_sha256=<empreinte>",
    "migrations_head=194_alexa_consultation_scale_read",
    "backup_last_verdict=PARTIAL",
    "connection_state=connected",
    "```",
  ].join("\n"),
  "utf8",
);

const fichiers = lister(destination);
const interdits = fichiers.filter((f) => {
  const nom = path.basename(f).toLowerCase();
  return (
    nom === ".env" ||
    nom.endsWith(".pfx") ||
    nom.endsWith(".dpapi") ||
    nom.endsWith(".pem") ||
    nom.endsWith(".key") ||
    nom.includes(".dump") ||
    nom.includes("node_modules") ||
    f.includes(`${path.sep}src${path.sep}`) ||
    f.includes(`${path.sep}tests${path.sep}`) ||
    f.includes(`${path.sep}supabase${path.sep}`)
  );
});
if (interdits.length > 0) refuser("fichiers interdits dans le dossier de livraison", interdits.map(relatif));

const motifs = [
  /MINDCARE_DATABASE_URL\s*=/i,
  /PGPASSWORD\s*=/i,
  /OPENROUTER_API_KEY\s*=/i,
  /GROQ_API_KEY\s*=/i,
  /ELEVENLABS_API_KEY\s*=/i,
  /BEGIN (?:RSA |EC )?PRIVATE KEY/i,
  /postgresql:\/\/[^\s]+:[^\s]+@/i,
];
for (const fichier of fichiers) {
  if (statSync(fichier).size > 2 * 1024 * 1024) continue; // binaires volumineux : hash seulement
  if (/\.(exe|dll|pak|bin|gguf|zip|png|ico|jpg|jpeg|webp|onnx|pdf)$/i.test(fichier)) continue;
  const texte = readFileSync(fichier, "utf8");
  for (const motif of motifs) {
    if (motif.test(texte)) refuser("motif de secret détecté", [relatif(fichier), String(motif)]);
  }
}

const migrationsDir = path.join(RACINE, "supabase", "migrations");
const migrations = existsSync(migrationsDir)
  ? readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()
  : [];

let head = null;
try {
  head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: RACINE, encoding: "utf8" }).trim();
} catch {
  head = null;
}

const manifeste = {
  schemaVersion: 1,
  product: "MindCare OS",
  version,
  builtAt: new Date().toISOString(),
  sourceHead: head,
  supportedWindows: ["Windows 10 x64", "Windows 11 x64"],
  roles: ["doctor", "reception"],
  roleSelection: "first-launch",
  database: {
    engine: "PostgreSQL",
    major: 16,
    migrationsCount: migrations.length,
    migrationsHead: migrations.length > 0 ? migrations[migrations.length - 1].replace(/\.sql$/i, "") : null,
  },
  signing: {
    signed: false,
    note: "Installateur local non signé. Windows SmartScreen peut demander une confirmation.",
  },
  artifacts: [],
};

for (const fichier of fichiers) {
  manifeste.artifacts.push({
    path: relatif(fichier),
    bytes: statSync(fichier).size,
    sha256: sha256(fichier),
  });
}
manifeste.artifacts.sort((a, b) => a.path.localeCompare(b.path));

writeFileSync(path.join(destination, "manifests", "release-manifest.json"), `${JSON.stringify(manifeste, null, 2)}\n`, "utf8");

// `SHA256SUMS.txt` couvre tous les fichiers, y compris le manifeste, mais pas
// lui-même. Les chemins sont relatifs à la racine du dossier de livraison.
const tous = lister(destination).filter((f) => path.basename(f) !== "SHA256SUMS.txt");
const lignes = tous
  .map((f) => ({ rel: relatif(f), hash: sha256(f) }))
  .sort((a, b) => a.rel.localeCompare(b.rel))
  .map(({ rel, hash }) => `${hash}  ${rel}`);
writeFileSync(path.join(destination, "manifests", "SHA256SUMS.txt"), `${lignes.join("\n")}\n`, "utf8");

console.log(`[release] OK — ${path.relative(RACINE, destination)}`);
console.log(`[release] version ${version}, ${manifeste.artifacts.length} fichiers, installateur ${(statSync(installerAttendu).size / 1024 / 1024 / 1024).toFixed(2)} Gio`);
console.log(`[release] manifeste : manifests/release-manifest.json`);
console.log(`[release] sommes   : manifests/SHA256SUMS.txt`);
