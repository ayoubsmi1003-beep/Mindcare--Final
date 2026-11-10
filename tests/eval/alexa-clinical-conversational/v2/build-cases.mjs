/**
 * Builds cases.json (the 200 main cases) and holdout.json (30 unseen reformulations) from the case files, and refuses an invalid campaign:
 * exactly 200 cases V001…V200 in the agreed distribution, unique ids, no book named in a book case, every turn tagged, and none of the
 * C200 questions repeated verbatim.
 *   node tests/eval/alexa-clinical-conversational/v2/build-cases.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cases as patient } from "./cases-patient.mjs";
import { cases as context } from "./cases-context.mjs";
import { cases as agenda } from "./cases-agenda.mjs";
import { cases as finance } from "./cases-finance.mjs";
import { cases as book } from "./cases-books.mjs";
import { cases as variation } from "./cases-variation.mjs";
import { cases as holdout } from "./cases-holdout.mjs";
import { FORMS, LANGS } from "./helpers.mjs";
import { BOOK_SOURCES } from "./book-sources.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const EXPECTED = { patient: 55, context: 45, agenda: 30, finance: 25, book: 35, variation: 10 };
const BOOK_NAMES = /\b(?:dsm|maudsley|stahl|taylor|cim|icd|livre|manuel|prescriber)\b/iu;
const norm = (text) => text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/gu, " ").trim();

export function buildCases() {
  const all = [...patient, ...context, ...agenda, ...finance, ...book, ...variation];
  const problems = [];
  const old = new Set(JSON.parse(readFileSync(join(here, "..", "v1", "cases.json"), "utf8")).cases.flatMap((item) => item.turns.map((turn) => norm(turn.say))));
  const ids = new Set();
  for (const item of [...all, ...holdout]) {
    if (ids.has(item.id)) problems.push(`duplicate id ${item.id}`);
    ids.add(item.id);
    for (const turn of item.turns) {
      if (!LANGS.includes(turn.lang)) problems.push(`${item.id}: bad lang ${turn.lang}`);
      if (!FORMS.includes(turn.form)) problems.push(`${item.id}: bad form ${turn.form}`);
      if (item.domain === "book" && BOOK_NAMES.test(turn.say)) problems.push(`${item.id}: names a book`);
      if (old.has(norm(turn.say.replace(/\{[^}]+\}/gu, "")))) problems.push(`${item.id}: repeats a C200 question`);
    }
  }
  if (all.length !== 200) problems.push(`expected 200 cases, got ${all.length}`);
  if (holdout.length !== 30) problems.push(`expected 30 holdout cases, got ${holdout.length}`);
  for (const [domain, count] of Object.entries(EXPECTED)) {
    const got = all.filter((item) => item.domain === domain).length;
    if (got !== count) problems.push(`${domain}: expected ${count}, got ${got}`);
  }
  all.forEach((item, index) => { if (item.id !== `V${String(index + 1).padStart(3, "0")}`) problems.push(`order: ${item.id} at position ${index + 1}`); });
  for (const item of book) if (!BOOK_SOURCES[item.id]) problems.push(`${item.id}: no verified source chunk`);
  return { all, holdout, problems };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { all, holdout: held, problems } = buildCases();
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  const stamp = { version: 2, campaign: "C201", frozenOn: "2026-11-10", note: "Wording written before any run; never tuned against results." };
  writeFileSync(join(here, "cases.json"), JSON.stringify({ ...stamp, cases: all }, null, 1) + "\n");
  writeFileSync(join(here, "holdout.json"), JSON.stringify({ ...stamp, set: "holdout", cases: held }, null, 1) + "\n");
  const langs = {};
  for (const item of all) for (const turn of item.turns) langs[turn.lang] = (langs[turn.lang] ?? 0) + 1;
  console.log(`cases.json: ${all.length} cases, holdout.json: ${held.length}; turns by language ${JSON.stringify(langs)}`);
}
