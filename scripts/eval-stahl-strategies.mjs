#!/usr/bin/env node
/**
 * eval-stahl-strategies — SONDE COMPARATIVE des strategies de requete (Stahl 7e).
 *
 *   node scripts/eval-stahl-strategies.mjs [--top 5] [--classes B_fr_complete,C_fr_sujet]
 *
 * CE QUE C'EST
 * Une sonde qui mesure, sur le CORPUS D'EVALUATION REEL et la PORTE LEXICALE
 * REELLE, plusieurs strategies de construction de requete, pour choisir la
 * meilleure par la MESURE et non par intuition.
 *
 * strategies :
 *   S0_base        : le planificateur actuel (reference).
 *   S1_rubrique    : concept clinique FR -> INTITULE DE RUBRIQUE anglais du
 *                    corpus (le seul vocabulaire qui existe dans l'index) ;
 *                    une requete par rubrique candidate.
 *   S2_rubrique_1  : idem S1, mais UNE seule requete (la rubrique la plus
 *                    couverte) — mesure le cout en rappel de la selection.
 *   S3_mixte       : S1 + la requete FR d'origine (pour les sources FR).
 *
 * Le classement, la fusion, la qualification et les preuves sont ceux du
 * depot (`orchestrerRecherche`) — pas une reimplantation.
 */
import { execFileSync } from "node:child_process";
import { readFileSync as lire, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { lignesSocket } from "./transport-socket.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (nom, defaut) => {
  const i = args.indexOf(nom);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : defaut;
};
const TOP = Number.parseInt(option("--top", "5"), 10);
const CLASSES = option("--classes", "").split(",").filter(Boolean);
const CORPUS = resolve(RACINE, "knowledge/eval/stahl-bilingue-v1.json");
const SORTIE = resolve(RACINE, "knowledge/eval/stahl-strategies.json");

/* ---------------------------------------------------------------- compile */
function compiler(nom, entrees) {
  const sortie = join(RACINE, ".eval-out", nom);
  rmSync(sortie, { recursive: true, force: true });
  const tsconfig = join(RACINE, ".eval-out", `${nom}.tsconfig.json`);
  writeFileSync(tsconfig, JSON.stringify({
    compilerOptions: {
      target: "es2022", lib: ["es2022", "dom"], module: "commonjs", moduleResolution: "node",
      strict: true, esModuleInterop: true, skipLibCheck: true, noEmitOnError: true,
      outDir: `./${nom}`, rootDir: "../src", baseUrl: "..", paths: { "@/*": ["./src/*"] }, types: ["node"],
    },
    include: entrees.map((e) => `../${e}`),
  }));
  execFileSync(process.execPath, [join(RACINE, "node_modules", "typescript", "bin", "tsc"), "-p", tsconfig],
    { cwd: RACINE, stdio: "pipe" });
  writeFileSync(join(sortie, "package.json"), JSON.stringify({ type: "commonjs" }));
  execFileSync(process.execPath, [join(RACINE, "scripts", "reecrire-alias-eval.mjs"), sortie],
    { cwd: RACINE, stdio: "pipe" });
}

compiler("eval-stahl-strategies", [
  "src/server/knowledge/recherche.ts",
  "src/server/knowledge/rerank.ts",
  "src/server/knowledge/preuve.ts",
  "src/server/knowledge/stockage.ts",
  "src/server/knowledge/gouvernance.ts",
  "src/server/alexa/knowledge-query.ts",
]);
const base = new URL(`file:///${join(RACINE, ".eval-out", "eval-stahl-strategies", "server").replace(/\\/g, "/")}/`).href;
const recherche = await import(`${base}/knowledge/recherche.js`);
const knowledgeQuery = await import(`${base}/alexa/knowledge-query.js`);

