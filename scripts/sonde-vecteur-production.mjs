/**
 * sonde-vecteur-production — M07 slice 3 : preuve du shell câblé.
 *
 * Exécute le VRAI `src/server/knowledge/vecteur-production.ts` compilé
 * (dépendances réelles : env → resources → cache, empreintes, ONNX local)
 * sur 3 requêtes : vecteur 1024 non-nul, déterminisme à l'octet, latence.
 * LECTURE SEULE (aucune écriture base ; le modèle est lu, jamais modifié).
 * Sortie : une ligne JSON + exit code.
 *
 *   node scripts/sonde-vecteur-production.mjs
 */
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { compilerConnaissance } from "./embeddings-runtime.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Chargeur env minimal (même sémantique que verifier-base.mjs : réel prime, jamais journalisé). */
for (const nom of [".env.local", ".env"]) {
  let texte;
  try {
    texte = readFileSync(join(RACINE, nom), "utf8");
  } catch {
    continue;
  }
  for (const ligne of texte.split("\n")) {
    const nette = ligne.trim().replace(/\r$/, "");
    if (nette === "" || nette.startsWith("#")) continue;
    const egal = nette.indexOf("=");
    if (egal <= 0) continue;
    const cle = nette.slice(0, egal).trim();
    if (process.env[cle] !== undefined) continue;
    let valeur = nette.slice(egal + 1).trim();
    if (
      (valeur.startsWith('"') && valeur.endsWith('"')) ||
      (valeur.startsWith("'") && valeur.endsWith("'"))
    ) {
      valeur = valeur.slice(1, -1);
    }
    process.env[cle] = valeur;
  }
}

const args = process.argv.slice(2);
function option(nom) {
  const i = args.indexOf(nom);
  if (i < 0) return null;
  const valeur = args[i + 1];
  return valeur !== undefined && !valeur.startsWith("--") ? valeur : "";
}
// `--dossier` (idiome des sondes) : surcharge MINDCARE_BGE_M3_DIR pour la
// mesure dev — la prod ne connaît que env → resources (jamais de cache Temp).
const dossierExplicite = option("--dossier") ?? "";
if (dossierExplicite !== "") process.env["MINDCARE_BGE_M3_DIR"] = dossierExplicite;

function echouer(etape, detail) {
  console.log(JSON.stringify({ ok: false, etape, detail }));
  process.exit(1);
}

const compile = await compilerConnaissance(RACINE, "sonde-vecteur-production", "src/services/connaissance-recherche.ts");
const moduleVP = await import(
  pathToFileURL(join(RACINE, ".eval-out", "sonde-vecteur-production", "server", "knowledge", "vecteur-production.js")).href
);
void compile;

const chargeur = moduleVP.chargeurVecteurProduction();
const requetes = ["sertraline 50 mg", "sertralin 50 mg", "dwa dyalou sertraline ?"];
const resultats = [];
for (const requete of requetes) {
  const t0 = Number(process.hrtime.bigint() / 1000000n);
  const v1 = await chargeur.vecteurRequete(requete);
  const ms1 = Number(process.hrtime.bigint() / 1000000n) - t0;
  const v2 = await chargeur.vecteurRequete(requete);
  if (v1 === null || v2 === null) {
    echouer("indisponible", `${requete} :: ${JSON.stringify(chargeur.statut())}`);
  }
  const memeOctet = JSON.stringify([...v1]) === JSON.stringify([...v2]);
  resultats.push({ requete, dim: v1.length, ms: ms1, octet_identique: memeOctet });
}
const statut = chargeur.statut();
const ok = statut.etat === "pret" && resultats.every((r) => r.dim === 1024 && r.octet_identique);
console.log(JSON.stringify({ ok, etape: ok ? "vecteur-production-pret" : "ecart-vecteur-production", statut, cas: resultats }));
process.exit(ok ? 0 : 1);
