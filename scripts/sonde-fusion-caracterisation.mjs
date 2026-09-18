/**
 * sonde-fusion-caracterisation — M07 slice 3, step 2 (MESURE, lecture seule).
 *
 * Par cas du golden PROD : portes 092/093 reelles → candidats fusionnes →
 * pour chaque candidat du top-20 : scoreLexical (ts_rank), scoreVectoriel
 * (cosine), couverture lexicale (jetoniser, meme fonction que le rerank),
 * rangs par branche + score RRF(k=60), score heuristique courant.
 *
 * Aucun INSERT/UPDATE/DELETE. Sortie : `artifacts/m07-fusion-caracterisation.json`.
 *
 *   node scripts/sonde-fusion-caracterisation.mjs [--db <nom-base>] [--dossier <modeles>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chargerBinaireNatif,
  compilerConnaissance,
  resoudreDossierProuve,
} from "./embeddings-runtime.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GOLDEN = join(RACINE, "tests", "eval", "knowledge.golden.prod-2026-09-15.json");

const args = process.argv.slice(2);
function option(nom) {
  const i = args.indexOf(nom);
  if (i < 0) return null;
  const valeur = args[i + 1];
  return valeur !== undefined && !valeur.startsWith("--") ? valeur : "";
}
const base = option("--db") ?? "mindcare";

// Calibration mesuree (M07 slice 3) : nom -> {poidsCouverture, poidsVecteur,
// exposantCouverture, exposantVecteur}. `courant` = CALIBRATION_COURANTE.
const CALIBS = {
  courant: { poidsCouverture: 0.55, poidsVecteur: 0.45, exposantCouverture: 1, exposantVecteur: 0 },
  A1: { poidsCouverture: 0.55, poidsVecteur: 0.45, exposantCouverture: 1, exposantVecteur: 1 },
  A2: { poidsCouverture: 0.55, poidsVecteur: 0.45, exposantCouverture: 2, exposantVecteur: 2 },
  A3: { poidsCouverture: 0.55, poidsVecteur: 0.45, exposantCouverture: 1, exposantVecteur: 1, porteMajorite: true },
  A4: { poidsCouverture: 0.55, poidsVecteur: 0, exposantCouverture: 1, exposantVecteur: 0 },
};
const nomCalib = option("--calib") ?? "courant";
const calib = CALIBS[nomCalib];
if (calib === undefined) {
  console.log(JSON.stringify({ ok: false, etape: "calib-inconnue", attendues: Object.keys(CALIBS) }));
  process.exit(1);
}

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

chargerEnv();
const url =
  process.env.MINDCARE_ADMIN_DATABASE_URL ??
  process.env.MINDCARE_TEST_DATABASE_URL ??
  process.env.MINDCARE_DATABASE_URL ??
  "";
if (url.trim() === "") {
  console.log(JSON.stringify({ ok: false, etape: "connexion" }));
  process.exit(1);
}
function baseCible(u, nom) {
  const m = u.match(/^(\w+:\/\/[^/]+\/)([^?]*)(.*)$/);
  if (!m) return null;
  return `${m[1]}${nom}${m[3]}`;
}
const urlCible = baseCible(url, base);
if (urlCible === null) {
  console.log(JSON.stringify({ ok: false, etape: "connexion" }));
  process.exit(1);
}

const { local, embeddings, service, db } = await compilerConnaissance(
  RACINE,
  "sonde-fusion-caracterisation",
  "src/services/connaissance-recherche.ts",
);

const recette = JSON.parse(readFileSync(join(RACINE, "knowledge", "recette-embedding-pinee.json"), "utf8"));
const config = local.configLocaleDepuisRecette(recette);
const dossier = resoudreDossierProuve(
  local,
  recette,
  RACINE,
  option("--dossier") ?? process.env["MINDCARE_BGE_M3_DIR"] ?? "",
);
const { createReadStream } = await import("node:fs");
await local.verifierEmpreintesParFlux(dossier, local.extraireEmpreintes(recette), (p) =>
  createReadStream(p),
);
const { ort, Tokenizer } = await chargerBinaireNatif();
const prete = await local.chargerSessionLocale(
  dossier,
  (p) => readFileSync(p, "utf8"),
  (json, cfg) => new Tokenizer(json, cfg),
  {
    creerSession: (chemin, options) =>
      ort.InferenceSession.create(chemin, {
        intraOpNumThreads: options.intraOpNumThreads,
        executionProviders: ["cpu"],
      }),
  },
);
const inference = local.inferenceDepuisSession({ Tensor: ort.Tensor }, prete.session, prete.tokenizer);
const fournisseur = new embeddings.FournisseurLocalOnnx(config, inference);
const vecteurRequete = local.vecteurRequeteDepuisFournisseur(fournisseur);

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: urlCible });
await client.connect();
await client.query("SET ROLE authenticated");

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
  getSession: inattendu,
  getInstallationStatus: inattendu,
  provisionOwnerAccount: inattendu,
  invokeFunction: inattendu,
  invokeFunctionStream: inattendu,
});

// Acces bas niveau aux portes + fusion + jetonisation via le service compile.
// On passe par `service` pour les lignes brutes : on re-appelle les portes
// ici en SQL direct (lecture seule), puis on utilise les fonctions pures
// exportees par les modules compiles.
const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
const cas = golden.cas ?? [];

const { pathToFileURL: versURL } = await import("node:url");
const rerankMod = await import(versURL(join(RACINE, ".eval-out", "sonde-fusion-caracterisation", "server", "knowledge", "rerank.js")).href);
const { jetoniser } = rerankMod;

function couverture(requete, texte) {
  const jetons = jetoniser(requete);
  if (jetons.length === 0) return 0;
  const sac = new Set(jetoniser(texte));
  const n = jetons.filter((j) => sac.has(j)).length;
  return n / jetons.length;
}

const K_RRF = 60;
const rrf = (rangLex, rangVec) =>
  (rangLex === null ? 0 : 1 / (K_RRF + rangLex)) + (rangVec === null ? 0 : 1 / (K_RRF + rangVec));

const lignes = [];
for (const c of cas) {
  const v = await vecteurRequete(c.requete);
  const rl = await client.query("SELECT * FROM app.search_knowledge_lexical($1,$2,$3)", [c.requete, c.langue, 20]);
  let rv = { rows: [] };
  if (v !== null) {
    rv = await client.query("SELECT * FROM app.search_knowledge_vector($1,$2)", [JSON.stringify([...v]), 20]);
  }
  const rangLex = new Map(rl.rows.map((r, i) => [r.chunk_id, i + 1]));
  const rangVec = new Map(rv.rows.map((r, i) => [r.chunk_id, i + 1]));
  const parChunk = new Map();
  for (const r of rl.rows) {
    parChunk.set(r.chunk_id, {
      chunk_id: r.chunk_id, source: r.source_id, section: r.section,
      score_lex: Number(r.score), score_vec: null, texte: r.texte,
    });
  }
  for (const r of rv.rows) {
    const e = parChunk.get(r.chunk_id);
    if (e === undefined) {
      parChunk.set(r.chunk_id, {
        chunk_id: r.chunk_id, source: r.source_id, section: r.section,
        score_lex: null, score_vec: Number(r.score), texte: r.texte,
      });
    } else {
      e.score_vec = Number(r.score);
    }
  }
  // Couverture via le service compile (meme jetonisation que le rerank) :
  // on approxime ici cote sonde avec une requete HTTP ? Non — on demande au
  // service hybride son top-1 et on annote. Plus simple : couverture calculee
  // par import du module rerank compile.
  const candidats = [...parChunk.values()].map((e) => ({
    ...e,
    couverture: Number(couverture(c.requete, `${e.section ?? ""} ${e.texte}`).toFixed(3)),
    rang_lex: rangLex.get(e.chunk_id) ?? null,
    rang_vec: rangVec.get(e.chunk_id) ?? null,
    rrf: rrf(rangLex.get(e.chunk_id) ?? null, rangVec.get(e.chunk_id) ?? null),
    double_branche: rangLex.has(e.chunk_id) && rangVec.has(e.chunk_id),
  }));
  candidats.sort((a, b) => b.rrf - a.rrf || (a.chunk_id < b.chunk_id ? -1 : 1));
  const r = await service.rechercherConnaissance(c.requete, c.langue, { vecteurRequete, calibration: calib });
  const top = r.ok ? (r.data.evidences[0] ?? null) : null;
  const top5 = r.ok ? r.data.evidences.slice(0, 5).map((e) => e.sourceId) : [];
  const topCand = top === null ? null : parChunk.get(top.chunkId) ?? null;
  const topCouv = topCand === null ? null : Number(couverture(c.requete, `${topCand.section ?? ""} ${topCand.texte}`).toFixed(3));
  lignes.push({
    id: c.id,
    issue_attendue: c.issue,
    issue_hybride: r.ok ? r.data.issue : "ERREUR",
    score_top1: top === null ? null : Number(top.evidence_relevance.toFixed(4)),
    couv_top1: topCouv,
    simvec_top1: topCand === null || topCand.score_vec === null ? null : Number(topCand.score_vec.toFixed(4)),
    scorelex_top1: topCand === null || topCand.score_lex === null ? null : Number(topCand.score_lex.toFixed(4)),
    top1_source: topCand === null ? null : topCand.source,
    top1_section: topCand === null ? null : topCand.section,
    gold_top5: c.gold === null || c.gold === undefined ? null : top5.includes(c.gold.source),
    gold_top1: c.gold === null || c.gold === undefined ? null : (top5[0] ?? null) === c.gold.source,
    top1_chunk: top === null ? null : top.chunkId,
    top1_double_branche: top === null ? null : (rangLex.has(top.chunkId) && rangVec.has(top.chunkId)),
    top1_rang_lex: top === null ? null : (rangLex.get(top.chunkId) ?? null),
    top1_rang_vec: top === null ? null : (rangVec.get(top.chunkId) ?? null),
    top1_rrf_rang: top === null ? null : candidats.findIndex((e) => e.chunk_id === top.chunkId) + 1,
    n_candidats: candidats.length,
    n_double_branche: candidats.filter((e) => e.double_branche).length,
    top5_rrf: candidats.slice(0, 5).map((e) => `${e.chunk_id.slice(0, 8)}:${e.rang_lex ?? "-"}/${e.rang_vec ?? "-"}`),
  });
}

await client.end();
const sortie = join(RACINE, "artifacts", `m07-fusion-caracterisation-${nomCalib}.json`);
writeFileSync(sortie, JSON.stringify({ base, calib: nomCalib, cas: lignes }, null, 2), "utf8");
for (const l of lignes) {
  console.log(
    `${l.id.padEnd(8)} att=${String(l.issue_attendue).padEnd(9)} obt=${String(l.issue_hybride).padEnd(9)} ` +
    `top1=${l.score_top1 === null ? "-" : String(l.score_top1).padEnd(7)} couv=${String(l.couv_top1 ?? "-").padEnd(6)}` +
    `simV=${String(l.simvec_top1 ?? "-").padEnd(8)}lex=${String(l.scorelex_top1 ?? "-").padEnd(8)}` +
    `dbl=${l.top1_double_branche === null ? "-" : l.top1_double_branche ? "2br" : "1br "} ` +
    `rLex=${String(l.top1_rang_lex ?? "-").padEnd(3)} rVec=${String(l.top1_rang_vec ?? "-").padEnd(3)} rRRF=${String(l.top1_rrf_rang ?? "-").padEnd(3)} ` +
    `cand=${l.n_candidats}/${l.n_double_branche} src=${String(l.top1_source ?? "-").slice(0, 8)}@${String(l.top1_section ?? "?").slice(0, 12)}`,
  );
}
console.log(`\necrit: ${sortie}`);
// Resume decisionnel : findings (issues), rappel gold, top-1 licites.
const findings = lignes.filter((l) => l.issue_hybride !== l.issue_attendue).map((l) => `${l.id}:${l.issue_attendue}->${l.issue_hybride}`);
const golds = lignes.filter((l) => l.gold_top5 !== null);
const goldR5 = golds.filter((l) => l.gold_top5).length;
console.log(`calib=${nomCalib} findings=${findings.length} recall-gold@5=${goldR5}/${golds.length}`);
console.log(`findings: ${findings.join(" ")}`);
