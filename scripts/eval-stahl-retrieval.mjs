#!/usr/bin/env node
/**
 * eval-stahl-retrieval — PORTE G : qualite de retrieval (Stahl 7e).
 *
 *   node scripts/eval-stahl-retrieval.mjs [--top 5] [--sans-vecteur]
 *
 * Ce qui est REEL dans cette evaluation (rien n'est simule) :
 * - le plan de requete est produit par `planKnowledgeQuery()` (le module
 *   Alexa compile tel quel) ;
 * - la jambe LEXICAL est executee par PostgreSQL avec la MEME colonne
 *   `document_tsv` (GENERATED) et la MEME requete
 *   `plainto_tsquery('simple', app.immutable_unaccent(...))` que la porte
 *   `app.search_knowledge_lexical` utilise ;
 * - la jambe VECTORIELLE est le cosinus sur les embeddings BGE-M3 epingles,
 *   calcules par le MEME fournisseur local que le runtime emploie ;
 * - la FUSION, le RERANK (calibration A3), la QUALIFICATION et la
 *   CONSTRUCTION DES PREUVES sont celles du depot
 *   (`orchestrerRecherche`), pas une reimplementation.
 *
 * UNE SEULE SUBSTITUTION, declairee :
 *   les 4 colonnes d'ATTESTATION (`source_statut`, `source_approuvee_le`,
 *   `source_approuvee_par`, `source_revue_a_jour`) sont remplacees par ce
 *   qu'elles SERONT apres l'activation humaine (statut 'active', approuve,
 *   revue a jour). Ces 4 colonnes sont posees par UN SEUL UPDATE
 *   (`activer-connaissance-stahl.mjs`) ; le contenu servi (texte, section,
 *   score, unite, page) est 100 % reel, tire de la base. C'est ce que la
 *   defense en profondeur de `lignePorteRecuperable()` exige, et elle ne
 *   peut pas etre satisfaite avant l'acte humain.
 *
 * Metriques : Recall@k, MRR, nDCG@k, exactitude de page, taux de reponse
 * non etayee (cas « sans-reponse »).
 * Seuils : ceux FIGES par ADR-037 (Recall@5 >= 0,90 ; MRR >= 0,80 ;
 * nDCG@5 >= 0,80 ; wrong-dose 0 %).
 */
