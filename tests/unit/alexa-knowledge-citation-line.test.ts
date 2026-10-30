import { afterEach, expect, it, vi } from "vitest";

const { local } = vi.hoisted(() => ({ local: vi.fn() }));
vi.mock("@/server/alexa/local-model", () => ({ inferLocalText: local }));
vi.mock("@/server/egress/external-call", () => ({ llm: () => { throw new Error("UnexpectedCloudText"); } }));

import { readKnowledge } from "@/server/alexa/knowledge-adapter";
import { synthesizeKnowledge } from "@/server/alexa/knowledge-synthesis";
import { mentionsKnowledgeBookTitle } from "@/server/alexa/knowledge-response";
import type { ClientSql } from "@/server/jarvis/client-sql";

const DSM = "DSM-5 — Manuel diagnostique et statistique des troubles mentaux";
const DSM_VERSION = "sha256:be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53";
const MAUDSLEY = "The Maudsley Prescribing Guidelines in Psychiatry";
const MAUDSLEY_VERSION = "sha256:14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0";
const STAHL = "Prescriber's Guide (Stahl's Essential Psychopharmacology)";
const STAHL_VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3";
const SECTION = "Section II — Critères diagnostiques et codes › Troubles anxieux › Trouble panique › Critères diagnostiques";
const PHRASE = "Le trouble panique se caractérise par des attaques de panique récurrentes et inattendues.";
const MARQUEUR = "[dsm5-fr-2015-elsevier p.205|src:264]";

it.each([
  "DSM-5",
  "Diagnostic and Statistical Manual of Mental Disorders",
  "Manuel diagnostique et statistique des troubles mentaux",
  "The Maudsley Prescribing Guidelines in Psychiatry",
  "Taylor",
  "Prescriber's Guide",
  "Stahl's Essential Psychopharmacology",
])("recognizes approved knowledge-book names in spoken excerpts: %s", title => {
  expect(mentionsKnowledgeBookTitle(`According to ${title}, this passage describes a clinical topic.`)).toBe(true);
});

function clientPour(texte: string): ClientSql {
  return { rpc: async <T,>() => ({ data: [{
    chunk_id: "dsm-chunk", source_id: "dsm-source", source_titre: DSM, source_version: DSM_VERSION,
    section: SECTION, version_chunk: "struct-v2", langue: "fr", texte, score: 0.6,
    source_statut: "active", source_classification: "C4", source_approuvee_le: new Date("2026-01-01"),
    source_approuvee_par: "practitioner", source_revue_a_jour: true, source_remplacee_par: null,
    unit_id: "unit", parent_texte_hash: "parent", enfant_index: 0, enfants_total: 1,
  }] as T, error: null }) };
}

afterEach(() => { local.mockReset(); });

it("garde la source et la page vérifiées dans les métadonnées sans prononcer le titre", async () => {
  const result = await readKnowledge(clientPour(`${PHRASE} ${MARQUEUR}`), "Explique le trouble panique selon DSM");
  local.mockResolvedValue(JSON.stringify({ coverage: "supported",
    sentences: [{ text: PHRASE, evidence: [{ index: 1, quoteId: "q1" }] }] }));
  const events = await synthesizeKnowledge(result, "Explique le trouble panique selon DSM", "fr",
    new AbortController().signal, { compact: true });
  expect(events).toHaveLength(1);
  const event = events[0]!;
  expect(event.type).toBe("sentence");
  if (event.type !== "sentence") return;
  expect(event.kind).toBe("knowledge");
  expect(event.text).toBe(`Passage cité : « ${PHRASE} »`);
  expect(event.text).not.toContain(DSM);
  expect(event.sources[0]?.label).toContain(DSM);
  expect(event.sources[0]?.excerpt).toBe(PHRASE);
  // La source structurée conserve l'édition et la page vérifiées.
  expect(event.sources[0]?.provenance).toMatchObject({ edition: "5e éd.", annee: 2015, pageImprimee: 205, pagePdf: 264 });
});

