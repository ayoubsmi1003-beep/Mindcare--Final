/** Book-only retrieval projection. SQL grants authority; this layer rejects drift. */
import { lignePorteRecuperable, validerLignePorte } from "./stockage";

export interface PageLivre {
  readonly splitId: string;
  readonly physicalPage: number;
  readonly globalPhysicalPage: number;
  readonly printedPage: string | null;
}

export interface PassageLivre {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly bookNumber: number;
  readonly titleExact: string;
  readonly edition: string;
  readonly sourceVersion: string;
  readonly headingPath: readonly string[];
  readonly ocrReviewStatus: "unreviewed" | "accepted" | "suspect";
  readonly extrait: string;
  readonly pages: readonly PageLivre[];
  readonly score: number;
  /** Server-only validated source text and exact page spans, never sent on the wire. */
  readonly sourceText: string;
  readonly sourceSegments: readonly (PageLivre & { readonly startCp: number; readonly endCp: number })[];
}

const SHA1 = /^[0-9a-f]{40}$/;
const PDF_NAME = /^[^\\/]+\.pdf$/i;
const MAX_CODEPOINTS = 800;
const IDENTIFIANT_LIVRE = /(?<![\p{L}\p{N}])(?:[\p{L}]{2,}-\d{3,}[\p{L}\p{N}]*(?:[./-][\p{L}\p{N}]+)*|[A-Z]{2,3}\d{1,2}(?:\.[0-9A-Z]+)?|\d[A-Z]\d{2})(?![\p{L}\p{N}]|[./-][\p{L}\p{N}])/gu;
const VALEUR_QUESTION = /\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|μg|g|m[lL]|mmol|IU|UI|kg)(?:\/[A-Za-z]+)?/gu;

export function identifiantsExactsLivre(question: string): string[] {
  return [...new Set([...question.matchAll(IDENTIFIANT_LIVRE)]
    .map((match) => match[0].toLocaleLowerCase("und")))];
}

