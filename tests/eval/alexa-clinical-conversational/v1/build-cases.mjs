/**
 * Builds cases.json from the six case files and refuses an invalid campaign:
 * exactly 200 cases, unique ids C001…C200, the agreed distribution, French only, no book named in a book case.
 *   node tests/eval/alexa-clinical-conversational/v1/build-cases.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cases as patient } from "./cases-patient.mjs";
import { cases as context } from "./cases-context.mjs";
import { cases as agenda } from "./cases-agenda.mjs";
import { cases as finance } from "./cases-finance.mjs";
import { cases as book } from "./cases-books.mjs";
import { cases as variation } from "./cases-variation.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const EXPECTED = { patient: 55, context: 45, agenda: 30, finance: 25, book: 35, variation: 10 };
const ARABIC = /[؀-ۿ]/u;
const DARIJA = /\b(?:wesh|wach|chkon|chhal|dyal|ta3|rani|bzaf|khoya|hadak)\b/iu;
const BOOK_NAMES = /\b(?:dsm|maudsley|stahl|taylor|cim|icd|livre|manuel|prescriber)\b/iu;

export function buildCases() {
  const all = [...patient, ...context, ...agenda, ...finance, ...book, ...variation];
  const problems = [];
  const ids = new Set();
  for (const item of all) {
    if (ids.has(item.id)) problems.push(`duplicate id ${item.id}`);
    ids.add(item.id);
    for (const turn of item.turns) {
      if (ARABIC.test(turn.say) || DARIJA.test(turn.say)) problems.push(`${item.id}: not French`);
      if (item.domain === "book" && BOOK_NAMES.test(turn.say)) problems.push(`${item.id}: names a book`);
    }
  }
  if (all.length !== 200) problems.push(`expected 200 cases, got ${all.length}`);
  for (const [domain, count] of Object.entries(EXPECTED)) {
    const got = all.filter((item) => item.domain === domain).length;
    if (got !== count) problems.push(`${domain}: expected ${count}, got ${got}`);
  }
  all.forEach((item, index) => { if (item.id !== `C${String(index + 1).padStart(3, "0")}`) problems.push(`order: ${item.id} at position ${index + 1}`); });
  return { all, problems };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { all, problems } = buildCases();
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  writeFileSync(join(here, "cases.json"), JSON.stringify({ version: 1, campaign: "C200", frozenOn: "2026-11-09", language: "fr", cases: all }, null, 1) + "\n");
  console.log(`cases.json written: ${all.length} cases`);
}
