import { describe, expect, it } from "vitest";
import { fusionnerLignesLivres, selectionnerExtraitLivre, validerLigneLivre } from "../../src/server/knowledge/livres";
import { reponseLivres } from "../../src/server/jarvis/reponse-livres";
import { recupererPreuvesLivres, recupererPreuvesLivresAvecDiagnostic } from "../../src/server/jarvis/preuves-recherche";

const ligne = {
  chunk_id: "child-1", source_id: "source-1", source_titre: "Staging",
  source_version: "ocr-2026-09", section: "Chapitre", version_chunk: "struct-v1.1",
  langue: "fr", texte: "ABCD EFGH", score: 0.8,
  source_statut: "active", source_classification: "C4",
  source_approuvee_le: "2026-09-22T00:00:00.000Z",
  source_approuvee_par: "11111111-1111-4111-8111-111111111111",
  source_revue_a_jour: true, source_remplacee_par: null,
  book_number: 1, title_exact: "Livre exact", edition_label: "Édition vérifiée",
  heading_path: ["Chapitre", "Section"], heading_status: "verified", ocr_review_status: "accepted",
  page_segments: [
    { segment_no: 0, split_id: "volume-1.pdf", physical_page_in_split: 4, global_physical_page: 4,
      chunk_start_cp: 0, chunk_end_cp: 4, raw_start_cp: 12, raw_end_cp: 16,
      page_sha1: "a".repeat(40), printed_page_verified: null },
    { segment_no: 1, split_id: "volume-1.pdf", physical_page_in_split: 5, global_physical_page: 5,
      chunk_start_cp: 5, chunk_end_cp: 9, raw_start_cp: 0, raw_end_cp: 4,
      page_sha1: "b".repeat(40), printed_page_verified: "3" },
  ],
};

