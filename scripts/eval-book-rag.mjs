#!/usr/bin/env node
/**
 * eval-book-rag — la mesure LIVRE RÉELLE du chemin Alexa (lecture seule, 0 écriture).
 *
 * ═══ CE QUE CETTE PASSE PROUVE ═══
 * Le VRAI `readKnowledge` (planification de requête, portes gouvernées, fusion,
 * qualification, preuve d'affichage avec page/édition) exécuté contre la base
 * du cabinet, sur le golden `tests/eval/knowledge.books-<date>.json`. Les
 * attendus sont SOURCE + SECTION, jamais un chunk_id produit par le retriever.
 *
 * ═══ CE QU'ELLE NE PROUVE PAS ═══
 *   · Pas la qualité clinique d'une réponse (aucun LLM ici).
 *   · Pas l'exactitude du folio imprimé : on mesure sa PRÉSENCE et sa
 *     cohérence avec le marqueur d'ingestion, pas une vérification visuelle.
 *   · Pas la branche vectorielle (modèle absent par défaut) : le mode est
 *     déclaré, jamais simulé.
 *
 *   node scripts/eval-book-rag.mjs [--golden <fichier>] [--json]
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

import { compilerConnaissance } from "./embeddings-runtime.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (nom, defaut) => {
  const i = args.indexOf(nom);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : defaut;
};
const GOLDEN = resolve(RACINE, option("--golden", join("tests", "eval", "knowledge.books-2026-10-27.json")));
const EN_JSON = args.includes("--json");
const URL_EXPLICITE = option("--url", "");
const VEUT_VECTEUR = args.includes("--vector");
const SLUG_MODELE = option("--slug", "e5-small");
const MODELE = option("--modele", "intfloat/multilingual-e5-small");
const VERSION_MODELE = option("--version", "614241f622f53c4eeff9890bdc4f31cfecc418b3");
const DIMENSIONS_MODELE = Number(option("--dimensions", "384"));
const TRONCATURE = Number(option("--truncature", "128"));
const DOSSIER_MODELE = option("--dossier", join(process.env.LOCALAPPDATA ?? process.env.TEMP, "MindCare", "modeles", SLUG_MODELE));

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
const url = URL_EXPLICITE !== ""
  ? URL_EXPLICITE
  : (process.env.MINDCARE_ADMIN_DATABASE_URL ?? process.env.MINDCARE_TEST_DATABASE_URL ?? process.env.MINDCARE_DATABASE_URL ?? "");
if (url.trim() === "") { console.error("aucune URL MINDCARE_* (lecture seule exigée)"); process.exit(1); }

mkdirSync(join(RACINE, ".eval-out"), { recursive: true });
const { sortie } = await compilerConnaissance(RACINE, "eval-book-rag", "src/server/alexa/knowledge-adapter.ts");
const { readKnowledge, dependancesReadKnowledge } = await import(
  pathToFileURL(join(sortie, "server", "alexa", "knowledge-adapter.js")).href
);

const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 10_000 });
/** Une connexion = un rôle applicatif, comme `withCaller` (jamais de fuite de rôle). */
const avecRole = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query("SET ROLE authenticated");
    return await fn(client);
  } finally {
    client.release();
  }
};