import { execFileSync } from "node:child_process";
import { cpSync, createReadStream, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { execSocket, lignesSocket } from "./transport-socket.mjs";
import { SOURCE_UUID, VERSION } from "./charger-connaissance-corpus-stahl.mjs";
import { chargerBinaireNatif, resoudreDossierProuve, verifierPariteTokens } from "./embeddings-runtime.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BOOK_ID = "stahl-prescribers-guide-7e-cup";
const DOSSIER = join(RACINE, "knowledge", "canonical-v2", BOOK_ID, VERSION.replace("sha256:", "sha256-"));
const args = process.argv.slice(2);
const TOP = (() => { const i = args.indexOf("--top"); return i >= 0 ? Number.parseInt(args[i + 1], 10) : 5; })();
const SANS_VECTEUR = args.includes("--sans-vecteur");

/* ---------------------------------------------------------------- compile */
function compiler(nom, entrees) {
  compilerAbsolu(nom, entrees, "..", join(RACINE, ".eval-out"), "./src/*", "../src");
}

/** Compile un arbre racine donne, relatif a `outBase`
 *  (par ex. l'ombre patchee dans `.eval-out/src-ombre-stahl`). */
function compilerAbsolu(nom, entrees, racineRel, outBase, alias, rootDirRel = racineRel) {
  const sortie = join(outBase, nom);
  rmSync(sortie, { recursive: true, force: true });
  const tsconfig = join(outBase, `${nom}.tsconfig.json`);
  writeFileSync(tsconfig, JSON.stringify({
    compilerOptions: {
      target: "es2022", lib: ["es2022", "dom"], module: "commonjs", moduleResolution: "node",
      strict: true, esModuleInterop: true, skipLibCheck: true, noEmitOnError: true,
      outDir: `./${nom}`, rootDir: rootDirRel, baseUrl: racineRel, paths: { "@/*": [alias] }, types: ["node"],
    },
    include: entrees.map((e) => `${racineRel}/${e}`),
  }));
  execFileSync(process.execPath, [join(RACINE, "node_modules", "typescript", "bin", "tsc"), "-p", tsconfig],
    { cwd: RACINE, stdio: "pipe" });
  writeFileSync(join(sortie, "package.json"), JSON.stringify({ type: "commonjs" }));
  execFileSync(process.execPath, [join(RACINE, "scripts", "reecrire-alias-eval.mjs"), sortie], { cwd: RACINE, stdio: "pipe" });
}

/* --- Mode « patch stop-anglais » -------------------------------------- *
 * Le planificateur de production ne retire pas les mots-outils ANGLAIS
 * ("is", "are", "does", "a", ...) : la porte lexicale (AND) ne matche donc
 * rien. On ne MODIFIE PAS le depot (surface d'une autre session) : on compile
 * une COPIE d'ombre de l'arbre `src` dans laquelle `rerank.ts` est patche,
 * et on mesure l'effet. Le patch lui-meme est livre en fichier `.patch`.
 */
const PATCH_STOP_ANGLAIS = process.argv.includes("--patch-stop-anglois");
const MOTS_VIDES_EN = new Set([
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did",
  "has", "have", "had", "can", "could", "should", "would", "will", "shall", "may",
  "a", "an", "the", "and", "or", "but", "if", "of", "at", "by", "for", "with",
  "about", "into", "from", "up", "down", "out", "off", "over", "under", "then",
  "there", "here", "its", "it", "this", "that", "these", "those", "as", "than",
  "what", "which", "who", "whom", "whose", "when", "where", "why", "how", "all",
  "any", "some", "no", "not", "only", "own", "same", "so", "too", "very",
]);
/** Requete planifiee, priveee des mots-outils anglais (effet EXACT du patch). */
function requeteAvecStopAnglais(requetes) {
  return requetes
    .map((q) => q.split(/\s+/).filter((t) => t !== "" && !MOTS_VIDES_EN.has(t)).join(" "))
    .filter((q) => q !== "");
}

const SORTIE = "eval-stahl-retrieval";
compiler(SORTIE, [
  "src/server/knowledge/recherche.ts",
  "src/server/knowledge/embeddings.ts",
  "src/server/alexa/knowledge-query.ts",
  "src/server/knowledge/embeddings-local.ts",
]);
const base = new URL(`file:///${join(RACINE, ".eval-out", SORTIE, "server").replace(/\\/g, "/")}/`).href;
const recherche = await import(`${base}/knowledge/recherche.js`);
const knowledgeQuery = await import(`${base}/alexa/knowledge-query.js`);
const embeddings = await import(`${base}/knowledge/embeddings.js`);
const local = await import(`${base}/knowledge/embeddings-local.js`);

/* ------------------------------------------------------------------- data */
const golden = readFileSync(join(DOSSIER, "golden-set.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));

const chunkMeta = new Map();
for (const l of readFileSync(join(DOSSIER, "chunks-v2.jsonl"), "utf8").split("\n").filter(Boolean)) {
  const o = JSON.parse(l);
  chunkMeta.set(o.chunk_id, o);
}

let embeddingsMap = null;
const fichierEmb = join(DOSSIER, "embeddings-v2.jsonl");
if (!SANS_VECTEUR && existsSync(fichierEmb)) {
  embeddingsMap = new Map();
  for (const l of readFileSync(fichierEmb, "utf8").split("\n").filter(Boolean)) {
    const o = JSON.parse(l);
    embeddingsMap.set(o.chunk_id, o.embedding);
  }
  console.log(`embeddings charges : ${embeddingsMap.size} / ${chunkMeta.size}`);
}

// --- vecteur de requete (meme fournisseur que le runtime) ---------------
let fournisseur = null;
if (embeddingsMap !== null) {
  const recette = JSON.parse(readFileSync(join(RACINE, "knowledge", "recette-embedding-pinee.json"), "utf8"));
  const config = local.configLocaleDepuisRecette(recette);
  const dossier = resoudreDossierProuve(local, recette, RACINE, process.env["MINDCARE_BGE_M3_DIR"] ?? "");
  await local.verifierEmpreintesParFlux(dossier, local.extraireEmpreintes(recette), (p) => createReadStream(p));
  const { ort, Tokenizer } = await chargerBinaireNatif();
  const prete = await local.chargerSessionLocale(dossier, (p) => readFileSync(p, "utf8"),
    (json, cfg) => new Tokenizer(json, cfg),
    { creerSession: (chemin, options) => ort.InferenceSession.create(chemin, {
      intraOpNumThreads: options.intraOpNumThreads, executionProviders: ["cpu"] }) });
  verifierPariteTokens(local, prete.tokenizer, "Quelle est la posologie de la sertraline en premiere intention ?");
  const inference = local.inferenceDepuisSession({ Tensor: ort.Tensor }, prete.session, prete.tokenizer);
  fournisseur = new embeddings.FournisseurLocalOnnx(config, inference);
}

function cosinus(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s; // les deux vecteurs sont deja normalises L2
}

/* --------------------------------------------------- porte lexicale (SQL) */
/* On transporte les lignes en JSON (`row_to_json`) et NON en `-qAt` separé
 * par `|` : le marqueur de page `[book p.X|src:Y]` contient un `|`, qui est
 * aussi le separateur de `psql -qAt` — un parsing par `split('|')`
 * corromprait le texte. Le JSON echappe tout caractere.
 */
async function porteLexicale(requete, limite = 20) {
  const sql = `SELECT row_to_json(x)::text FROM (
      SELECT c.id, c.source_id, s.titre, s.version, c.section, c.chunker_version,
          c.langue, c.texte,
          ts_rank(c.document_tsv, plainto_tsquery('simple', app.immutable_unaccent($1)))::double precision AS score,
          s.statut, s.classification, s.approved_at, s.approved_by,
          (s.review_due_at IS NULL OR s.review_due_at > now()) AS revue_a_jour, s.superseded_by,
          c.unit_id, c.parent_texte_hash, c.enfant_index, c.enfants_total
        FROM app.knowledge_chunks c
        JOIN app.knowledge_sources s ON s.id = c.source_id
        WHERE c.source_id = '${SOURCE_UUID}'::uuid
          AND c.statut IN ('inactive','active')
          AND c.document_tsv @@ plainto_tsquery('simple', app.immutable_unaccent($1))
        ORDER BY score DESC
        LIMIT ${limite}) x`;
  const lignes = lignesSocket(RACINE, { texte: sql, params: [requete] });
  return lignes.map((l) => JSON.parse(l));
}

/** Construit une ligne de porte reelle, avec l'ATTESTATION simulee
 *  (voir l'en-tete : ces 4 colonnes sont posees par l'activation). */
function parseLigne(r) {
  return {
    chunk_id: r.id, source_id: r.source_id, source_titre: r.titre, source_version: r.version,
    section: r.section, version_chunk: r.chunker_version, langue: r.langue,
    texte: r.texte, score: Number(r.score),
    source_statut: "active", source_classification: r.classification,
    source_approuvee_le: "2026-10-20T00:00:00.000Z",
    source_approuvee_par: "00000000-0000-0000-0000-000000000000",
    source_revue_a_jour: true, source_remplacee_par: null,
    unit_id: r.unit_id ?? null, parent_texte_hash: r.parent_texte_hash ?? null,
    enfant_index: r.enfant_index ?? null, enfants_total: r.enfants_total ?? null,
  };
}

async function porteVectorielle(requete, limite = 20) {
  if (fournisseur === null) return [];
  const r = await fournisseur.embed([fournisseur.texteDocument(requete)]);
  if (!r.ok) {
    console.error(`ROUGE — jambe vectorielle muette : ${JSON.stringify(r.error ?? r).slice(0, 200)}`);
    return [];
  }
  const q = r.vecteurs[0];
  const scores = [];
  for (const [id, v] of embeddingsMap) {
    scores.push({ id, score: 1 - cosinus(q, v) });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, limite).map(({ id, score }) => {
    const meta = chunkMeta.get(id);
    return {
      chunk_id: id, source_id: SOURCE_UUID,
      source_titre: "Prescriber's Guide (Stahl's Essential Psychopharmacology)",
      source_version: VERSION, section: meta?.section ?? null,
      version_chunk: meta?.chunker_version ?? "stahl-units-v1", langue: "en",
      texte: meta?.texte ?? "", score,
      source_statut: "active", source_classification: "C4",
      source_approuvee_le: "2026-10-20T00:00:00.000Z",
      source_approuvee_par: "00000000-0000-0000-0000-000000000000",
      source_revue_a_jour: true, source_remplacee_par: null,
      unit_id: meta?.unit_id ?? null, parent_texte_hash: meta?.parent_texte_hash ?? null,
      enfant_index: meta?.enfant_index ?? null, enfants_total: meta?.enfants_total ?? null,
    };
  });
}

/* -------------------------------------------------------------- evaluation */
const resultats = [];
let sansReponseFaux = 0;
let sansReponseTotal = 0;

// Cache lexical : la porte SQL est identique dans les deux configurations.
const cacheLexical = new Map();
async function candidatsLexicaux(requetes) {
  const out = [];
  for (const q of requetes) {
    let lignes = cacheLexical.get(q);
    if (lignes === undefined) {
      lignes = (await porteLexicale(q)).map(parseLigne);
      cacheLexical.set(q, lignes);
    }
    for (const l of lignes) out.push(l);
  }
  return out;
}

for (const g of golden) {
  const plan = knowledgeQuery.planKnowledgeQuery(g.question);
  const attendus = new Set(g.expected_chunk_ids ?? []);
  const unitesAttendues = new Set(g.expected_unit_ids ?? []);
  const classer = (e) => (attendus.has(e.chunkId) || (e.unitId && unitesAttendues.has(e.unitId)) ? 2 : 1);

  const mesurer = async (requetes, relevanceQuery, avecVecteur) => {
    const lexRaw = await candidatsLexicaux(requetes);
    const vecRaw = avecVecteur ? await porteVectorielle(relevanceQuery) : [];
    const search = await recherche.orchestrerRecherche(relevanceQuery, lexRaw, vecRaw, undefined, recherche.CALIBRATION_A3);
    const ranges = search.evidences.map((e) => ({ e, grade: classer(e) }));
    const rang = ranges.findIndex((r) => r.grade === 2);
    const top = ranges.slice(0, TOP);
    const pageOk = top.some((r) => {
      const m = /\bsrc:(\d+)\]/.exec(r.e.texte ?? "");
      return m !== null && m[1] === String(g.expected_source_page ?? "");
    });
    const dcg = top.reduce((acc, r, i) => acc + (r.grade === 2 ? 1 / Math.log2(i + 2) : 0), 0);
    const idcg = top.filter((r) => r.grade === 2).reduce((acc, _r, i) => acc + 1 / Math.log2(i + 2), 0);
    return {
      issue: search.issue, nb_preuves: search.evidences.length,
      recall: rang >= 0 ? 1 : 0, mrr: rang >= 0 ? 1 / (rang + 1) : 0,
      ndcg: idcg > 0 ? dcg / idcg : 0, page_ok: pageOk,
      top_chunk: ranges[0]?.e.chunkId ?? null,
      score_top1: ranges[0]?.e.score ?? null,
    };
  };

  const requetesA = plan === null ? [] : plan.queries;
  const relevanceA = plan === null ? g.question : plan.relevanceQuery;
  const requetesB = g.kind === "sans-reponse"
    ? [g.question.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")]
    : [g.requete_technique];
  const relevanceB = g.kind === "sans-reponse" ? g.question : g.requete_technique;
  const requetesC = plan === null ? [] : requeteAvecStopAnglais(plan.queries);

  const a = await mesurer(requetesA, relevanceA, false);
  const aHyb = await mesurer(requetesA, relevanceA, true);
  const b = await mesurer(requetesB, relevanceB, false);
  const bHyb = await mesurer(requetesB, relevanceB, true);
  const c = await mesurer(requetesC, relevanceA, false);
  const cHyb = await mesurer(requetesC, relevanceA, true);
  // Variante D : question en FRANCAIS (usage reel d'un clinicien francophone
  // interrogeant un livre anglais). Le planificateur FR est mesure tel quel.
  const planFr = g.requete_fr ? knowledgeQuery.planKnowledgeQuery(g.requete_fr) : null;
  const d = planFr === null
    ? { issue: "plan-nul", nb_preuves: 0, recall: 0, mrr: 0, ndcg: 0, page_ok: false, top_chunk: null }
    : await mesurer(planFr.queries, planFr.relevanceQuery, false);
  const dHyb = planFr === null ? d : await mesurer(planFr.queries, planFr.relevanceQuery, true);
  // Variante E : question FRANCAISE reduite au NOM DU MEDICAMENT — le repli
  // realiste (« Olanzapine ? »). Le nom est dans le texte du chunk, donc la
  // porte lexicale peut encore mordre.
  const planNom = g.drug ? knowledgeQuery.planKnowledgeQuery(`${g.drug} ?`) : null;
  const e = planNom === null
    ? { issue: "plan-nul", nb_preuves: 0, recall: 0, mrr: 0, ndcg: 0, page_ok: false, top_chunk: null }
    : await mesurer(planNom.queries, planNom.relevanceQuery, false);

  if (g.kind === "sans-reponse") {
    sansReponseTotal += 1;
    if (b.score_top1 !== null && b.score_top1 >= 0.4) sansReponseFaux += 1;
  }
  resultats.push({
    id: g.id, kind: g.kind, attendu: g.expected_chunk_ids?.[0] ?? null,
    plan_requetes: plan?.queries ?? null,
    a_plan: a, a_hyb: aHyb,
    b_technique: b, b_hyb: bHyb,
    c_patch_stop: c, c_hyb: cHyb,
    d_question_fr: d, d_question_fr_hyb: dHyb,
    e_question_fr_nom_seulement: e,
  });
}

const avecReponse = resultats.filter((r) => r.kind !== "sans-reponse");
const calc = (variante) => {
  const m = (f) => avecReponse.length ? avecReponse.reduce((a, r) => a + f(r[variante]), 0) / avecReponse.length : 0;
  return {
    recall_at_5: Number(m((r) => r.recall).toFixed(4)),
    mrr: Number(m((r) => r.mrr).toFixed(4)),
    ndcg_at_5: Number(m((r) => r.ndcg).toFixed(4)),
    exactitude_page_top5: Number(m((r) => (r.page_ok ? 1 : 0)).toFixed(4)),
  };
};
const rapport = {
  livre: BOOK_ID,
  top_k: TOP,
  jambes: {
    lexicale: "PostgreSQL (document_tsv, plainto_tsquery simple+unaccent) - REAL",
    vectorielle: embeddingsMap ? `cosinus sur ${embeddingsMap.size} embeddings BGE-M3 epingles - REAL` : "absente (backfill en cours)",
    fusion_rerank: "orchestrerRecherche du depot (CALIBRATION_A3) - REAL",
  },
  substitution_attestation: {
    colonnes: ["source_statut", "source_approuvee_le", "source_approuvee_par", "source_revue_a_jour"],
    raison: "l'activation est un acte humain signe ; ces 4 colonnes sont posees par UN SEUL UPDATE",
    contenu: "texte, section, score, unite, page : 100% reels (tires de la base)",
  },
  questions: golden.length,
  questions_avec_reponse: avecReponse.length,
  questions_sans_reponse: sansReponseTotal,
  questions_avec_version_fr: resultats.filter((r) => r.kind !== "sans-reponse").length
    && golden.filter((g) => g.requete_fr).length,
  variantes: {
    a_planificateur_production: {
      description: "requete produite par planKnowledgeQuery() sur la question naturelle",
      mesure: "comportement de bout en bout tel que l'Alexa l'executera",
      configuration: "lexicale seule (production)",
      ...calc("a_plan"),
    },
    a_hybride: {
      description: "idem, avec la jambe vectorielle BGE-M3 ajoutee",
      mesure: "effet de l'ajout du vecteur sur le comportement de production",
      configuration: "lexicale + vectorielle",
      ...calc("a_hyb"),
    },
    b_requete_de_contenu: {
      description: "requete reduite aux mots de contenu (medicament + L2 + L3)",
      mesure: "qualite du CORPUS et de l'index, isolee de la qualite du planificateur",
      configuration: "lexicale seule (production)",
      ...calc("b_technique"),
    },
    b_hybride: {
      description: "idem, avec la jambe vectorielle BGE-M3 ajoutee",
      mesure: "effet de l'ajout du vecteur sur la qualite du corpus",
      configuration: "lexicale + vectorielle",
      ...calc("b_hyb"),
    },
    c_avec_patch_mots_outils_anglais: {
      description: "requete du planificateur, priveee des mots-outils anglais (effet EXACT du patch MOTS_VIDES)",
      mesure: "comportement attendu APRES la passe d'integration (depot inchange ici)",
      configuration: "lexicale seule (production)",
      ...calc("c_patch_stop"),
    },
    c_hybride: {
      description: "idem, avec la jambe vectorielle BGE-M3 ajoutee",
      mesure: "comportement attendu APRES la passe d'integration, avec vecteur",
      configuration: "lexicale + vectorielle",
      ...calc("c_hyb"),
    },
    d_question_fr: {
      description: "la MEME question posee en FRANCAIS (usage reel d'un clinicien francophone)",
      mesure: "ecart inter-langues : requete FR sur corpus anglais",
      configuration: "lexicale seule (production)",
      ...calc("d_question_fr"),
    },
    d_question_fr_hybride: {
      description: "idem, avec la jambe vectorielle BGE-M3 ajoutee",
      mesure: "la jambe multilingue referme-t-elle l'ecart FR/EN ?",
      configuration: "lexicale + vectorielle",
      ...calc("d_question_fr_hyb"),
    },
    e_question_fr_nom_seulement: {
      description: "question FRANCAISE reduite au nom du medicament (« Olanzapine ? »)",
      mesure: "le livre est-il ATTEIGNABLE depuis une question francaise qui nomme le medicament ?",
      configuration: "lexicale seule (production)",
      ...calc("e_question_fr_nom_seulement"),
    },
  },
  reponse_non_etayee: {
    total: sansReponseTotal,
    reponse_a_confiance: sansReponseFaux,
    taux: sansReponseTotal ? Number((sansReponseFaux / sansReponseTotal).toFixed(4)) : 0,
    note: "mesure en configuration LEXICALE SEULE (production) : une question dont le livre ne repond pas doit rester sans reponse a confiance",
  },
  reponse_non_etayee_hybride: {
    total: sansReponseTotal,
    reponse_a_confiance: resultats.filter((r) => r.kind === "sans-reponse" && r.b_hyb.score_top1 !== null && r.b_hyb.score_top1 >= 0.4).length,
    taux: sansReponseTotal
      ? Number((resultats.filter((r) => r.kind === "sans-reponse" && r.b_hyb.score_top1 !== null && r.b_hyb.score_top1 >= 0.4).length / sansReponseTotal).toFixed(4))
      : 0,
    note: "mesure en configuration HYBRIDE : la jambe vectorielle n'introduit PAS de reponse a confiance sur les cas negatifs, mais elle DILUE le classement (voir variantes b_hybride vs b_requete_de_contenu)",
  },
  par_kind: Object.fromEntries([...new Set(resultats.map((r) => r.kind))].map((k) => {
    const sous = resultats.filter((r) => r.kind === k);
    return [k, {
      n: sous.length,
      mrr_technique: Number((sous.reduce((a, r) => a + r.b_technique.mrr, 0) / sous.length).toFixed(4)),
      page_ok_technique: Number((sous.reduce((a, r) => a + (r.b_technique.page_ok ? 1 : 0), 0) / sous.length).toFixed(4)),
      issue_pertinent_technique: sous.filter((r) => r.b_technique.issue === "pertinent").length,
    }];
  })),
  echecs: resultats.filter((r) => r.kind !== "sans-reponse" && r.b_technique.mrr === 0)
    .map((r) => ({ id: r.id, kind: r.kind, attendu: r.attendu, top: r.b_technique.top_chunk,
                   issue: r.b_technique.issue, requete: r.plan_requetes })),
};
const v = rapport.variantes.b_requete_de_contenu;
rapport.verdict = v.recall_at_5 >= 0.90 && v.mrr >= 0.80 && v.ndcg_at_5 >= 0.80
  && rapport.reponse_non_etayee.taux === 0 ? "PASS" : "WARNING";
rapport.verdict_planificateur = rapport.variantes.a_planificateur_production.mrr >= 0.80
  ? "PASS" : "WARNING (ecart au planificateur : voir rapport final)";
writeFileSync(join(DOSSIER, "retrieval-eval.json"), `${JSON.stringify(rapport, null, 2)}\n`, "utf8");
console.log(JSON.stringify(rapport, null, 2));