describe("book provenance", () => {
  it("uses the governed vector branch when the lexical book gate errors", async () => {
    const called: string[] = [];
    const result = await recupererPreuvesLivresAvecDiagnostic(
      { rpc: async <T,>(name: string) => {
        called.push(name);
        return name === "search_book_knowledge_lexical"
          ? { data: null as T, error: { message: "lexical unavailable" } }
          : { data: [ligne] as T, error: null };
      } },
      "ABCD", async () => [0.1, 0.2],
    );
    expect(called).toContain("search_book_knowledge_vector");
    expect(result.diagnostic).toBeNull();
    expect(result.preuves).toHaveLength(1);
  });

  it("names the unavailable lexical branch when vector search returns no passage", async () => {
    const result = await recupererPreuvesLivresAvecDiagnostic(
      { rpc: async <T,>(name: string) => name === "search_book_knowledge_lexical"
        ? { data: null as T, error: { message: "lexical unavailable" } }
        : { data: [] as T, error: null } },
      "ABCD", async () => [0.1, 0.2],
    );
    expect(result.diagnostic).toBe("recherche-lexicale-indisponible");
    expect(reponseLivres(result.preuves, result.diagnostic)).toMatch(/recherche par mots.*indisponible/i);
  });

  it("distinguishes a search outage from an empty governed search", async () => {
    const outage = await recupererPreuvesLivresAvecDiagnostic(
      { rpc: async <T,>() => ({ data: null as T, error: { message: "offline" } }) },
      "diagnostic", async () => null,
    );
    const empty = await recupererPreuvesLivresAvecDiagnostic(
      { rpc: async <T,>() => ({ data: [] as T, error: null }) },
      "diagnostic", async () => [0.1, 0.2],
    );
    const partial = await recupererPreuvesLivresAvecDiagnostic(
      { rpc: async <T,>() => ({ data: [] as T, error: null }) },
      "diagnostic", async () => null,
    );
    expect(outage.diagnostic).toBe("recherche-indisponible");
    expect(empty.diagnostic).toBe("aucun-passage-accessible");
    expect(partial.diagnostic).toBe("recherche-partielle");
    expect(reponseLivres(outage.preuves, outage.diagnostic)).toMatch(/n'a pas abouti/);
    expect(reponseLivres(empty.preuves, empty.diagnostic)).toMatch(/aucun passage accessible/);
    expect(reponseLivres(partial.preuves, partial.diagnostic)).toMatch(/recherche sémantique/);
  });

  it("explains when all staged books have zero searchable passages", async () => {
    const result = await recupererPreuvesLivresAvecDiagnostic(
      { rpc: async <T,>(name: string) => ({
        data: (name === "get_book_knowledge_availability"
          ? [{ total_books: 6, eligible_chunks: "0" }]
          : []) as T,
        error: null,
      }) },
      "What do the books say about lithium?", async () => null,
    );
    expect(result.preuves).toEqual([]);
    expect(result.diagnostic).toBe("livres-non-recherchables");
    expect(reponseLivres(result.preuves, result.diagnostic)).toMatch(/livres.*aucun passage.*activé/i);
  });

  it("explains provenance, numeric, and OCR rejection without quoting unsafe text", async () => {
    const cases = [
      { row: { ...ligne, heading_status: "detected" }, question: "diagnostic", reason: "provenance-invalide" },
      { row: ligne, question: "GFR 90mL/min", reason: "valeur-non-confirmee" },
      { row: { ...ligne, ocr_review_status: "unreviewed" }, question: "diagnostic", reason: "ocr-incertain" },
      { row: { ...ligne, ocr_review_status: "suspect" }, question: "diagnostic", reason: "ocr-incertain" },
      { row: { ...ligne, texte: "Lithium 400mg/day", page_segments: [
        { ...ligne.page_segments[0], chunk_end_cp: 17, raw_end_cp: 29 },
      ] }, question: "lithium", reason: "dose-ocr-non-verifiee" },
    ] as const;
    for (const example of cases) {
      const result = await recupererPreuvesLivresAvecDiagnostic(
        { rpc: async <T,>() => ({ data: [example.row] as T, error: null }) },
        example.question, async () => null,
      );
      expect(result.preuves).toEqual([]);
      expect(result.diagnostic).toBe(example.reason);
      expect(reponseLivres(result.preuves, result.diagnostic)).not.toContain("400mg/day");
    }
  });

  it.each(["zebrax-999", "triclamorine-742", "QX-917", "MCC-2049"])(
    "does not substitute a related passage for absent identifier %s", async (identifier) => {
      const result = await recupererPreuvesLivresAvecDiagnostic(
        { rpc: async <T,>() => ({ data: [ligne] as T, error: null }) },
        `What dose does the book give for ${identifier}?`, async () => null,
      );
      expect(result.preuves).toEqual([]);
      expect(result.diagnostic).toBe("identifiant-introuvable");
      expect(reponseLivres(result.preuves, result.diagnostic)).toMatch(/identifiant exact/);
    },
  );

  it("keeps an exact identifier when the validated passage contains it", async () => {
    const texte = "Study MCC-2049 is listed here";
    const row = { ...ligne, texte, page_segments: [
      { ...ligne.page_segments[0], chunk_end_cp: texte.length, raw_end_cp: 12 + texte.length },
    ] };
    const result = await recupererPreuvesLivresAvecDiagnostic(
      { rpc: async <T,>() => ({ data: [row] as T, error: null }) },
      "What does MCC-2049 report?", async () => null,
    );
    expect(result.diagnostic).toBeNull();
    expect(result.preuves[0]?.extrait).toContain("MCC-2049");
  });

  it("checks all 20 retrieved candidates before keeping five exact identifier citations", async () => {
    const irrelevant = Array.from({ length: 5 }, (_, index) => ({
      ...ligne, chunk_id: `top-${index}`, score: 1 - index / 10,
    }));
    const texte = "Study MCC-2049 is listed here";
    const matching = { ...ligne, chunk_id: "sixth", score: 0.1, texte,
      page_segments: [{ ...ligne.page_segments[0], chunk_end_cp: texte.length,
        raw_end_cp: 12 + texte.length }] };
    const result = await recupererPreuvesLivresAvecDiagnostic(
      { rpc: async <T,>() => ({ data: [...irrelevant, matching] as T, error: null }) },
      "What does MCC-2049 report?", async () => null,
    );
    expect(result.diagnostic).toBeNull();
    expect(result.preuves).toHaveLength(1);
    expect(result.preuves[0]?.extrait).toContain("MCC-2049");
  });

  it("does not confuse an identifier with a longer OCR token", async () => {
    const texte = "Study MCC-2049A is listed here";
    const row = { ...ligne, texte, page_segments: [
      { ...ligne.page_segments[0], chunk_end_cp: texte.length, raw_end_cp: 12 + texte.length },
    ] };
    const result = await recupererPreuvesLivresAvecDiagnostic(
      { rpc: async <T,>() => ({ data: [row] as T, error: null }) },
      "What does MCC-2049 report?", async () => null,
    );
    expect(result.preuves).toEqual([]);
    expect(result.diagnostic).toBe("identifiant-introuvable");
  });

  it.each(["MCC-2049A", "MCC-2049.1", "MCC-2049-1"])(
    "does not answer with the shorter identifier for %s", async (identifier) => {
      const texte = "Study MCC-2049 is listed here";
      const row = { ...ligne, texte, page_segments: [
        { ...ligne.page_segments[0], chunk_end_cp: texte.length, raw_end_cp: 12 + texte.length },
      ] };
      const result = await recupererPreuvesLivresAvecDiagnostic(
        { rpc: async <T,>() => ({ data: [row] as T, error: null }) },
        `What does ${identifier} report?`, async () => null,
      );
      expect(result.preuves).toEqual([]);
      expect(result.diagnostic).toBe("identifiant-introuvable");
    },
  );

  it("quarantines the known ICD code OCR conflict at physical page 226", async () => {
    const texte = "Subdural code NAO7.6Z";
    const row = { ...ligne, chunk_id: "83377756", book_number: 2, texte, page_segments: [
      { ...ligne.page_segments[0], physical_page_in_split: 76, global_physical_page: 226,
        chunk_end_cp: texte.length, raw_end_cp: 12 + texte.length },
    ] };
    const client = { rpc: async <T,>() => ({ data: [row] as T, error: null }) };
    const printed = await recupererPreuvesLivresAvecDiagnostic(client, "What is NA07.6Z?", async () => null);
    expect(printed.preuves).toEqual([]);
    expect(printed.diagnostic).toBe("conflit-ocr-connu");
    const ocr = await recupererPreuvesLivresAvecDiagnostic(client, "What is NAO7.6Z?", async () => null);
    expect(ocr.preuves).toEqual([]);
    expect(ocr.diagnostic).toBe("conflit-ocr-connu");
    expect(reponseLivres(ocr.preuves, ocr.diagnostic)).not.toContain("NAO7.6Z");
    const unrelated = await recupererPreuvesLivresAvecDiagnostic(client, "What is QX-917?", async () => null);
    expect(unrelated.diagnostic).toBe("identifiant-introuvable");
  });

  it("does not quarantine an unrelated ICD chunk solely for sharing physical page 226", async () => {
    const texte = "Unrelated indexed entry";
    const row = { ...ligne, chunk_id: "7af28d6b", book_number: 2, texte, page_segments: [
      { ...ligne.page_segments[0], physical_page_in_split: 76, global_physical_page: 226,
        chunk_end_cp: texte.length, raw_end_cp: 12 + texte.length },
    ] };
    const result = await recupererPreuvesLivresAvecDiagnostic(
      { rpc: async <T,>() => ({ data: [row] as T, error: null }) },
      "Unrelated indexed entry", async () => null,
    );
    expect(result.diagnostic).toBeNull();
    expect(result.preuves).toHaveLength(1);
  });

  it("quarantines the image-checked DSM criterion-label OCR conflict", async () => {
    const texte = "Critères diagnostiques de phobie spécifique avec étiquettes OCR altérées";
    const row = { ...ligne, chunk_id: "910e7b4d", texte, page_segments: [
      { ...ligne.page_segments[0], physical_page_in_split: 6, global_physical_page: 306,
        chunk_end_cp: texte.length, raw_end_cp: 12 + texte.length },
    ] };
    const result = await recupererPreuvesLivresAvecDiagnostic(
      { rpc: async <T,>() => ({ data: [row] as T, error: null }) },
      "Quels critères de phobie spécifique ?", async () => null,
    );
    expect(result.preuves).toEqual([]);
    expect(result.diagnostic).toBe("conflit-ocr-connu");
    expect(reponseLivres(result.preuves, result.diagnostic)).toMatch(/désaccord connu/);
  });
  it.each([
    ["eef0d441", 678, "0 ui"],
    ["377fcac6", 680, "0 UI"],
    ["a13a0972", 683, "5013120 UI"],
    ["5244599a", 733, "57123113 UI"],
    ["2f4cab28", 549, "7g"],
    ["5e57fbae", 234, "2500mcg"],
    ["a2eda7d2", 342, "1g"],
    ["6e8b6cbf", 379, "3g"],
    ["b4620a40", 770, "3g"],
  ])("quarantines image-checked Taylor OCR conflict %s", async (chunkId, page, expression) => {
    const texte = `Rotated table OCR ${expression}`;
    const row = { ...ligne, chunk_id: chunkId, book_number: 6, texte, page_segments: [
      { ...ligne.page_segments[0], global_physical_page: page,
        chunk_end_cp: texte.length, raw_end_cp: 12 + texte.length },
    ] };
    const result = await recupererPreuvesLivresAvecDiagnostic(
      { rpc: async <T,>() => ({ data: [row] as T, error: null }) },
      expression, async () => null,
    );
    expect(result.preuves).toEqual([]);
    expect(result.diagnostic).toBe("conflit-ocr-connu");
  });
  it("quarantines the B06 page-500 printed-folio conflict and keeps the verified folio", async () => {
    const texte = "Monitoring guidance for chart review";
    const row = { ...ligne, chunk_id: "b06p500a", book_number: 6, texte, page_segments: [
      { ...ligne.page_segments[0], global_physical_page: 500, printed_page_verified: "4",
        chunk_end_cp: texte.length, raw_end_cp: 12 + texte.length },
    ] };
    const quarantined = await recupererPreuvesLivresAvecDiagnostic(
      { rpc: async <T,>() => ({ data: [row] as T, error: null }) },
      "Monitoring guidance for chart review", async () => null,
    );
    expect(quarantined.preuves).toEqual([]);
    expect(quarantined.diagnostic).toBe("conflit-ocr-connu");
    const verified = { ...ligne, chunk_id: "b06p500b", book_number: 6, texte, page_segments: [
      { ...ligne.page_segments[0], global_physical_page: 500, printed_page_verified: "479",
        chunk_end_cp: texte.length, raw_end_cp: 12 + texte.length },
    ] };
    const kept = await recupererPreuvesLivresAvecDiagnostic(
      { rpc: async <T,>() => ({ data: [verified] as T, error: null }) },
      "Monitoring guidance for chart review", async () => null,
    );
    expect(kept.diagnostic).toBeNull();
    expect(kept.preuves).toHaveLength(1);
  });
  it("keeps a v1.1 child's exact physical pages and only verified printed pages", () => {
    const proof = validerLigneLivre(ligne);
    expect(proof?.chunkId).toBe("child-1");
    expect(proof?.pages.map((p) => [p.physicalPage, p.printedPage])).toEqual([[4, null], [5, "3"]]);
    expect(proof?.headingPath).toEqual(["Chapitre", "Section"]);
  });

  it("rejects incomplete metadata, malformed or drifting spans, and quarantine", () => {
    expect(validerLigneLivre({ ...ligne, edition_label: null })).toBeNull();
    expect(validerLigneLivre({ ...ligne, page_segments: [{ ...ligne.page_segments[0], chunk_end_cp: 99 }] })).toBeNull();
    expect(validerLigneLivre({ ...ligne, source_statut: "discovered" })).toBeNull();
    expect(validerLigneLivre({ ...ligne, heading_status: "detected" })).toBeNull();
  });

  it("drops a lexical/vector conflict for the same chunk", () => {
    expect(fusionnerLignesLivres([ligne], [{ ...ligne, edition_label: "Another edition" }])).toEqual([]);
  });

  it("rejects a conflicting raw tail even when the displayed excerpt is identical", () => {
    const first = { ...ligne, texte: "A".repeat(900), page_segments: [
      { ...ligne.page_segments[0], chunk_end_cp: 900, raw_end_cp: 912 },
    ] };
    expect(fusionnerLignesLivres([first], [{ ...first, texte: "A".repeat(800) + "B".repeat(100) }])).toEqual([]);
  });

  it("answers only with server-made citations and excerpts", () => {
    const proof = validerLigneLivre(ligne);
    expect(proof).not.toBeNull();
    const response = reponseLivres(proof ? [{ titre: proof.titleExact, section: proof.headingPath.join(" › "),
      version: proof.sourceVersion, extrait: proof.extrait, id: "11111111-1111-4111-8111-111111111111",
      livre: { numero: proof.bookNumber, edition: proof.edition, pages: proof.pages,
        ocrReviewStatus: proof.ocrReviewStatus } }] : []);
    expect(response).toContain("Livre exact");
    expect(response).toContain("DSM-5 Manuel diagnostique et statistiques des troubles mentaux");
    expect(response).toContain("PDF p. 4");
    expect(response).toContain("ABCD EFGH");
    expect(reponseLivres([])).toMatch(/ne peux pas répondre/i);
  });

  it("calls only book gates and rejects a divergent vector projection", async () => {
    const names: string[] = [];
    const result = await recupererPreuvesLivres({ rpc: async <T,>(name: string) => {
      names.push(name);
      return { data: (name.endsWith("lexical") ? [ligne] : [{ ...ligne, title_exact: "Drift" }]) as T, error: null };
    } }, "diagnostic", async () => [0.1, 0.2]);
    expect(names).toEqual(["search_book_knowledge_lexical", "search_book_knowledge_vector"]);
    expect(result).toEqual([]);
  });

  it("keeps a validated book proof with a server-issued evidence ID", async () => {
    const result = await recupererPreuvesLivres({ rpc: async <T,>() => ({ data: [ligne] as T, error: null }) },
      "diagnostic", async () => null);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result[0]?.livre?.pages.map((p) => p.physicalPage)).toEqual([4,5]);
  });

  it("withholds a dose excerpt from both answer and evidence even after source approval", async () => {
    const row = { ...ligne, texte: "Lithium 400mg/day", ocr_review_status: "accepted",
      page_segments: [{ ...ligne.page_segments[0], chunk_end_cp: 17, raw_end_cp: 29 }] };
    const proofs = await recupererPreuvesLivres(
      { rpc: async <T,>() => ({ data: [row] as T, error: null }) },
      "lithium dose", async () => null,
    );
    expect(proofs).toEqual([]);
    expect(reponseLivres(proofs)).toMatch(/ne peux pas répondre/i);
  });

  it.each(["Citalopram 408 mg", "Naloxone 0,8 mg", "Take 2 tablets", "Dose 20 daily"])(
    "withholds a dose-like OCR context: %s",
    async (texte) => {
      const length = [...texte].length;
      const row = { ...ligne, texte, page_segments: [
        { ...ligne.page_segments[0], chunk_end_cp: length, raw_end_cp: 12 + length },
      ] };
      const proofs = await recupererPreuvesLivres(
        { rpc: async <T,>() => ({ data: [row] as T, error: null }) },
        "medication", async () => null,
      );
      expect(proofs).toEqual([]);
    },
  );

  it.each(["GFR 50mL/min", "Birthweight 500 g", "Blood alcohol 20 mg/dL", "Criterion 5"])(
    "preserves a non-dose number from a governed book: %s",
    async (texte) => {
      const length = [...texte].length;
      const row = { ...ligne, texte, page_segments: [
        { ...ligne.page_segments[0], chunk_end_cp: length, raw_end_cp: 12 + length },
      ] };
      const proofs = await recupererPreuvesLivres(
        { rpc: async <T,>() => ({ data: [row] as T, error: null }) },
        "diagnostic", async () => null,
      );
      expect(proofs).toHaveLength(1);
      expect(reponseLivres(proofs)).toContain(texte);
    },
  );

  it("does not format a numeric book proof supplied by another caller", () => {
    const proof = validerLigneLivre(ligne);
    expect(proof).not.toBeNull();
    const candidate = {
      titre: proof!.titleExact, section: "Chapitre", version: proof!.sourceVersion,
      extrait: "Take 2 tablets", id: "11111111-1111-4111-8111-111111111111",
      livre: { numero: proof!.bookNumber, edition: proof!.edition, pages: proof!.pages,
        ocrReviewStatus: proof!.ocrReviewStatus },
    } as const;
    expect(reponseLivres([candidate])).toMatch(/ne peux pas répondre/i);
  });

  it("quotes an exact queried non-dose line with only that line's PDF page", async () => {
    const first = "Lithium 400mg/day\n";
    const second = "GFR 50mL/min";
    const row = { ...ligne, texte: first + second, page_segments: [
      { ...ligne.page_segments[0], chunk_start_cp: 0, chunk_end_cp: first.length,
        raw_start_cp: 0, raw_end_cp: first.length },
      { ...ligne.page_segments[1], chunk_start_cp: first.length,
        chunk_end_cp: first.length + second.length, raw_start_cp: 0, raw_end_cp: second.length },
    ] };
    const proofs = await recupererPreuvesLivres(
      { rpc: async <T,>() => ({ data: [row] as T, error: null }) },
      "GFR 50mL/min", async () => null,
    );
    expect(proofs).toHaveLength(1);
    expect(proofs[0]?.extrait).toBe(second);
    expect(proofs[0]?.livre?.pages.map((page) => page.physicalPage)).toEqual([5]);
    expect(reponseLivres(proofs)).not.toContain("400mg/day");
  });

  it("abstains when a numeric query has no unique exact source match", async () => {
    const texte = "GFR 50mL/min\nGFR 50mL/min";
    const row = { ...ligne, texte, page_segments: [
      { ...ligne.page_segments[0], chunk_start_cp: 0, chunk_end_cp: texte.length,
        raw_start_cp: 0, raw_end_cp: texte.length },
    ] };
    const client = { rpc: async <T,>() => ({ data: [row] as T, error: null }) };
    expect(await recupererPreuvesLivres(client, "GFR 50mL/min", async () => null)).toEqual([]);
    expect(await recupererPreuvesLivres(client, "GFR 90mL/min", async () => null)).toEqual([]);
  });

  it("does not join an identifier and value from unrelated source lines", async () => {
    const first = "Study QX-917 is listed here\n";
    const second = "GFR 50mL/min is measured elsewhere";
    const row = { ...ligne, texte: first + second, page_segments: [
      { ...ligne.page_segments[0], chunk_start_cp: 0, chunk_end_cp: first.length,
        raw_start_cp: 0, raw_end_cp: first.length },
      { ...ligne.page_segments[1], chunk_start_cp: first.length,
        chunk_end_cp: first.length + second.length, raw_start_cp: 0, raw_end_cp: second.length },
    ] };
    const client = { rpc: async <T,>() => ({ data: [row] as T, error: null }) };
    for (const question of ["QX-917 GFR 50mL/min", "GFR 50mL/min for QX-917"]) {
      const result = await recupererPreuvesLivresAvecDiagnostic(client, question, async () => null);
      expect(result.preuves).toEqual([]);
      expect(result.diagnostic).toBe("valeur-non-confirmee");
    }
  });

  it("keeps an exact identifier and value when both occur on the cited line", async () => {
    const texte = "Study QX-917 reports GFR 50mL/min";
    const row = { ...ligne, texte, page_segments: [
      { ...ligne.page_segments[0], chunk_end_cp: texte.length, raw_end_cp: 12 + texte.length },
    ] };
    const result = await recupererPreuvesLivresAvecDiagnostic(
      { rpc: async <T,>() => ({ data: [row] as T, error: null }) },
      "GFR 50mL/min for QX-917", async () => null,
    );
    expect(result.diagnostic).toBeNull();
    expect(result.preuves[0]?.extrait).toBe(texte);
    expect(result.preuves[0]?.livre?.pages.map((page) => page.physicalPage)).toEqual([4]);
  });

  it("can cite a verified page for an exact non-dose value beyond the old 800-character excerpt", async () => {
    const prefix = "A".repeat(900) + "\n";
    const value = "Blood alcohol 20 mg/dL";
    const row = { ...ligne, texte: prefix + value, page_segments: [
      { ...ligne.page_segments[0], chunk_start_cp: 0, chunk_end_cp: prefix.length,
        raw_start_cp: 0, raw_end_cp: prefix.length },
      { ...ligne.page_segments[1], chunk_start_cp: prefix.length,
        chunk_end_cp: prefix.length + value.length, raw_start_cp: 0, raw_end_cp: value.length },
    ] };
    const proofs = await recupererPreuvesLivres(
      { rpc: async <T,>() => ({ data: [row] as T, error: null }) },
      "Blood alcohol 20 mg/dL", async () => null,
    );
    expect(proofs[0]?.extrait).toBe(value);
    expect(proofs[0]?.livre?.pages.map((page) => page.physicalPage)).toEqual([5]);
  });

  it("omits a page that contributes only whitespace to the selected excerpt", () => {
    const texte = "GFR  50mL/min";
    const row = { ...ligne, texte, page_segments: [
      { ...ligne.page_segments[0], chunk_start_cp: 0, chunk_end_cp: 3,
        raw_start_cp: 0, raw_end_cp: 3 },
      { ...ligne.page_segments[1], chunk_start_cp: 3, chunk_end_cp: 5,
        raw_start_cp: 0, raw_end_cp: 2 },
      { ...ligne.page_segments[1], segment_no: 2, physical_page_in_split: 6,
        global_physical_page: 6, chunk_start_cp: 5, chunk_end_cp: texte.length,
        raw_start_cp: 0, raw_end_cp: texte.length - 5 },
    ] };
    const passage = validerLigneLivre(row);
    expect(passage).not.toBeNull();
    expect(selectionnerExtraitLivre(passage!, "50mL/min")?.pages.map((page) => page.physicalPage))
      .toEqual([4, 6]);
  });

  it("does not cite a bare table number without its row or measurement label", async () => {
    const first = "Lithium\n";
    const second = "50mL/min";
    const row = { ...ligne, texte: first + second, page_segments: [
      { ...ligne.page_segments[0], chunk_start_cp: 0, chunk_end_cp: first.length,
        raw_start_cp: 0, raw_end_cp: first.length },
      { ...ligne.page_segments[1], chunk_start_cp: first.length,
        chunk_end_cp: first.length + second.length, raw_start_cp: 0, raw_end_cp: second.length },
    ] };
    const proofs = await recupererPreuvesLivres(
      { rpc: async <T,>() => ({ data: [row] as T, error: null }) },
      "GFR 50mL/min", async () => null,
    );
    expect(proofs).toEqual([]);
  });
});