/** ClientSql lecture seule : les deux portes, rien d'autre. */
const clientSql = {
  rpc: async (nom, params = {}) => {
    try {
      if (nom === "search_knowledge_lexical") {
        return await avecRole(async (client) => {
          const r = await client.query("SELECT * FROM app.search_knowledge_lexical($1,$2,$3)",
            [params.p_requete, params.p_langue, params.p_limite]);
          return { data: r.rows, error: null };
        });
      }
      if (nom === "search_knowledge_vector_v2_768") {
        return await avecRole(async (client) => {
          const r = await client.query("SELECT * FROM app.search_knowledge_vector_v2_768($1,$2,$3,$4)",
            [params.p_embedding_json, params.p_modele, params.p_version, params.p_limite]);
          return { data: r.rows, error: null };
        });
      }
      if (nom === "search_knowledge_vector_v2") {
        // Un espace vectoriel par dimension (HNSW exige une dimension fixe).
        // Le harnais route vers la porte de l'espace MESURÉ ; le code de
        // production, lui, garde son site d'appel littéral.
        const porte = DIMENSIONS_MODELE === 768
          ? "app.search_knowledge_vector_v2_768"
          : "app.search_knowledge_vector_v2";
        return await avecRole(async (client) => {
          const r = await client.query(`SELECT * FROM ${porte}($1,$2,$3,$4)`,
            [params.p_embedding_json, params.p_modele, params.p_version, params.p_limite]);
          return { data: r.rows, error: null };
        });
      }
      if (nom === "search_knowledge_vector") {
        return await avecRole(async (client) => {
          const r = await client.query("SELECT * FROM app.search_knowledge_vector($1,$2)",
            [params.p_embedding_json, params.p_limite]);
          return { data: r.rows, error: null };
        });
      }
      return { data: null, error: { code: "introuvable", message: "porte inconnue", context: nom } };
    } catch (err) {
      return { data: null, error: { code: "indisponible", message: String(err?.message ?? err).slice(0, 200), context: nom } };
    }
  },
};

