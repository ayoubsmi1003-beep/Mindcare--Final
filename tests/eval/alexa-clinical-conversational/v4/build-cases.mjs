/**
 * Builds cases.json for C270 and refuses an invalid campaign:
 *  - exactly 270 doctor turns, split by domain 55/45/40/35/80/15 (a conversation counts each of its turns);
 *  - ids unique, with the domain prefix (P, X, A, F, L, V);
 *  - French only, every turn tagged, no book named in a book question, every book turn tied to a verified chunk;
 *  - no turn that repeats or closely resembles a C200, C201 (holdout included) or C202 turn: exact match after
 *    normalisation, or a Jaccard word overlap of 70 % or more. The semantic (embedding) check is a separate test,
 *    tests/unit/alexa-c270-novelty.test.ts, because it needs the local e5 model.
 *   node tests/eval/alexa-clinical-conversational/v4/build-cases.mjs [holdout]
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
export const EXPECTED_TURNS = { patient: 55, context: 45, agenda: 40, finance: 35, book: 80, variation: 15 };
const PREFIX = { patient: "P", context: "X", agenda: "A", finance: "F", book: "L", variation: "V" };
const ARABIC = /[؀-ۿ]/u;
const DARIJA = /\b(?:wesh|wach|chkoun|chhal|dyal|dyalou|3and\w*|3tini|kayen|kayakhod|daba|bzaf|akhir|wakteh|ghedda|lyoum|khlass\w*)\b/iu;
const BOOK_NAMES = /\b(?:dsm|maudsley|stahl|taylor|cim|icd|livre|manuel|prescriber|ouvrage)\b/iu;
const norm = (text) => text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/gu, " ").trim();
export const words = (text) => new Set(norm(text.replace(/\{[^}]+\}/gu, "")).split(" ").filter((word) => word.length > 1));
const overlap = (a, b) => { let shared = 0; for (const word of a) if (b.has(word)) shared++; return shared / (a.size + b.size - shared); };

/** Every earlier doctor turn (C200, C201 with its holdout, C202), as text. */
export function earlierTurns() {
  const out = [];
  for (const [dir, file] of [["v1", "cases.json"], ["v2", "cases.json"], ["v2", "holdout.json"], ["v3", "cases.json"]]) {
    for (const item of JSON.parse(readFileSync(join(here, "..", dir, file), "utf8")).cases) for (const turn of item.turns) out.push(turn.say);
  }
  return out;
}

function resemblance(mine, others) {
  // One- and two-word stubs ("Synthèse.", "allergie ?") are compared by exact match only: a ratio means nothing on them.
  if (mine.size < 3) return others.some((other) => other.size === mine.size && [...mine].every((word) => other.has(word))) ? 1 : 0;
  return Math.max(0, ...others.map((other) => (other.size < 3 ? 0 : overlap(mine, other))));
}

export function buildCases() {
  const all = [...patient, ...context, ...agenda, ...finance, ...book, ...variation];
  const problems = [];
  const earlier = earlierTurns().map(words);
  const ids = new Set();
  const turnsBy = {};
  for (const item of all) {
    if (ids.has(item.id)) problems.push(`duplicate id ${item.id}`);
    ids.add(item.id);
    if (!item.id.startsWith(PREFIX[item.domain] ?? "?")) problems.push(`${item.id}: prefix does not match domain ${item.domain}`);
    turnsBy[item.domain] = (turnsBy[item.domain] ?? 0) + item.turns.length;
    item.turns.forEach((turn, index) => {
      if (turn.lang !== "fr") problems.push(`${item.id}: not tagged French`);
      if (!FORMS.includes(turn.form)) problems.push(`${item.id}: bad form ${turn.form}`);
      if (ARABIC.test(turn.say) || DARIJA.test(turn.say)) problems.push(`${item.id}: not French`);
      if (turn.expect.k === "book") {
        if (BOOK_NAMES.test(turn.say)) problems.push(`${item.id}: names a book`);
        const source = BOOK_SOURCES[item.id];
        if (!(Array.isArray(source) ? source[index] : source)) problems.push(`${item.id}#${index + 1}: no verified source chunk`);
      }
      const worst = resemblance(words(turn.say), earlier);
      if (worst >= 0.7) problems.push(`${item.id}#${index + 1}: resembles an earlier question (${Math.round(worst * 100)}%): ${turn.say.slice(0, 70)}`);
    });
  }
  // Within C270 too: two turns of the campaign must not be the same question.
  const own = all.flatMap((item) => item.turns.map((turn, index) => ({ id: `${item.id}#${index + 1}`, w: words(turn.say), say: turn.say })));
  own.forEach((a, i) => own.slice(i + 1).forEach((b) => { if (a.w.size >= 3 && b.w.size >= 3 && overlap(a.w, b.w) >= 0.7) problems.push(`${a.id} ~ ${b.id}: ${a.say.slice(0, 50)}`); }));
  for (const [domain, count] of Object.entries(EXPECTED_TURNS)) if ((turnsBy[domain] ?? 0) !== count) problems.push(`${domain}: expected ${count} turns, got ${turnsBy[domain] ?? 0}`);
  const total = Object.values(turnsBy).reduce((sum, n) => sum + n, 0);
  if (total !== 270) problems.push(`expected 270 turns, got ${total}`);
  return { all, problems, turnsBy };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { all, problems, turnsBy } = buildCases();
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  const stamp = { version: 4, campaign: "C270", frozenOn: "2026-11-11", language: "fr", turnsByDomain: turnsBy, note: "French only. Written before any Alexa change and never tuned against results." };
  writeFileSync(join(here, "cases.json"), JSON.stringify({ ...stamp, cases: all }, null, 1) + "\n");
  console.log(`cases.json written: ${all.length} cases, ${Object.values(turnsBy).reduce((s, n) => s + n, 0)} turns`, turnsBy);
}