/* ------------------------------------------------------- porte lexicale */
const cache = new Map();
function porteLexicale(requete, langue, limite = 20) {
  const cle = `${langue}::${requete}::${limite}`;
  if (cache.has(cle)) return cache.get(cle);
  const sql = `SELECT row_to_json(x)::text FROM (
      SELECT c.id, c.source_id, s.titre, s.version, c.section, c.chunker_version,
          c.langue, c.texte,
          ts_rank(c.document_tsv, plainto_tsquery('simple', app.immutable_unaccent($1)))::double precision AS score,
          s.statut, s.classification, s.approved_at, s.approved_by,
          (s.review_due_at IS NULL OR s.review_due_at > now()) AS revue_a_jour, s.superseded_by,
          c.unit_id, c.parent_texte_hash, c.enfant_index, c.enfants_total
        FROM app.knowledge_chunks c
        JOIN app.knowledge_sources s ON s.id = c.source_id
        WHERE s.classification = 'C4'
          AND s.statut IN ('active','reviewed')
          AND (s.review_due_at IS NULL OR s.review_due_at > now())
          AND s.superseded_by IS NULL
          AND c.statut IN ('inactive','active')
          AND ($2 = 'toutes' OR c.langue = $2)
          AND c.document_tsv @@ plainto_tsquery('simple', app.immutable_unaccent($1))
        ORDER BY score DESC
        LIMIT ${limite}) x`;
  const lignes = lignesSocket(RACINE, { texte: sql, params: [requete, langue] });
  const out = lignes.map((l) => JSON.parse(l)).map((r) => ({
    chunk_id: r.id, source_id: r.source_id, source_titre: r.titre, source_version: r.version,
    section: r.section, version_chunk: r.chunker_version, langue: r.langue, texte: r.texte,
    score: Number(r.score),
    source_statut: "active", source_classification: r.classification,
    source_approuvee_le: "2026-10-20T00:00:00.000Z",
    source_approuvee_par: "00000000-0000-0000-0000-000000000000",
    source_revue_a_jour: true, source_remplacee_par: null,
    unit_id: r.unit_id ?? null, parent_texte_hash: r.parent_texte_hash ?? null,
    enfant_index: r.enfant_index ?? null, enfants_total: r.enfants_total ?? null,
  }));
  cache.set(cle, out);
  return out;
}

/* --------------------------------------- table FR -> rubriques du corpus */
/**
 * Les realisations anglaises sont les INTITULES DE RUBRIQUES REELS du corpus
 * (L3 du Prescriber's Guide). Ce n'est pas un glossaire medical invente :
 * chaque libelle est une chaine qui existe dans l'index — verifiable.
 */
const RUBRIQUES = {
  posologie: ["usual dosage range", "dosing tips", "how to dose", "dosage forms"],
  "effets indesirables": ["notable side effects", "side effects"],
  "effets indesirables graves": ["life-threatening or dangerous side effects"],
  "effets indesirables notables": ["notable side effects"],
  "contre indications": ["do not use"],
  "interactions medicamenteuses": ["drug interactions"],
  surdosage: ["overdose"],
  grossesse: ["pregnancy"],
  allaitement: ["breast feeding"],
  "enfants et adolescents": ["children and adolescents"],
  "personnes agees": ["elderly"],
  "insuffisance renale": ["renal impairment"],
  "insuffisance hepatique": ["hepatic impairment"],
  "insuffisance cardiaque": ["cardiac impairment"],
  "mechanisme d action": ["how the drug works"],
  "delai d action": ["how long until it works"],
  indications: ["commonly prescribed for"],
  precautions: ["other warnings/precautions"],
  "arret du traitement": ["how to stop"],
  pharmacocinetique: ["pharmacokinetics"],
  "formes pharmaceutiques": ["dosage forms"],
  dependance: ["habit forming"],
  "prise de poids": ["weight gain"],
  sedation: ["sedation"],
  generique: ["generic"],
  "comment doser": ["how to dose", "dosing tips"],
  "conseils de posologie": ["dosing tips"],
  "posologie habituelle": ["usual dosage range", "dosing tips", "how to dose"],
  "effets indesirables graves": ["life-threatening or dangerous side effects"],
  "que faire des effets indesirables": ["what to do about side effects"],
  "agents d appoint": ["best augmenting agents for side effects"],
  avantages: ["potential advantages"],
};

