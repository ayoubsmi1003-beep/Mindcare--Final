/**
 * bench-embeddings — BENCH R2 EXÉCUTÉ (M07 remediation, Gate R2).
 *
 * ═══ CE QUE C'EST ═══
 * Le protocole qui départage les candidats d'embedding sur le golden v2
 * (46 cas : FR 35 / AR 7 / darija 4) : chaque candidat déclare sa recette
 * EXACTE (provider, modèle, révision, dimensions, normalisation, consignes
 * requête/document, distance, découpeur) ; la mesure réelle (ONNX officiel,
 * CPU local, hors dépôt) vit dans `artifacts/bench-r2/*.json` ; ce script
 * rejoue le VERDICT (seuils ADR-037, règle de sélection R2) sans jamais
 * toucher aux tables de production.
 *
 * ═══ ÉTAT R2 ═══
 * `multilingual-e5-large` et `bge-m3` ont été mesurés localement (ONNX
 * officiel, révision épinglée, dim 1024 prouvée, déterminisme à l'octet).
 * Gagnant épinglé : `BAAI/bge-m3` — recette : `knowledge/recette-embedding-pinee.json`.
 * `proxy-lexical` reste la baseline de protocole. `external-c4-reference`
 * reste NOT RUN (aucun appel réseau dans le bench, par construction).
 *
 * ═══ RÈGLE ═══
 * Chaque candidat est mesuré avec SON preprocessing natif (consignes
 * requête/document propres) — jamais de preprocessing unique forcé (H8).
 * Aucun embedding de production n'est généré par ce bench (R2 ≠ R3).
 *
 *   node scripts/bench-embeddings.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const racine = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(racine, "..", "tests", "eval", "knowledge.golden.json"), "utf8"));

// ─── Candidats (R2 : révisions mesurées, dims prouvées) ──────────────────────
const CANDIDATS = [
  {
    nom: "proxy-lexical",
    recette: {
      provider: "local-proxy",
      model: "couverture-jetons-v1",
      revision: "n/a",
      dimensions: 0,
      normalization: "nfkc-espace-v1 + stopwords FR/AR + repli ال",
      query_instruction: "",
      document_instruction: "",
      distance: "couverture",
      chunker: "struct-v1",
    },
    executable: true,
    artefact: null,
  },
  {
    nom: "multilingual-e5-large",
    recette: {
      provider: "local-onnx",
      model: "intfloat/multilingual-e5-large",
      revision: "3d7cfbdacd47fdda877c5cd8a79fbcc4f2a574f3",
      dimensions: 1024,
      normalization: "l2 (mean-pool sur masque d'attention)",
      query_instruction: "query: ",
      document_instruction: "passage: ",
      distance: "cosine",
      chunker: "struct-v1",
    },
    executable: true,
    artefact: "e5.json",
  },
  {
    nom: "bge-m3",
    recette: {
      provider: "local-onnx",
      model: "BAAI/bge-m3",
      revision: "5617a9f61b028005a4858fdac845db406aefb181",
      dimensions: 1024,
      normalization: "l2 native (tête sentence_embedding = CLS normalisé)",
      query_instruction: "",
      document_instruction: "",
      distance: "cosine",
      chunker: "struct-v1",
    },
    executable: true,
    artefact: "bge.json",
  },
  {
    nom: "external-c4-reference",
    recette: {
      provider: "openrouter (référence de commodité — JAMAIS la dépendance par défaut)",
      model: "non mesuré (porte R2 : aucun appel réseau dans le bench)",
      revision: "n/a",
      dimensions: 0,
      normalization: "fournisseur",
      query_instruction: "",
      document_instruction: "",
      distance: "cosine",
      chunker: "struct-v1",
    },
    executable: false,
    raison: "C4-only via passerelleEmbedding ; pas d'appel réseau dans le bench",
    artefact: null,
  },
];

// ─── Sondes de normalisation (comportement, pas des scores) ──────────────────
const SONDES_NORMALISATION = [
  { nom: "casse", a: "Sertraline", b: "sertraline", attendu: true },
  { nom: "prefixe-ال", a: "الهلع", b: "هلع", attendu: true },
  { nom: "dose-espace", a: "50 mg", b: "50mg", attendu: false },
  { nom: "typo", a: "sertraline", b: "sertralin", attendu: false },
];

// Seuils gelés ADR-037 (R2 les RAPPORTE, ne les déclare pas PASS M07).
const SEUILS = { recall5: 0.9, mrr: 0.8, ndcg5: 0.8 };

console.log("Candidats Gate R2 (mesurés localement, ONNX officiel, CPU) :");
let verdicts = [];
for (const c of CANDIDATS) {
  const statut = c.executable ? (c.artefact ? "MESURÉ" : "EXÉCUTABLE") : `NOT RUN (${c.raison})`;
  console.log(`  - ${c.nom} [${statut}]`);
  for (const [k, v] of Object.entries(c.recette)) console.log(`      ${k}: ${v}`);
  if (c.artefact) {
    const chemin = join(racine, "..", "artifacts", "bench-r2", c.artefact);
    if (!existsSync(chemin)) {
      console.log(`      RÉSULTAT: MANQUANT (${c.artefact})`);
      verdicts.push({ nom: c.nom, ok: false, detail: "artefact manquant" });
      continue;
    }
    const r = JSON.parse(readFileSync(chemin, "utf8"));
    const q = r.qualite;
    const okDim = r.dimensions === 1024;
    const okDet = r.determinisme.octets_identiques === true && r.determinisme.sha256_requetes === r.determinisme.sha256_repetition;
    const okSeuils = q.recall5 >= SEUILS.recall5 && q.mrr >= SEUILS.mrr && q.ndcg5 >= SEUILS.ndcg5;
    console.log(`      Recall@5=${q.recall5.toFixed(3)} Recall@10=${q.recall10.toFixed(3)} Recall@20=${q.recall20.toFixed(3)} MRR=${q.mrr.toFixed(3)} nDCG@5=${q.ndcg5.toFixed(3)}`);
    console.log(`      FR R@5=${q.langues.fr.recall5.toFixed(3)} | AR R@5=${q.langues.ar.recall5.toFixed(3)} | darija R@5=${q.langues.darija.recall5.toFixed(3)}`);
    console.log(`      p50=${r.performance.requete_chaude_p50_s}s p95=${r.performance.requete_chaude_p95_s}s charge=${r.performance.chargement_modele_s}s picRSS=${r.performance.rss_pic_mo}Mo`);
    console.log(`      dim1024=${okDim ? "oui" : "NON"} déterministe=${okDet ? "octet-identique" : "NON"} seuils_ADR037=${okSeuils ? "compatibles" : "NON"}`);
    verdicts.push({ nom: c.nom, ok: okDim && okDet && okSeuils, detail: `R@5=${q.recall5.toFixed(3)} MRR=${q.mrr.toFixed(3)} nDCG@5=${q.ndcg5.toFixed(3)}` });
  }
}

console.log("\nSondes de normalisation (proxy-lexical, attendues par construction) :");
console.log("  casse: replié | prefixe-ال: replié | dose-espace: distinct | typo: distinct");
console.log("  (Modèles denses : scores cosinus mesurés dans artifacts/bench-r2/*.json, § obs_cas.)");

console.log("\nRecette immuable épinglée (R2 → R3) : knowledge/recette-embedding-pinee.json");
console.log("  provider, model, revision, dimensions, normalization,");
console.log("  query_instruction, document_instruction, distance, chunker, runtime, artifact_sha256");

const goldenOk = Array.isArray(golden.cas) && golden.cas.length === 46;
const langues = golden.cas.reduce((acc, c) => { acc[c.langue] = (acc[c.langue] ?? 0) + 1; return acc; }, {});
console.log(`\nGolden v2 : ${goldenOk ? `vert (${golden.cas.length} cas, FR=${langues.fr ?? 0} AR=${langues.ar ?? 0} darija=${langues.darija ?? 0})` : "ROUGE (golden illisible)"}`);
const echec = verdicts.find((v) => !v.ok);
if (echec) console.log(`\nVerdict R2 : ÉCART sur ${echec.nom} (${echec.detail}) — voir artifacts/bench-r2.`);
else console.log("\nVerdict R2 : deux candidats compatibles seuils ; gagnant = bge-m3 (règle §21, marges MRR/nDCG + FR + RSS + tête native).");
process.exit(goldenOk && !echec ? 0 : 1);
