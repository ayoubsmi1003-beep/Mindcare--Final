import { BOOK_DISORDER_TERMS, BOOK_DRUG_NAMES } from "./book-topics.generated";

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’]/gu, "'");
// "cyclothymie" and "cyclothymique" name one topic; so do "gabapentine" and "gabapentin", "cauchemar" and "cauchemars".
const root = (word: string) => word.replace(/(?:iques?|ies?|ues?)$/u, "");
function sameWord(said: string, term: string): boolean {
  if (said === term) return true;
  if (term.length < 5 || said.length < 5) return false;
  if ((said.startsWith(term) && said.length - term.length <= 2) || (term.startsWith(said) && term.length - said.length <= 2)) return true;
  const a = root(said), b = root(term);
  return a.length >= 6 && a === b;
}
const SINGLE = [...BOOK_DRUG_NAMES, ...BOOK_DISORDER_TERMS.filter((term) => !/[ '/-]/u.test(term))];
const PHRASES = BOOK_DISORDER_TERMS.filter((term) => /[ '/-]/u.test(term));

/** The text names a drug or a disorder the approved books treat (generated from their headings). */
export function mentionsBookTopic(text: string): boolean {
  const plain = ` ${fold(text).replace(/[^\p{L}\p{N}'/-]+/gu, " ").trim()} `;
  if (PHRASES.some((phrase) => plain.includes(` ${phrase} `))) return true;
  const words = plain.split(/[\s'/-]+/u).filter((word) => word.length >= 4);
  return words.some((word) => SINGLE.some((term) => sameWord(word, term)));
}
