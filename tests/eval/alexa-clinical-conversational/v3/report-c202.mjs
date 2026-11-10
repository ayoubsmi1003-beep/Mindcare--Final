/**
 * Masked summary of a C202 run: PASS / FAIL / BLOCKED overall, by domain, by language, by formulation type; book evidence quality;
 * latency; and every failing turn with its exact reasons. It never prints an answer, a patient identity or a passage.
 *   node tests/eval/alexa-clinical-conversational/v3/report-c202.mjs <label> [<label>...] [--holdout]
 * Several result files can be merged: later files replace earlier ones case by case.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const args = process.argv.slice(2), holdout = args.includes("--holdout");
const labels = args.filter((arg) => !arg.startsWith("--"));
if (!labels.length) { console.error("usage: report-c202.mjs <label> [<label>...] [--holdout]"); process.exit(1); }

const spec = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), holdout ? "holdout.json" : "cases.json"), "utf8")).cases;
const turns = new Map();
for (const label of labels) {
  const file = join(root, ".eval-out", "alexa-c202", `results-${label}.jsonl`);
  if (!existsSync(file)) { console.error(`missing ${file}`); continue; }
  const fresh = new Map();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (row.rollup || row.turn === undefined) continue;
    if (!fresh.has(row.caseId)) fresh.set(row.caseId, []);
    fresh.get(row.caseId).push(row);
  }
  for (const [id, rows] of fresh) turns.set(id, rows);
}

const rollUp = (verdicts) => verdicts.includes("FAIL") ? "FAIL" : verdicts.includes("BLOCKED") ? "BLOCKED" : verdicts.includes("NOT VERIFIED") ? "NOT VERIFIED" : "PASS";
const empty = () => ({ PASS: 0, FAIL: 0, BLOCKED: 0, "NOT VERIFIED": 0, "NOT RUN": 0 });
const caseRows = empty(), byDomain = {}, byLang = {}, byForm = {}, reasons = {}, times = [];
const bump = (table, key, verdict) => { (table[key] ??= empty())[verdict]++; };
const fidelity = { shown: 0, verbatim: 0, answering: 0, pageOk: 0, pageChecked: 0, cases: 0, caseFound: 0 };
const failing = [];

for (const item of spec) {
  const rows = turns.get(item.id);
  if (!rows || rows.length < item.turns.length) { caseRows["NOT RUN"]++; bump(byDomain, item.domain, "NOT RUN"); continue; }
  const verdict = rollUp(rows.map((row) => row.verdict));
  caseRows[verdict]++; bump(byDomain, item.domain, verdict);
  for (const [index, row] of rows.entries()) {
    const turn = item.turns[index] ?? {};
    bump(byLang, turn.lang ?? "?", row.verdict); bump(byForm, turn.form ?? "?", row.verdict);
    times.push(row.ms);
    for (const reason of row.reasons) { const key = reason.replace(/:.*/u, ""); reasons[key] = (reasons[key] ?? 0) + 1; }
    for (const quote of row.quoteChecks ?? []) {
      fidelity.shown++; if (quote.verbatim) fidelity.verbatim++;
      if (quote.pageInLabel != null && quote.markerPage != null) { fidelity.pageChecked++; if (quote.pageInLabel === quote.markerPage) fidelity.pageOk++; }
    }
    if (row.verdict !== "PASS") failing.push(`${item.id}#${index + 1} [${item.domain}/${turn.lang}/${turn.form}] ${row.verdict}: ${row.reasons.join(", ")} | "${String(turn.say ?? "").slice(0, 90)}"`);
  }
  if (item.domain === "book" || (item.turns[0]?.expect?.k === "book")) { fidelity.cases++; if (verdict === "PASS") fidelity.caseFound++; }
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "-");
const line = (name, t) => `  ${name.padEnd(14)} PASS ${t.PASS} / FAIL ${t.FAIL} / BLOCKED ${t.BLOCKED} / NV ${t["NOT VERIFIED"]} / NOT RUN ${t["NOT RUN"]}`;
console.log(`C202 ${holdout ? "HOLDOUT " : ""}results (${labels.join(" + ")}), cases: ${JSON.stringify(caseRows)}`);
console.log("by domain (cases):"); for (const [k, v] of Object.entries(byDomain)) console.log(line(k, v));
console.log("by language (turns):  fr French · ar Darija Arabic script · la Darija Latin · mx mixed"); for (const [k, v] of Object.entries(byLang)) console.log(line(k, v) + `   (${pct(v.PASS, v.PASS + v.FAIL + v.BLOCKED + v["NOT VERIFIED"])} pass)`);
console.log("by formulation (turns):"); for (const [k, v] of Object.entries(byForm).sort()) console.log(line(k, v) + `   (${pct(v.PASS, v.PASS + v.FAIL + v.BLOCKED + v["NOT VERIFIED"])} pass)`);
times.sort((a, b) => a - b);
if (times.length) console.log(`latency per turn: median ${(times[Math.floor(times.length / 2)] / 1000).toFixed(1)} s, p95 ${(times[Math.floor(times.length * 0.95)] / 1000).toFixed(1)} s, worst ${(times.at(-1) / 1000).toFixed(0)} s`);
if (fidelity.shown) console.log(`book evidence: ${fidelity.caseFound}/${fidelity.cases} questions answered by the right passage; ${fidelity.shown} passages shown, ${fidelity.verbatim} word for word from an approved chunk (${pct(fidelity.verbatim, fidelity.shown)}); page of the citation agrees with the chunk marker ${fidelity.pageOk}/${fidelity.pageChecked}`);
console.log("failure reasons (turns):"); for (const [key, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${key}`);
console.log(`failing turns (${failing.length}):`); for (const entry of failing) console.log(`  ${entry}`);
