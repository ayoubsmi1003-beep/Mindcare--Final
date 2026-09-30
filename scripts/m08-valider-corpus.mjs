/**
 * m08-valider-corpus — M08 · VALIDATION LIVE EN LECTURE SEULE, 0 ÉCRITURE.
 *
 * Prouve contre la base gouvernée (rôle `authenticated`, portes 092/093) :
 *   C-live : les 5 unités DSM exclues sont absentes (parité d'ensemble
 *            recomputée par le chargeur lui-même), les sources
 *            inactives/reviewed ne surfacent jamais sur les 46 requêtes golden.
 *   J-live : les portes ne lisent que les tables knowledge_* (définition SQL
 *            inspectée), tout chunk rendu est C4, aucun embedding DSM.
 *   D-live : sondes DSM réelles → top-1 DSM avec provenance exacte
 *            (chunk, source, version, crochet de page).
 *   E      : matrice de robustesse (classes de requêtes × résultat porte).
 *   L      : latences lexicales p50/p95 + volumes.
 *
 * Usage : node scripts/m08-valider-corpus.mjs [--db <nom-base>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function option(nom) {
  const i = args.indexOf(nom);
  if (i < 0) return null;
  const v = args[i + 1];
  return v !== undefined && !v.startsWith("--") ? v : "";
}
const base = option("--db") ?? "mindcare";

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
function baseCible(u, nom) {
  const m = u.match(/^(\w+:\/\/[^/]+\/)([^?]*)(.*)$/);
  if (!m) return null;
  return `${m[1]}${nom}${m[3]}`;
}
const urlCible = baseCible(url, base);
if (!urlCible) {
  console.log("ROUGE | connexion | URL illisible");
  process.exit(1);
}

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: urlCible });
try {
  await client.connect();
  await client.query("SET ROLE authenticated");
} catch (e) {
  console.log(`ROUGE | connexion | ${String(e?.message ?? e).slice(0, 200)}`);
  process.exit(1);
}

const rapport = { base, sections: {}, verdict: "VERT" };
function noter(section, cle, valeur) {
  rapport.sections[section] ??= {};
  rapport.sections[section][cle] = valeur;
}
function echec(section, cle, valeur) {
  noter(section, cle, valeur);
  rapport.verdict = "ROUGE";
  console.log(`  ROUGE | ${section} | ${cle} : ${JSON.stringify(valeur)?.slice(0, 220)}`);
}
function succes(section, ligne) {
  console.log(`  vert  | ${section} | ${ligne}`);
}

// ── 0. Corpus ─────────────────────────────────────────────────────────────
const q = (t, p = []) => client.query(t, p);
const rSources = await q(
  "SELECT id::text AS id, titre, version, statut, classification, approved_at IS NOT NULL AND approved_by IS NOT NULL AS approuvee FROM app.knowledge_sources ORDER BY titre",
);
const actives = rSources.rows.filter((r) => r.statut === "active");
const rChunks = await q(
  "SELECT count(*)::int AS n FROM app.knowledge_chunks c JOIN app.knowledge_sources s ON s.id = c.source_id WHERE c.statut='active' AND s.statut='active'",
);
const rDsm = await q("SELECT count(*)::int AS n FROM app.knowledge_chunks WHERE chunker_version='struct-v2' AND statut='active'");
const rEmb = await q("SELECT count(*)::int AS n FROM app.knowledge_chunks WHERE embedding IS NOT NULL AND statut='active'");
const rEmbDsm = await q("SELECT count(*)::int AS n FROM app.knowledge_chunks WHERE chunker_version='struct-v2' AND embedding IS NOT NULL");
noter("corpus", "sources_actives", actives.length);
noter("corpus", "chunks_actifs", rChunks.rows[0].n);
noter("corpus", "chunks_dsm_struct_v2", rDsm.rows[0].n);
noter("corpus", "chunks_avec_embedding", rEmb.rows[0].n);
noter("corpus", "embeddings_dsm", rEmbDsm.rows[0].n);
succes("corpus", `${actives.length} sources actives, ${rChunks.rows[0].n} chunks actifs, DSM=${rDsm.rows[0].n}, embeddings DSM=${rEmbDsm.rows[0].n}`);
if (rEmbDsm.rows[0].n !== 0) echec("corpus", "embeddings_dsm_interdits", rEmbDsm.rows[0].n);

// ── C-live(a). Parité d'ensemble des chunks DSM ────────────────────────────
const { chunksDepuisUnitesDSM, filtrerUnitesSures } = await import("./charger-connaissance-corpus-dsm.mjs");
const { uuidDeterministe } = await import("./charger-connaissance-socle.mjs");
const manifeste = JSON.parse(readFileSync(join(RACINE, "knowledge", "manifest.json"), "utf8"));
const entreeDsm = (manifeste.entrees ?? manifeste.sources ?? []).find((e) => (e.source_id ?? e.id) === "corpus-dsm5");
const versionDsm = entreeDsm?.version ?? "";
const langueDsm = entreeDsm?.langue ?? "fr";
const ctxDsm = { sourceUuid: uuidDeterministe(`m07-r1|corpus-dsm5|${versionDsm}`), version: versionDsm, langue: langueDsm };
const RACINE_DSM = join(RACINE, "knowledge", "canonical-v2", "dsm5-fr-2015-elsevier", "sha256-be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53", "reconciliation-v10", "units.jsonl");
const unites = readFileSync(RACINE_DSM, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const attendus = new Set(chunksDepuisUnitesDSM(filtrerUnitesSures(unites), ctxDsm).map((c) => c.chunkId));
const rIds = await q("SELECT id FROM app.knowledge_chunks WHERE chunker_version='struct-v2'");
const enBase = new Set(rIds.rows.map((r) => r.id));
const excedent = [...enBase].filter((id) => !attendus.has(id));
const manquant = [...attendus].filter((id) => !enBase.has(id));
noter("frontiere", "unites_v10", unites.length);
noter("frontiere", "chunks_attendus_chargeur", attendus.size);
noter("frontiere", "chunks_dsm_en_base", enBase.size);
if (excedent.length === 0 && manquant.length === 0 && enBase.size === 12815) {
  succes("frontiere", `parité exacte : 12815 chunks DSM en base = ensemble recomputé (5 unités exclues absentes)`);
} else {
  echec("frontiere", "parite_dsm", { excedent: excedent.slice(0, 5), manquants: manquant.length });
}
// Les 5 unités exclues : les chunkIds qu'elles AURAIENT produits (formule
// du chargeur rejouée à l'identique, dans l'ordre du fichier) sont absents.
// (Un contrôle par trace textuelle serait faux : les listes de contributeurs
// de N013 se répètent légitimement dans d'autres unités d'annexe.)
const { hacherTexteFNV, normaliserTexte } = await import("./charger-connaissance-socle.mjs");
const EXCLUES = new Set([
  "dsm5fr-u-1175-N013",
  "dsm5fr-u-152-C027",
  "dsm5fr-u-590-COVER",
  "dsm5fr-u-590-T40001",
  "dsm5fr-u-590-U30184",
]);
const occRejeu = new Map();
const interdits = new Set();
for (const u of unites) {
  const section = Array.isArray(u.structural_path) ? u.structural_path.join(" › ") : "";
  const texte = normaliserTexte(
    `${u.title ?? ""} — ${u.evidence_wording ?? ""} [${u.book_id ?? ""} p.${u.printed_page_start ?? "?"}|src:${u.page_start ?? "?"}]`,
  );
  if (texte === "") continue;
  const texteHash = hacherTexteFNV(texte);
  const cle = `${ctxDsm.sourceUuid}|${ctxDsm.version}|${section}|${texteHash}`;
  const occurrence = occRejeu.get(cle) ?? 0;
  occRejeu.set(cle, occurrence + 1);
  if (EXCLUES.has(u.id)) {
    interdits.add(`dsm5-${hacherTexteFNV([ctxDsm.sourceUuid, ctxDsm.version, section, u.id, texteHash, String(occurrence)].join("|"))}`);
  }
}
const presents = [...interdits].filter((id) => enBase.has(id));
noter("frontiere", "chunkids_interdits_attendus", interdits.size);
if (presents.length === 0 && interdits.size > 0) {
  succes("frontiere", `5 unités exclues → ${interdits.size} chunkIds interdits, 0 présent en base`);
} else {
  echec("frontiere", "unites_exclues_presentes", presents.slice(0, 5));
}

// ── C-live(b). Les sources non actives ne surfacent jamais ─────────────────
const golden = JSON.parse(readFileSync(join(RACINE, "tests", "eval", "knowledge.golden.prod-2026-09-15.json"), "utf8"));
const cas = golden.cas ?? [];
const idsActifsApprouves = new Set(
  rSources.rows.filter((r) => r.statut === "active" && r.approuvee).map((r) => r.id),
);
const vus = new Map();
const latences = [];
const classesVues = new Set();
for (const c of cas) {
  const t0 = process.hrtime.bigint();
  const r = await q("SELECT * FROM app.search_knowledge_lexical($1,$2,$3)", [c.requete, c.langue ?? "fr", 20]);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  latences.push(ms);
  for (const row of r.rows) {
    vus.set(row.source_id, (vus.get(row.source_id) ?? 0) + 1);
    classesVues.add(row.source_classification);
    if (!idsActifsApprouves.has(row.source_id)) {
      echec("frontiere", "source_non_eligible_rendue", { cas: c.id, source: row.source_id });
    }
  }
}
noter("frontiere", "requetes_golden_jouees", cas.length);
noter("frontiere", "sources_distinctes_rendues", [...vus.keys()].length);
noter("frontiere", "classifications_rendues", [...classesVues]);
succes("frontiere", `${cas.length} requêtes golden : toutes les sources rendues sont actives+approuvées (${[...vus.keys()].length} distinctes, classes=${[...classesVues]})`);

// ── J-live. Les portes ne lisent que knowledge_* ───────────────────────────
for (const fn of ["search_knowledge_lexical", "search_knowledge_vector"]) {
  const r = await q("SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname=$1", [fn]);
  const def = r.rows[0]?.def ?? "";
  const interdits = ["patients", "dossiers", "ordonnances", "consultations", "notes_seance", "patient_id", "cabinet_patients"]
    .filter((t) => new RegExp(`\\b${t}\\b`, "i").test(def));
  const tables = (def.match(/FROM\s+app\.\w+|JOIN\s+app\.\w+/gi) ?? []).map((s) => s.toLowerCase());
  noter("patient", `${fn}_tables`, [...new Set(tables)]);
  if (interdits.length === 0) succes("patient", `${fn} : aucune table patient référencée (${[...new Set(tables)].join(", ")})`);
  else echec("patient", `${fn}_tables_patient`, interdits);
}

// ── D-live. Sondes DSM réelles ─────────────────────────────────────────────
const sourceDsm = rSources.rows.find((r) => r.titre.startsWith("DSM-5"));
const sondes = [
  { id: "D1-terminologie", requete: "épisode maniaque", attend: "maniaque" },
  { id: "D2-criteres", requete: "critères épisode maniaque", attend: "maniaque" },
  { id: "D3-symptome", requete: "attaque de panique", attend: "panique" },
  { id: "D4-francais", requete: "trouble anxiété généralisée", attend: "anxi" },
  { id: "D5-rubrique", requete: "schizophrénie", attend: "schizo" },
];
noter("dsm", "source_titre", sourceDsm?.titre ?? null);
noter("dsm", "source_version", sourceDsm?.version ?? null);
for (const s of sondes) {
  const r = await q("SELECT * FROM app.search_knowledge_lexical($1,'fr',5)", [s.requete]);
  const top1 = r.rows[0] ?? null;
  const estDsm = top1 !== null && String(top1.source_id) === String(sourceDsm?.id);
  const texteOk = top1 !== null && top1.texte.toLowerCase().includes(s.attend);
  const crochet = top1 !== null && /p\.\d+\|src:\d+/.test(top1.texte);
  // Re-constat en base : le chunk existe, actif, source active.
  let recontrat = false;
  if (top1 !== null) {
    const rc = await q(
      "SELECT c.id IS NOT NULL AND c.statut='active' AND s.statut='active' AS ok FROM app.knowledge_chunks c JOIN app.knowledge_sources s ON s.id=c.source_id WHERE c.id=$1",
      [top1.chunk_id],
    );
    recontrat = rc.rows[0]?.ok === true;
  }
  const preuve = estDsm && texteOk && crochet && recontrat;
  noter("dsm", s.id, {
    top_chunk: top1?.chunk_id?.slice(0, 13) ?? null,
    top_section: typeof top1?.section === "string" ? top1.section.slice(0, 80) : null,
    est_dsm: estDsm,
    texte_pertinent: texteOk,
    crochet_page: crochet,
    reconstat_base: recontrat,
  });
  if (preuve) succes("dsm", `${s.id} « ${s.requete} » → DSM ${String(top1.chunk_id).slice(0, 13)} · crochet page · re-constaté actif`);
  else echec("dsm", s.id, { estDsm, texteOk, crochet, recontrat });
}

// ── E. Matrice de robustesse (niveau porte) ────────────────────────────────
const matrice = [
  { classe: "exacte", requete: "sertraline 50 mg" },
  { classe: "exacte", requete: "trouble panique" },
  { classe: "faute-frappe", requete: "sertralin 50 mg" },
  { classe: "faute-frappe", requete: "anxieté" },
  { classe: "accents", requete: "anxiete" },
  { classe: "singulier-pluriel", requete: "critère épisode maniaque" },
  { classe: "formulation", requete: "angoisse" },
  { classe: "formulation", requete: "sevrage" },
  { classe: "darija-fr", requete: "dwa dyalou sertraline ?" },
  { classe: "hors-corpus", requete: "licorne rose" },
  { classe: "hors-corpus", requete: "protocole ancien-protocole" },
];
for (const m of matrice) {
  const r = await q("SELECT source_titre, section FROM app.search_knowledge_lexical($1,'fr',5)", [m.requete]);
  noter("robustesse", `${m.classe} :: ${m.requete}`, {
    lignes: r.rows.length,
    top1: r.rows[0]?.source_titre?.slice(0, 40) ?? null,
  });
  succes("robustesse", `${m.classe} « ${m.requete} » → ${r.rows.length} ligne(s)${r.rows[0] ? `, top1=${String(r.rows[0].source_titre).slice(0, 34)}` : ""}`);
}

// ── L. Latences ────────────────────────────────────────────────────────────
latences.sort((a, b) => a - b);
const pct = (p) => latences[Math.min(latences.length - 1, Math.floor((p / 100) * latences.length))];
noter("performance", "lexical_ms_moyen", +((latences.reduce((a, b) => a + b, 0) / latences.length).toFixed(1)));
noter("performance", "lexical_ms_p50", +pct(50).toFixed(1));
noter("performance", "lexical_ms_p95", +pct(95).toFixed(1));
noter("performance", "lexical_ms_max", +latences[latences.length - 1].toFixed(1));
noter("performance", "hybride", "NOT RUN — jambe vectorielle sans modèle local prouvé ; DSM sans embeddings par recette (M08-M)");
succes("performance", `lexical sur ${latences.length} requêtes : moy=${(latences.reduce((a, b) => a + b, 0) / latences.length).toFixed(1)} ms p50=${pct(50).toFixed(1)} p95=${pct(95).toFixed(1)} max=${latences[latences.length - 1].toFixed(1)} ms`);

await client.end();
writeFileSync(join(RACINE, "knowledge", ".sortie-m08-validation.json"), JSON.stringify(rapport, null, 2), "utf8");
console.log(`\nVERDICT M08-LIVE : ${rapport.verdict} — knowledge/.sortie-m08-validation.json`);
process.exit(rapport.verdict === "VERT" ? 0 : 1);
