#!/usr/bin/env node
/**
 * sonde-lexique-stahl — DIAGNOSTIC de la porte lexicale (lecture seule).
 *
 *   node scripts/sonde-lexique-stahl.mjs
 *
 * Question : la porte lexicale de production peut-elle ramener le contenu
 * d'un livre ANGLAIS depuis une question FRANCAISE (usage reel de l'Alexa
 * d'un cabinet francophone) ? Et depuis une question ANGLAISE ?
 *
 * On mesure :
 *  - ce que `planKnowledgeQuery()` produit reellement (requetes, langue) ;
 *  - ce que la porte lexicale (meme SQL que `app.search_knowledge_lexical`)
 *    ramene ;
 *  - ce que la jambe VECTORIELLE ramene (BGE-M3 multilingue).
 *
 * Aucune ecriture. La source Stahl reste en quarantaine (`reviewed`).
 */
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { lignesSocket } from "./transport-socket.mjs";
import { SOURCE_UUID, VERSION } from "./charger-connaissance-corpus-stahl.mjs";
import { chargerBinaireNatif, resoudreDossierProuve, verifierPariteTokens } from "./embeddings-runtime.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BOOK_ID = "stahl-prescribers-guide-7e-cup";
const DOSSIER = join(RACINE, "knowledge", "canonical-v2", BOOK_ID, VERSION.replace("sha256:", "sha256-"));

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
  execFileSync(process.execPath, [join(RACINE, "scripts", "reecrire-alias-eval.mjs"), sortie], { cwd: RACINE, stdio: "pipe" });
}
compiler("sonde-lexicale-stahl", [
  "src/server/knowledge/embeddings.ts",
  "src/server/alexa/knowledge-query.ts",
  "src/server/knowledge/embeddings-local.ts",
]);
const base = new URL(`file:///${join(RACINE, ".eval-out", "sonde-lexicale-stahl", "server").replace(/\\/g, "/")}/`).href;
const knowledgeQuery = await import(`${base}/alexa/knowledge-query.js`);
const embeddings = await import(`${base}/knowledge/embeddings.js`);
const local = await import(`${base}/knowledge/embeddings-local.js`);

const chunks = new Map();
for (const l of readFileSync(join(DOSSIER, "chunks-v2.jsonl"), "utf8").split("\n").filter(Boolean)) {
  const o = JSON.parse(l);
  chunks.set(o.chunk_id, o);
}
const embMap = new Map();
const fEmb = join(DOSSIER, "embeddings-v2.jsonl");
if (existsSync(fEmb)) {
  for (const l of readFileSync(fEmb, "utf8").split("\n").filter(Boolean)) {
    const o = JSON.parse(l);
    embMap.set(o.chunk_id, o.embedding);
  }
}

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
const fournisseur = new embeddings.FournisseurLocalOnnx(config, inference);

function porteLexicale(requete, limite = 20) {
  const sql = `SELECT c.id, c.section, c.texte,
      ts_rank(c.document_tsv, plainto_tsquery('simple', app.immutable_unaccent($1)))::double precision AS score
    FROM app.knowledge_chunks c
    WHERE c.source_id = '${SOURCE_UUID}'::uuid
      AND c.document_tsv @@ plainto_tsquery('simple', app.immutable_unaccent($1))
    ORDER BY score DESC LIMIT ${limite}`;
  return lignesSocket(RACINE, { texte: sql, params: [requete] });
}

function porteVectorielle(requete, limite = 20) {
  if (embMap.size === 0) return [];
  const r = fournisseur.embed([fournisseur.texteDocument(requete)]);
  if (!r.ok) return [];
  const q = r.vecteurs[0];
  const scored = [];
  for (const [id, v] of embMap) {
    let s = 0;
    for (let i = 0; i < q.length; i++) s += q[i] * v[i];
    scored.push({ id, score: 1 - s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limite);
}

const QUESTIONS = [
  ["fr", "Quelle est la posologie habituelle de l'olanzapine ?"],
  ["fr", "Quels sont les effets indesirables de la sertraline ?"],
  ["fr", "Comment fonctionne la venlafaxine ?"],
  ["en", "What is the usual dosage range of Olanzapine?"],
  ["en", "What are the notable side effects of Sertraline?"],
  ["en", "How does Venlafaxine work?"],
  ["mix", "Olanzapine posologie usual dosage range?"],
];

const rapport = [];
for (const [langue, question] of QUESTIONS) {
  const plan = knowledgeQuery.planKnowledgeQuery(question);
  const requetes = plan ? plan.queries : [];
  let lex = 0;
  const lexTop = [];
  for (const q of requetes) {
    const l = porteLexicale(q);
    lex += l.length;
    if (l.length > 0) lexTop.push(l[0]);
  }
  const vec = porteVectorielle(plan ? plan.relevanceQuery : question);
  rapport.push({
    langue, question,
    plan_nul: plan === null,
    langue_plan: plan?.language ?? null,
    requetes,
    lexicale_resultats: lex,
    lexicale_top: lexTop.map((l) => l.split("|")[0]),
    vectorielle_resultats: vec.length,
    vectorielle_top: vec.slice(0, 3).map((v) => ({ id: v.id, score: Number(v.score.toFixed(4)), section: chunks.get(v.id)?.section })),
  });
  console.log(`[${langue}] ${question}`);
  console.log(`   requetes  : ${JSON.stringify(requetes)}`);
  console.log(`   lexicale  : ${lex} resultat(s) ${JSON.stringify(rapport.at(-1).lexicale_top)}`);
  console.log(`   vectoriel : ${vec.length} resultat(s) top=${JSON.stringify(rapport.at(-1).vectorielle_top.map((v) => v.section))}`);
}
writeFileSync(join(DOSSIER, "lexical-diagnostic.json"), `${JSON.stringify(rapport, null, 2)}\n`, "utf8");
console.log(`\nembeddings disponibles : ${embMap.size}`);
