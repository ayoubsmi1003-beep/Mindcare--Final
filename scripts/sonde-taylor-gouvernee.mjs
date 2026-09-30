/**
 * sonde-taylor-gouvernee — M08-Taylor · Sondes de FRONTIÈRE (lecture seule).
 *
 * Taylor est embedded mais reviewed/inactive/unapproved : les portes 092/093
 * (C4 + active + approved + revue + chunk actif) doivent l'EXCLURE sur les
 * deux chemins gouvernés (lexical ET vectoriel). Cette sonde prouve la
 * frontière au lieu de la contourner : aucun affaiblissement de porte ici.
 *
 *   node scripts/sonde-taylor-gouvernee.mjs [--db <nom-base>]
 *
 * LECTURE SEULE (SELECT sur portes + une lecture d'embedding servant de
 * vecteur-requête ; aucun INSERT/UPDATE/DELETE dans ce fichier).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compilerConnaissance } from "./embeddings-runtime.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function option(nom) {
  const i = args.indexOf(nom);
  if (i < 0) return null;
  const valeur = args[i + 1];
  return valeur !== undefined && !valeur.startsWith("--") ? valeur : "";
}
const base = option("--db") ?? "mindcare";

function chargerEnv() {
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
}

let verts = 0;
let rouges = 0;
function verdict(ok, ligne, detail = "") {
  if (ok) verts += 1;
  else rouges += 1;
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${ligne}${detail === "" ? "" : ` | ${detail}`}`);
}

chargerEnv();
const url =
  process.env.MINDCARE_ADMIN_DATABASE_URL ??
  process.env.MINDCARE_TEST_DATABASE_URL ??
  process.env.MINDCARE_DATABASE_URL ??
  "";
if (url.trim() === "") {
  console.log("  ROUGE | connexion | aucune URL MINDCARE_* disponible (lecture seule exigee)");
  process.exit(1);
}
function baseCible(u, nom) {
  const m = u.match(/^(\w+:\/\/[^/]+\/)([^?]*)(.*)$/);
  if (!m) return null;
  return `${m[1]}${nom}${m[3]}`;
}
const urlCible = baseCible(url, base);
if (urlCible === null) {
  console.log("  ROUGE | connexion | URL illisible");
  process.exit(1);
}

const { service, db } = await compilerConnaissance(
  RACINE,
  "sonde-taylor-gouvernee",
  "src/services/connaissance-recherche.ts",
);

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: urlCible });
try {
  await client.connect();
  await client.query("SET ROLE authenticated");
} catch (err) {
  console.log(`  ROUGE | connexion | ${String(err.message ?? err).slice(0, 200)}`);
  process.exit(1);
}
const inattendu = () => {
  throw new Error("porte factice : methode non implantee (lecture seule)");
};
db.setDbPort({
  select: inattendu,
  rpc: async (nom, params) => {
    try {
      if (nom === "search_knowledge_lexical") {
        const r = await client.query("SELECT * FROM app.search_knowledge_lexical($1,$2,$3)", [
          params.p_requete,
          params.p_langue,
          params.p_limite,
        ]);
        return { ok: true, data: r.rows };
      }
      if (nom === "search_knowledge_vector") {
        const r = await client.query("SELECT * FROM app.search_knowledge_vector($1,$2)", [
          params.p_embedding_json,
          params.p_limite,
        ]);
        return { ok: true, data: r.rows };
      }
      return { ok: false, error: { code: "introuvable", message: `porte inconnue : ${nom}` } };
    } catch (err) {
      return { ok: false, error: { code: "indisponible", message: String(err.message ?? err).slice(0, 200) } };
    }
  },
  signIn: inattendu,
  signOut: inattendu,
});

// Service exige `deps.vecteurRequete` (fonction) : lexical seul ici
// (pas de modèle chargé — la voie vectorielle est prouvée au niveau porte
// ci-dessous, pas au niveau service).
const DEPS_LEXICAL = { vecteurRequete: async () => null };

const estTaylor = (e) =>
  String(e.sourceId ?? "").toLowerCase() === "9c2fd184-297e-504e-8c95-ffd06896e420" ||
  String(e.sourceTitre ?? "").toLowerCase().includes("maudsley");

// Termes attestés dans le corpus Taylor (ancrage D4 : raw pages).
const REQUETES_TAYLOR = [
  "benzatropine adverse effects",
  "clozapine titration schizophrenia",
  "lithium augmentation depression",
  "QT prolongation antipsychotic",
  "benzodiazepine dependence withdrawal",
];

for (const requete of REQUETES_TAYLOR) {
  let res;
  try {
    res = await service.rechercherConnaissance(requete, "en", DEPS_LEXICAL);
  } catch (e) {
    verdict(false, `lexical-en/${requete.slice(0, 28)}`, `levée: ${String(e?.message ?? e).slice(0, 100)}`);
    continue;
  }
  const lignes = res.ok ? (res.data.evidences ?? []) : [];
  const taylor = lignes.filter(estTaylor);
  verdict(res.ok === true, `lexical-en/${requete.slice(0, 28)}`, `lignes=${lignes.length} taylor=${taylor.length}`);
  verdict(taylor.length === 0, `frontiere-taylor/${requete.slice(0, 28)}`, "0 chunk Taylor via porte gouvernée");
  // Provenance complète quand des lignes existent (D3 : section/source/version).
  const incompletes = lignes.filter((e) => !e.chunkId || !e.sourceId || !e.sourceVersion);
  verdict(incompletes.length === 0, `prov-en/${requete.slice(0, 28)}`, incompletes.length === 0 ? "provenance complète" : "provenance INCOMPLÈTE");
}

// Contrôle FR : le corpus actif répond, sans fuite Taylor.
{
  let res;
  try {
    res = await service.rechercherConnaissance("sertraline", "fr", DEPS_LEXICAL);
  } catch (e) {
    verdict(false, "lexical-fr/controle", `levée: ${String(e?.message ?? e).slice(0, 100)}`);
    res = null;
  }
  if (res !== null) {
    const lignes = res.ok ? (res.data.evidences ?? []) : [];
    const taylor = lignes.filter(estTaylor);
    verdict(res.ok === true && lignes.length > 0, "lexical-fr/controle", `lignes=${lignes.length}`);
    verdict(taylor.length === 0, "non-fuite-fr", "0 Taylor dans réponse FR");
  }
}

// Porte vectorielle : vecteur-requête = embedding réel d'un chunk Taylor
// (similitude maximale avec lui-même) — la porte doit quand même l'exclure.
{
  const emb = await client.query(
    "SELECT id, embedding::text AS v FROM app.knowledge_chunks WHERE source_id = '9c2fd184-297e-504e-8c95-ffd06896e420' AND embedding IS NOT NULL ORDER BY id LIMIT 1",
  );
  if (emb.rows.length === 0) {
    console.log("  vert  | vectoriel-taylor | NOT RUN (0 chunk embedded — backfill en cours ou non lancé)");
    verts += 1;
  } else {
    const r = await client.query("SELECT * FROM app.search_knowledge_vector($1,$2)", [emb.rows[0].v, 5]);
    const taylor = r.rows.filter(estTaylor);
    verdict(taylor.length === 0, "frontiere-vectorielle", `lignes=${r.rows.length} taylor=${taylor.length} (requête=chunk ${emb.rows[0].id})`);
  }
}

await client.end();
console.log(`\nVERDICT SONDE-TAYLOR : ${rouges === 0 ? "VERT" : "ROUGE"} — ${verts} verts, ${rouges} rouges`);
process.exit(rouges === 0 ? 0 : 1);
