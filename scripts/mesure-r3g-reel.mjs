/**
 * mesure-r3g-reel - BASELINE R3-G sur substrat REEL (M07).
 *
 * Chaine VRAIE : golden v2 (46 cas, tests/eval/knowledge.golden.json) -> service
 * rechercheConnaissance compile -> portes 092 reelles (lexicale + pgvector) ->
 * BGE-M3 local (requetes) -> fusion -> rerank heuristique -> preuves.
 * Methodologie des metriques = copie exacte de eval-knowledge-retrieval.mjs
 * (positifs/rangPremierPositif/ndcg/metriques/E1-E6). LECTURE SEULE.
 *
 *   node scripts/mesure-r3g-reel.mjs --db mindcare --passe A --sortie <fichier.json>
 *   node scripts/mesure-r3g-reel.mjs --db mindcare --passe A --sortie <f.json> --golden tests/eval/knowledge.golden.prod-2026-09-15.json
 *   node scripts/mesure-r3g-reel.mjs --db mindcare --passe E --sortie <f.json> --golden <golden.json> --reranker <dossier-cross-encoder>
 *   node scripts/mesure-r3g-reel.mjs --analyser <A.json> <B.json> [--golden <golden.json>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  chargerBinaireNatif,
  compilerConnaissance,
  resoudreDossierProuve,
  verifierPariteTokens,
} from "./embeddings-runtime.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function option(nom) {
  const i = args.indexOf(nom);
  if (i < 0) return null;
  const valeur = args[i + 1];
  return valeur !== undefined && !valeur.startsWith("--") ? valeur : "";
}
const maintenantMs = () => Number(process.hrtime.bigint() / 1000000n);
function rouge(detail) {
  console.log(JSON.stringify({ ok: false, etape: "infra", detail }));
  process.exit(1);
}

const INTERDITES_GELEES = ["ancien-protocole", "brouillon-poso", "synthese-cas", "guide-anxiete-v2024", "guide-revue-due"];
function interditesDe(golden) {
  if (Array.isArray(golden.interdites)) return new Set(golden.interdites);
  return new Set(INTERDITES_GELEES);
}

if (option("--analyser") !== null) {
  const cheminGolden = option("--golden") ?? join(RACINE, "tests", "eval", "knowledge.golden.json");
  const golden = JSON.parse(readFileSync(cheminGolden, "utf8"));
  const a = JSON.parse(readFileSync(option("--analyser"), "utf8"));
  const b = JSON.parse(readFileSync(args[args.indexOf(option("--analyser")) + 1] ?? "", "utf8"));
  // E5 (fencing) exige le vrai `cloturerPourJarvis` compilé : chargement
  // meilleur-effort depuis la dernière compilation de mesure ; indisponible
  // → "non-mesuree" honnête (jamais un vert supposé).
  let preuveAnalyse = null;
  try {
    preuveAnalyse = await import(pathToFileURL(join(RACINE, ".eval-out", "mesure-r3g", "server", "knowledge", "preuve.js")).href);
    if (typeof preuveAnalyse.cloturerPourJarvis !== "function") preuveAnalyse = null;
  } catch { preuveAnalyse = null; }
  console.log(JSON.stringify(analyser(a, b, golden, preuveAnalyse)));
  process.exit(0);
}

const base = option("--db") ?? "mindcare";
const passe = option("--passe") ?? "A";
const sortie = option("--sortie") ?? join(RACINE, "..", "r3g-passe.json");

// Calibration mesuree (M07 slice 3) : `--calib <nom>` ne change JAMAIS les
// seuils ni le golden — seule la forme du score heuristique varie (voie
// hybride uniquement ; le lexical reste `CALIBRATION_COURANTE`).
const CALIBS = {
  courant: { poidsCouverture: 0.55, poidsVecteur: 0.45, exposantCouverture: 1, exposantVecteur: 0 },
  A1: { poidsCouverture: 0.55, poidsVecteur: 0.45, exposantCouverture: 1, exposantVecteur: 1 },
  A2: { poidsCouverture: 0.55, poidsVecteur: 0.45, exposantCouverture: 2, exposantVecteur: 2 },
  A3: { poidsCouverture: 0.55, poidsVecteur: 0.45, exposantCouverture: 1, exposantVecteur: 1, porteMajorite: true },
  A4: { poidsCouverture: 0.55, poidsVecteur: 0, exposantCouverture: 1, exposantVecteur: 0 },
};
const nomCalib = option("--calib") ?? "courant";
const calibDemandee = CALIBS[nomCalib];
if (calibDemandee === undefined) rouge(`calib inconnue : ${nomCalib}`);

function chargerEnv() {
  for (const nom of [".env.local", ".env"]) {
    let texte;
    try { texte = readFileSync(join(RACINE, nom), "utf8"); } catch { continue; }
    for (const ligne of texte.split("\n")) {
      const nette = ligne.trim().replace(/\r$/, "");
      if (nette === "" || nette.startsWith("#")) continue;
      const egal = nette.indexOf("=");
      if (egal <= 0) continue;
      const cle = nette.slice(0, egal).trim();
      if (process.env[cle] !== undefined) continue;
      let valeur = nette.slice(egal + 1).trim();
      if ((valeur.startsWith('"') && valeur.endsWith('"')) || (valeur.startsWith("'") && valeur.endsWith("'"))) valeur = valeur.slice(1, -1);
      process.env[cle] = valeur;
    }
  }
}
chargerEnv();
const url = process.env.MINDCARE_ADMIN_DATABASE_URL ?? process.env.MINDCARE_TEST_DATABASE_URL ?? process.env.MINDCARE_DATABASE_URL ?? "";
if (url.trim() === "") rouge("aucune URL MINDCARE_* (lecture seule exigee).");
function baseCible(u, nom) {
  const m = u.match(/^(\w+:\/\/[^/]+\/)([^?]*)(.*)$/);
  if (!m) return null;
  return m[1] + nom + m[3];
}
const urlCible = baseCible(url, base);
if (urlCible === null) rouge("URL illisible.");

const golden = JSON.parse(readFileSync(option("--golden") ?? join(RACINE, "tests", "eval", "knowledge.golden.json"), "utf8"));
const { local, embeddings, service, db } = await compilerConnaissance(RACINE, "mesure-r3g", "src/services/connaissance-recherche.ts");
const recette = JSON.parse(readFileSync(join(RACINE, "knowledge", "recette-embedding-pinee.json"), "utf8"));
const config = local.configLocaleDepuisRecette(recette);
const dossier = resoudreDossierProuve(local, recette, RACINE, option("--dossier") ?? process.env["MINDCARE_BGE_M3_DIR"] ?? "");
const { createReadStream } = await import("node:fs");
await local.verifierEmpreintesParFlux(dossier, local.extraireEmpreintes(recette), (p) => createReadStream(p));
const { ort, Tokenizer } = await chargerBinaireNatif();
const prete = await local.chargerSessionLocale(dossier, (p) => readFileSync(p, "utf8"), (json, cfg) => new Tokenizer(json, cfg), {
  creerSession: (chemin, options) => ort.InferenceSession.create(chemin, { intraOpNumThreads: options.intraOpNumThreads, executionProviders: ["cpu"] }),
});
verifierPariteTokens(local, prete.tokenizer, "Quelle est la posologie de la sertraline en premiere intention ?");
const inference = local.inferenceDepuisSession({ Tensor: ort.Tensor }, prete.session, prete.tokenizer);
const fournisseur = new embeddings.FournisseurLocalOnnx(config, inference);
const vecteurRequete = local.vecteurRequeteDepuisFournisseur(fournisseur);

// R4 (optionnel) : `--reranker <dossier>` injecte le cross-encoder local
// (bge-reranker-v2-m3 ONNX) sur la voie hybride uniquement. Absent → voie
// heuristique (défaut production, fail-closed). Le scoreur est chronométré
// pour la mesure de latence R4 ; tout échec untenable replie en heuristique.
let rerankerLocal = undefined;
let dossierReranker = option("--reranker") ?? process.env["MINDCARE_RERANKER_DIR"] ?? "";
if (dossierReranker !== "") {
  await compilerConnaissance(RACINE, "mesure-r3g-rerank", "src/server/knowledge/rerank-cross-encoder.ts");
  const moduleCross = await import(pathToFileURL(join(RACINE, ".eval-out", "mesure-r3g-rerank", "server", "knowledge", "rerank-cross-encoder.js")).href);
  const sessionR = await ort.InferenceSession.create(join(dossierReranker, "model.onnx"), { intraOpNumThreads: 4, executionProviders: ["cpu"] });
  const tokenizerR = new Tokenizer(
    JSON.parse(readFileSync(join(dossierReranker, "tokenizer.json"), "utf8")),
    JSON.parse(readFileSync(join(dossierReranker, "tokenizer_config.json"), "utf8")),
  );
  console.log(JSON.stringify({ etape: "reranker-charge", entrees: sessionR.inputNames, sorties: sessionR.outputNames }));
  const scoreur = moduleCross.noterPairesDepuisSession({ Tensor: ort.Tensor }, sessionR, tokenizerR);
  rerankerLocal = moduleCross.creerRerankerCrossEncoder(scoreur);
}

let preuveModule = null;
try {
  preuveModule = await import(pathToFileURL(join(RACINE, ".eval-out", "mesure-r3g", "server", "knowledge", "preuve.js")).href);
} catch { preuveModule = null; }

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: urlCible });
try { await client.connect(); } catch (err) { rouge("connexion base : " + String(err.message ?? err).slice(0, 200)); }
// L'URL applicative ouvre `mindcare_app` (NOINHERIT, bootstrap 010) : sans
// endossement, même les portes EXECUTE-TO-authenticated sont injoignables
// (42501). L'application endosse le rôle de l'appelant (withCaller) ; la
// mesure endosse `authenticated`, rôle auquel 092 accorde EXECUTE. La
// gouvernance reste DANS le SQL des portes (inchangée) — plomberie, pas méthode.
try { await client.query("SET ROLE authenticated"); } catch (err) { rouge("endossement authenticated : " + String(err.message ?? err).slice(0, 200)); }
const inattendu = () => { throw new Error("porte factice non implantee (lecture seule)"); };
let timingsPortes = null;
db.setDbPort({
  select: inattendu,
  rpc: async (nom, params) => {
    const t0 = maintenantMs();
    try {
      if (nom === "search_knowledge_lexical") {
        const r = await client.query("SELECT * FROM app.search_knowledge_lexical($1,$2,$3)", [params.p_requete, params.p_langue, params.p_limite]);
        if (timingsPortes !== null) { timingsPortes.lexical += maintenantMs() - t0; for (const l of r.rows) timingsPortes.top20.push({ source: l.source_id, section: l.section }); }
        return { ok: true, data: r.rows };
      }
      if (nom === "search_knowledge_vector") {
        const r = await client.query("SELECT * FROM app.search_knowledge_vector($1,$2)", [params.p_embedding_json, params.p_limite]);
        if (timingsPortes !== null) { timingsPortes.vector += maintenantMs() - t0; for (const l of r.rows) if (!timingsPortes.top20.some((t) => t.source === l.source_id && t.section === l.section)) timingsPortes.top20.push({ source: l.source_id, section: l.section }); }
        return { ok: true, data: r.rows };
      }
      return { ok: false, error: { code: "introuvable", message: "porte inconnue : " + nom } };
    } catch (err) { return { ok: false, error: { code: "indisponible", message: String(err.message ?? err).slice(0, 200) } }; }
  },
  signIn: inattendu, signOut: inattendu, getSession: inattendu, getInstallationStatus: inattendu,
  provisionOwnerAccount: inattendu, invokeFunction: inattendu, invokeFunctionStream: inattendu,
});

async function passerCas(cas, avecVecteur) {
  let msEmbed = 0;
  let msRerank = 0;
  // Chronométrage R4 : enveloppe le scoreur (voie hybride seule).
  let dep;
  if (avecVecteur && rerankerLocal !== undefined) {
    const brut = rerankerLocal;
    dep = {
      vecteurRequete,
      calibration: calibDemandee,
      rerankerLocal: {
        nom: brut.nom,
        version: brut.version,
        reranker: brut.reranker.bind(brut),
        rerankerAsync: async (requete, candidats, topN) => {
          const t0 = maintenantMs();
          try {
            return await brut.rerankerAsync(requete, candidats, topN);
          } finally {
            msRerank += maintenantMs() - t0;
          }
        },
      },
    };
  } else {
    dep = avecVecteur ? { vecteurRequete, calibration: calibDemandee } : { vecteurRequete: async () => null };
  }
  if (avecVecteur) { const t0 = maintenantMs(); await vecteurRequete(cas.requete); msEmbed = maintenantMs() - t0; }
  timingsPortes = { lexical: 0, vector: 0, top20: [] };
  const t1 = maintenantMs();
  const res = await service.rechercherConnaissance(cas.requete, cas.langue, dep);
  const msService = maintenantMs() - t1;
  const portes = timingsPortes;
  timingsPortes = null;
  if (!res.ok) return { erreur: res.error.code ?? "?", issue: "erreur", evidences: [], top20: [], msEmbed, msService, msRerank, msLexical: portes.lexical, msVector: portes.vector };
  return {
    issue: res.data.issue, raison: res.data.raison ?? "",
    evidences: res.data.evidences.map((e) => ({ sourceId: e.sourceId, section: e.section, chunkId: e.chunkId, versionChunk: e.versionChunk, evidence_relevance: e.evidence_relevance, sourceTitre: e.sourceTitre, sourceVersion: e.sourceVersion, langue: e.langue, texte: e.texte })),
    top20: portes.top20, msEmbed, msService, msRerank, msLexical: portes.lexical, msVector: portes.vector,
  };
}

const artefact = { passe, base, calib: nomCalib, cas: [] };
for (const cas of golden.cas) {
  const hybride = await passerCas(cas, true);
  const lexicalSeul = await passerCas(cas, false);
  artefact.cas.push({ id: cas.id, hybride: { ...hybride, evidences: hybride.evidences.map((e) => ({ sourceId: e.sourceId, section: e.section, chunkId: e.chunkId })) }, lexicalSeul: { ...lexicalSeul, evidences: lexicalSeul.evidences.map((e) => ({ sourceId: e.sourceId, section: e.section, chunkId: e.chunkId })) }, _plein: { hybride, lexicalSeul } });
  console.log(JSON.stringify({ cas: cas.id, issue_h: hybride.issue, issue_l: lexicalSeul.issue, n_h: hybride.evidences.length, ms_embed: hybride.msEmbed, ms_svc: hybride.msService }));
}
artefact._plein = artefact.cas.map((c) => ({ id: c.id, hybride: c._plein.hybride, lexicalSeul: c._plein.lexicalSeul }));
for (const c of artefact.cas) delete c._plein;
writeFileSync(sortie, JSON.stringify(artefact) + "\n", "utf8");
await client.end();
console.log(JSON.stringify({ ok: true, etape: "passe-terminee", passe, cas: artefact.cas.length, sortie }));

function positifs(cas) {
  const ens = new Set();
  if (cas.gold !== null && cas.gold !== undefined) ens.add(cas.gold.source + "::" + cas.gold.section);
  for (const s of cas.acceptable ?? []) ens.add(s + "::*");
  return ens;
}
function rangPremierPositif(cas, evidences) {
  const pos = positifs(cas);
  for (let i = 0; i < evidences.length; i++) {
    const e = evidences[i];
    if (pos.has(e.sourceId + "::" + e.section) || pos.has(e.sourceId + "::*")) return i + 1;
  }
  return null;
}
function ndcgCas(cas, evidences, k) {
  k = k ?? 5;
  const gains = evidences.slice(0, k).map((e) => {
    if (cas.gold !== null && cas.gold !== undefined && e.sourceId === cas.gold.source && e.section === cas.gold.section) return 2;
    if ((cas.acceptable ?? []).includes(e.sourceId)) return 1;
    return 0;
  });
  let dcg = 0;
  gains.forEach((g, i) => { dcg += g / Math.log2(i + 2); });
  const ideal = [...gains].sort((a, b) => b - a);
  let idcg = 0;
  ideal.forEach((g, i) => { idcg += g / Math.log2(i + 2); });
  return idcg === 0 ? null : dcg / idcg;
}
function quantile(trie, q) {
  if (trie.length === 0) return null;
  const t = [...trie].sort((a, b) => a - b);
  return t[Math.min(t.length - 1, Math.ceil(q * t.length) - 1)];
}
function analyser(a, b, golden, preuveModule) {
  const INTERDITES = interditesDe(golden);
  const res = [];
  for (const ca of a.cas) {
    const cas = golden.cas.find((c) => c.id === ca.id);
    const pa = a._plein.find((c) => c.id === ca.id);
    res.push({ cas, hybride: pa.hybride, lexicalSeul: pa.lexicalSeul });
  }
  let e1ok = 0, citOk = 0, citD = 0, naOk = 0, gouvViol = 0, e4ok = 0, e4d = 0, e5ok = 0, e5d = 0;
  let rap5n = 0, rap5d = 0, mrrN = 0, mrrD = 0, ndcgN = 0, ndcgD = 0, wDrug = 0, wDrugD = 0, wVer = 0, wVerD = 0;
  const langues = {};
  const latSvc = [], latEmb = [], latLex = [], latVec = [], latRerank = [];
  for (const entree of res) {
    const { cas, hybride: r, lexicalSeul } = entree;
    const L = (langues[cas.langue] ??= { cas: 0, ok: 0 });
    L.cas += 1;
    latSvc.push(r.msService); latEmb.push(r.msEmbed); latLex.push(r.msLexical); latVec.push(r.msVector);
    if (typeof r.msRerank === "number") latRerank.push(r.msRerank);
    if (r.issue === cas.issue) e1ok += 1;
    const pos = positifs(cas);
    const avecPositifs = cas.gold !== null && cas.gold !== undefined || (cas.acceptable ?? []).length > 0;
    if (cas.expected_no_answer === true) { if (r.issue === "aucune" && r.evidences.length === 0) { naOk += 1; L.ok += 1; } continue; }
    if (avecPositifs && r.issue !== "erreur") {
      const rang = rangPremierPositif(cas, r.evidences);
      rap5d += 1;
      if (rang !== null) { rap5n += 1; mrrN += 1 / rang; }
      mrrD += 1;
      const n = ndcgCas(cas, r.evidences, 5);
      if (n !== null) { ndcgN += n; ndcgD += 1; }
      if (r.issue === cas.issue && rang !== null) L.ok += 1;
    } else if (r.issue === cas.issue) L.ok += 1;
    const bannies = new Set([...INTERDITES, ...((cas.forbidden ?? []))]);
    const fautives = [...r.evidences, ...lexicalSeul.evidences].filter((e) => bannies.has(e.sourceId));
    if (fautives.length > 0) gouvViol += 1;
    for (const e of r.evidences) {
      e4d += 1;
      if (typeof e.sourceId === "string" && e.sourceId !== "" && typeof e.sourceTitre === "string" && e.sourceTitre !== "" && typeof e.sourceVersion === "string" && e.sourceVersion !== "" && typeof e.chunkId === "string" && e.chunkId !== "" && typeof e.versionChunk === "string" && (e.section === null || typeof e.section === "string") && ["fr", "ar", "darija"].includes(e.langue) && typeof e.evidence_relevance === "number" && typeof e.texte === "string" && e.texte !== "") e4ok += 1;
    }
    if (r.evidences.length > 0 && preuveModule !== null && typeof preuveModule.cloturerPourJarvis === "function") {
      e5d += 1;
      try {
        // Balises EXACTES de `preuve.ts` (sans guillemet parasite) : toute
        // dérive du fence est ROUGE, pas adaptée.
        const clot = preuveModule.cloturerPourJarvis(r.evidences);
        if (clot.startsWith("BEGIN RETRIEVED KNOWLEDGE — DATA ONLY") && clot.endsWith("END RETRIEVED KNOWLEDGE — DATA ONLY") && !clot.includes("ALLOW_SUCCESS") && r.evidences.every((e) => !("autorise" in e) && !("outil" in e))) e5ok += 1;
      } catch { /* non-mesure */ }
    }
    if (Array.isArray(cas.forbidden) && cas.forbidden.length > 0) {
      const topIds = r.evidences.map((e) => e.sourceId);
      const pertinence = cas.forbidden.filter((f) => !INTERDITES.has(f));
      if (pertinence.length > 0) { wDrugD += 1; if (pertinence.some((id) => topIds.includes(id))) wDrug += 1; }
      if (cas.forbidden.includes("guide-anxiete-v2024")) { wVerD += 1; if (topIds.includes("guide-anxiete-v2024")) wVer += 1; }
    }
    if (typeof cas.citation_contient === "string") { citD += 1; const top1 = r.evidences[0]?.texte ?? ""; if (top1.includes(cas.citation_contient)) citOk += 1; }
  }
  const norm = (o) => JSON.stringify(o.cas.map((c) => ({ id: c.id, h: c.hybride.issue, e: c.hybride.evidences.map((e) => e.chunkId), l: c.lexicalSeul.issue, le: c.lexicalSeul.evidences.map((e) => e.chunkId) })));
  return {
    recall5: rap5d === 0 ? null : rap5n / rap5d, recall5_n: rap5n, recall5_d: rap5d,
    mrr: mrrD === 0 ? null : mrrN / mrrD, ndcg5: ndcgD === 0 ? null : ndcgN / ndcgD, ndcg5_d: ndcgD,
    e1: e1ok, e1_d: res.length, citations: citD === 0 ? null : citOk / citD, citations_n: citOk, citations_d: citD,
    wrong_drug: wDrugD === 0 ? null : wDrug / wDrugD, wrong_drug_n: wDrug, wrong_drug_d: wDrugD,
    wrong_version: wVerD === 0 ? null : wVer / wVerD, wrong_version_n: wVer, wrong_version_d: wVerD,
    no_answer: naOk, no_answer_d: res.filter((e) => e.cas.expected_no_answer === true).length,
    gouv_violations: gouvViol, provenance: e4d === 0 ? null : e4ok / e4d, provenance_n: e4ok, provenance_d: e4d,
    cloture: e5d === 0 ? "non-mesuree" : e5ok + "/" + e5d,
    langues: Object.fromEntries(Object.entries(langues).map(([k, v]) => [k, v.ok + "/" + v.cas])),
    svc_p50: quantile(latSvc, 0.5), svc_p95: quantile(latSvc, 0.95),
    emb_p50: quantile(latEmb, 0.5), emb_p95: quantile(latEmb, 0.95),
    lex_p50: quantile(latLex, 0.5), lex_p95: quantile(latLex, 0.95),
    vec_p50: quantile(latVec, 0.5), vec_p95: quantile(latVec, 0.95),
    rerank_p50: latRerank.length === 0 ? "non-mesure" : quantile(latRerank, 0.5),
    rerank_p95: latRerank.length === 0 ? "non-mesure" : quantile(latRerank, 0.95),
    determinisme_octet: norm(a) === norm(b),
  };
}
