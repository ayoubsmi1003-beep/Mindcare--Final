/**
 * Masked summary of a C200 run: counts by domain and verdict, failure reasons, timings. It never prints an answer,
 * a patient identity or a passage. Several result files can be merged: later files replace earlier ones case by case.
 *   node tests/eval/alexa-clinical-conversational/v1/report-c200.mjs <label> [<label>...]
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const labels = process.argv.slice(2);
if (!labels.length) { console.error("usage: report-c200.mjs <label> [<label>...]"); process.exit(1); }

const cases = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "cases.json"), "utf8")).cases;
const byId = new Map(cases.map((item) => [item.id, item]));
const turns = new Map(); // caseId -> [turn rows]
for (const label of labels) {
  const file = join(root, ".eval-out", "alexa-c200", `results-${label}.jsonl`);
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
const table = {}, reasons = {}, times = [];
let notRun = 0;
for (const item of cases) {
  const rows = turns.get(item.id);
  const domain = table[item.domain] ??= { PASS: 0, FAIL: 0, "NOT VERIFIED": 0, BLOCKED: 0, "NOT RUN": 0, turnsPass: 0, turns: 0 };
  if (!rows || rows.length < item.turns.length) { domain["NOT RUN"]++; notRun++; continue; }
  domain[rollUp(rows.map((row) => row.verdict))]++;
  for (const row of rows) {
    domain.turns++; if (row.verdict === "PASS") domain.turnsPass++;
    times.push(row.ms);
    for (const reason of row.reasons) { const key = `${item.domain}:${reason.replace(/:.*/u, "")}`; reasons[key] = (reasons[key] ?? 0) + 1; }
  }
}
const total = { PASS: 0, FAIL: 0, "NOT VERIFIED": 0, BLOCKED: 0, "NOT RUN": 0 };
for (const domain of Object.values(table)) for (const key of Object.keys(total)) total[key] += domain[key];
times.sort((a, b) => a - b);
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "-");
console.log(`C200 results (${labels.join(" + ")}): ${JSON.stringify(total)}`);
for (const [name, d] of Object.entries(table)) console.log(`  ${name.padEnd(10)} PASS ${d.PASS} / FAIL ${d.FAIL} / NV ${d["NOT VERIFIED"]} / BLOCKED ${d.BLOCKED} / NOT RUN ${d["NOT RUN"]}   (turns ${d.turnsPass}/${d.turns} = ${pct(d.turnsPass, d.turns)})`);
if (times.length) console.log(`timing per turn: p50 ${(times[Math.floor(times.length / 2)] / 1000).toFixed(1)} s, p95 ${(times[Math.floor(times.length * 0.95)] / 1000).toFixed(1)} s, max ${(times.at(-1) / 1000).toFixed(0)} s`);
console.log("failure reasons (turns):");
for (const [key, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(3)}  ${key}`);
const failing = [...turns].filter(([, rows]) => rows.some((row) => row.verdict !== "PASS")).map(([id, rows]) => `${id}${rows.length > 1 ? `#${rows.filter((r) => r.verdict !== "PASS").map((r) => r.turn).join("/")}` : ""}`);
console.log(`not passing: ${failing.join(" ")}`);
void byId;
