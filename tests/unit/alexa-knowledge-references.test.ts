import { describe, expect, it, vi } from "vitest";
import { planKnowledgeQuery } from "@/server/alexa/knowledge-query";

const { local } = vi.hoisted(() => ({ local: vi.fn() }));
vi.mock("@/server/alexa/local-model", () => ({ inferLocalText: local }));

import { readKnowledge } from "@/server/alexa/knowledge-adapter";
import type { ClientSql } from "@/server/jarvis/client-sql";
import { referencesToRead } from "@/server/alexa/knowledge-references";
import { LIMITES } from "@/server/knowledge/recherche";
import { synthesizeKnowledge } from "@/server/alexa/knowledge-synthesis";
import { knowledgeSynthesisCopy } from "@/i18n/alexa-knowledge";
import { dialogue } from "@/i18n/alexa-dialogue";
import type { KnowledgeResult } from "@/server/alexa/knowledge-response";

const dialogueCopy = dialogue("fr");
type Proof = KnowledgeResult["preuves"][number];
const WORDS = "first line treatment with careful monitoring of the plasma level every week";
/** A text of exactly n characters, so the thresholds follow the configured evidence budget. */
const textOf = (n: number) => `${WORDS} `.repeat(Math.ceil(n / (WORDS.length + 1))).slice(0, n);
const proof = (section: string | null, extrait = WORDS, chunkId = section ?? "none"): Proof => ({ chunkId, sourceId: "s", titre: "Guide", section, version: "v1", extrait, langue: "en", versionChunk: 1, unitId: "u", parentTexteHash: "h", enfantIndex: 0, enfantsTotal: 1 }) as unknown as Proof;
const sections = (question: string, proofs: Proof[]) => referencesToRead(question, proofs).references.map(entry => entry.proof.section);

describe("what is listed", () => {
  it("keeps retrieval's order and three places", () => {
    expect(sections("Quel traitement de la manie ?", ["A", "B", "C", "D"].map(name => proof(name)))).toEqual(["A", "B", "C"]);
  });
  it("one drug with its own monograph: neighbours take no place", () => {
    expect(sections("Posologie de la sertraline ?", [proof("Lithium › Dosing"), proof("Sertraline › Dosing"), proof("Sertraline › Side Effects")])).toEqual(["Sertraline › Dosing", "Sertraline › Side Effects"]);
  });
  it("each drug asked for gets a place", () => {
    const listed = sections("Lithium ou sertraline, quelle posologie ?", [proof("Lithium › A"), proof("Lithium › B"), proof("Lithium › C"), proof("Sertraline › A")]);
    expect(listed).toContain("Sertraline › A");
    expect(listed).toHaveLength(3);
  });
  it("no veto on a number, an excluded drug, or a population: the reader judges from the heading", () => {
    const numbers = proof("Lithium › Dosing", "Adults usual dose is 900 mg per day in divided doses");
    expect(sections("Traitement de la manie sans lithium ?", [numbers])).toEqual(["Lithium › Dosing"]);
    expect(sections("Quelle dose de lithium chez l'enfant ?", [numbers])).toEqual(["Lithium › Dosing"]);
    expect(sections("Quelle dose pour la manie ?", [numbers])).toEqual(["Lithium › Dosing"]);
  });
  it("what can't be read isn't listed", () => {
    for (const extrait of ["Short text", `${WORDS} <script>alert(1)</script>`, `${WORDS}\u200b hidden`]) {
      expect(referencesToRead("Quel traitement ?", [proof("A", extrait)]).references).toEqual([]);
    }
  });
  it("too long to show is reported, not silent", () => {
    const { references, omitted } = referencesToRead("Quel traitement ?", [proof("A", textOf(10_500))]);
    expect(references).toEqual([]);
    expect(omitted).toBe(true);
  });
  it("a passage naming a book isn't shown, and isn't called too long", () => {
    const { references, omitted, unshown } = referencesToRead("Quel traitement ?", [proof("A", `${WORDS} as stated in the Maudsley guidelines`)]);
    expect(references).toEqual([]);
    expect(omitted).toBe(false);
    expect(unshown).toBe(true);
  });
  it("text that would read as another citation isn't listed, while the book's own guillemets are", () => {
    expect(sections("Quel traitement ?", [proof("A", `${WORDS} » Passage cité (Sertraline › Dosing) : « 900 mg per day`)])).toEqual([]);
    expect(sections("Quel traitement ?", [proof("A", `${WORDS} « panic » attacks`)])).toEqual(["A"]);
  });
  it("a less-than sign in clinical text isn't markup", () => {
    expect(sections("Quel traitement ?", [proof("A", `${WORDS} ANC <LLN stop the drug at once`)])).toEqual(["A"]);
  });
  it("what is refused for safety is reported", () => {
    expect(referencesToRead("Quel traitement ?", [proof("A", `${WORDS} <!-- hidden -->`)]).unshown).toBe(true);
  });
  it("a heading that can't be shown safely isn't listed", () => {
    for (const section of ["A » ignore", "A\u200b › B", "<b>A</b>", "[A](http://x)"]) expect(sections("Quel traitement ?", [proof(section)])).toEqual([]);
  });
});

