import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Rule A: Alexa is never taught the benchmark. No C270 question may appear in the code or the tests, word for word (accents,
// case and punctuation aside), not even as a comment or a test example. Reads C270 only; the sealed holdout is never opened here.
const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’]/gu, "'").replace(/[^\p{L}\p{N}']+/gu, " ").trim();
const cases = JSON.parse(readFileSync(join(process.cwd(), "tests", "eval", "alexa-clinical-conversational", "v4", "cases.json"), "utf8")) as { cases?: { id: string; turns: { say: string }[] }[] } | { id: string; turns: { say: string }[] }[];
const questions = (Array.isArray(cases) ? cases : cases.cases ?? []).flatMap((item) => item.turns.map((turn) => ({ id: item.id, said: fold(turn.say) })))
  .filter((question) => question.said.split(" ").length >= 4 && !question.said.includes("{"));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(?:ts|tsx|mjs)$/u.test(name) && !path.includes("alexa-c270") ? [path] : [];
  });
}

describe("no benchmark question in the code or the tests", () => {
  it("finds no C270 question, word for word", () => {
    const found = ["src", join("tests", "unit"), join("tests", "integration")].flatMap((dir) => files(join(process.cwd(), dir)))
      .flatMap((path) => { const text = ` ${fold(readFileSync(path, "utf8"))} `; return questions.filter((question) => text.includes(` ${question.said} `)).map((question) => `${path} ${question.id}`); });
    expect(found).toEqual([]);
  });
});
