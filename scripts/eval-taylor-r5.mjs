/**
 * eval-taylor-r5.mjs — R5 : v1-current vs v2-candidate, LECTURE SEULE.
 *
 * Compare la représentation des MÊMES 7 859 parents canoniques sous deux
 * chunkings, à requêtes et paramètres fixés. Aucune écriture (ni DB ni
 * corpus) ; aucune activation ; aucun embedding calculé.
 *
 * Chaîne de légitimité, maillon par maillon :
 * - candidats lexicaux : le VRAI scoring porte (`ts_rank` + `plainto_tsquery`
 *   + `simple` + `immutable_unaccent`, composition section+texte identique à
 *   `document_tsv`), calculé en SQL sur les deux pools de textes — seule la
 *   représentation change, c'est la variable testée ;
 * - aval : le VRAI `orchestrerRecherche` compilé (validation + gouvernance +
 *   fusion + rerank A3 + qualification + preuves + budget), jambes
 *   vectorielles vides des deux côtés (comparaison lexicale pure, déclarée) ;
 * - gouvernance des lignes : constantes C4/active/approuvée identiques des
 *   deux côtés (la représentation est la variable, pas l'autorité).
 *
 * Requêtes dérivées du corpus de façon déterministe (graine fixe) — sonde de
 * représentation, PAS un golden clinique (D5 reste ouvert) : termes attestés
 * dans l'or, strates tail/général/court.
 *
 *   node scripts/eval-taylor-r5.mjs [--db <nom>] [--n-tail N] [--n-gen N] [--n-court N]
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compilerConnaissance } from "./embeddings-runtime.mjs";
import {
  chunksDepuisUnitesTaylorV2,
} from "./charger-connaissance-corpus-taylor-v2.mjs";
import {
  filtrerUnitesSuresTaylor,
} from "./charger-connaissance-corpus-taylor.mjs";
import { uuidDeterministe } from "./charger-connaissance-socle.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function option(nom) {
  const i = args.indexOf(nom);
  if (i < 0) return null;
  const v = args[i + 1];
  return v !== undefined && !v.startsWith("--") ? v : "";
}
const BASE = option("--db") ?? "mindcare";
const N_TAIL = Number.parseInt(option("--n-tail") ?? "25", 10);
const N_GEN = Number.parseInt(option("--n-gen") ?? "25", 10);
const N_COURT = Number.parseInt(option("--n-court") ?? "10", 10);

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
      if ((valeur.startsWith('"') && valeur.endsWith('"')) || (valeur.startsWith("'") && valeur.endsWith("'"))) {
        valeur = valeur.slice(1, -1);
      }
      process.env[cle] = valeur;
    }
  }
}
chargerEnv();

/** PRNG déterministe (mulberry32) — le jeu de requêtes est rejouable. */
function prng(graine) {
  let a = graine >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MOTS = (texte) => (texte.toLowerCase().match(/[\p{L}0-9][\p{L}0-9'-]*/gu) ?? []).filter((w) => w.length >= 6);
/** Termes distinctifs : les plus longs, dédupliqués, attestés dans le span. */
function termesDistinctifs(span, n, alea) {
  const uniques = [...new Set(MOTS(span))].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const bassin = uniques.slice(0, Math.max(n, 12));
  // Tirage déterministe dans le bassin des longs (évite le biais systématique des 4 premiers).
  const pris = [];
  const idx = bassin.map((_, i) => i);
  while (pris.length < n && idx.length > 0) {
    pris.push(bassin[idx.splice(Math.floor(alea() * idx.length), 1)[0]]);
  }
  return pris;
}

const TITRE = "The Maudsley Prescribing Guidelines in Psychiatry";
const VERSION = "sha256:14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0";
const GOUVERNANCE_CONST = {
  source_titre: TITRE,
  source_version: VERSION,
  langue: "en",
  source_statut: "active",
  source_classification: "C4",
  source_approuvee_le: "2026-09-26T00:00:00.000Z",
  source_approuvee_par: "fixture-r5",
  source_revue_a_jour: true,
  source_remplacee_par: null,
};

const { local: _local, embeddings: _embeddings } = await compilerConnaissance(
  RACINE,
  "eval-taylor-r5",
  "src/server/knowledge/recherche.ts",
);
void _local;
void _embeddings;
const { pathToFileURL } = await import("node:url");
const baseOut = pathToFileURL(join(RACINE, ".eval-out", "eval-taylor-r5", "server", "knowledge")).href;
const { orchestrerRecherche } = await import(`${baseOut}/recherche.js`);
const { CALIBRATION_A3 } = await import(`${baseOut}/rerank.js`);

const url =
  process.env.MINDCARE_ADMIN_DATABASE_URL ??
  process.env.MINDCARE_TEST_DATABASE_URL ??
  process.env.MINDCARE_DATABASE_URL ??
  "";
if (url.trim() === "") {
  console.error("ROUGE — aucune URL MINDCARE_* (lecture seule exigée).");
  process.exit(1);
}
const mUrl = url.match(/^(\w+:\/\/[^/]+\/)([^?]*)(.*)$/);
const urlCible = mUrl ? `${mUrl[1]}${BASE}${mUrl[3]}` : null;
if (urlCible === null) {
  console.error("ROUGE — URL illisible.");
  process.exit(1);
}
const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: urlCible });
await client.connect();
try {
  await client.query("SET ROLE authenticated");
} catch {
  // RLS déjà contournée par le rôle de l'URL (superuser local) : lecture inchangée.
}

// ── pools de textes ─────────────────────────────────────────────────────────
// v1-current : EXACTEMENT ce qui est chargé (lecture DB, sol de vérité).
const r1 = await client.query(
  "SELECT id, section, texte FROM app.knowledge_chunks WHERE source_id='9c2fd184-297e-504e-8c95-ffd06896e420' ORDER BY id",
);
const V1 = r1.rows.map((r) => ({ id: String(r.id), section: r.section, texte: String(r.texte) }));
console.log(`pool v1 (DB) : ${V1.length}`);
// v2-candidate : builder dry-run (seule existence hors DB).
const baseCanon = join(RACINE, "knowledge", "canonical-v2", "maudsley-prescribing-guidelines-2021-taylor-14e",
  "sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0", "units.jsonl");
const unites = readFileSync(baseCanon, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const { gardees } = filtrerUnitesSuresTaylor(RACINE, unites);
const CTX = {
  sourceUuid: uuidDeterministe("maudsley-prescribing-guidelines-2021-taylor-14e:sha256:14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0"),
  version: VERSION, langue: "en",
};
const { chunks: V2BRUT, parents } = chunksDepuisUnitesTaylorV2(RACINE, gardees, CTX);
// Normalise au même contrat que V1 (id/section/texte + lignée).
const V2 = V2BRUT.map((c) => ({
  id: c.chunkId, section: c.section, texte: c.texte,
  unit_id: c.unit_id, occurrence: c.occurrence, enfant_index: c.enfant_index,
}));
console.log(`pool v2 (builder) : ${V2.length} (parents ${parents.length})`);
if (V1.length !== 7859 || V2.length !== 9344 || parents.length !== 7859) {
  console.error(`ROUGE — pools inattendus (v1=${V1.length}, v2=${V2.length}, parents=${parents.length}).`);
  process.exit(1);
}
const v2ParParent = new Map();
for (const c of V2) {
  const k = `${c.unit_id}|${c.occurrence}`;
  if (!v2ParParent.has(k)) v2ParParent.set(k, []);
  v2ParParent.get(k).push(c);
}
for (const l of v2ParParent.values()) l.sort((a, b) => a.enfant_index - b.enfant_index);
// unit_id des chunks v1 : via les textes partagés avec V2 (table ci-dessous).
const texteVersUnite = new Map();
for (const p of parents) {
  const enfants = v2ParParent.get(`${p.unit_id}|${p.occurrence}`) ?? [];
  for (const e of enfants) {
    if (!texteVersUnite.has(e.texte)) texteVersUnite.set(e.texte, { unit_id: p.unit_id, occurrence: p.occurrence });
  }
}

// ── jeu de requêtes (graine fixe) ───────────────────────────────────────────
const alea = prng(20260927);
const requetes = [];
{
  // Strate TAIL : parents scindés — termes de la QUEUE (dernier enfant).
  const scindes = parents.filter((p) => p.enfants > 1);
  const melanges = [...scindes];
  for (let i = melanges.length - 1; i > 0; i--) {
    const j = Math.floor(alea() * (i + 1));
    [melanges[i], melanges[j]] = [melanges[j], melanges[i]];
  }
  for (const p of melanges.slice(0, N_TAIL)) {
    const enfants = v2ParParent.get(`${p.unit_id}|${p.occurrence}`) ?? [];
    const queue = enfants[enfants.length - 1];
    if (!queue) continue;
    const termes = termesDistinctifs(queue.texte, 4, alea);
    if (termes.length < 3) continue;
    const parentV1 = V1.find((c) => c.texte === p.texteParent);
    requetes.push({
      strate: "tail", termes,
      orV1: parentV1?.id ?? null, orV2: queue.id,
      unite: p.unit_id,
    });
  }
  // Strate GENERAL : parents quelconques — termes longs du parent.
  const melanges2 = [...parents];
  for (let i = melanges2.length - 1; i > 0; i--) {
    const j = Math.floor(alea() * (i + 1));
    [melanges2[i], melanges2[j]] = [melanges2[j], melanges2[i]];
  }
  for (const p of melanges2.slice(0, N_GEN)) {
    const termes = termesDistinctifs(p.texteParent, 4, alea);
    if (termes.length < 3) continue;
    const parentV1 = V1.find((c) => c.texte === p.texteParent);
    const enfants = v2ParParent.get(`${p.unit_id}|${p.occurrence}`) ?? [];
    // Or v2 = enfant couvrant le plus de termes (départage : premier).
    let meilleur = null;
    let meilleurScore = -1;
    for (const e of enfants) {
      const bas = e.texte.toLowerCase();
      const s = termes.filter((t) => bas.includes(t)).length;
      if (s > meilleurScore) {
        meilleurScore = s;
        meilleur = e;
      }
    }
    requetes.push({
      strate: "general", termes,
      orV1: parentV1?.id ?? null, orV2: meilleur?.id ?? null,
      unite: p.unit_id,
    });
  }
  // Strate COURT : chunks v1 < 120 caractères — contrôle de parité.
  const courts = V1.filter((c) => c.texte.length < 120);
  const melanges3 = [...courts];
  for (let i = melanges3.length - 1; i > 0; i--) {
    const j = Math.floor(alea() * (i + 1));
    [melanges3[i], melanges3[j]] = [melanges3[j], melanges3[i]];
  }
  for (const c of melanges3.slice(0, N_COURT)) {
    const termes = termesDistinctifs(c.texte, 3, alea);
    if (termes.length < 2) continue;
    const unite = texteVersUnite.get(c.texte);
    const enfants = unite ? (v2ParParent.get(`${unite.unit_id}|${unite.occurrence}`) ?? []) : [];
    requetes.push({
      strate: "court", termes,
      orV1: c.id, orV2: enfants.find((e) => e.texte === c.texte)?.id ?? enfants[0]?.id ?? null,
      unite: unite?.unit_id ?? null,
    });
  }
}
console.log(`requêtes: ${requetes.length} (tail=${requetes.filter((r) => r.strate === "tail").length}, general=${requetes.filter((r) => r.strate === "general").length}, court=${requetes.filter((r) => r.strate === "court").length})`);
const sansOr = requetes.filter((r) => r.orV1 === null || r.orV2 === null);
if (sansOr.length > 0) {
  console.error(`ROUGE — ${sansOr.length} requêtes sans or (appariement parent/enfant rompu).`);
  process.exit(1);
}

// ── scoring lexical miroir de la porte (même config, mêmes fonctions) ───────
async function topLexical(pool, question) {
  const ids = pool.map((c) => c.id);
  const sections = pool.map((c) => c.section ?? "");
  const textes = pool.map((c) => c.texte);
  const r = await client.query(
    `SELECT t.id AS id, ts_rank(to_tsvector('simple', app.immutable_unaccent(t.section || ' ' || t.texte)), plainto_tsquery('simple', app.immutable_unaccent($1))) AS score ` +
    `FROM unnest($2::text[], $3::text[], $4::text[]) AS t(id, section, texte) ` +
    `WHERE to_tsvector('simple', app.immutable_unaccent(t.section || ' ' || t.texte)) @@ plainto_tsquery('simple', app.immutable_unaccent($1)) ` +
    `ORDER BY score DESC LIMIT 20`,
    [question, ids, sections, textes],
  );
  return r.rows;
}

function versLigne(brute, pool, versionChunk) {
  const c = pool.find((x) => x.id === String(brute.id));
  if (!c) return null;
  return {
    chunk_id: c.id,
    source_id: "9c2fd184-297e-504e-8c95-ffd06896e420",
    ...GOUVERNANCE_CONST,
    section: c.section,
    version_chunk: versionChunk,
    texte: c.texte,
    score: Number(brute.score),
  };
}

// ── passe d'évaluation ──────────────────────────────────────────────────────
async function evaluer() {
  const resultats = [];
  for (const [qi, q] of requetes.entries()) {
    const question = q.termes.join(" ");
    const ligne = { id: `R5-${String(qi + 1).padStart(2, "0")}`, strate: q.strate, question, orV1: q.orV1, orV2: q.orV2, unite: q.unite };
    for (const [version, pool, chunker] of [["v1", V1, "taylor-units-v1-proposed"], ["v2", V2, "taylor-units-v2-candidate"]]) {
      const brutes = await topLexical(pool, question);
      const lignes = brutes.map((b) => versLigne(b, pool, chunker)).filter((l) => l !== null);
      const { issue, evidences } = await orchestrerRecherche(question, lignes, [], undefined, CALIBRATION_A3);
      const orId = version === "v1" ? q.orV1 : q.orV2;
      const rang = evidences.findIndex((e) => e.chunkId === orId);
      const rangCand = lignes.findIndex((l) => l.chunk_id === orId);
      const top1 = evidences[0] ?? null;
      const bas = (top1?.texte ?? "").toLowerCase();
      ligne[version] = {
        candidats: lignes.length,
        evidences: evidences.length,
        issue,
        rangOr: rang === -1 ? null : rang + 1,
        rappel5: rang !== -1 && rang < 5,
        rangCandOr: rangCand === -1 ? null : rangCand + 1,
        rappel20: rangCand !== -1,
        provCompletes: evidences.every((e) => e.chunkId && e.sourceId && e.sourceVersion && e.langue),
        top1CouvreTermes: q.termes.every((t) => bas.includes(t)),
        textesDistinctsTop5: new Set(evidences.slice(0, 5).map((e) => e.texte)).size,
        ligneeOk: version === "v1" ? true : evidences.every((e) => v2ParParent.has(`${V2.find((c) => c.id === e.chunkId)?.unit_id}|${V2.find((c) => c.id === e.chunkId)?.occurrence}`)),
      };
    }
    resultats.push(ligne);
  }
  return resultats;
}

const run1 = await evaluer();
const run2 = await evaluer();
const j1 = JSON.stringify(run1);
const j2 = JSON.stringify(run2);
const deterministe = j1 === j2;
await client.end();

function syntese(resultats, version) {
  const rs = resultats.map((r) => r[version]);
  const avecOr = rs.filter((r) => r.rangOr !== null);
  const rangs = avecOr.map((r) => r.rangOr).sort((a, b) => a - b);
  const mediane = rangs.length === 0 ? null : rangs[Math.floor(rangs.length / 2)];
  return {
    n: rs.length,
    rappel5: rs.filter((r) => r.rappel5).length,
    rangMedianOr: mediane,
    orManquant: rs.length - avecOr.length,
    rappel20: rs.filter((r) => r.rappel20).length,
    orAbsentCandidats: rs.filter((r) => r.rangCandOr === null).length,
    pertinent: rs.filter((r) => r.issue === "pertinent").length,
    faible: rs.filter((r) => r.issue === "faible").length,
    aucune: rs.filter((r) => r.issue === "aucune").length,
    provCompletes: rs.filter((r) => r.provCompletes).length,
    top1CouvreTermes: rs.filter((r) => r.top1CouvreTermes).length,
    dupTop5: rs.filter((r) => r.textesDistinctsTop5 < Math.min(5, r.evidences)).length,
    ligneeOk: rs.filter((r) => r.ligneeOk).length,
  };
}

const s1 = syntese(run1, "v1");
const s2 = syntese(run1, "v2");
console.log("synthèse v1 : " + JSON.stringify(s1));
console.log("synthèse v2 : " + JSON.stringify(s2));
for (const strate of ["tail", "general", "court"]) {
  const sub = run1.filter((r) => r.strate === strate);
  const g = (v, f) => sub.filter((r) => r[v][f]).length;
  console.log(`strate ${strate} (n=${sub.length}) : v1.rappel5=${g("v1", "rappel5")} v2.rappel5=${g("v2", "rappel5")} | v1.rappel20=${g("v1", "rappel20")} v2.rappel20=${g("v2", "rappel20")}`);
}
console.log(`déterminisme rerun : ${deterministe ? "OK (byte-identique)" : "DIVERGENT"}`);

// F/E : cas divergents.
for (const r of run1) {
  const a = r.v1.rappel5;
  const b = r.v2.rappel5;
  if (a !== b) {
    console.log(`divergent ${r.id} [${r.strate}] « ${r.question.slice(0, 60)} » v1.rappel5=${a} (rang ${r.v1.rangOr}) v2.rappel5=${b} (rang ${r.v2.rangOr}) unite=${r.unite}`);
  }
}
const { writeFileSync } = await import("node:fs");
writeFileSync(join(RACINE, "knowledge", ".sortie-r5-taylor.json"), JSON.stringify({ requetes: run1.length, s1, s2, deterministe, resultats: run1 }, null, 2) + "\n", "utf8");
if (!deterministe) process.exit(1);
