/**
 * eval-golden — LA PORTE GOLDEN M08 (agregateur, deterministe, 0 reseau).
 *
 * CE QUE CETTE PORTE PROUVE
 * L'ensemble M01-M07 reste vert sur une seule commande : compilation des
 * modules evalues, typecheck, lint du perimetre M08, vitest, passes
 * eval-jarvis-* existantes (composees, jamais remplacees), bench
 * connaissance sur fixtures, validateur schema, gardes grep, integrite du
 * validateur, preuve de mutation, scan PII, rapport machine + humain.
 * Vocabulaire final strict : PASS / FAIL / NOT RUN. Exit : 0 / 1 / 2.
 *
 * REGLE DE VERDICT (arbitrage documente)
 * La mission exige PASS/FAIL/NOT RUN sans faux PASS. Les suites sont jugees
 * strictement (vert->PASS, rouge->FAIL, prerequis manquant->NOT RUN avec
 * motif). Le verdict global vaut FAIL des qu'un FAIL existe. Les NOT RUN
 * purement environnementaux (base, app, modele physique, voix humaine,
 * passes DB) sont enumeres avec motif et ne fabriquent ni PASS ni FAIL :
 * le global vaut alors PASS si et seulement si tout l'executable est vert
 * et qu'aucun NOT RUN structurel (compilateur, evaluateur absent, sortie
 * malformee, mutation non detectee) ne subsiste. Sinon NOT RUN (exit 2).
 * Chaque NOT RUN porte {reason, required_environment, suite}.
 *
 * CE QU'ELLE NE PROUVE PAS
 * Ni la qualite live d'un vrai modele (sorties pinees), ni la RLS, ni l'UI,
 * ni les passes DB/embeddings/cross-encoder (declarees NOT RUN), ni la
 * reconnaissance vocale humaine (declaree par le pipeline lui-meme).
 * Execution sequentielle volontaire : lint/eval concurrents ont deja produit
 * des rouges de contention (STATE 2026-09-08).
 *
 *   node scripts/eval-golden.mjs [--artifacts-dir artifacts]
 * PowerShell-safe : aucun shell, que des execFile node/git.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative, sep } from "node:path";

const RACINE = join(dirname(process.argv[1]), "..");
const ARG_ART = process.argv.find((a) => a.startsWith("--artifacts-dir="));
const ART_DIR = join(RACINE, ARG_ART ? ARG_ART.slice("--artifacts-dir=".length) : "artifacts");

function run(cmd, args, { timeout = 120000, cwd = RACINE } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        code: err && typeof err.code === "number" ? err.code : err ? 1 : 0,
        timedOut: Boolean(err && err.killed),
        out: String(stdout ?? ""),
        errText: String(stderr ?? "").slice(0, 2000),
        errFull: String(stderr ?? "").slice(0, 200000),
      });
    });
  });
}
const node = (args, opt) => run(process.execPath, args, opt);

const LIGNE_VERT = /^\s*vert\s*\|/gm;
const LIGNE_ROUGE = /ROUGE/gm;
const ID_ROUGE = /ROUGE\s*\|\s*([^\s|]+)/g;
function compter(out) {
  const pass = (out.match(LIGNE_VERT) ?? []).length;
  const failLines = (out.match(LIGNE_ROUGE) ?? []).length;
  const ids = [];
  for (const m of out.matchAll(ID_ROUGE)) if (!ids.includes(m[1]) && ids.length < 80) ids.push(m[1]);
  return { pass, failLines, ids };
}

const suites = [];
function push(s) {
  suites.push(s);
  const extra = s.status === "FAIL" ? ` fail=${s.fail_count}` : s.status === "NOT RUN" ? ` (${s.not_run_reason ?? "?"})` : "";
  console.log(`[${s.status}] ${s.name} pass=${s.pass_count}${extra}`);
}

async function suiteCommand({ name, cmd, args, timeout, parse, requiredFiles = [], envGate = null }) {
  for (const f of requiredFiles) {
    if (!existsSync(join(RACINE, f))) {
      push({ name, status: "FAIL", case_count: 0, pass_count: 0, fail_count: 1, not_run_count: 0, failed_case_ids: [], not_run_reason: null, detail: `evaluateur absent: ${f}` });
      return;
    }
  }
  if (envGate && envGate.absent) {
    push({ name, status: "NOT RUN", case_count: null, pass_count: 0, fail_count: 0, not_run_count: 1, failed_case_ids: [], not_run_reason: envGate.reason, required_environment: envGate.required_environment, detail: null });
    return;
  }
  const r = await node(args, { timeout });
  if (r.timedOut) {
    push({ name, status: "FAIL", case_count: null, pass_count: 0, fail_count: 1, not_run_count: 0, failed_case_ids: [], not_run_reason: null, detail: `timeout ${timeout}ms` });
    return;
  }
  const c = compter(r.out);
  const p = parse ? parse(r.out, r.code, c, r.errFull) : null;
  const fail = p?.fail_count ?? (r.code === 0 ? 0 : Math.max(c.failLines, 1));
  let pass = p?.pass_count ?? c.pass;
  let cases = p?.case_count ?? (pass + fail || null);
  const status = fail > 0 || r.code === 1 ? "FAIL" : r.code === 0 ? "PASS" : "FAIL";
  // Suites binaires (typecheck/lint) : un succes sans compteur vaut 1/1, jamais 0/0.
  if (status === "PASS" && pass === 0 && fail === 0) { pass = 1; cases = cases ?? 1; }
  push({
    name, status,
    case_count: cases,
    pass_count: pass, fail_count: status === "FAIL" ? fail : 0, not_run_count: 0,
    failed_case_ids: status === "FAIL" ? (p?.failed_case_ids ?? c.ids) : [],
    not_run_reason: null,
    detail: [p?.detail, r.code !== 0 ? `exit=${r.code}` : null, r.code !== 0 ? `out: ${(r.out.match(/error[^\n]*/gi) ?? []).slice(0, 5).join(" / ").slice(0, 600) || r.out.slice(-400)}` : null, r.errText && r.code !== 0 ? `stderr: ${r.errText.slice(0, 300)}` : null].filter(Boolean).join(" | ") || null,
  });
}

// Reecriture des alias "@/" (meme algorithme que checkpoint-jarvis-couche.sh).
function reecrireAlias(racineOut) {
  (function marcher(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) { marcher(p); continue; }
      if (!p.endsWith(".js")) continue;
      const s = readFileSync(p, "utf8");
      if (!s.includes("\"@/")) continue;
      const rel = relative(racineOut, d);
      const pre = rel === "" ? "./" : "../".repeat(rel.split(sep).length);
      writeFileSync(p, s.split("\"@/").join("\"" + pre));
    }
  })(racineOut);
  writeFileSync(join(racineOut, "package.json"), JSON.stringify({ type: "commonjs" }) + "\n");
}

// ─── Gardes grep (miroir JS des controles checkpoint, commentaires exclus) ──
function lignesCode(chemin) {
  return readFileSync(chemin, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
}
function fichiersSrc() {
  const out = [];
  (function marcher(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "graphify-out") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!p.includes("node_modules") && !p.startsWith(join(RACINE, ".eval-out"))) marcher(p); }
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
  })(join(RACINE, "src"));
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
console.log("M08 GOLDEN GATE — collecte");
const t0 = Date.now();

// 0 · sonde d'environnement
const gitRev = (await run("git", ["rev-parse", "--short", "HEAD"])).out.trim() || "inconnu";
const sales = (await run("git", ["rev-parse", "--is-shallow-repository"])).out.trim();
const diffN = (await run("git", ["status", "--short"])).out.split("\n").filter((l) => l.trim() !== "").length;
const REV = `${gitRev}${diffN > 0 ? "-dirty" : ""}`;
const AVOIR_DB = Boolean(process.env.MINDCARE_TEST_DATABASE_URL);
console.log(`rev=${REV} (fichiers modifies/ajoutes: ${diffN}) node=${process.version} db=${AVOIR_DB ? "presente" : "absente"}`);

// 1 · compilations (Portes : un echec rend les evals dependantes NOT RUN-structurelles)
let compileOk = true;
for (const [nom, argv, timeout] of [
  ["compile-intentions", ["node_modules/typescript/bin/tsc", "-p", ".eval-intentions-tsconfig.json"], 240000],
  ["compile-services", ["node_modules/typescript/bin/tsc", "-p", ".eval-tsconfig.json"], 300000],
]) {
  const r = await node(argv, { timeout });
  const ok = r.code === 0;
  if (!ok) compileOk = false;
  push({ name: nom, status: ok ? "PASS" : "FAIL", case_count: null, pass_count: ok ? 1 : 0, fail_count: ok ? 0 : 1, not_run_count: 0, failed_case_ids: [], not_run_reason: null, detail: ok ? null : `exit=${r.code} ${(r.out + r.errText).slice(0, 500)}` });
}
try {
  await node(["scripts/reecrire-alias-eval.mjs", ".eval-out/intentions"], { timeout: 60000 });
  reecrireAlias(join(RACINE, ".eval-out"));
  const r = await node(["node_modules/typescript/bin/tsc", "src/shared/jarvis/normalisation.ts", "--outDir", ".eval-out/frontiere", "--module", "commonjs", "--target", "es2022", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--noEmitOnError"], { timeout: 240000 });
  // La passe frontiere ecrase sa sortie avant de compiler (anti-repli sur .js d'hier).
  if (r.code !== 0) compileOk = false;
  push({ name: "compile-frontiere", status: r.code === 0 ? "PASS" : "FAIL", case_count: null, pass_count: r.code === 0 ? 1 : 0, fail_count: r.code === 0 ? 0 : 1, not_run_count: 0, failed_case_ids: [], not_run_reason: null, detail: r.code === 0 ? null : `exit=${r.code}` });
} catch (e) {
  compileOk = false;
  push({ name: "compile-frontiere", status: "FAIL", case_count: null, pass_count: 0, fail_count: 1, not_run_count: 0, failed_case_ids: [], not_run_reason: null, detail: String(e).slice(0, 300) });
}

// 2 · typecheck (2 passes) + lint du perimetre M08
await suiteCommand({ name: "typecheck", cmd: "node", args: ["node_modules/typescript/bin/tsc", "--noEmit"], timeout: 300000 });
await suiteCommand({ name: "typecheck-tests", cmd: "node", args: ["node_modules/typescript/bin/tsc", "-p", "tsconfig.test.json"], timeout: 300000 });
await suiteCommand({ name: "lint-m08", cmd: "node", args: ["node_modules/eslint/bin/eslint.js", "scripts/valider-golden.mjs", "scripts/eval-golden.mjs"], timeout: 180000 });

// 3 · vitest (les integrations s'ignorent sans base : declare NOT RUN a part)
await suiteCommand({
  name: "vitest", cmd: "node", args: ["node_modules/vitest/vitest.mjs", "run"], timeout: 600000,
  parse: (out, code, c, errFull) => {
    const tout = `${out}\n${errFull ?? ""}`.replace(/\u001b\[[0-9;]*m/g, "");
    const mf = tout.match(/Test Files\s+(\d+) passed/);
    const mt = tout.match(/Tests\s+(\d+) passed/);
    const mfs = tout.match(/(\d+) skipped/);
    const mfl = tout.match(/(\d+) failed/);
    const fails = mfl ? Number(mfl[1]) : code === 0 ? 0 : Math.max(c.failLines, 1);
    return { pass_count: mt ? Number(mt[1]) : c.pass, fail_count: fails, case_count: mt ? Number(mt[1]) : null, detail: mf ? `fichiers=${mf[1]}${mfs ? ` ignores=${mfs[1]}` : ""}` : "resume vitest illisible" };
  },
});
push({ name: "vitest-integration", status: AVOIR_DB ? "PASS" : "NOT RUN", case_count: null, pass_count: 0, fail_count: 0, not_run_count: 5, failed_case_ids: [], not_run_reason: AVOIR_DB ? null : "MINDCARE_TEST_DATABASE_URL absente", required_environment: "MINDCARE_TEST_DATABASE_URL", detail: AVOIR_DB ? "base presente : incluse dans vitest" : "5 suites exigeant une vraie base (jamais simulees)" });

// 4 · passes eval (dependantes de la compilation)
const SVC = ".eval-out/services";
const FRONT = ".eval-out/frontiere";
const EVALS = [
  ["eval-frontiere", ["scripts/eval-jarvis-frontiere.mjs", SVC], 120000],
  ["eval-boucle", ["scripts/eval-jarvis-boucle.mjs", SVC], 120000],
  ["eval-chaine", ["scripts/eval-jarvis-chaine.mjs", SVC], 120000],
  ["eval-ecritures", ["scripts/eval-jarvis-ecritures.mjs", SVC], 120000],
  ["eval-briefs", ["scripts/eval-jarvis-briefs.mjs", SVC], 120000],
  ["eval-reveil", ["scripts/eval-jarvis-reveil.mjs", SVC], 120000],
  ["eval-micro-partage", ["scripts/eval-micro-partage.mjs", SVC], 120000],
  ["eval-endpointage", ["scripts/eval-endpointage.mjs", SVC], 120000],
  ["eval-machine-voix", ["scripts/eval-machine-voix.mjs", SVC], 120000],
  ["eval-lecture-voix", ["scripts/eval-lecture-voix.mjs", SVC], 120000],
  ["eval-registre", ["scripts/eval-jarvis-registre.mjs", SVC], 120000],
  ["eval-sans-suppression", ["scripts/eval-registre-sans-suppression.mjs", SVC], 120000],
  ["eval-injection", ["scripts/eval-jarvis-injection.mjs", `${FRONT}/routing.js`], 120000],
  ["eval-routage", ["scripts/eval-jarvis-routage.mjs", FRONT], 120000],
  ["eval-v2", ["scripts/eval-jarvis-v2.mjs", `${FRONT}/routing.js`], 120000],
  ["eval-intentions", ["scripts/eval-jarvis-intentions.mjs", ".eval-out/intentions", FRONT], 120000],
  ["eval-conversation", ["scripts/eval-jarvis-conversation.mjs", ".eval-out"], 180000],
  ["eval-knowledge-fixture", ["scripts/eval-knowledge-retrieval.mjs", ".eval-out"], 180000],
  ["eval-reveil-pipeline", ["scripts/eval-reveil-pipeline.mjs", "alexa.onnx"], 300000],
];
if (!compileOk) {
  for (const [nom] of EVALS.filter(([n]) => n !== "eval-reveil-pipeline"))
    push({ name: nom, status: "NOT RUN", case_count: null, pass_count: 0, fail_count: 0, not_run_count: 1, failed_case_ids: [], not_run_reason: "compilation en echec (structurel)", required_environment: "compilateur tsc + sources", detail: null });
  await suiteCommand({ name: "eval-reveil-pipeline", cmd: "node", args: ["scripts/eval-reveil-pipeline.mjs", "alexa.onnx"], timeout: 300000 });
} else {
  for (const [nom, argv, timeout] of EVALS) {
    await suiteCommand({
      name: nom, cmd: "node", args: argv, timeout,
      requiredFiles: [argv[0]],
      parse: nom === "eval-reveil-pipeline"
        ? (out, code, c) => ({ pass_count: c.pass, fail_count: code === 0 ? 0 : Math.max(c.failLines, 1), detail: "voix humaine : NON MESUREE par la passe elle-meme (plumbing 11/11)" })
        : nom === "eval-knowledge-fixture"
          ? (out, code, c) => {
            const m = out.match(/Recall@5\s+hybride=([0-9.]+%)/);
            return { pass_count: c.pass, fail_count: code === 0 ? 0 : Math.max(c.failLines, 1), detail: m ? `recall@5-hybride(proxy lexical)=${m[1]} ; portes SQL + embeddings reels + cross-encoder : NOT RUN` : "portes SQL + embeddings reels + cross-encoder : NOT RUN" };
          }
          : null,
    });
  }
}
push({ name: "eval-contexte-seance", status: "NOT RUN", case_count: null, pass_count: 0, fail_count: 0, not_run_count: 1, failed_case_ids: [], not_run_reason: "source supabase/functions/_shared/contexte-seance.ts absente (pre-existant)", required_environment: "source vivante src/server/jarvis/ (re-cablage hors perimetre M08)", detail: null });
push({ name: "eval-resume-cas", status: "NOT RUN", case_count: null, pass_count: 0, fail_count: 0, not_run_count: 1, failed_case_ids: [], not_run_reason: "source supabase/functions/_shared/resume-cas.ts absente (pre-existant)", required_environment: "source vivante src/server/jarvis/resume-cas.ts (re-cablage hors perimetre M08)", detail: null });
push({ name: "eval-knowledge-db", status: "NOT RUN", case_count: null, pass_count: 0, fail_count: 0, not_run_count: 1, failed_case_ids: [], not_run_reason: "migration 092 + embeddings reels + cross-encoder non deployes ici (M07 en cours)", required_environment: "base M07 + porte embeddings + cross-encoder local", detail: null });
push({ name: "live-model-quality", status: "NOT RUN", case_count: null, pass_count: 0, fail_count: 0, not_run_count: 1, failed_case_ids: [], not_run_reason: "aucun modele pine/disponible pour la qualite live (variance free-tier 5s-180s)", required_environment: "modele pine ou runtime local M13", detail: null });
push({ name: "e2e", status: "NOT RUN", case_count: null, pass_count: 0, fail_count: 0, not_run_count: 19, failed_case_ids: [], not_run_reason: "exigent pnpm start + /api/health ; la porte ne lance pas de serveurs", required_environment: "app demarree + base locale", detail: null });

// 5 · validateur schema
await suiteCommand({
  name: "schema-golden", cmd: "node", args: ["scripts/valider-golden.mjs"], timeout: 120000,
  requiredFiles: ["scripts/valider-golden.mjs", "tests/eval/golden-schema.json"],
  parse: (out, code, c) => {
    const m = out.match(/VERT \((\d+) fichiers, (\d+) cas\)/);
    return { pass_count: m ? Number(m[2]) : c.pass, fail_count: code === 0 ? 0 : Math.max(c.failLines, 1), case_count: m ? Number(m[2]) : null, detail: m ? `${m[1]} fichiers` : null };
  },
});

// 6 · gardes grep (miroir checkpoint)
(function gardes() {
  const srcs = fichiersSrc();
  const norm = (p) => relative(RACINE, p).split(sep).join("/");
  const lire = (p) => lignesCode(p).join("\n");
  // modeles hors passerelle (commentaires exclus, passerelle exclue)
  const modeles = [];
  for (const f of srcs) {
    if (norm(f) === "src/server/egress/external-call.ts") continue;
    const rel = relative(join(RACINE, "src"), f).split(sep).join("/");
    for (const [i, l] of lignesCode(f).entries())
      if (/nemotron|gemini-2\.5|gpt-4|claude-3/.test(l)) modeles.push(`${rel}:${i + 1}`);
  }
  push({ name: "garde-modeles", status: modeles.length === 0 ? "PASS" : "FAIL", case_count: 1, pass_count: modeles.length === 0 ? 1 : 0, fail_count: modeles.length === 0 ? 0 : 1, not_run_count: 0, failed_case_ids: modeles.slice(0, 20), not_run_reason: null, detail: modeles.length === 0 ? "bascule = configuration" : "couplage hors passerelle" });
  // executerAction : un seul chemin (jarvis-execution <- jarvis-tools)
  const appels = [];
  for (const f of srcs) {
    const rel = norm(f);
    if (rel === "src/services/jarvis-execution.ts" || rel === "src/services/jarvis-tools.ts") continue;
    for (const [i, l] of lignesCode(f).entries()) if (/executerAction\(/.test(l)) appels.push(`${rel}:${i + 1}`);
  }
  push({ name: "garde-chemin-execution", status: appels.length === 0 ? "PASS" : "FAIL", case_count: 1, pass_count: appels.length === 0 ? 1 : 0, fail_count: appels.length === 0 ? 0 : 1, not_run_count: 0, failed_case_ids: appels.slice(0, 20), not_run_reason: null, detail: appels.length === 0 ? "executerAction <- jarvis-execution" : "second chemin d ecriture" });
  // porte execute : seule jarvis-tools.ts l'invoque (+ allowlist nomme seulement)
  const portes = [];
  for (const f of srcs) {
    const rel = norm(f);
    if (rel === "src/services/jarvis-tools.ts" || rel === "src/server/db/allowlist.generated.ts") continue;
    for (const [i, l] of lignesCode(f).entries()) if (/execute_jarvis_action/.test(l)) portes.push(`${rel}:${i + 1}`);
  }
  push({ name: "garde-porte-execute", status: portes.length === 0 ? "PASS" : "FAIL", case_count: 1, pass_count: portes.length === 0 ? 1 : 0, fail_count: portes.length === 0 ? 0 : 1, not_run_count: 0, failed_case_ids: portes.slice(0, 20), not_run_reason: null, detail: portes.length === 0 ? "seule jarvis-tools.ts l invoque" : "appel direct a la base" });
  // boucle ignore le registre d'ecriture ; 3 portes dans jarvis-tools
  const boucle = lire(join(RACINE, "src/services/jarvis-boucle.ts"));
  const outils = lire(join(RACINE, "src/services/jarvis-tools.ts"));
  const sansEcritures = !/jarvis-ecritures/.test(boucle);
  push({ name: "garde-boucle-sans-ecritures", status: sansEcritures ? "PASS" : "FAIL", case_count: 1, pass_count: sansEcritures ? 1 : 0, fail_count: sansEcritures ? 0 : 1, not_run_count: 0, failed_case_ids: [], not_run_reason: null, detail: sansEcritures ? "aucun import — aucun chemin d appel" : "IMPORT TROUVE" });
  const trois = ["propose_jarvis_action", "confirm_jarvis_action", "execute_jarvis_action"].every((p) => outils.includes(p));
  push({ name: "garde-trois-portes", status: trois ? "PASS" : "FAIL", case_count: 1, pass_count: trois ? 1 : 0, fail_count: trois ? 0 : 1, not_run_count: 0, failed_case_ids: [], not_run_reason: null, detail: trois ? "propose · confirm · execute" : "une porte manque" });
  // secrets : grep reel du build s'il existe, sinon NOT RUN honnete
  const statique = join(RACINE, ".next/static");
  if (existsSync(statique)) {
    const RXS = /OPENROUTER|GROQ|ELEVENLABS|SEEKAI/;
    let fichiers = 0;
    const touches = [];
    (function marcher(d) {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) { marcher(p); continue; }
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.size > 5 * 1024 * 1024) continue;
        fichiers += 1;
        let s;
        try { s = readFileSync(p, "latin1"); } catch { continue; }
        if (RXS.test(s) && touches.length < 10) touches.push(relative(RACINE, p).split(sep).join("/"));
      }
    })(statique);
    push({ name: "garde-secrets-build", status: touches.length === 0 ? "PASS" : "FAIL", case_count: 1, pass_count: touches.length === 0 ? 1 : 0, fail_count: touches.length === 0 ? 0 : 1, not_run_count: 0, failed_case_ids: touches, not_run_reason: null, detail: touches.length === 0 ? `${fichiers} fichiers .next/static : 0 occurrence` : "CLE FOURNISSEUR DANS LE BUNDLE" });
  } else {
    push({ name: "garde-secrets-build", status: "NOT RUN", case_count: null, pass_count: 0, fail_count: 0, not_run_count: 1, failed_case_ids: [], not_run_reason: "pas de build .next/static (la porte ne construit pas)", required_environment: "build next", detail: null });
  }
})();

// 7 · integrite du validateur (controles negatifs + positif, goldens temporaires)
await (async function integriteValidateur() {
  const dir = mkdtempSync(join(tmpdir(), "m08-schema-"));
  const cas = (m) => ({ id: "T-01", input: "x", langue: "FR", categorie: "t", sortieModele: null, attendu: { statut: "ecarte", raison: "indisponible", intent: null, patientMention: null, missingInformation: [], pronomSansAntecedent: false, homonymePossible: false, outil: null, clarification: false, refus: false, ...m } });
  const casse = {
    "neg-malforme": "{ pas du json",
    "neg-sans-id": JSON.stringify({ cas: [{ input: "x" }] }),
    "neg-champ-inconnu": JSON.stringify({ cas: [{ ...cas({}), champInventé: 1 }] }),
    "neg-duplicat": JSON.stringify({ cas: [{ ...cas({}), id: "D" }, { ...cas({}), id: "D" }] }),
    "neg-enum": JSON.stringify({ cas: [{ ...cas({}), attendu: { ...cas({}).attendu, statut: "peut-etre" } }] }),
    "pos-valide": JSON.stringify({ _doc: "t", cas: [{ ...cas({}) }] }),
  };
  let ok = 0;
  const problemes = [];
  for (const [nom, contenu] of Object.entries(casse)) {
    const f = join(dir, `${nom}.json`);
    writeFileSync(f, typeof contenu === "string" && nom === "neg-malforme" ? contenu : contenu);
    // renommer en famille intentions pour detection
    const ff = join(dir, `jarvis-intentions-${nom}.json`);
    writeFileSync(ff, readFileSync(f, "utf8"));
    const r = await node(["scripts/valider-golden.mjs", ff], { timeout: 60000 });
    const veutEchec = nom.startsWith("neg-");
    const bon = veutEchec ? r.code !== 0 : r.code === 0;
    if (bon) ok += 1;
    else problemes.push(nom);
  }
  push({ name: "integrite-validateur", status: problemes.length === 0 ? "PASS" : "FAIL", case_count: 6, pass_count: ok, fail_count: problemes.length, not_run_count: 0, failed_case_ids: problemes, not_run_reason: null, detail: "5 negatifs doivent FAIL + 1 positif PASS" });
})();

// 8 · preuve de mutation (copie temporaire, baseline jamais touchee)
await (async function mutation() {
  const dir = mkdtempSync(join(tmpdir(), "m08-mut-"));
  const src = readFileSync(join(RACINE, "tests/eval/jarvis-intentions.golden.json"), "utf8");
  const doc = JSON.parse(src);
  const cible = doc.cas.find((c) => c.id === "M01-01");
  cible.attendu.intent = "GET_TODAY_AGENDA";
  cible.attendu.outil = "get_today_agenda";
  const f = join(dir, "jarvis-intentions.mute.json");
  writeFileSync(f, JSON.stringify(doc));
  const r = await node(["scripts/eval-jarvis-intentions.mjs", ".eval-out/intentions", ".eval-out/frontiere", f], { timeout: 120000 });
  const detecte = r.code !== 0 && r.out.includes("M01-01");
  push({ name: "preuve-mutation", status: detecte ? "PASS" : "FAIL", case_count: 1, pass_count: detecte ? 1 : 0, fail_count: detecte ? 0 : 1, not_run_count: 0, failed_case_ids: detecte ? [] : ["M01-01-non-detecte"], not_run_reason: null, detail: "M01-01 mutee GET_NEXT_PATIENT->GET_TODAY_AGENDA : la porte doit FAIL en citant M01-01" });
})();

// 9 · scan PII (identifiants directs ; corpus IDs declares + placeholders admis)
// REGLE : courriel/telephone/dossier = FAIL partout. UUID reel = FAIL sauf
// (a) placeholders synthetiques (uuid-, 00000000-, 11111111-, 22222222-,
// 33333333-, 123e4567- sonde M01-38) et (b) IDs de corpus declares dans le
// $meta du meme fichier (sources de connaissance, pas des patients).
(function pii() {
  const cibles = readdirSync(join(RACINE, "tests/eval")).filter((f) => f.endsWith(".json")).map((f) => join("tests/eval", f));
  cibles.push("scripts/valider-golden.mjs", "scripts/eval-golden.mjs");
  const trouvailles = [];
  const UUID_OK = /^(uuid-|00000000-|11111111-|22222222-|33333333-|123e4567-)/i;
  const RX_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  const REGLES = [
    ["courriel", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
    ["telephone", /(\+213|0)(5|6|7)\d{8}/],
    ["fixe", /(\+213|0)(2|3|4)\d{7,8}/],
    ["dossier", /P-\d{3,}/],
  ];
  for (const rel of cibles) {
    const brut = readFileSync(join(RACINE, rel), "utf8");
    let corpus = new Set();
    try {
      const doc = JSON.parse(brut);
      corpus = new Set(((doc.$meta ?? {}).sources ?? []).map((s) => s.id).filter((x) => typeof x === "string"));
    } catch { /* non-JSON : regex seules */ }
    for (const [nom, rx] of REGLES) {
      const m = brut.match(rx);
      if (m) trouvailles.push(`${rel}: ${nom} ${m[0].slice(0, 12)}…`);
    }
    for (const m of brut.matchAll(RX_UUID))
      if (!UUID_OK.test(m[0]) && !corpus.has(m[0].toLowerCase()) && ![...corpus].some((id) => id.toLowerCase() === m[0].toLowerCase())) trouvailles.push(`${rel}: uuid-reel ${m[0].slice(0, 13)}…`);
  }
  push({ name: "scan-pii", status: trouvailles.length === 0 ? "PASS" : "FAIL", case_count: cibles.length, pass_count: trouvailles.length === 0 ? cibles.length : 0, fail_count: trouvailles.length, not_run_count: 0, failed_case_ids: trouvailles.slice(0, 20), not_run_reason: null, detail: "courriels/telephones/dossiers/UUID reels ; placeholders, corpus IDs declares et prenoms de fixtures admis (synthetiques, ids fictifs)" });
})();

// ═══════════════════════════════════════════════════════════════════════
// Agregation + rapports
const fails = suites.filter((s) => s.status === "FAIL");
const notRuns = suites.filter((s) => s.status === "NOT RUN");
const structurels = notRuns.filter((s) => !s.required_environment || ["compilateur tsc + sources"].includes(s.required_environment));
const passN = suites.reduce((a, s) => a + s.pass_count, 0);
const failN = suites.reduce((a, s) => a + s.fail_count, 0);
const notRunN = suites.reduce((a, s) => a + s.not_run_count, 0);
const verdict = fails.length > 0 ? "FAIL" : structurels.length > 0 ? "NOT RUN" : "PASS";
const EXIT = verdict === "PASS" ? 0 : verdict === "FAIL" ? 1 : 2;

function couverture() {
  const lire = (f) => JSON.parse(readFileSync(join(RACINE, f), "utf8"));
  const int = lire("tests/eval/jarvis-intentions.golden.json").cas;
  const conv = lire("tests/eval/jarvis-conversation.golden.json").scripts;
  const kno = lire("tests/eval/knowledge.golden.json").cas;
  const parCat = {};
  for (const c of int) parCat[`intentions/${c.categorie}`] = (parCat[`intentions/${c.categorie}`] ?? 0) + 1;
  for (const s of conv) parCat[`conversation/${s.id}`] = (s.tours ?? []).length;
  const langues = {};
  for (const c of [...int.map((c) => ({ l: c.langue })), ...kno.map((c) => ({ l: c.langue }))])
    langues[c.l] = (langues[c.l] ?? 0) + 1;
  return {
    categories: parCat,
    langues,
    securite: ["eval-frontiere (49)", "eval-injection (scenario M)", "vitest jarvis-egress-* (71)", "conversation H (injection-donnee) + I (porte-de-fil)", "gardes grep (modeles/chemin/porte/boucle/portes)"],
    rag: ["eval-knowledge-fixture (46 cas : recall/precision/MRR/nDCG/reranker-gain/citation/version/dose)", "NOT RUN : portes SQL 092 + embeddings reels + cross-encoder"],
    failure_honesty: ["eval-ecritures (scenario N : echec avoue)", "conversation K (panne sonde -> indisponible)", "intentions ecarte (invalide/indisponible/confiance-basse)", "vitest jarvis-response-guard + jarvis-execution"],
    grounding: ["knowledge NA-* (sans-reponse exigee) + GV-* (gouvernance exclue)", "conversation C/M (zero-resultat -> clarification nommee)", "NOT RUN : qualite live"],
  };
}

const rapport = {
  mission: "M08-B",
  gate: "pnpm eval:golden",
  gate_version: "m08-gate-v1",
  verdict_rule: "FAIL si un FAIL ; sinon NOT RUN si NOT RUN structurel ; sinon PASS (NOT RUN environnementaux enumeres avec motif, jamais convertis en PASS)",
  git_revision: REV,
  timestamp: new Date().toISOString(),
  verdict,
  duree_s: Math.round((Date.now() - t0) / 1000),
  suites,
  totaux: { suites: suites.length, PASS: passN, FAIL: failN, "NOT RUN": notRunN },
  ...couverture(),
  environment_requirements: ["node>=20", "tsc+eslint+vitest locaux", "MINDCARE_TEST_DATABASE_URL (integration)", "app demarree (e2e)", "modeles ONNX public/wakeword (pipeline)", "base M07 + embeddings + cross-encoder (retrieval DB)", "modele pine (qualite live)"],
  not_run_reasons: notRuns.map((s) => ({ suite: s.name, reason: s.not_run_reason, required_environment: s.required_environment ?? null })),
  mutation_proof: suites.find((s) => s.name === "preuve-mutation")?.status ?? "ABSENTE",
  pii_scan: suites.find((s) => s.name === "scan-pii")?.status ?? "ABSENT",
  schema_validation: suites.find((s) => s.name === "schema-golden")?.status ?? "ABSENTE",
  gate_integrity: suites.find((s) => s.name === "integrite-validateur")?.status ?? "ABSENTE",
  suite_versions: { goldens_hash: "voir git", schema: SCHEMA_VERSION() },
};
function SCHEMA_VERSION() {
  try {
    return JSON.parse(readFileSync(join(RACINE, "tests/eval/golden-schema.json"), "utf8")).version;
  } catch { return "illisible"; }
}

mkdirSync(ART_DIR, { recursive: true });
writeFileSync(join(ART_DIR, `m08-gate-${REV}.json`), JSON.stringify(rapport, null, 2));
const txt = [
  "M08 GOLDEN GATE",
  `rev=${REV} date=${rapport.timestamp} duree=${rapport.duree_s}s`,
  ...suites.map((s) => `${s.status.padEnd(7)} ${s.name} pass=${s.pass_count} fail=${s.fail_count} notrun=${s.not_run_count}${s.failed_case_ids.length > 0 ? ` :: ${s.failed_case_ids.slice(0, 5).join(", ")}` : ""}${s.not_run_reason ? ` :: ${s.not_run_reason}` : ""}`),
  "========================",
  `PASS: ${passN}`,
  `FAIL: ${failN}`,
  `NOT RUN: ${notRunN}`,
  `VERDICT: ${verdict}`,
].join("\n");
writeFileSync(join(ART_DIR, `m08-gate-${REV}.txt`), txt + "\n");

console.log("========================");
console.log(`PASS: ${passN}`);
console.log(`FAIL: ${failN}`);
console.log(`NOT RUN: ${notRunN}`);
console.log(`VERDICT: ${verdict}`);
process.exit(EXIT);
