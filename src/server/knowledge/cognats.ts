import { BOOK_ENGLISH_WORDS } from "./book-english-words.generated";

/**
 * The English spelling of a French clinical word, when the English books themselves contain it. Medical French and English share
 * their Greek and Latin roots and differ mostly by the ending: myocardite/myocarditis, agranulocytose/agranulocytosis,
 * akathisie/akathisia, priapisme/priapism, thyroïde/thyroid, prolactine/prolactin. Spelling rules propose candidates; a candidate
 * counts only if the books contain it (`BOOK_ENGLISH_WORDS`), so a rule can never invent a word, and the one the books use most
 * wins ("epilepsy" over "epilepsia"). Input: a folded word (no accents).
 */
const ENDINGS: readonly (readonly [RegExp, readonly string[]])[] = [
  [/emie$/u, ["emia", "aemia"]],
  [/ite$/u, ["itis", "ity"]],
  [/ose$/u, ["osis"]],
  [/isme$/u, ["ism"]],
  [/ie$/u, ["ia", "y"]],
  [/aque$/u, ["ac"]],
  [/ique$/u, ["ic", "ical"]],
  [/ide$/u, ["id"]],
  [/if$/u, ["ive"]],
  [/aire$/u, ["ary", "ar"]],
  [/eur$/u, ["or"]],
  [/e$/u, [""]],
];
// The same spelling in both languages counts only if the English books really use it: a French word quoted once in a reference
// ("traitement") is no English word.
const SAME_WORD_MIN_PASSAGES = 3;

export function cognatAnglais(mot: string): string | undefined {
  if (mot.length < 6) return undefined;
  let best: string | undefined, bestPassages = 0;
  for (const [ending, replacements] of ENDINGS) {
    if (!ending.test(mot)) continue;
    for (const replacement of replacements) {
      const candidate = mot.replace(ending, replacement), passages = BOOK_ENGLISH_WORDS.get(candidate) ?? 0;
      // Six letters at least: "contre" must not become the fragment "contr" the index holds.
      if (candidate.length >= 6 && passages > bestPassages) { best = candidate; bestPassages = passages; }
    }
  }
  if (best) return best;
  // Long words only: short ones are often false friends ("place", "grave").
  return mot.length >= 8 && (BOOK_ENGLISH_WORDS.get(mot) ?? 0) >= SAME_WORD_MIN_PASSAGES ? mot : undefined;
}
