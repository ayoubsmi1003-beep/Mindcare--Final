#!/usr/bin/env node
/**
 * bench-book-embedding — mesure un candidat d'embedding sur les DEUX livres
 * réellement actifs (DSM-5 + Maudsley), sans écrire en base.
 *
 *   node scripts/bench-book-embedding.mjs --modele e5-small [--max 256] [--batch 16]
 *   node scripts/bench-book-embedding.mjs --modele e5-small --limite 2000   (échantillon)
 *
 * ═══ CE QUE CE SCRIPT MESURE ═══
 *   · le chargement réel (ONNX CPU) et la mémoire résidente ;
 *   · le débit d'embedding des passages (passages/s) ;
 *   · la latence d'embedding d'une question (p50/p95) ;
 *   · la qualité de la branche DENSE SEULE sur le golden livres : Recall@1/5/20,
 *     MRR — avec les mêmes attendus (source + section ou fragments de texte)
 *     que `eval-book-rag.mjs`.
 *
 * ═══ CE QU'IL NE FAIT PAS ═══
 *   · Aucune écriture : ni table, ni index, ni activation.
 *   · Aucun jugement clinique : il compare des positions de passages.
 *   · Aucune promotion : un candidat n'est retenu qu'après comparaison avec la
 *     baseline lexicale mesurée par `eval-book-rag.mjs`.
 *
 * Le pooling est celui de la carte du modèle : moyenne pondérée par
 * `attention_mask`, puis normalisation L2. Les préfixes `query:` / `passage:`
 * sont ceux exigés par E5 ; les omettre fausse la mesure.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (nom, defaut) => {
  const i = args.indexOf(nom);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : defaut;
};
const SLUG = opt("--modele", "e5-small");
const MAX_TOKENS = Number(opt("--max", "256"));
const BATCH = Number(opt("--batch", "8"));
const THREADS = Number(opt("--threads", "2"));
const LIMITE = Number(opt("--limite", "0"));
const JSON_OUT = args.includes("--json");
const SORTIE = opt("--sortie", "");
const PREFIXES = { "e5-small": { requete: "query: ", passage: "passage: " }, "horizon-small": { requete: "", passage: "" } };

const dossier = resolve(process.env.LOCALAPPDATA ?? process.env.TEMP, "MindCare", "modeles", SLUG);
if (!existsSync(join(dossier, "model.onnx"))) {
  console.error(`modèle absent : ${dossier} (lancer scripts/telecharger-modele-book.mjs --modele ${SLUG})`);
  process.exit(1);
}
const prefixes = PREFIXES[SLUG] ?? { requete: "", passage: "" };

function chargerEnv() {
  for (const nom of [".env.local", ".env"]) {
    let texte;
    try { texte = readFileSync(nom, "utf8"); } catch { continue; }
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

// ── Modèle ────────────────────────────────────────────────────────────────
const ort = await import("onnxruntime-node");
const { Tokenizer } = await import("@huggingface/tokenizers");
const t0 = performance.now();
const tokenizer = new Tokenizer(
  JSON.parse(readFileSync(join(dossier, "tokenizer.json"), "utf8")),
  JSON.parse(readFileSync(join(dossier, "tokenizer_config.json"), "utf8")),
);
const session = await ort.InferenceSession.create(join(dossier, "model.onnx"),
  { intraOpNumThreads: THREADS, executionProviders: ["cpu"], graphOptimizationLevel: "all" });
const chargementMs = Math.round(performance.now() - t0);
const sortie = session.outputNames.includes("sentence_embedding") ? "sentence_embedding" : session.outputNames[0];
const entreeTrois = session.inputNames.includes("token_type_ids");

function encoder(textes) {
  const tronques = textes.map((texte) => {
    const enc = tokenizer.encode(texte);
    let ids = [...enc.ids];
    let masque = [...enc.attention_mask];
    if (ids.length > MAX_TOKENS) {
      const dernier = ids[ids.length - 1] ?? 0;
      const dernierMasque = masque[masque.length - 1] ?? 1;
      ids = [...ids.slice(0, MAX_TOKENS - 1), dernier];
      masque = [...masque.slice(0, MAX_TOKENS - 1), dernierMasque];
    }
    return { ids, masque };
  });
  let longueur = 0;
  for (const t of tronques) if (t.ids.length > longueur) longueur = t.ids.length;
  const n = tronques.length;
  const ids = new BigInt64Array(n * longueur);
  const masque = new BigInt64Array(n * longueur);
  const types = new BigInt64Array(n * longueur);
  tronques.forEach((t, i) => {
    for (let j = 0; j < longueur; j++) {
      ids[i * longueur + j] = BigInt(t.ids[j] ?? 0);
      masque[i * longueur + j] = BigInt(t.masque[j] ?? 0);
    }
  });
  return { ids, masque, types, n, longueur };
}

/** Moyenne pondérée par le masque, puis L2 — la tête de la carte du modèle. */
function moyenner(data, n, longueur, masque, dimension) {
  const sortie = [];
  for (let i = 0; i < n; i++) {
    const vecteur = new Float64Array(dimension);
    let total = 0;
    for (let j = 0; j < longueur; j++) {
      const poids = Number(masque[i * longueur + j]);
      if (poids === 0) continue;
      total += poids;
      for (let d = 0; d < dimension; d++) vecteur[d] += data[(i * longueur + j) * dimension + d] * poids;
    }
    const norme = Math.sqrt(vecteur.reduce((s, v) => s + v * v, 0)) || 1;
    sortie.push(Float32Array.from(vecteur, (v) => v / (total * norme)));
  }
  return sortie;
}