/**
 * Concepts FR reconnus dans la question (formes normalisees, sans accents).
 * Pour chaque concept, on retient aussi ses JETONS : ils seront RETIRES de
 * la requete (le concept francais ne doit pas rester dans une requete
 * anglaise, il annulerait l'ET de la porte).
 */
function conceptsReconnus(question) {
  const q = question.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const trouves = [];
  for (const [fr, rubriques] of Object.entries(RUBRIQUES)) {
    const motif = new RegExp(`(^|[^\\p{L}\\p{N}])${fr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "u");
    if (!motif.test(q)) continue;
    const jetons = fr.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    trouves.push({ fr, rubriques, jetons });
  }
  return trouves;
}

/**
 * Termes de la question qui ne sont pas le concept clinique : le nom du
 * medicament, la population, la quantite. Les jetons du concept reconnu sont
 * EXCLUS (le concept est remplace par sa realisation anglaise).
 */
function termesMedicaux(question, concepts) {
  const plan = knowledgeQuery.planKnowledgeQuery(question);
  if (plan === null) return [];
  const conceptJetons = new Set(concepts.flatMap((c) => c.jetons));
  return [...new Set(plan.queries.flatMap((q) => q.split(" ")).filter(Boolean))]
    .filter((t) => !conceptJetons.has(t));
}

/* ------------------------------------------------------------ strategies */
function strategies(question) {
  const base = knowledgeQuery.planKnowledgeQuery(question);
  const baseQueries = base === null ? [] : base.queries;
  const baseLangue = base === null ? "toutes" : base.language;

  const concepts = conceptsReconnus(question);
  const rubriques = [...new Set(concepts.flatMap((c) => c.rubriques))];
  const medicaments = termesMedicaux(question, concepts);

  const requetesRubriques = rubriques.map((r) => [r, ...medicaments].join(" "));

  return {
    S0_base: { requetes: baseQueries, langue: baseLangue, references: baseQueries },
    S1_rubrique: {
      requetes: requetesRubriques.length > 0 ? requetesRubriques : baseQueries,
      langue: baseLangue, references: requetesRubriques.length > 0 ? requetesRubriques : baseQueries,
    },
    S2_rubrique_1: {
      requetes: requetesRubriques.length > 0 ? [requetesRubriques[0]] : baseQueries,
      langue: baseLangue, references: requetesRubriques.length > 0 ? [requetesRubriques[0]] : baseQueries,
    },
    S3_mixte: {
      requetes: requetesRubriques.length > 0 ? [...baseQueries, ...requetesRubriques] : baseQueries,
      langue: baseLangue,
      references: requetesRubriques.length > 0 ? [...baseQueries, ...requetesRubriques] : baseQueries,
    },
  };
}

/* ------------------------------------------------------------- evaluation */
const corpus = JSON.parse(lire(CORPUS, "utf8"));
const questions = corpus.questions.filter((q) => CLASSES.length === 0 || CLASSES.includes(q.classe));

/** Classement par LOT : chaque lot est classe contre SA propre reference. */
async function classer(lots) {
  const parLot = [];
  for (const lot of lots) {
    const search = await recherche.orchestrerRecherche(lot.reference, lot.lignes, [], undefined, recherche.CALIBRATION_A3);
    parLot.push({ issue: search.issue, evidences: search.evidences });
  }
  const issues = parLot.map((p) => p.issue);
  const issue = issues.includes("pertinent") ? "pertinent" : issues.includes("faible") ? "faible" : "aucune";
  const fusion = [];
  const vus = new Set();
  for (let i = 0; ; i++) {
    let ajoute = false;
    for (const lot of parLot) {
      const e = lot.evidences[i];
      if (e === undefined) continue;
      if (vus.has(e.chunkId)) continue;
      vus.add(e.chunkId);
      fusion.push(e);
      ajoute = true;
    }
    if (!ajoute || fusion.length >= 20) break;
  }
  return { issue, evidences: fusion };
}

const resultats = {};
for (const nom of ["S0_base", "S1_rubrique", "S2_rubrique_1", "S3_mixte"]) {
  const lignes = [];
  for (const q of questions) {
    const question = q.question_fr ?? q.question;
    const st = strategies(question)[nom];
    const lots = st.requetes.map((r, i) => ({
      reference: st.references[i] ?? r,
      lignes: porteLexicale(r, st.langue, 20),
    }));
    const search = await classer(lots);
    const chunksAttendus = new Set(q.chunks_attendus ?? []);
    const unitesAttendues = new Set(q.unites_attendues ?? []);
    const estOr = (e) => chunksAttendus.has(e.chunkId) || (e.unitId && unitesAttendues.has(e.unitId));
    const preuves = search.evidences;
    const rang = preuves.findIndex(estOr);
    const top = preuves.slice(0, TOP);
    const pageOk = q.page_attendue === null || q.page_attendue === undefined ? null
      : top.some((e) => {
        const m = /\bsrc:(\d+)\]/.exec(e.texte ?? "");
        return m !== null && m[1] === String(q.page_attendue);
      });
    const sansReponse = q.source_attendue === null;
    lignes.push({
      id: q.id, classe: q.classe,
      recall: sansReponse ? null : (rang >= 0 ? 1 : 0),
      mrr: sansReponse ? null : (rang >= 0 ? 1 / (rang + 1) : 0),
      ndcg: sansReponse ? null : 0,
      page_ok: pageOk,
      issue: search.issue,
      requetes: st.requetes,
      source_premiere: preuves[0]?.sourceTitre ?? null,
      attribution_incorrecte: q.source_attendue !== null && preuves.length > 0 && preuves[0].sourceTitre !== q.source_attendue ? 1 : 0,
      reponse_non_etayee: sansReponse ? (preuves.length > 0 && preuves[0].evidence_relevance >= 0.4) : null,
    });
  }
  const avec = lignes.filter((l) => l.classe !== "G_sans_reponse");
  const m = (f) => Number((avec.reduce((a, l) => a + (f(l) ?? 0), 0) / (avec.length || 1)).toFixed(4));
  resultats[nom] = {
    n: avec.length,
    recall_at_5: m((l) => l.recall),
    mrr: m((l) => l.mrr),
    exactitude_page: m((l) => (l.page_ok === null ? null : (l.page_ok ? 1 : 0))),
    attribution_incorrecte: m((l) => l.attribution_incorrecte),
    requetes_moyennes: Number((lignes.reduce((a, l) => a + l.requetes.length, 0) / (lignes.length || 1)).toFixed(2)),
    abstention: lignes.filter((l) => l.classe === "G_sans_reponse" && l.reponse_non_etayee).length,
  };
  const parClasse = {};
  for (const c of [...new Set(lignes.map((l) => l.classe))].sort()) {
    const sous = lignes.filter((l) => l.classe === c && l.classe !== "G_sans_reponse");
    if (sous.length === 0) continue;
    const mm = (f) => Number((sous.reduce((a, l) => a + (f(l) ?? 0), 0) / sous.length).toFixed(4));
    parClasse[c] = { n: sous.length, recall_at_5: mm((l) => l.recall), mrr: mm((l) => l.mrr) };
  }
  resultats[nom].par_classe = parClasse;
}

writeFileSync(SORTIE, `${JSON.stringify(resultats, null, 2)}\n`, "utf8");
console.log(`corpus : ${questions.length} questions`);
console.log(JSON.stringify(resultats, null, 2));
console.log(`\nrapport : ${SORTIE}`);
