#!/usr/bin/env node
/**
 * eval-stahl-bilingue — ÉVALUATION DU RETRIEVAL BILINGUE (Stahl 7e).
 *
 *   node scripts/eval-stahl-bilingue.mjs [--corpus knowledge/eval/stahl-bilingue-v1.json]
 *                                        [--top 5] [--sortie <fichier>]
 *
 * ═══ CE QUI EST RÉEL (rien n'est simulé) ═══
 *   · le chemin de production EST appelé : `readKnowledge()` (le module Alexa
 *     compilé TEL QUEL), avec un `ClientSql` dont le `rpc` exécute la VRAIE
 *     porte SQL `app.search_knowledge_lexical` ;
 *   · la porte filtre donc exactement comme en production : classification,
 *     statut, approbation, revue à jour, non-supersession, langue, ET lexical ;
 *   · le classement, la fusion, la qualification et la construction des
 *     preuves sont ceux du dépôt (`orchestrerRecherche`) ;
 *   · la restriction de livre demandé (`matchesRequestedBook`) est appliquée
 *     par le code de production.
 *
 * UNE SEULE SUBSTITUTION, déclarée :
 *   les 4 colonnes d'ATTESTATION (`source_statut`, `source_approuvee_le`,
 *   `source_approuvee_par`, `source_revue_a_jour`) sont celles qu'elles
 *   SERONT après l'activation humaine. Elles sont posees par UN SEUL UPDATE
 *   (`activer-connaissance-stahl.mjs`) ; le contenu servi (texte, section,
 *   score, unité, page) est 100 % réel, tiré de la base. C'est ce que la
 *   défense en profondeur de `lignePorteRecuperable()` exige, et elle ne
 *   peut pas être satisfaite avant l'acte humain.
 *
 * MESURES : Recall@k, MRR, nDCG@k, exactitude de source, exactitude de page,
 * taux de réponse non étayée, taux d'attribution incorrecte, abstention.
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
const CORPUS = resolve(RACINE, option("--corpus", "knowledge/eval/stahl-bilingue-v1.json"));
const SORTIE = resolve(RACINE, option("--sortie", "knowledge/eval/stahl-bilingue-v1.resultat.json"));
/**
 * `--porte-reelle` : n'DEFAUT PAS de simulation d'attestation. La porte
 * SQL est interrogee telle quelle, avec le filtre d'autorite reel
 * (classification, statut, approbation, revue, non-supersession, langue).
 * C'est le mode a utiliser apres activation : il prouve que la source
 * ACTIVE est reellement servie, sans aucune substitution.
 */
const PORTE_REELLE = args.includes("--porte-reelle");