async function embed(textes) {
  const enc = encoder(textes);
  const entrees = {
    input_ids: new ort.Tensor("int64", enc.ids, [enc.n, enc.longueur]),
    attention_mask: new ort.Tensor("int64", enc.masque, [enc.n, enc.longueur]),
  };
  if (entreeTrois) entrees.token_type_ids = new ort.Tensor("int64", enc.types, [enc.n, enc.longueur]);
  const resultat = await session.run(entrees);
  const tete = resultat[sortie];
  const donnees = tete.data;
  const dims = tete.dims;
  const dimension = dims[dims.length - 1];
  if (dims.length === 3) return moyenner(donnees, enc.n, enc.longueur, enc.masque, dimension);
  return Array.from({ length: enc.n }, (_, i) => Float32Array.from(donnees.slice(i * dimension, (i + 1) * dimension)));
}

// ── Corpus réel (lecture seule) ────────────────────────────────────────────
const url = process.env.MINDCARE_ADMIN_DATABASE_URL ?? process.env.MINDCARE_TEST_DATABASE_URL ?? process.env.MINDCARE_DATABASE_URL;
const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
await client.connect();
await client.query("SET ROLE authenticated");
let pas = 0;
if (LIMITE > 0) {
  const compte = await client.query(`SELECT count(*)::int n
    FROM app.knowledge_chunks c JOIN app.knowledge_sources s ON s.id = c.source_id
    WHERE s.statut = 'active' AND s.classification = 'C4' AND s.approved_at IS NOT NULL AND s.approved_by IS NOT NULL
      AND (s.review_due_at IS NULL OR s.review_due_at > now()) AND s.superseded_by IS NULL AND c.statut = 'active'
      AND (s.titre LIKE 'DSM-5%' OR s.titre LIKE 'The Maudsley%')`);
  pas = Math.max(1, Math.ceil((compte.rows[0]?.n ?? 0) / LIMITE));
}
const { rows: chunks } = await client.query(`
  SELECT c.id, c.texte, c.section, s.titre
  FROM app.knowledge_chunks c JOIN app.knowledge_sources s ON s.id = c.source_id
  WHERE s.statut = 'active' AND s.classification = 'C4' AND s.approved_at IS NOT NULL AND s.approved_by IS NOT NULL
    AND (s.review_due_at IS NULL OR s.review_due_at > now()) AND s.superseded_by IS NULL AND c.statut = 'active'
    AND (s.titre LIKE 'DSM-5%' OR s.titre LIKE 'The Maudsley%')
    ${pas > 0 ? `AND c.ordinal % ${pas} = 0` : ""}
  ORDER BY c.id`);
