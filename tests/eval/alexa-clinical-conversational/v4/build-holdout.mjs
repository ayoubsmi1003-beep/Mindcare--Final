/**
 * Seals the H270 holdout. Its questions live only in .eval-out/alexa-c270/holdout-cases.mjs (git-ignored, written with C270,
 * before any Alexa change). This script checks them like C270 (French, no book name, verified chunk, no resemblance to any
 * C200–C202 turn NOR to any C270 turn), writes .eval-out/alexa-c270/holdout.json and prints its SHA-256, which is committed
 * in manifest-holdout.json. Running it never prints a question.
 *   node tests/eval/alexa-clinical-conversational/v4/build-holdout.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildCases, earlierTurns, words } from "./build-cases.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "..", "..", "..", ".eval-out", "alexa-c270");
const { cases, BOOK_SOURCES_HOLDOUT } = await import(pathToFileURL(join(out, "holdout-cases.mjs")).href);
const BOOK_NAMES = /\b(?:dsm|maudsley|stahl|taylor|cim|icd|livre|manuel|prescriber|ouvrage)\b/iu;
const overlap = (a, b) => { let shared = 0; for (const word of a) if (b.has(word)) shared++; return shared / (a.size + b.size - shared); };

const c270 = buildCases().all.flatMap((item) => item.turns.map((turn) => turn.say));
const others = [...earlierTurns(), ...c270].map(words).filter((set) => set.size >= 3);
const problems = [];
const turns = {};
for (const item of cases) {
  turns[item.domain] = (turns[item.domain] ?? 0) + item.turns.length;
  for (const turn of item.turns) {
    if (turn.lang !== "fr") problems.push(`${item.id}: not French`);
    if (turn.expect.k === "book" && (BOOK_NAMES.test(turn.say) || !BOOK_SOURCES_HOLDOUT[item.id])) problems.push(`${item.id}: book name or no source`);
    const mine = words(turn.say);
    if (mine.size >= 3 && others.some((other) => overlap(mine, other) >= 0.7)) problems.push(`${item.id}: resembles an earlier or C270 question`);
  }
}
const total = Object.values(turns).reduce((sum, n) => sum + n, 0);
if (total !== 60 || Object.values(turns).some((n) => n !== 10)) problems.push(`expected 60 turns, 10 per domain: ${JSON.stringify(turns)}`);
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
const body = JSON.stringify({ version: 4, campaign: "H270", frozenOn: "2026-11-11", bookSources: BOOK_SOURCES_HOLDOUT, cases }, null, 1) + "\n";
writeFileSync(join(out, "holdout.json"), body);
console.log(JSON.stringify({ holdoutSha256: createHash("sha256").update(body).digest("hex"), turns }));
