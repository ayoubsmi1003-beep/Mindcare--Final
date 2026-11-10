/**
 * Builds cases.json (200 cases) and refuses an invalid campaign: exactly 200 cases W001…W200 in the C200 distribution, unique ids,
 * French only, every turn tagged, no book named in a book case, and no question that repeats or closely resembles a C200 or C201 one
 * (exact match after normalisation, or a Jaccard word overlap of 70% or more).
 *   node tests/eval/alexa-clinical-conversational/v3/build-cases.mjs
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
import { FORMS } from "./helpers.mjs";
import { BOOK_SOURCES } from "./book-sources.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const EXPECTED = { patient: 55, context: 45, agenda: 30, finance: 25, book: 35, variation: 10 };
const ARABIC = /[؀-ۿ]/u;
const DARIJA = /\b(?:wesh|wach|chkoun|chhal|dyal|dyalou|3and\w*|3tini|kayen|kayakhod|daba|bzaf|akhir|wakteh|ghedda|lyoum|khlass\w*)\b/iu;
const BOOK_NAMES = /\b(?:dsm|maudsley|stahl|taylor|cim|icd|livre|manuel|prescriber|ouvrage)\b/iu;
const norm = (text) => text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/gu, " ").trim();
const words = (text) => new Set(norm(text).split(" ").filter((word) => word.length > 1));
const overlap = (a, b) => { let shared = 0; for (const word of a) if (b.has(word)) shared++; return shared / (a.size + b.size - shared); };

export function buildCases() {
  const all = [...patient, ...context, ...agenda, ...finance, ...book, ...variation];
  const problems = [];
  const earlier = [];
  for (const file of [["v1", "cases.json"], ["v2", "cases.json"], ["v2", "holdout.json"]]) {
    for (const item of JSON.parse(readFileSync(join(here, "..", file[0], file[1]), "utf8")).cases) for (const turn of item.turns) earlier.push(words(turn.say.replace(/\{[^}]+\}/gu, "")));
  }
  const ids = new Set();
  for (const item of all) {
    if (ids.has(item.id)) problems.push(`duplicate id ${item.id}`);
    ids.add(item.id);
    for (const turn of item.turns) {
      if (turn.lang !== "fr") problems.push(`${item.id}: not tagged French`);
      if (!FORMS.includes(turn.form)) problems.push(`${item.id}: bad form ${turn.form}`);
      if (ARABIC.test(turn.say) || DARIJA.test(turn.say)) problems.push(`${item.id}: not French`);
      if (item.domain === "book" && BOOK_NAMES.test(turn.say)) problems.push(`${item.id}: names a book`);
      const mine = words(turn.say.replace(/\{[^}]+\}/gu, ""));
      // The one-word and two-word stubs ("Synthèse.", "Séances ?") are compared by exact match only: an overlap ratio means nothing on them.
      const worst = mine.size < 3 ? (earlier.some((other) => other.size === mine.size && [...mine].every((word) => other.has(word))) ? 1 : 0) : Math.max(0, ...earlier.map((other) => (other.size < 3 ? 0 : overlap(mine, other))));
      if (worst >= 0.7) problems.push(`${item.id}: resembles an earlier question (${Math.round(worst * 100)}%): ${turn.say.slice(0, 70)}`);
    }
  }
  if (all.length !== 200) problems.push(`expected 200 cases, got ${all.length}`);
  for (const [domain, count] of Object.entries(EXPECTED)) {
    const got = all.filter((item) => item.domain === domain).length;
    if (got !== count) problems.push(`${domain}: expected ${count}, got ${got}`);
  }
  all.forEach((item, index) => { if (item.id !== `W${String(index + 1).padStart(3, "0")}`) problems.push(`order: ${item.id} at position ${index + 1}`); });
  for (const item of book) if (!BOOK_SOURCES[item.id]) problems.push(`${item.id}: no verified source chunk`);
  return { all, problems };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { all, problems } = buildCases();
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  const stamp = { version: 3, campaign: "C202", frozenOn: "2026-11-10", language: "fr", note: "French only. Wording written before any run; never tuned against results." };
  writeFileSync(join(here, "cases.json"), JSON.stringify({ ...stamp, cases: all }, null, 1) + "\n");
  console.log(`cases.json written: ${all.length} cases`);
}