/* ---------------------------------------------------------------- compile */
function compiler(nom, entrees) {
  const sortie = join(RACINE, ".eval-out", nom);
  rmSync(sortie, { recursive: true, force: true });
  const tsconfig = join(RACINE, ".eval-out", `${nom}.tsconfig.json`);
  // MÊME disposition que `eval-stahl-retrieval.mjs` : rootDir `../src`, sortie
  // plate (`server/`) ; l'alias "@/" est ensuite reecrit par
  // `reecrire-alias-eval.mjs`.
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

compiler("eval-stahl-bilingue", [
  "src/server/knowledge/recherche.ts",
  "src/server/knowledge/rerank.ts",
  "src/server/knowledge/preuve.ts",
  "src/server/knowledge/stockage.ts",
  "src/server/knowledge/gouvernance.ts",
  "src/server/knowledge/terminologie-bilingue.ts",
  "src/server/alexa/knowledge-query.ts",
  "src/server/alexa/knowledge-adapter.ts",
]);
const base = new URL(`file:///${join(RACINE, ".eval-out", "eval-stahl-bilingue", "server").replace(/\\/g, "/")}/`).href;
const knowledgeAdapter = await import(`${base}/alexa/knowledge-adapter.js`);
const knowledgeQuery = await import(`${base}/alexa/knowledge-query.js`);

/* --------------------------------------------------------- porte reelle */
const cache = new Map();
/**
 * La VRAIE porte `app.search_knowledge_lexical`, avec la SEULE substitution
 * d'attestation (4 colonnes). Le filtre d'autorité est celui de la porte.
 */
function porteReelle(requete, langue, limite) {
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
          AND s.statut = 'active'
          AND s.approved_at IS NOT NULL
          AND s.approved_by IS NOT NULL
          AND (s.review_due_at IS NULL OR s.review_due_at > now())
          AND s.superseded_by IS NULL
          AND c.statut = 'active'
          AND ($2 = 'toutes' OR c.langue = $2)
          AND c.document_tsv @@ plainto_tsquery('simple', app.immutable_unaccent($1))
        ORDER BY score DESC
        LIMIT ${limite}) x`;
  const lignes = lignesSocket(RACINE, { texte: sql, params: [requete, langue] });
  const out = lignes.map((l) => JSON.parse(l)).map((r) => ({
    chunk_id: r.id, source_id: r.source_id, source_titre: r.titre, source_version: r.version,
    section: r.section, version_chunk: r.chunker_version, langue: r.langue, texte: r.texte,
    score: Number(r.score),
    // En mode REEL, les colonnes d'attestation sont celles de la base.
    source_statut: r.statut, source_classification: r.classification,
    source_approuvee_le: r.approved_at === null ? null : new Date(r.approved_at).toISOString(),
    source_approuvee_par: r.approved_by,
    source_revue_a_jour: r.revue_a_jour, source_remplacee_par: r.superseded_by,
    unit_id: r.unit_id ?? null, parent_texte_hash: r.parent_texte_hash ?? null,
    enfant_index: r.enfant_index ?? null, enfants_total: r.enfants_total ?? null,
  }));
  cache.set(cle, out);
  return out;
}

/** Le client de production, branché sur la vraie porte. */
const client = {
  rpc: async (porte, args = {}) => {
    if (porte !== "search_knowledge_lexical") return { data: null, error: { message: "porte inconnue" } };
    return { data: porteReelle(args.p_requete, args.p_langue, args.p_limite), error: null };
  },
};

/* ------------------------------------------------------------------ corpus */
if (!existsSyncSafe(CORPUS)) {
  console.error(`ROUGE — corpus introuvable : ${CORPUS}`);
  process.exit(2);
}
function existsSyncSafe(p) {
  try { return lire(p, "utf8").length >= 0; } catch { return false; }
}
const corpus = JSON.parse(lire(CORPUS, "utf8"));
console.log(`corpus : ${corpus.corpus} — ${corpus.questions.length} questions`);

/* -------------------------------------------------------------- evaluation */
const resultats = [];
for (const q of corpus.questions) {
  const question = q.question_fr && q.classe !== "A_contenu_en" && q.classe !== "D_nom_seulement"
    ? q.question_fr : q.question;
  const plan = knowledgeQuery.planKnowledgeQuery(question);
  const resultat = await knowledgeAdapter.readKnowledge(client, question);
  const preuves = resultat.preuves.map((p) => ({
    chunkId: p.chunkId, unitId: p.unitId, sourceTitre: p.titre, texte: p.extrait,
    evidence_relevance: 0,
  }));
  const chunksAttendus = new Set(q.chunks_attendus ?? []);
  const unitesAttendues = new Set(q.unites_attendues ?? []);
  const estOr = (e) => chunksAttendus.has(e.chunkId) || (e.unitId && unitesAttendues.has(e.unitId));
  const top = preuves.slice(0, TOP);
  const rang = preuves.findIndex(estOr);
  const pageOk = q.page_attendue === null || q.page_attendue === undefined ? null
    : top.some((e) => {
      const m = /\bsrc:(\d+)\]/.exec(e.texte ?? "");
      return m !== null && m[1] === String(q.page_attendue);
    });
  const sansReponse = q.source_attendue === null;
  const reponseConfiante = sansReponse ? preuves.length > 0 && resultat.etat !== "faible" : null;
  const attributionIncorrecte = q.source_attendue !== null && preuves.length > 0
    && preuves[0].sourceTitre !== q.source_attendue ? 1 : 0;
  const dcg = top.reduce((acc, e, i) => acc + (estOr(e) ? 1 / Math.log2(i + 2) : 0), 0);
  const idcg = top.filter(estOr).reduce((acc, _e, i) => acc + 1 / Math.log2(i + 2), 0);
  resultats.push({
    id: q.id, classe: q.classe, question,
    plan_requetes: plan === null ? null : plan.queries,
    plan_references: plan === null ? null : plan.references,
    plan_langue: plan === null ? "toutes" : plan.language,
    terminologie: plan === null ? null : plan.terminologieVersion ?? null,
    etat: resultat.etat,
    nb_preuves: preuves.length,
    recall: sansReponse ? null : (rang >= 0 ? 1 : 0),
    mrr: sansReponse ? null : (rang >= 0 ? 1 / (rang + 1) : 0),
    ndcg: sansReponse ? null : (idcg > 0 ? dcg / idcg : 0),
    page_ok: pageOk,
    source_pertinente: q.source_attendue === null ? null
      : (preuves.length > 0 && preuves[0].sourceTitre === q.source_attendue),
    attribution_incorrecte: attributionIncorrecte,
    reponse_non_etayee: reponseConfiante,
    source_premiere: preuves[0]?.sourceTitre ?? null,
    top_chunk: preuves[0]?.chunkId ?? null,
  });
}

const avecReponse = resultats.filter((r) => r.classe !== "G_sans_reponse");
const sansReponse = resultats.filter((r) => r.classe === "G_sans_reponse");
const calc = (sous) => {
  const n = sous.length;
  if (n === 0) return { n: 0 };
  const m = (f) => Number((sous.reduce((a, r) => a + (f(r) ?? 0), 0) / n).toFixed(4));
  return {
    n,
    recall_at_5: m((r) => r.recall),
    mrr: m((r) => r.mrr),
    ndcg_at_5: m((r) => r.ndcg),
    exactitude_page: m((r) => (r.page_ok === null ? null : (r.page_ok ? 1 : 0))),
    exactitude_source: m((r) => (r.source_pertinente === null ? null : (r.source_pertinente ? 1 : 0))),
    attribution_incorrecte: m((r) => r.attribution_incorrecte),
  };
};

const parClasse = {};
for (const c of [...new Set(resultats.map((r) => r.classe))].sort()) {
  parClasse[c] = calc(resultats.filter((r) => r.classe === c));
}

const rapport = {
  corpus: corpus.corpus,
  corpus_version: corpus.version,
  livre: corpus.livre,
  top_k: TOP,
  chemin_production: "readKnowledge() — module Alexa compile TEL QUEL ; rpc branché sur la VRAIE porte app.search_knowledge_lexical",
  substitution_attestation: {
    colonnes: ["source_statut", "source_approuvee_le", "source_approuvee_par", "source_revue_a_jour"],
    raison: "l'activation est un acte humain signe ; ces 4 colonnes sont posees par UN SEUL UPDATE",
    contenu: "texte, section, score, unite, page : 100% reels (tires de la base)",
  },
  questions: resultats.length,
  questions_avec_reponse: avecReponse.length,
  questions_sans_reponse: sansReponse.length,
  global: calc(avecReponse),
  par_classe: parClasse,
  abstention: {
    total: sansReponse.length,
    reponse_a_confiance: sansReponse.filter((r) => r.reponse_non_etayee).length,
    taux: sansReponse.length
      ? Number((sansReponse.filter((r) => r.reponse_non_etayee).length / sansReponse.length).toFixed(4))
      : 0,
  },
  attribution: {
    total_questions_avec_source_attendue: avecReponse.length,
    attribution_incorrecte: avecReponse.reduce((a, r) => a + r.attribution_incorrecte, 0),
    taux: avecReponse.length
      ? Number((avecReponse.reduce((a, r) => a + r.attribution_incorrecte, 0) / avecReponse.length).toFixed(4))
      : 0,
    note: "une question dont la reponse attendue vient du DSM-5 ne doit PAS etre servie par Stahl",
  },
  detail: resultats,
  echecs: resultats.filter((r) => r.classe !== "G_sans_reponse" && r.mrr === 0)
    .map((r) => ({ id: r.id, classe: r.classe, question: r.question, requetes: r.plan_requetes,
      langue: r.plan_langue, etat: r.etat, source: r.source_premiere })),
};

writeFileSync(SORTIE, `${JSON.stringify(rapport, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  corpus: rapport.corpus, questions: rapport.questions,
  global: rapport.global, par_classe: rapport.par_classe,
  abstention: rapport.abstention, attribution: rapport.attribution,
}, null, 2));
console.log(`\nrapport : ${SORTIE}`);