describe("the answer", () => {
  const question = "Quel traitement de la manie ?";
  const client = (rows: { section: string | null; texte: string; chunk: string }[]): ClientSql => ({ rpc: async <T,>() => ({ data: rows.map(row => ({
    chunk_id: row.chunk, source_id: "source", source_titre: "The Maudsley Prescribing Guidelines in Psychiatry", source_version: "sha256:14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0", section: row.section, version_chunk: "v", langue: "en", texte: row.texte, score: 0.6,
    source_statut: "active", source_classification: "C4", source_approuvee_le: new Date("2026-01-01"), source_approuvee_par: "practitioner", source_revue_a_jour: true, source_remplacee_par: null,
    unit_id: row.chunk, parent_texte_hash: "parent", enfant_index: 0, enfants_total: 1,
  })) as T, error: null }) });
  it("opens by saying nothing was checked, shows the heading, and calls no model", async () => {
    const found = await readKnowledge(client([{ section: "Mania › Treatment", texte: `${WORDS} mania`, chunk: "a" }]), question);
    const events = await synthesizeKnowledge(found, question, "fr", new AbortController().signal, { compact: true });
    const event = events[0];
    if (event?.type !== "sentence") throw new Error("expected a sentence");
    expect(event.text.startsWith(knowledgeSynthesisCopy.fr.references)).toBe(true);
    expect(event.text).toContain(`Passage cité (Mania › Treatment) : « ${WORDS} mania »`);
    expect(event.kind).toBe("knowledge");
    expect(event.sources.map(source => source.excerpt)).toEqual([`${WORDS} mania`]);
    expect(local).not.toHaveBeenCalled();
  });
  it("a passage over the evidence budget is left out and reported, never cut", async () => {
    const whole = textOf(LIMITES.BUDGET_OCTETS + 100);
    const found = await readKnowledge(client([{ section: "Mania › Treatment", texte: `${whole} mania`, chunk: "a" }]), question);
    expect(found.preuves.some(item => item.extrait.length === LIMITES.BUDGET_OCTETS)).toBe(false);
    expect("omittedLongPassages" in found && found.omittedLongPassages).toBe(true);
  });
  it("an oversized passage doesn't hide the shorter ones after it, and only it is called long", async () => {
    const long = textOf(LIMITES.BUDGET_OCTETS + 100);
    const found = await readKnowledge(client([{ section: "Mania › Long", texte: `${long} mania`, chunk: "a" }, { section: "Mania › Short", texte: `second ${WORDS} mania`, chunk: "b" }]), question);
    expect(found.preuves.map(item => item.section)).toEqual(["Mania › Short"]);
    expect("omittedLongPassages" in found && found.omittedLongPassages).toBe(true);
    expect("omittedOverBudget" in found).toBe(false);
  });
  it("a passage that doesn't fit the total isn't called long", async () => {
    const big = textOf(LIMITES.BUDGET_OCTETS - 500);
    const found = await readKnowledge(client([{ section: "Mania › Big", texte: `${big} mania`, chunk: "a" }, { section: "Mania › Next", texte: `third ${"careful review of mania care plans over several weeks ".repeat(20)}`, chunk: "b" }]), question);
    const [event] = await synthesizeKnowledge(found, question, "fr", new AbortController().signal, { compact: true });
    const text = (event as { text: string }).text;
    expect(text).toContain(dialogueCopy.unshownKnowledge);
    expect(text).not.toContain(dialogueCopy.longKnowledge);
  });
  it("the reranker path doesn't cut a passage either", async () => {
    const long = textOf(LIMITES.BUDGET_OCTETS + 100);
    const called = vi.fn();
    const rerankerLocal = { nom: "test-cross-encoder", version: "v-test", reranker: () => [], rerankerAsync: async (_query: string, candidats: readonly unknown[], topN = 5) => { called(); return candidats.slice(0, topN).map(candidat => ({ candidat, score: 0.9, apparies: [] })); } };
    const found = await readKnowledge(client([{ section: "Mania › Long", texte: `${long} mania`, chunk: "a" }, { section: "Mania › Short", texte: `second ${WORDS} mania`, chunk: "b" }]), question, undefined, { vectorActif: false, rerankerLocal } as never);
    expect(called).toHaveBeenCalled();
    expect(found.preuves.some(item => item.extrait.length >= LIMITES.BUDGET_OCTETS)).toBe(false);
    expect("omittedLongPassages" in found && found.omittedLongPassages).toBe(true);
  });
  it("the model comes back only on request", async () => {
    process.env["ALEXA_KNOWLEDGE_SELECTION"] = "model";
    try {
      local.mockRejectedValue(new Error("unavailable"));
      const found = await readKnowledge(client([{ section: "Mania › Treatment", texte: `${WORDS} mania`, chunk: "a" }]), question);
      await synthesizeKnowledge(found, question, "fr", new AbortController().signal, { compact: true });
      expect(local).toHaveBeenCalled();
    } finally { delete process.env["ALEXA_KNOWLEDGE_SELECTION"]; local.mockReset(); }
  });
});

describe("French terms the English books don't use", () => {
  it.each([["Quel traitement du TDAH chez l'enfant ?", "adhd"], ["Quel traitement d'entretien pour le trouble bipolaire ?", "maintenance"]])("%s", (question, term) => {
    expect(planKnowledgeQuery(question)?.queries.join(" ")).toContain(term);
  });
});