it("ne prononce pas le titre dans la réponse directe tout en conservant la source structurée", async () => {
  const question = "Explique le trouble panique selon DSM";
  const result = await readKnowledge(clientPour(`${PHRASE} ${MARQUEUR}`), question);
  local.mockResolvedValue(JSON.stringify({ coverage: "supported",
    sentences: [{ text: PHRASE, evidence: [{ index: 1, quote: PHRASE }] }] }));
  const events = await synthesizeKnowledge(result, question, "fr", new AbortController().signal);
  const text = events.filter(event => event.type === "sentence").map(event => event.text).join(" ");
  const sources = events.flatMap(event => event.type === "sentence" ? event.sources : []);
  expect(text).not.toContain(DSM);
  expect(text).not.toContain("Source :");
  expect(sources.some(source => source.label.includes(DSM))).toBe(true);
  expect(sources.some(source => source.excerpt === PHRASE)).toBe(true);
  expect(sources.some(source => source.provenance?.pageImprimee === 205 && source.provenance?.pagePdf === 264)).toBe(true);
});

it("n'énonce pas le nom d'un ouvrage même s'il figure dans le passage cité", async () => {
  const quote = `Selon le DSM-5, ${PHRASE}`;
  const question = "Explique le trouble panique selon DSM";
  const result = await readKnowledge(clientPour(`${quote} ${MARQUEUR}`), question);
  local.mockResolvedValue(JSON.stringify({ coverage: "supported",
    sentences: [{ text: quote, evidence: [{ index: 1, quote }] }] }));
  const events = await synthesizeKnowledge(result, question, "fr", new AbortController().signal);
  const text = events.filter(event => event.type === "sentence").map(event => event.text).join(" ");
  const sources = events.flatMap(event => event.type === "sentence" ? event.sources : []);
  expect(text).not.toMatch(/\bDSM\s*[- ]?5\b/iu);
  expect(text).toContain(PHRASE);
  expect(text).toContain(`Passage cité : « ${PHRASE} »`);
  expect(sources.some(source => source.label.includes(DSM))).toBe(true);
});

it("keeps a source title out of the spoken fallback when local synthesis fails", async () => {
  const quote = `Selon le DSM-5, ${PHRASE}`;
  const question = "Explique le trouble panique selon DSM";
  const result = await readKnowledge(clientPour(`${quote} ${MARQUEUR}`), question);
  local.mockRejectedValue(new Error("LocalModelUnavailable"));
  const events = await synthesizeKnowledge(result, question, "fr", new AbortController().signal);
  const text = events.filter(event => event.type === "sentence").map(event => event.text).join(" ");
  const sources = events.flatMap(event => event.type === "sentence" ? event.sources : []);
  expect(text).not.toMatch(/\bDSM\s*[- ]?5\b/iu);
  expect(text).toContain(PHRASE);
  expect(sources.some(source => source.label.includes(DSM))).toBe(true);
  expect(sources.some(source => source.excerpt === PHRASE)).toBe(true);
});

it("uses the Prescriber's Guide as a Stahl alias while keeping its title out of speech", async () => {
  const quote = "Lithium works by modulating intracellular inositol signaling pathways involved in neuronal communication.";
  const question = "Comment agit le lithium selon le Prescriber's Guide ?";
  const client: ClientSql = { rpc: async <T,>() => ({ data: [{
    chunk_id: "stahl-citation-chunk", source_id: "stahl-citation-source", source_titre: STAHL,
    source_version: STAHL_VERSION, section: "How the Drug Works", version_chunk: "stahl-citation-v1",
    langue: "en", texte: `${quote} [stahl-prescribers-guide-7e-cup p.1029|src:1029]`, score: 0.6,
    source_statut: "active", source_classification: "C4", source_approuvee_le: new Date("2026-09-01"),
    source_approuvee_par: "synthetic-reviewer", source_revue_a_jour: true, source_remplacee_par: null,
    unit_id: "stahl-citation-unit", parent_texte_hash: "stahl-citation-parent", enfant_index: 1, enfants_total: 1,
  }] as T, error: null }) };
  const result = await readKnowledge(client, question);
  local.mockResolvedValue(JSON.stringify({ coverage: "supported",
    sentences: [{ text: quote, evidence: [{ index: 1, quote }] }] }));
  const events = await synthesizeKnowledge(result, question, "fr", new AbortController().signal);
  const text = events.filter(event => event.type === "sentence").map(event => event.text).join(" ");
  const sources = events.flatMap(event => event.type === "sentence" ? event.sources : []);
  expect(result.etat).toBe("ok");
  expect(text).toContain(quote);
  expect(text).not.toContain("Prescriber's Guide");
  expect(text).not.toContain("Stahl's Essential Psychopharmacology");
  expect(sources).toHaveLength(1);
  expect(sources[0]?.label).toContain(STAHL);
  expect(sources[0]?.provenance).toMatchObject({ edition: "7e éd.", annee: 2021, pageImprimee: 1029, pagePdf: 1029 });
});