function motifExact(anchor: string): RegExp {
  const literal = anchor.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${literal}(?![\\p{L}\\p{N}]|[./-][\\p{L}\\p{N}])`, "iu");
}

export function contientIdentifiantExactLivre(texte: string, identifiant: string): boolean {
  return motifExact(identifiant).test(texte);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** A row with a partial, forged or parent-wide page range is never cited. */
export function validerLigneLivre(value: unknown): PassageLivre | null {
  const base = validerLignePorte(value);
  if (!base || !lignePorteRecuperable(base) || typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const book = row["book_number"];
  const title = row["title_exact"];
  const edition = row["edition_label"];
  const heading = row["heading_path"];
  const ocr = row["ocr_review_status"];
  const segments = row["page_segments"];
  if (!positiveInteger(book) || book > 6 || typeof title !== "string" || !title.trim() ||
      typeof edition !== "string" || !edition.trim() || row["heading_status"] !== "verified" ||
      !Array.isArray(heading) || heading.length === 0 || heading.some((h) => typeof h !== "string" || !h.trim()) ||
      (ocr !== "unreviewed" && ocr !== "accepted" && ocr !== "suspect") ||
      !Array.isArray(segments) || segments.length === 0) return null;

  const codepoints = [...base.texte];
  const length = codepoints.length;
  const pages: PageLivre[] = [];
  const sourceSegments: (PageLivre & { startCp: number; endCp: number })[] = [];
  const seenPages = new Set<string>();
  const pageByKey = new Map<string, PageLivre>();
  let previousEnd = 0;
  for (let i = 0; i < segments.length; i++) {
    const segment: unknown = segments[i];
    if (typeof segment !== "object" || segment === null || Array.isArray(segment)) return null;
    const s = segment as Record<string, unknown>;
    if (s["segment_no"] !== i || typeof s["split_id"] !== "string" || !PDF_NAME.test(s["split_id"]) ||
        !positiveInteger(s["physical_page_in_split"]) || !positiveInteger(s["global_physical_page"]) ||
        !nonnegativeInteger(s["chunk_start_cp"]) || !positiveInteger(s["chunk_end_cp"]) ||
        !nonnegativeInteger(s["raw_start_cp"]) || !positiveInteger(s["raw_end_cp"]) ||
        typeof s["page_sha1"] !== "string" || !SHA1.test(s["page_sha1"]) ||
        (s["printed_page_verified"] !== null &&
          (typeof s["printed_page_verified"] !== "string" || !s["printed_page_verified"].trim())) ||
        s["chunk_start_cp"] < previousEnd || s["chunk_end_cp"] <= s["chunk_start_cp"] ||
        s["chunk_end_cp"] > length ||
        s["chunk_end_cp"] - s["chunk_start_cp"] !== s["raw_end_cp"] - s["raw_start_cp"]) return null;
    if (codepoints.slice(previousEnd, s["chunk_start_cp"]).some((ch) => !/\s/u.test(ch))) return null;
    previousEnd = s["chunk_end_cp"];
    sourceSegments.push({ splitId: s["split_id"], physicalPage: s["physical_page_in_split"],
      globalPhysicalPage: s["global_physical_page"], printedPage: s["printed_page_verified"],
      startCp: s["chunk_start_cp"], endCp: s["chunk_end_cp"] });
    if (s["chunk_start_cp"] >= MAX_CODEPOINTS) continue;
    const key = `${s["split_id"]}:${s["physical_page_in_split"]}`;
    const previousPage = pageByKey.get(key);
    if (previousPage && (previousPage.globalPhysicalPage !== s["global_physical_page"] ||
      previousPage.printedPage !== s["printed_page_verified"])) return null;
    if (!seenPages.has(key)) {
      const page = { splitId: s["split_id"], physicalPage: s["physical_page_in_split"],
        globalPhysicalPage: s["global_physical_page"], printedPage: s["printed_page_verified"] };
      pages.push(page);
      pageByKey.set(key, page);
      seenPages.add(key);
    }
  }
  if (codepoints.slice(previousEnd, MAX_CODEPOINTS).some((ch) => !/\s/u.test(ch))) return null;
  if (pages.length === 0) return null;
  return {
    chunkId: base.chunk_id, sourceId: base.source_id, bookNumber: book,
    titleExact: title, edition, sourceVersion: base.source_version,
    headingPath: heading as string[], ocrReviewStatus: ocr,
    extrait: codepoints.slice(0, MAX_CODEPOINTS).join(""), pages, score: base.score,
    sourceText: base.texte, sourceSegments,
  };
}

/**
 * A numeric question may name an exact value beyond the default excerpt.
 * Quote only its unique source line and derive pages from that line's spans.
 * Ambiguous or absent values abstain; no page is inherited from the chunk.
 */
export function selectionnerExtraitLivre(passage: PassageLivre, question: string): PassageLivre | null {
  const anchors = [...new Set([...question.matchAll(VALEUR_QUESTION)]
    .map((match) => match[0]).concat(identifiantsExactsLivre(question)))];
  if (anchors.length === 0) return passage;
  const first = motifExact(anchors[0]!);
  const matches = [...passage.sourceText.matchAll(new RegExp(first.source, "giu"))];
  const hit = matches[0];
  if (matches.length !== 1 || !hit) return null;
  const at = hit.index;
  const lineStart = passage.sourceText.lastIndexOf("\n", at - 1) + 1;
  const nextNewline = passage.sourceText.indexOf("\n", at);
  const lineEnd = nextNewline < 0 ? passage.sourceText.length : nextNewline;
  const rawLine = passage.sourceText.slice(lineStart, lineEnd);
  const excerpt = rawLine.trim();
  if (!excerpt || [...excerpt].length > MAX_CODEPOINTS ||
      !/\p{L}{3,}/u.test(excerpt.replace(first, "")) ||
      anchors.some((anchor) => !motifExact(anchor).test(excerpt))) return null;
  const leading = rawLine.length - rawLine.trimStart().length;
  const startCp = [...passage.sourceText.slice(0, lineStart + leading)].length;
  const endCp = startCp + [...excerpt].length;
  const pages: PageLivre[] = [];
  const seen = new Set<string>();
  const codepoints = [...passage.sourceText];
  for (const segment of passage.sourceSegments) {
    if (segment.startCp >= endCp || segment.endCp <= startCp) continue;
    const left = Math.max(startCp, segment.startCp);
    const right = Math.min(endCp, segment.endCp);
    if (codepoints.slice(left, right).every((char) => /\s/u.test(char))) continue;
    const key = segment.splitId + ":" + segment.physicalPage;
    if (!seen.has(key)) {
      pages.push({ splitId: segment.splitId, physicalPage: segment.physicalPage,
        globalPhysicalPage: segment.globalPhysicalPage, printedPage: segment.printedPage });
      seen.add(key);
    }
  }
  return pages.length ? { ...passage, extrait: excerpt, pages } : null;
}

function identity(raw: unknown): string {
  const row = raw as Record<string, unknown>;
  return JSON.stringify([
    row["source_id"], row["source_version"], row["section"], row["version_chunk"],
    row["langue"], row["texte"], row["source_statut"], row["source_classification"],
    row["source_approuvee_le"], row["source_approuvee_par"], row["source_revue_a_jour"],
    row["source_remplacee_par"], row["book_number"], row["title_exact"],
    row["edition_label"], row["heading_path"], row["heading_status"],
    row["ocr_review_status"], row["page_segments"],
  ]);
}

/** A disagreement between lexical and vector projections invalidates that chunk. */
export function fusionnerLignesLivres(lexical: readonly unknown[], vector: readonly unknown[]): PassageLivre[] {
  const byChunk = new Map<string, PassageLivre>();
  const identities = new Map<string, string>();
  const invalid = new Set<string>();
  for (const raw of [...lexical, ...vector]) {
    const proof = validerLigneLivre(raw);
    if (!proof || invalid.has(proof.chunkId)) continue;
    const previous = byChunk.get(proof.chunkId);
    const rawIdentity = identity(raw);
    if (previous && identities.get(proof.chunkId) !== rawIdentity) {
      byChunk.delete(proof.chunkId);
      identities.delete(proof.chunkId);
      invalid.add(proof.chunkId);
    } else if (!previous || proof.score > previous.score) {
      byChunk.set(proof.chunkId, proof);
      identities.set(proof.chunkId, rawIdentity);
    }
  }
  return [...byChunk.values()].sort((a,b) => b.score-a.score || a.chunkId.localeCompare(b.chunkId)).slice(0,20);
}
