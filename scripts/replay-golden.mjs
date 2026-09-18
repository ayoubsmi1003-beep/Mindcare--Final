/**
 * replay-golden — LE REJOUEUR M09 (simulation hors-ligne, deterministe, 0 reseau).
 *
 * CE QUE CETTE PORTE PROUVE
 * Tout cas golden rejouable rejoue a l'identique : les harnesses
 * deterministes (sorties pinees, faux registres, zero reseau/DB) sont
 * re-executes, chaque cas est rattache a son empreinte d'entree (sha256 de
 * la partie decisionnelle) et a son verdict, le rapport machine+humain est
 * emis sous `artifacts/replay-*.json/.txt`. Vocabulaire strict :
 * PASS / FAIL / NOT RUN. Exit : 0 / 1 / 2.
 *
 * TROIS KINDS (jamais interchangeables, le kind est ecrit dans le rapport)
 * - simulate (defaut) : re-execute les suites deterministes (voir SUITES).
 * - observe : relit le dernier rapport m08-gate + les goldens, sans executer.
 * - compare : diff deux rapports de replay (verdicts, cas, provenance).
 *   FAIL signifie alors "les runs different" (drift detecte), pas "panne".
 *
 * CE QU'ELLE NE PROUVE PAS
 * Ni la qualite live d'un vrai modele (sorties pinees), ni la RLS, ni l'UI,
 * ni les passes DB/embeddings/cross-encoder (declarees NOT RUN), ni la
 * reconnaissance vocale humaine. Aucune ecriture clinique : la simulation
 * ne cable jamais les portes d'ecriture (garde boucle-sans-ecritures du
 * gate M08, re-assert ici par l'absence d'import `pg`).
 * Execution sequentielle volontaire (contention documentee STATE 2026-09-08).
 *
 *   node scripts/replay-golden.mjs [--kind=simulate|observe|compare]
 *     [--compare-a=runA.json --compare-b=runB.json]
 *     [--artifacts-dir=artifacts] [--suites=eval-intentions,eval-conversation]
 *     [--avec-base] (opt-in : suites a base, mesure R&D, jamais gate)
 * PowerShell-safe : aucun shell, que des execFile node/git.
 */

import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import {
  REPLAY_SCHEMA_VERSION,
  chaineCanonique,
  sha256Hex,
  empreinteCas,
  partieDecisionnelle,
  analyserLignes,
  verdictsParCas,
  enregistrementSuite,
  balayerPii,
  comparerRapports,
} from "./replay-preuve.mjs";

const RACINE = join(dirname(process.argv[1]), "..");
function arg(nom, defaut = null) {
  const a = process.argv.find((x) => x.startsWith(`${nom}=`));
  return a ? a.slice(nom.length + 1) : defaut;
}
const KIND = arg("--kind", "simulate");
const ART_DIR = join(RACINE, arg("--artifacts-dir", "artifacts"));
const FILTRE_SUITES = (arg("--suites", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function run(cmd, args, { timeout = 120000, cwd = RACINE } = {}) {
  return new Promise((resolveP) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolveP({
        code: err && typeof err.code === "number" ? err.code : err ? 1 : 0,
        timedOut: Boolean(err && err.killed),
        out: String(stdout ?? ""),
        errText: String(stderr ?? "").slice(0, 2000),
      });
    });
  });
}
const node = (args, opt) => run(process.execPath, args, opt);

const GOLDENS = [
  { famille: "intentions", fichier: "tests/eval/jarvis-intentions.golden.json", cleCas: "cas" },
  { famille: "conversation", fichier: "tests/eval/jarvis-conversation.golden.json", cleCas: "scripts" },
  { famille: "connaissance", fichier: "tests/eval/knowledge.golden.json", cleCas: "cas" },
];
const FICHIERS_PROMPTS = [
  "src/app/api/jarvis/jarvis-chat/prompt.ts",
  "src/server/jarvis/classifieur-intentions.ts",
];