it("uses Taylor as the Maudsley alias while keeping its title out of speech", async () => {
  const quote = "Lithium monitoring includes periodic renal and thyroid tests.";
  const question = "Quelles précautions de surveillance du lithium selon Taylor ?";
  const client: ClientSql = { rpc: async <T,>() => ({ data: [{
    chunk_id: "maudsley-citation-chunk", source_id: "maudsley-citation-source", source_titre: MAUDSLEY,
    source_version: MAUDSLEY_VERSION, section: "Lithium monitoring", version_chunk: "maudsley-citation-v1",
    langue: "en", texte: `${quote} [maudsley-prescribing-guidelines-2021-taylor-14e p.248|src:269]`, score: 0.6,
    source_statut: "active", source_classification: "C4", source_approuvee_le: new Date("2026-09-01"),
    source_approuvee_par: "synthetic-reviewer", source_revue_a_jour: true, source_remplacee_par: null,
    unit_id: "maudsley-citation-unit", parent_texte_hash: "maudsley-citation-parent", enfant_index: 1, enfants_total: 1,
  }] as T, error: null }) };
  const result = await readKnowledge(client, question);
  local.mockResolvedValue(JSON.stringify({ coverage: "supported",
    sentences: [{ text: quote, evidence: [{ index: 1, quote }] }] }));
  const events = await synthesizeKnowledge(result, question, "fr", new AbortController().signal);
  const text = events.filter(event => event.type === "sentence").map(event => event.text).join(" ");
  const sources = events.flatMap(event => event.type === "sentence" ? event.sources : []);
  expect(result.etat).toBe("ok");
  expect(text).toContain(quote);
  expect(text).not.toContain("The Maudsley Prescribing Guidelines");
  expect(text).not.toContain("Taylor");
  expect(sources).toHaveLength(1);
  expect(sources[0]?.label).toContain(MAUDSLEY);
  expect(sources[0]?.provenance).toMatchObject({ edition: "14e éd.", annee: 2021, pageImprimee: 248, pagePdf: 269 });
});

it("n'invente aucune page quand le chunk n'en porte pas, et ne cite pas une source inutilisée", async () => {
  const result = await readKnowledge(clientPour(`${PHRASE} Sans marqueur de page.`), "Explique le trouble panique selon DSM");
  local.mockResolvedValue(JSON.stringify({ coverage: "supported",
    sentences: [{ text: PHRASE, evidence: [{ index: 1, quoteId: "q1" }] }] }));
  const events = await synthesizeKnowledge(result, "Explique le trouble panique selon DSM", "fr",
    new AbortController().signal, { compact: true });
  const event = events[0]!;
  if (event.type !== "sentence") throw new Error("sentence attendue");
  expect(event.text).toBe(`Passage cité : « ${PHRASE} »`);
  expect(event.text).not.toContain(DSM);
  expect(event.text).not.toMatch(/\bp\.\s*\d/u);
  expect(event.sources[0]?.provenance).not.toHaveProperty("pageImprimee");
  expect(event.sources[0]?.label).not.toMatch(/\bp\.\s*\d/u);
});

it("ignore la page soufflée par le modèle et ne garde que le passage source vérifié", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const result = await readKnowledge(clientPour(`${PHRASE} ${MARQUEUR}`), "Explique le trouble panique selon DSM");
    local.mockResolvedValue(JSON.stringify({ coverage: "supported",
      sentences: [{ text: `${PHRASE} Voir page 999.`, evidence: [{ index: 1, quoteId: "q1" }] }] }));
    const events = await synthesizeKnowledge(result, "Explique le trouble panique selon DSM", "fr",
      new AbortController().signal, { compact: true });
    expect(events.some(e => e.type === "sentence" && e.kind === "inference")).toBe(false);
    const spoken = events.filter(e => e.type === "sentence" && e.kind === "knowledge");
    expect(spoken.map(e => e.type === "sentence" ? e.text : "").join(" ")).toBe(`Passage cité : « ${PHRASE} »`);
    expect(spoken.some(e => e.type === "sentence" && e.text.includes("999"))).toBe(false);
    expect(spoken.flatMap(e => e.type === "sentence" ? e.sources : []).map(source => source.provenance.pageImprimee)).toContain(205);
    expect(warn).not.toHaveBeenCalledWith("[alexa-knowledge] source-fallback", "number");
  } finally { warn.mockRestore(); }
});
