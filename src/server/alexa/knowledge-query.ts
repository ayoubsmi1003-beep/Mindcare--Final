import { jetoniser } from "@/server/knowledge/rerank";

// Titles observed in the approved local corpus. Aliases never approve a source.
const BOOKS = [
  { marker: /\bdsm(?:\s*-?\s*5)?\b/u,
    title: "DSM-5 — Manuel diagnostique et statistique des troubles mentaux", language: "fr" },
  { marker: /\b(?:maudsley|taylor)\b/u,
    title: "The Maudsley Prescribing Guidelines in Psychiatry", language: "en" },
] as const;

const SCAFFOLD = new Set([
  "quels", "quelles", "comment", "explique", "expliquer", "parle", "parler", "dit", "dis", "dire",
  "montre", "selon", "apres", "livre", "livres", "ouvrage", "manuel", "references", "reference",
  "sources", "source", "difference", "compare", "comparer", "entre", "chez",
  "what", "which", "how", "explain", "tell", "says", "according", "to", "the", "of", "in", "and", "book",
  "واش", "يقول", "حسب", "اشرح", "شرح", "شنو", "وش", "كتاب", "مرجع", "مراجع", "chno", "wach", "3la",
]);

// Closed, literal retrieval aliases (FR / EN), not a diagnosis or translation model.
// Unknown clinical words remain in the query; no fallback to a guessed topic.
const ALIASES: Readonly<Record<string, readonly [string, string]>> = {
  criteres: ["criteres", "criteria"], diagnostiquer: ["criteres", "criteria"],
  traitement: ["traitement", "treatment"], traitements: ["traitements", "treatments"],
  trouble: ["trouble", "disorder"], troubles: ["troubles", "disorders"], bipolaire: ["bipolaire", "bipolar"],
  schizophrenie: ["schizophrenie", "schizophrenia"], anxiete: ["anxiete", "anxiety"],
  symptomes: ["symptomes", "symptoms"], enfants: ["enfants", "children"], adulte: ["adulte", "adult"],
  contreindications: ["contre indications", "contraindications"],
  معايير: ["criteres", "criteria"], اكتياب: ["depression", "depression"], // hamza-normalized اكتئاب
  علاج: ["traitement", "treatment"], جرعة: ["dose", "dose"],
  اعراض: ["symptomes", "symptoms"], فصام: ["schizophrenie", "schizophrenia"], قلق: ["anxiete", "anxiety"],
  سيرترالين: ["sertraline", "sertraline"],
};

export interface KnowledgeQueryPlan {
  readonly queries: readonly string[];
  readonly relevanceQuery: string;
  readonly language: "fr" | "en" | "toutes";
  readonly sourceTitle: string | null;
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim()
    .replace(/[٠-٩]/gu, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, digit => String(digit.charCodeAt(0) - 0x06f0)).replace(/٫/gu, ".");
}

/** Local query planning only. SQL still decides approval, lifecycle and access. */
export function planKnowledgeQuery(question: string): KnowledgeQueryPlan | null {
  // Never truncate away a final book, population, dose or other restriction.
  if (question.length > 500) return null;
  let normalized = normalize(question);
  // Only DSM-5 is observed locally. A different edition or text revision must
  // fail closed before its book label can be stripped or mapped to that source.
  for (const edition of normalized.matchAll(/\bdsm\s*-?\s*(\d+|[ivx]+)(?:\s*-?\s*(tr|r))?\b/gu)) {
    if (edition[1] !== "5" || edition[2]) return null;
  }
  const books = BOOKS.filter(book => book.marker.test(normalized));
  if (books.length > 1) return null; // No implicit substitution for a multi-book request.
  const book = books[0];
  const named = normalized.match(/(?:\b(?:selon|d['’]apres|according to)|حسب)\s+(?:(?:le|la|les|the)\s+)?(?:(?:livre|ouvrage|manuel|book|كتاب|مرجع)\s+)?([\p{L}\p{N}-]+)/u)?.[1];
  const namedBook = normalized.match(/(?:\b(?:livre|ouvrage|book)|كتاب|مرجع)\s+(?:de\s+)?([\p{L}\p{N}-]+)/u)?.[1];
  const generic = new Set(["references", "sources", "litterature", "criteres", "symptomes", "livres", "مراجع", "معايير"]);
  for (const name of [named, namedBook]) {
    if (name && !generic.has(name) && !BOOKS.some(known => known.marker.test(name))) return null;
  }
  if (book) normalized = normalized.replace(new RegExp(book.marker.source, "gu"), " ");
  normalized = normalized.replace(/ثنايي\s+(?:ال)?قطب/gu, "trouble bipolaire");
  normalized = normalized.replace(/\bcontre[-\s]+indications?\b/gu, "contreindications");
  const language = book?.language ?? "toutes";
  const english = language === "en";
  // The unchanged rank tokenizer drops one-digit, decimal and signed quantities.
  // Preserve their exact numeric lexemes at the SQL query boundary.
  const lexemes = normalized.match(/[+-]?\d+(?:[.,]\d+)?(?:\/\d+)?|[\p{L}]+/gu) ?? [];
  const terms = lexemes.flatMap(token => /^[+-]?\d/u.test(token) ? [token] : jetoniser(token));
  const tokens = [...new Set(terms.filter(token => !SCAFFOLD.has(token))
    .map(token => ALIASES[token]?.[english ? 1 : 0] ?? token))];
  if (tokens.length === 0) return null;
  let queries = [tokens.join(" ")];
  // Type I must survive the baseline's one-letter token exclusion. A comparison
  // gets two exact lexical AND queries, never an OR query or a drug-only fallback.
  const typeI = /\btype\s+i\b/u.test(normalized);
  const typeII = /(?:\btype\s+ii\b|\b(?:et|vs|versus)\s+ii\b)/u.test(normalized);
  if (typeI && typeII) {
    const common = tokens.filter(token => !["type", "ii", "vs", "versus"].includes(token)).join(" ");
    queries = [`${common} type i`, `${common} type ii`];
  } else if (typeI) queries = [`${queries[0]} i`];
  if (queries.some(query => query.length > 500)) return null;
  return { queries, relevanceQuery: queries.join(" "), language, sourceTitle: book?.title ?? null };
}

/** Requested-book matching restricts already-governed rows; it grants no access. */
export function matchesRequestedBook(row: unknown, plan: KnowledgeQueryPlan): boolean {
  if (plan.sourceTitle === null) return true;
  return typeof row === "object" && row !== null && "source_titre" in row
    && typeof row.source_titre === "string" && normalize(row.source_titre) === normalize(plan.sourceTitle);
}