await client.end();

// ── Embedding des passages ────────────────────────────────────────────────
const vecteurs = [];
const debutPassages = performance.now();
for (let i = 0; i < chunks.length; i += BATCH) {
  const lot = chunks.slice(i, i + BATCH);
  const sorties = await embed(lot.map((c) => `${prefixes.passage}${c.texte}`));
  sorties.forEach((v, j) => vecteurs.push({ chunk: lot[j], vecteur: v }));
}
const passagesMs = performance.now() - debutPassages;

// ── Golden + mesure ──────────────────────────────────────────────────────
const golden = JSON.parse(readFileSync(join("tests", "eval", "knowledge.books-2026-10-27.json"), "utf8"));
const normaliser = (v) => String(v ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const satisfait = (chunk, attendu) => {
  if (!normaliser(chunk.titre).includes(normaliser(attendu.source))) return false;
  if (attendu.section) return attendu.section.every((g) => g.some((m) => normaliser(chunk.section).includes(normaliser(m))));
  if (attendu.texteContient) return attendu.texteContient.every((f) => normaliser(chunk.texte).includes(normaliser(f)));
  return true;
};
const cosinus = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

const latences = [];
const resultats = [];
for (const cas of golden.cas.filter((c) => c.answerable)) {
  const d0 = performance.now();
  const [q] = await embed([`${prefixes.requete}${cas.question}`]);
  latences.push(performance.now() - d0);
  const classes = vecteurs
    .map((x) => ({ chunk: x.chunk, score: cosinus(q, x.vecteur) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  const rang = classes.findIndex((x) => satisfait(x.chunk, cas.attendu));
  resultats.push({ id: cas.id, rang: rang >= 0 ? rang + 1 : null, top1: classes[0] ? classes[0].chunk.section?.slice(-50) : null });
}
const rangs = resultats.map((r) => r.rang);
const recall = (k) => rangs.filter((r) => r !== null && r <= k).length / Math.max(1, rangs.length);
const mrr = rangs.reduce((s, r) => s + (r ? 1 / r : 0), 0) / Math.max(1, rangs.length);
const tri = (v) => [...v].sort((a, b) => a - b);
const p = (q) => { const t = tri(latences); return Math.round(t[Math.min(t.length - 1, Math.floor(q * t.length))] ?? 0); };

const resume = {
  modele: SLUG, dossier, maxTokens: MAX_TOKENS, batch: BATCH, threads: THREADS,
  passages: chunks.length, chargementMs, passagesMs: Math.round(passagesMs),
  passagesParSeconde: Number((chunks.length / (passagesMs / 1000)).toFixed(1)),
  requeteP50: p(0.5), requeteP95: p(0.95),
  rssMo: Math.round(process.memoryUsage().rss / 1_048_576),
  recall1: recall(1), recall5: recall(5), recall20: recall(20), mrr,
  resultats,
};
if (SORTIE !== "") { const { writeFileSync } = await import("node:fs"); writeFileSync(SORTIE, JSON.stringify(resume, null, 1)); }
if (JSON_OUT) console.log(JSON.stringify(resume, null, 1));
else {
  console.log(`\nBENCH EMBEDDING — ${SLUG} (${chunks.length} passages, max ${MAX_TOKENS} tokens)`);
  for (const r of resultats) console.log(`  ${r.id.padEnd(26)} ${r.rang ? `rang ${r.rang}` : "MISS"}`);
  console.log(`\n  chargement ${chargementMs} ms · ${resume.passagesParSeconde} passages/s · requête p50 ${resume.requeteP50} ms / p95 ${resume.requeteP95} ms · RSS ${resume.rssMo} Mo`);
  console.log(`  Recall@1 ${(resume.recall1 * 100).toFixed(1)}%  Recall@5 ${(resume.recall5 * 100).toFixed(1)}%  Recall@20 ${(resume.recall20 * 100).toFixed(1)}%  MRR ${mrr.toFixed(3)}\n`);
}