function horodatage() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function provenance() {
  const bruts = [];
  const fichiers = [];
  for (const g of GOLDENS) {
    const brut = readFileSync(join(RACINE, g.fichier), "utf8");
    bruts.push(brut);
    fichiers.push({ fichier: g.fichier, sha256: sha256Hex(brut) });
  }
  let promptsConcat = "";
  const versions = [];
  for (const f of FICHIERS_PROMPTS) {
    const brut = readFileSync(join(RACINE, f), "utf8");
    promptsConcat += brut;
    for (const m of brut.matchAll(/(v\d+\.\d+[-A-Za-z]*|intent-v\d+|PROMPT_VERSION\s*=\s*"[^"]+")/g)) {
      if (!versions.includes(m[0]) && versions.length < 20) versions.push(m[0]);
    }
  }
  let schemaVersion = "illisible";
  try {
    schemaVersion = JSON.parse(readFileSync(join(RACINE, "tests/eval/golden-schema.json"), "utf8")).version;
  } catch { /* illisible : constate, jamais invente */ }
  return {
    goldens_hash: sha256Hex(bruts.join("\n")),
    schema_version: schemaVersion,
    prompts_hash: sha256Hex(promptsConcat),
    prompts_versions: versions,
    fichiers_goldens: fichiers,
  };
}

function empreintesCas() {
  const cas = [];
  for (const g of GOLDENS) {
    const doc = JSON.parse(readFileSync(join(RACINE, g.fichier), "utf8"));
    for (const c of doc[g.cleCas] ?? []) {
      const partie = partieDecisionnelle(g.famille, c);
      if (!partie) continue;
      cas.push({ famille: g.famille, id: c.id, empreinte: empreinteCas(partie), verdict: "non-mappe" });
    }
  }
  return cas;
}

// ─── Suites deterministes rejouables (memes argv que le gate M08) ───────────
const SVC = ".eval-out/services";
const FRONT = ".eval-out/frontiere";
const SUITES_SIMULATION = [
  ["eval-frontiere", ["scripts/eval-jarvis-frontiere.mjs", SVC]],
  ["eval-boucle", ["scripts/eval-jarvis-boucle.mjs", SVC]],
  ["eval-chaine", ["scripts/eval-jarvis-chaine.mjs", SVC]],
  ["eval-ecritures", ["scripts/eval-jarvis-ecritures.mjs", SVC]],
  ["eval-briefs", ["scripts/eval-jarvis-briefs.mjs", SVC]],
  ["eval-reveil", ["scripts/eval-jarvis-reveil.mjs", SVC]],
  ["eval-micro-partage", ["scripts/eval-micro-partage.mjs", SVC]],
  ["eval-endpointage", ["scripts/eval-endpointage.mjs", SVC]],
  ["eval-machine-voix", ["scripts/eval-machine-voix.mjs", SVC]],
  ["eval-lecture-voix", ["scripts/eval-lecture-voix.mjs", SVC]],
  ["eval-registre", ["scripts/eval-jarvis-registre.mjs", SVC]],
  ["eval-sans-suppression", ["scripts/eval-registre-sans-suppression.mjs", SVC]],
  ["eval-injection", ["scripts/eval-jarvis-injection.mjs", `${FRONT}/routing.js`]],
  ["eval-routage", ["scripts/eval-jarvis-routage.mjs", FRONT]],
  ["eval-v2", ["scripts/eval-jarvis-v2.mjs", `${FRONT}/routing.js`]],
  ["eval-intentions", ["scripts/eval-jarvis-intentions.mjs", ".eval-out/intentions", FRONT]],
  ["eval-conversation", ["scripts/eval-jarvis-conversation.mjs", ".eval-out"]],
  ["eval-knowledge-fixture", ["scripts/eval-knowledge-retrieval.mjs", ".eval-out"]],
  // M07 — portes réelles (base gouvernée). OPT-IN explicite (`--avec-base`
  // ou `--suites=eval-knowledge-db`) : la mesure porte 3 écarts R&D nommés
  // (TY-01, DJ-02, WD-02 — tous vers le silence, jamais d'hallucination) qui
  // rendraient TOUT replay FAIL en la gardant par défaut — un gate toujours
  // rouge est pire que pas de gate. Hors opt-in : NOT RUN honnête.
  ["eval-knowledge-db", ["scripts/eval-knowledge-db.mjs", "--db", "mindcare"], 900000, true],
];
const NOT_RUN_ENV = [
  ["eval-reveil-pipeline", "modele ONNX public/wakeword absent ou voix humaine NON MESUREE", "modele ONNX + voix humaine"],
  ["eval-contexte-seance", "source supabase/functions/_shared/contexte-seance.ts absente (pre-existant)", "source vivante src/server/jarvis/ (re-cablage hors perimetre M09)"],
  ["eval-resume-cas", "source supabase/functions/_shared/resume-cas.ts absente (pre-existant)", "source vivante src/server/jarvis/resume-cas.ts (re-cablage hors perimetre M09)"],
  ["live-model-quality", "aucun modele pine pour la qualite live (variance free-tier 5s-180s)", "modele pine ou runtime local M13"],
  ["live-reexecution", "re-execution live interdite en M09 (texte brut + UUID stables vers le fournisseur)", "cabinet d'eval isole + revue de minimisation (decision humaine)"],
  ["model-comparison-live", "comparaison live interdite en M09 (meme motif)", "runtime local M13 + cabinet isole"],
  ["e2e", "exigent pnpm start + /api/health ; le replayer ne lance pas de serveurs", "app demarree + base locale"],
];

async function compiler() {
  const suites = [];
  let ok = true;
  for (const [nom, argv] of [
    ["compile-intentions", ["node_modules/typescript/bin/tsc", "-p", ".eval-intentions-tsconfig.json"]],
    ["compile-services", ["node_modules/typescript/bin/tsc", "-p", ".eval-tsconfig.json"]],
  ]) {
    const r = await node(argv, { timeout: 300000 });
    if (r.code !== 0) ok = false;
    suites.push(enregistrementSuite({ nom, statut: r.code === 0 ? "PASS" : "FAIL", passer: r.code === 0 ? ["compilation"] : [], echouer: r.code === 0 ? [] : ["compilation"], detail: r.code === 0 ? null : `exit=${r.code}` }));
  }
  try {
    // Reecriture des alias "@/" exactement comme le gate M08 : script sur
    // les intentions, puis balayage de TOUT .eval-out (prefixes relatifs a
    // la racine .eval-out, miroir de src/) + package.json commonjs.
    await node(["scripts/reecrire-alias-eval.mjs", ".eval-out/intentions"], { timeout: 60000 });
    await node(["scripts/reecrire-alias-eval.mjs", ".eval-out"], { timeout: 60000 });
    writeFileSync(join(RACINE, ".eval-out", "package.json"), JSON.stringify({ type: "commonjs" }) + "\n");
    const r = await node(["node_modules/typescript/bin/tsc", "src/shared/jarvis/normalisation.ts", "--outDir", ".eval-out/frontiere", "--module", "commonjs", "--target", "es2022", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--noEmitOnError"], { timeout: 240000 });
    if (r.code !== 0) ok = false;
    suites.push(enregistrementSuite({ nom: "compile-frontiere", statut: r.code === 0 ? "PASS" : "FAIL", passer: r.code === 0 ? ["compilation"] : [], echouer: r.code === 0 ? [] : ["compilation"], detail: r.code === 0 ? null : `exit=${r.code}` }));
  } catch (e) {
    ok = false;
    suites.push(enregistrementSuite({ nom: "compile-frontiere", statut: "FAIL", passer: [], echouer: ["compilation"], detail: String(e).slice(0, 300) }));
  }
  return { suites, ok };
}

async function executerHarness(nom, argv, delai = 180000, baseRequise = false) {
  const t0 = Date.now();
  if (!existsSync(join(RACINE, argv[0]))) {
    return enregistrementSuite({ nom, statut: "FAIL", passer: [], echouer: ["evaluateur-absent"], detail: `evaluateur absent: ${argv[0]}`, latenceMs: Date.now() - t0 });
  }
  const r = await node(argv, { timeout: delai });
  const { passer, echouer } = analyserLignes(r.out);
  if (r.timedOut) {
    return enregistrementSuite({ nom, statut: "FAIL", passer, echouer: [...echouer, "timeout"], detail: `timeout ${delai}ms`, latenceMs: Date.now() - t0 });
  }
  // Suite à base : sans base joignable, NOT RUN honnête (jamais FAIL).
  if (baseRequise && /base injoignable|aucune URL|connexion impossible|URL illisible/.test(r.out)) {
    return enregistrementSuite({ nom, statut: "NOT RUN", passer: [], echouer: [], raisonNonRun: "base M07 injoignable (SCAN structurel absent, jamais simule)", environnementRequis: "base gouvernee + portes 092 (+ BGE-M3 local pour l'hybride)", latenceMs: Date.now() - t0 });
  }
  const fail = echouer.length > 0 ? echouer.length : r.code === 1 ? 1 : 0;
  const statut = fail > 0 ? "FAIL" : "PASS";
  return enregistrementSuite({
    nom, statut, passer, echouer,
    detail: [r.code !== 0 && statut === "PASS" ? `exit=${r.code}` : null, r.code !== 0 && statut === "FAIL" ? `exit=${r.code}` : null].filter(Boolean).join(" | ") || null,
    latenceMs: Date.now() - t0,
  });
}

async function kindSimulate(REV) {
  const t0 = Date.now();
  const suites = [];
  const { suites: compils, ok: compileOk } = await compiler();
  suites.push(...compils);
  const veutBase = process.argv.includes("--avec-base");
  const selection = FILTRE_SUITES.length > 0
    ? SUITES_SIMULATION.filter(([n]) => FILTRE_SUITES.includes(n))
    : SUITES_SIMULATION.filter(([, , , baseRequise]) => veutBase || baseRequise !== true);
  const sauteesOptIn = veutBase || FILTRE_SUITES.length > 0
    ? []
    : SUITES_SIMULATION.filter(([, , , baseRequise]) => baseRequise === true);
  if (!compileOk) {
    for (const [nom] of selection) {
      suites.push(enregistrementSuite({ nom, statut: "NOT RUN", passer: [], echouer: [], raisonNonRun: "compilation en echec (structurel)", environnementRequis: "compilateur tsc + sources" }));
    }
  } else {
    for (const [nom, argv, delai, baseRequise] of selection) {
      suites.push(await executerHarness(nom, argv, delai ?? 180000, baseRequise ?? false));
      console.log(`[${suites[suites.length - 1].statut}] ${nom} pass=${suites[suites.length - 1].pass_count} fail=${suites[suites.length - 1].fail_count}`);
    }
  }
  // Schema golden (contrat M08, re-execute tel quel).
  {
    const t = Date.now();
    const r = await node(["scripts/valider-golden.mjs"], { timeout: 120000 });
    const { passer, echouer } = analyserLignes(r.out);
    suites.push(enregistrementSuite({ nom: "schema-golden", statut: r.code === 0 ? "PASS" : "FAIL", passer, echouer, detail: r.code === 0 ? null : `exit=${r.code}`, latenceMs: Date.now() - t }));
    console.log(`[${suites[suites.length - 1].statut}] schema-golden`);
  }
  // Preuve de mutation : M01-01 mutee doit FAIL en citant M01-01.
  {
    const dir = mkdtempSync(join(tmpdir(), "m09-mut-"));
    const doc = JSON.parse(readFileSync(join(RACINE, "tests/eval/jarvis-intentions.golden.json"), "utf8"));
    const cible = doc.cas.find((c) => c.id === "M01-01");
    if (!cible) {
      suites.push(enregistrementSuite({ nom: "preuve-mutation", statut: "FAIL", passer: [], echouer: ["M01-01-absente"], detail: "cas temoin M01-01 introuvable dans le golden" }));
      console.log("[FAIL] preuve-mutation");
    } else {
      cible.attendu.intent = "GET_TODAY_AGENDA";
      cible.attendu.outil = "get_today_agenda";
      const f = join(dir, "jarvis-intentions.mute.json");
      writeFileSync(f, JSON.stringify(doc));
      const r = await node(["scripts/eval-jarvis-intentions.mjs", ".eval-out/intentions", ".eval-out/frontiere", f], { timeout: 120000 });
      const detecte = r.code !== 0 && r.out.includes("M01-01");
      suites.push(enregistrementSuite({ nom: "preuve-mutation", statut: detecte ? "PASS" : "FAIL", passer: detecte ? ["M01-01-mutee-detectee"] : [], echouer: detecte ? [] : ["M01-01-non-detectee"], detail: "M01-01 mutee GET_NEXT_PATIENT->GET_TODAY_AGENDA : le harness doit FAIL en citant M01-01" }));
      console.log(`[${suites[suites.length - 1].statut}] preuve-mutation`);
    }
  }
  for (const [nom, raison, env] of NOT_RUN_ENV) {
    suites.push(enregistrementSuite({ nom, statut: "NOT RUN", passer: [], echouer: [], raisonNonRun: raison, environnementRequis: env }));
  }
  for (const [nom] of sauteesOptIn) {
    suites.push(enregistrementSuite({ nom, statut: "NOT RUN", passer: [], echouer: [], raisonNonRun: "mesure opt-in : passer --avec-base (ecarts R&D nommes, jamais gate par defaut)", environnementRequis: "base gouvernee (+ BGE-M3 local pour l'hybride)" }));
  }
  return { suites, dureeS: Math.round((Date.now() - t0) / 1000) };
}

function kindObserve() {
  const t0 = Date.now();
  const rapports = readdirSync(ART_DIR).filter((f) => f.startsWith("m08-gate-") && f.endsWith(".json")).sort();
  const suites = [];
  let detail = null;
  if (rapports.length === 0) {
    suites.push(enregistrementSuite({ nom: "observation-gate", statut: "NOT RUN", passer: [], echouer: [], raisonNonRun: "aucun rapport m08-gate-*.json (structurel)", environnementRequis: "gate M08 execute au moins une fois" }));
  } else {
    const gate = JSON.parse(readFileSync(join(ART_DIR, rapports[rapports.length - 1]), "utf8"));
    detail = `relit sans executer : ${rapports[rapports.length - 1]} (verdict ${gate.verdict})`;
    for (const s of gate.suites ?? []) {
      suites.push(enregistrementSuite({ nom: s.name, statut: s.status, passer: [], echouer: s.failed_case_ids ?? [], raisonNonRun: s.not_run_reason ?? null, environnementRequis: s.required_environment ?? null, detail: "observation : comptes seuls, cles non conservees par le gate" }));
    }
  }
  return { suites, dureeS: Math.round((Date.now() - t0) / 1000), detail };
}

// ═══════════════════════════════════════════════════════════════════════
console.log("M09 REPLAY — collecte");
const t0 = Date.now();
if (!["simulate", "observe", "compare"].includes(KIND)) {
  console.error(`kind inconnu: ${KIND} (attendu simulate|observe|compare)`);
  process.exit(2);
}
const gitRev = (await run("git", ["rev-parse", "--short", "HEAD"])).out.trim() || "inconnu";
const diffN = (await run("git", ["status", "--short"])).out.split("\n").filter((l) => l.trim() !== "").length;
const REV = `${gitRev}${diffN > 0 ? "-dirty" : ""}`;
const TS = horodatage();
console.log(`rev=${REV} kind=${KIND} node=${process.version}`);

let rapport;
if (KIND === "compare") {
  const cheminA = arg("--compare-a", "");
  const cheminB = arg("--compare-b", "");
  if (!cheminA || !cheminB || !existsSync(resolve(RACINE, cheminA)) || !existsSync(resolve(RACINE, cheminB))) {
    console.error("compare exige --compare-a=<rapport.json> --compare-b=<rapport.json> existants");
    process.exit(2);
  }
  const a = JSON.parse(readFileSync(resolve(RACINE, cheminA), "utf8"));
  const b = JSON.parse(readFileSync(resolve(RACINE, cheminB), "utf8"));
  const { identique, diffs } = comparerRapports(a, b);
  const casB = (b.cas ?? []).map((c) => ({ famille: c.famille, id: c.id, empreinte: c.empreinte, verdict: c.verdict }));
  rapport = {
    mission: "M09",
    kind: "compare",
    replay: true,
    live: false,
    gate_version: REPLAY_SCHEMA_VERSION,
    verdict_rule: "FAIL si un FAIL ; sinon NOT RUN si NOT RUN structurel ; sinon PASS (le FAIL d'une comparaison signifie : les runs different)",
    git_revision: REV,
    timestamp: new Date().toISOString(),
    duree_s: Math.round((Date.now() - t0) / 1000),
    verdict: identique ? "PASS" : "FAIL",
    suites: [enregistrementSuite({ nom: "comparaison-runs", statut: identique ? "PASS" : "FAIL", passer: identique ? ["runs-identiques"] : [], echouer: identique ? [] : diffs.slice(0, 80).map((d) => `${d.portee}:${d.nom}`), detail: identique ? `${cheminA} == ${cheminB}` : `${diffs.length} ecart(s) : voir comparaison.diffs` })],
    totaux: { suites: 1, PASS: identique ? 1 : 0, FAIL: identique ? 0 : 1, "NOT RUN": 0, cas: casB.length, cas_non_mappes: casB.filter((c) => c.verdict === "non-mappe").length },
    cas: casB,
    provenance: b.provenance,
    not_run_reasons: [],
    comparaison: { a: cheminA, b: cheminB, identique, diffs: diffs.slice(0, 200) },
  };
} else {
  const prov = provenance();
  const cas = empreintesCas();
  let suites;
  let dureeS;
  let detailObserve = null;
  if (KIND === "simulate") {
    ({ suites, dureeS } = await kindSimulate(REV));
  } else {
    ({ suites, dureeS, detail: detailObserve } = kindObserve());
    if (detailObserve) console.log(detailObserve);
  }
  // Rattache les verdicts par cas depuis les lignes des suites concernees.
  const clesPasser = new Map();
  const clesEchouer = new Map();
  const suiteDeFamille = { intentions: "eval-intentions", conversation: "eval-conversation", connaissance: "eval-knowledge-fixture" };
  for (const s of suites) {
    for (const [fam, nomSuite] of Object.entries(suiteDeFamille)) {
      if (s.nom === nomSuite) {
        clesPasser.set(fam, [...(clesPasser.get(fam) ?? []), ...(s.cles_vertes ?? [])]);
        clesEchouer.set(fam, [...(clesEchouer.get(fam) ?? []), ...(s.cles_rouges ?? [])]);
      }
    }
  }
  for (const c of cas) {
    const v = verdictsParCas(c.famille, [c.id], clesPasser.get(c.famille) ?? [], clesEchouer.get(c.famille) ?? []);
    c.verdict = v[c.id];
  }
  // Scan PII : goldens + scripts du replayer (memes regles que le gate M08).
  // Le rapport lui-meme n'est PAS balaye, pour deux raisons constatees :
  // (1) les empreintes sha256 qu'il porte contiennent inevitablement des
  // plages de chiffres qui ressemblent a des telephones (faux positifs
  // mecaniques) ; (2) les lignes des harnesses y recopient des valeurs de
  // fixtures synthetiques (faux registres en monde clos) que le contrat
  // PII du gate ne couvre pas non plus. Le rapport ne porte par
  // construction que hashes/ids/verdicts/metriques (garanti par
  // valider-replay.mjs, jamais de texte libre patient).
  const corpus = new Set();
  try {
    const doc = JSON.parse(readFileSync(join(RACINE, "tests/eval/knowledge.golden.json"), "utf8"));
    for (const s of (doc.$meta ?? {}).sources ?? []) if (s.id) corpus.add(s.id);
  } catch { /* corpus vide : scan strict, jamais assoupli en silence */ }
  const ciblesPii = GOLDENS.map((g) => ({ nom: g.fichier, brut: readFileSync(join(RACINE, g.fichier), "utf8"), corpusIds: [...corpus] }));
  ciblesPii.push({ nom: "scripts/replay-golden.mjs", brut: readFileSync(join(RACINE, "scripts/replay-golden.mjs"), "utf8"), corpusIds: [] });
  ciblesPii.push({ nom: "scripts/replay-preuve.mjs", brut: readFileSync(join(RACINE, "scripts/replay-preuve.mjs"), "utf8"), corpusIds: [] });
  ciblesPii.push({ nom: "scripts/valider-replay.mjs", brut: readFileSync(join(RACINE, "scripts/valider-replay.mjs"), "utf8"), corpusIds: [] });
  ciblesPii.push({ nom: "scripts/eval-knowledge-db.mjs", brut: readFileSync(join(RACINE, "scripts/eval-knowledge-db.mjs"), "utf8"), corpusIds: [] });
  ciblesPii.push({ nom: "scripts/ingerer-replay.mjs", brut: readFileSync(join(RACINE, "scripts/ingerer-replay.mjs"), "utf8"), corpusIds: [] });
  const trouvailles = balayerPii(ciblesPii);
  suites.push(enregistrementSuite({ nom: "scan-pii", statut: trouvailles.length === 0 ? "PASS" : "FAIL", passer: trouvailles.length === 0 ? ciblesPii.map((c) => c.nom) : [], echouer: trouvailles.slice(0, 20), detail: "goldens + scripts replayer : courriels/telephones/dossiers/UUID reels ; placeholders, corpus IDs declares et prenoms de fixtures admis" }));
  console.log(`[${suites[suites.length - 1].statut}] scan-pii`);

  const fails = suites.filter((s) => s.statut === "FAIL");
  const notRuns = suites.filter((s) => s.statut === "NOT RUN");
  const structurels = notRuns.filter((s) => !s.required_environment || ["compilateur tsc + sources"].includes(s.required_environment));
  const passN = suites.reduce((a, s) => a + s.pass_count, 0);
  const failN = suites.reduce((a, s) => a + s.fail_count, 0);
  const notRunN = suites.reduce((a, s) => a + s.not_run_count, 0);
  const verdict = fails.length > 0 ? "FAIL" : structurels.length > 0 ? "NOT RUN" : "PASS";
  rapport = {
    mission: "M09",
    kind: KIND,
    replay: true,
    live: false,
    gate_version: REPLAY_SCHEMA_VERSION,
    verdict_rule: "FAIL si un FAIL ; sinon NOT RUN si NOT RUN structurel ; sinon PASS (NOT RUN environnementaux enumeres avec motif, jamais convertis en PASS)",
    git_revision: REV,
    timestamp: new Date().toISOString(),
    duree_s: dureeS,
    verdict,
    suites,
    totaux: { suites: suites.length, PASS: passN, FAIL: failN, "NOT RUN": notRunN, cas: cas.length, cas_non_mappes: cas.filter((c) => c.verdict === "non-mappe").length },
    cas,
    provenance: prov,
    not_run_reasons: notRuns.map((s) => ({ suite: s.nom, reason: s.not_run_reason, required_environment: s.required_environment ?? null })),
    comparaison: null,
  };
}

mkdirSync(ART_DIR, { recursive: true });
const nomBase = KIND === "compare" ? `replay-compare-${REV}-${TS}` : `replay-${KIND}-${REV}-${TS}`;
writeFileSync(join(ART_DIR, `${nomBase}.json`), JSON.stringify(rapport, null, 2));
const txt = [
  "M09 REPLAY",
  `rev=${rapport.git_revision} kind=${rapport.kind} date=${rapport.timestamp} duree=${rapport.duree_s}s`,
  `goldens_hash=${rapport.provenance.goldens_hash.slice(0, 16)}… schema=${rapport.provenance.schema_version} prompts=${rapport.provenance.prompts_hash.slice(0, 16)}…`,
  ...rapport.suites.map((s) => `${s.statut.padEnd(7)} ${s.nom} pass=${s.pass_count} fail=${s.fail_count} notrun=${s.not_run_count}${s.cles_rouges.length > 0 ? ` :: ${s.cles_rouges.slice(0, 5).join(", ")}` : ""}${s.not_run_reason ? ` :: ${s.not_run_reason}` : ""}`),
  "========================",
  `PASS: ${rapport.totaux.PASS}`,
  `FAIL: ${rapport.totaux.FAIL}`,
  `NOT RUN: ${rapport.totaux["NOT RUN"]}`,
  `CAS: ${rapport.totaux.cas} (non-mappes: ${rapport.totaux.cas_non_mappes})`,
  `VERDICT: ${rapport.verdict}`,
].join("\n");
writeFileSync(join(ART_DIR, `${nomBase}.txt`), `${txt}\n`);

console.log("========================");
console.log(`PASS: ${rapport.totaux.PASS}`);
console.log(`FAIL: ${rapport.totaux.FAIL}`);
console.log(`NOT RUN: ${rapport.totaux["NOT RUN"]}`);
console.log(`CAS: ${rapport.totaux.cas} (non-mappes: ${rapport.totaux.cas_non_mappes})`);
console.log(`VERDICT: ${rapport.verdict}`);
console.log(`rapport: artifacts/${nomBase}.json`);
process.exit(rapport.verdict === "PASS" ? 0 : rapport.verdict === "FAIL" ? 1 : 2);