const normaliser = (v) => String(v ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/**
 * Le chemin de section commence TOUJOURS par un conteneur générique
 * (« Section II — Critères diagnostiques et codes » pour le DSM, « Part 1: … »
 * pour Taylor). Ce conteneur rendrait n'importe quelle rubrique « conforme » à
 * une question de critères, donc il est ÉCARTÉ. On juge ensuite sur les
 * segments RÉELS du chemin : le trouble demandé ou le chapitre nommé peut
 * vivre à n'importe quelle profondeur (« Chapter 3: Depression › Antidepressant
 * withdrawal › Background »). L'ancien matcher ne regardait que les deux
 * derniers segments et déclarait « absent » un passage pourtant situé dans le
 * bon chapitre — la règle mesurait la profondeur de l'arborescence, pas la
 * pertinence.
 */
const segments = (section) => normaliser(section).split(/[\u203A\u00BB]/).map((s) => s.trim()).filter(Boolean);
const cheminUtile = (section) => segments(section).slice(1);
const sectionsConcernent = (section, groupes) => {
  const chemin = cheminUtile(section);
  return groupes.every((groupe) => groupe.some((mot) => chemin.some((segment) => segment.includes(normaliser(mot)))));
};
const sectionExclue = (section, exclus) => (exclus ?? []).some((mot) => normaliser(section).includes(normaliser(mot)));
const texteContient = (texte, fragments) => fragments.every((fragment) => normaliser(texte).includes(normaliser(fragment)));
const sourceConcernent = (titre, attendu) => normaliser(titre).includes(normaliser(attendu));
/** Un attendu est satisfait si la SOURCE correspond ET toutes les contraintes présentes. */
const preuveSatisfait = (preuve, attendu) => {
  if (!sourceConcernent(preuve.titre, attendu.source)) return false;
  if (sectionExclue(preuve.section ?? "", attendu.sectionExclut)) return false;
  if (attendu.section && !sectionsConcernent(preuve.section ?? "", attendu.section)) return false;
  if (attendu.texteContient && !texteContient(preuve.extrait ?? "", attendu.texteContient)) return false;
  return true;
};

const golden = JSON.parse(readFileSync(GOLDEN, "utf8").replace(/^\uFEFF/, ""));
let deps = dependancesReadKnowledge();
if (VEUT_VECTEUR) {
  const { chargerEmbeddeur } = await import("./lib/embedding-livre.mjs");
  const emb = await chargerEmbeddeur({ dossier: DOSSIER_MODELE, slug: SLUG_MODELE, maxTokens: TRONCATURE, threads: 2 });
  deps = {
    vectorActif: true,
    vecteurRequete: async (question) => (await emb.embed([question], "requete"))[0],
    vectorielSecondaire: { modele: MODELE, version: VERSION_MODELE },
  };
}
const resultats = [];
for (const cas of golden.cas) {
  const t0 = performance.now();
  let resultat;
  try { resultat = await readKnowledge(clientSql, cas.question, undefined, deps); }
  catch (err) { resultat = { etat: "panne", preuves: [], erreur: String(err?.message ?? err).slice(0, 120) }; }
  const ms = performance.now() - t0;
  const rang = cas.answerable
    ? resultat.preuves.findIndex((p) => preuveSatisfait(p, cas.attendu))
    : -1;
  resultats.push({
    id: cas.id, answerable: cas.answerable !== false, etat: resultat.etat, ms: Math.round(ms),
    vectoriel: resultat.vectoriel ?? null,
    preuves: resultat.preuves.length, rang1: rang >= 0 ? rang + 1 : null,
    page: rang >= 0 ? resultat.preuves[rang]?.page?.libelle ?? null : null,
    edition: rang >= 0 ? resultat.preuves[rang]?.edition?.edition ?? null : null,
    top1: resultat.preuves[0] ? { titre: String(resultat.preuves[0].titre).slice(0, 40), section: String(resultat.preuves[0].section ?? "").slice(0, 70) } : null,
    motif: cas.motif ?? null,
  });
}

const positifs = resultats.filter((r) => r.answerable);
const negatifs = resultats.filter((r) => !r.answerable);
const rangPremier = positifs.map((r) => r.rang1);
const recall = (k) => positifs.filter((r) => r.rang1 !== null && r.rang1 <= k).length / Math.max(1, positifs.length);
const mrr = rangPremier.reduce((s, r) => s + (r === null ? 0 : 1 / r), 0) / Math.max(1, positifs.length);
const abstention = negatifs.filter((r) => r.etat === "sans-preuve" || r.etat === "faible").length / Math.max(1, negatifs.length);
const pages = positifs.filter((r) => r.page !== null).length / Math.max(1, positifs.length);
// Taux de page CONDITIONNEL : parmi les preuves effectivement trouvées, combien
// portent un folio vérifié ? C'est la métrique qui compte pour une citation :
// une absence de page sur une question non retrouvée ne dit rien de la citation.
const trouvees = positifs.filter((r) => r.rang1 !== null);
const pageQuandTrouve = trouvees.filter((r) => r.page !== null).length / Math.max(1, trouvees.length);
const latences = resultats.map((r) => r.ms).sort((a, b) => a - b);
const p = (q) => latences[Math.min(latences.length - 1, Math.floor(q * latences.length))] ?? 0;

const resume = {
  golden: GOLDEN.split(/[\\/]/).pop(), cas: resultats.length, positifs: positifs.length, negatifs: negatifs.length,
  mode: [
    deps.vectorActif ? "hybride" : "lexical-seul",
    deps.rerankerLocal !== undefined ? "rerank:actif" : "rerank:inactif",
  ].join("+"),
  recall5: recall(5), recall1: recall(1), recall3: recall(3), mrr, abstention, pageRate: pages, pageQuandTrouve,
  p50: p(0.5), p95: p(0.95), resultats,
};
if (EN_JSON) console.log(JSON.stringify(resume, null, 1));
else {
  console.log(`\nGOLDEN LIVRES — ${resume.golden} (${resume.cas} cas, ${resume.positifs} positifs, ${resume.negatifs} abstentions) — mode ${resume.mode}`);
  for (const r of resultats) {
    const marque = r.answerable ? (r.rang1 === 1 ? "TOP1" : r.rang1 ? `r${r.rang1}` : "MISS") : (r.etat === "sans-preuve" || r.etat === "faible" ? "ABST" : "REPONDU");
    console.log(`  ${r.id.padEnd(24)} ${String(r.etat).padEnd(11)} ${marque.padEnd(8)} ${String(r.ms).padStart(4)} ms  ${r.page ?? "-"}  ${r.edition ?? "-"}`);
  }
  console.log(`\n  Recall@1 ${(resume.recall1 * 100).toFixed(1)}%  Recall@5 ${(resume.recall5 * 100).toFixed(1)}%  MRR ${resume.mrr.toFixed(3)}`);
  console.log(`  Abstention ${(resume.abstention * 100).toFixed(1)}%  Page présente ${(resume.pageRate * 100).toFixed(1)}% (${(resume.pageQuandTrouve * 100).toFixed(1)}% des preuves trouvées)  p50 ${resume.p50} ms  p95 ${resume.p95} ms\n`);
}
await pool.end();
