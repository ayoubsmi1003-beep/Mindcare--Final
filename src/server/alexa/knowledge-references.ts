import { hiddenControls } from "./knowledge-french";
import { bibliographyEvidence, bibliographyRequested, headingOnlyEvidence, requestedMedicationNames, substantiveQuote } from "./knowledge-evidence-content";
import { matchesSectionFocus, planKnowledgeQuery } from "./knowledge-query";
import { monographOwner } from "./knowledge-monograph";
import { requestedMonographNames } from "@/server/knowledge/monograph-roots";
import { knowledgeExcerptForSpeech, type KnowledgeResult } from "./knowledge-response";

type Proof = KnowledgeResult["preuves"][number];
export type KnowledgeReference = { readonly proof: Proof; readonly excerpt: string };

// The adapter's evidence budget decides how much arrives, and reports what it leaves out.
const MAX_REFERENCE_CHARS = 10_400;
// Whatever retrieval kept is shown: a passage found and not displayed is not an answer (the evidence budget already bounds the total).
const MIN_REFERENCES = 5;
const MAX_REFERENCES = 5;

/**
 * The ingested chunk opens with its breadcrumb, which the reference already shows as its heading.
 * Only an exact leading prefix goes.
 */
export function withoutSectionHeading(text: string, section: string | null): string {
  let quote = text;
  // A label that is only the passage's own opening, cut ("■ Discontinuation … inad — ■ Discontinuation … inadvertent overdose"),
  // shows the same words twice and is not the book's text: the passage alone stays.
  const label = /^(.{12,}?)\s*—\s*/u.exec(quote);
  if (label && quote.slice(label[0].length).startsWith(label[1]!)) quote = quote.slice(label[0].length);
  if (!section) return quote;
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const stripped = quote.replace(new RegExp(`^${escaped}\\s*(?:—|–|-)\\s*`, "u"), "").trim();
  return stripped.length ? stripped : quote;
}

// Whole tags only: "ANC <LLN" is clinical text.
const MARKUP = /<\/?[a-z][^<>]*>|<!--|\]\(/iu;
// The book's own « » are kept: the DSM uses them. Only text that would read as another of our citations goes.
const FORGED_FRAME = /passage\s+cit/iu;
const safeHeading = (section: string | null) => !section || (!/[«»]/u.test(section) && !hiddenControls.test(section) && !MARKUP.test(section));

/**
 * The closest passages, for the doctor to read. Nothing here decides that a passage answers the
 * question, or fits this drug, population or exclusion: three review rounds found that rules doing so
 * keep misleading in new ways. The reader judges from the passage and its heading, and the answer says so.
 *
 * Rows go only when they can't be read: markup, control characters, a bare heading or reference.
 */
export function referencesToRead(question: string, proofs: readonly Proof[]): { references: KnowledgeReference[]; omitted: boolean; unshown: boolean } {
  let omitted = false, unshown = false;
  const readable = proofs.flatMap((proof): KnowledgeReference[] => {
    const quote = withoutSectionHeading(proof.extrait, proof.section);
    const excerpt = knowledgeExcerptForSpeech(quote);
    if (quote.length > MAX_REFERENCE_CHARS) { omitted = true; return []; }
    // Refused for naming a book, for instance: not a matter of length, so the notice must not say it is.
    if (excerpt === null) { unshown = true; return []; }
    if (hiddenControls.test(quote) || MARKUP.test(quote) || FORGED_FRAME.test(quote) || !safeHeading(proof.section)) { unshown = true; return []; }
    // A label with nothing after it, or only the tail of a sentence cut in the middle ("… — Diagnostic différentiel — » pour ce
    // trouble)."), shows no text of the book.
    const readableText = substantiveQuote(excerpt) && !headingOnlyEvidence(quote, proof.section) && !/—\s*(?:$|[»)\],;:.][^—]{0,80}$)/u.test(excerpt.trim())
      && (!bibliographyEvidence(proof.section) || bibliographyRequested(question));
    return readableText ? [{ proof, excerpt }] : [];
  });

  const drugs = [...new Set([...requestedMonographNames(question), ...requestedMedicationNames(question)])];
  const ownedBy = (name: string) => (entry: KnowledgeReference) => monographOwner(entry.proof.section, [name]) !== null;
  const mentions = (name: string) => (entry: KnowledgeReference) =>
    [...requestedMonographNames(entry.excerpt), ...requestedMedicationNames(entry.excerpt)].includes(name);
  // One drug with its own monograph here: a neighbouring drug would only be noise. Another book's passage naming that same drug
  // is no neighbour: it often holds the answer (the Maudsley's "asenapine does not appear to affect prolactin").
  const owned = drugs.length === 1 ? readable.filter(entry => ownedBy(drugs[0]!)(entry) || mentions(drugs[0]!)(entry)) : [];
  const pool = owned.length ? owned : readable;

  // Retrieval's order, except that each drug and section asked for gets a place first.
  const plan = planKnowledgeQuery(question);
  const first = [
    ...drugs.map(name => pool.find(ownedBy(name)) ?? pool.find(mentions(name))),
    ...(plan?.sectionFocuses ?? []).map(focus => pool.find(entry => matchesSectionFocus(entry.proof.section, focus))),
  ].filter((entry): entry is KnowledgeReference => entry !== undefined);
  const limit = Math.min(MAX_REFERENCES, Math.max(MIN_REFERENCES, new Set(first).size));
  const chosen = new Set([...first, ...pool]);
  return { references: [...chosen].slice(0, limit), omitted, unshown };
}
