import { afterEach, expect, it, vi } from "vitest";
const { local, cloud } = vi.hoisted(() => ({ local: vi.fn(), cloud: vi.fn(() => { throw new Error("UnexpectedCloudText"); }) }));
vi.mock("@/server/alexa/local-model", () => ({ inferLocalText: local }));
vi.mock("@/server/egress/external-call", () => ({ llm: cloud }));
import { synthesizeKnowledge } from "@/server/alexa/knowledge-synthesis";
import { readKnowledge } from "@/server/alexa/knowledge-adapter";
import type { ClientSql } from "@/server/jarvis/client-sql";
const quote = "Critères de la dépression : le texte de référence décrit les critères documentés.";
const client: ClientSql = { rpc: async <T>() => ({ data: [{
  chunk_id: "synthetic-chunk", source_id: "synthetic-dsm", source_titre: "DSM-5 — Manuel diagnostique et statistique des troubles mentaux",
  source_version: "synthetic-v1", section: "Synthetic", version_chunk: "synthetic-c1", langue: "fr", texte: quote, score: 0.6,
  source_statut: "active", source_classification: "C4", source_approuvee_le: new Date("2026-01-01"),
  source_approuvee_par: "synthetic-reviewer", source_revue_a_jour: true, source_remplacee_par: null,
  unit_id: "synthetic-unit", parent_texte_hash: "synthetic-parent", enfant_index: 1, enfants_total: 1,
}] as T, error: null }) };
afterEach(() => { local.mockReset(); cloud.mockClear(); });
it("synthesizes only immutable approved passages locally and preserves provenance", async () => {
  const result = await readKnowledge(client, "critères dépression selon DSM");
  expect(result.etat).toBe("ok");
  local.mockResolvedValue(JSON.stringify({ coverage: "supported", sentences: [{ text: quote, evidence: [{ index: 1, quote }] }] }));
  const events = await synthesizeKnowledge(result, "critères dépression selon DSM", "fr", new AbortController().signal);
  expect(events.some(event => event.type === "sentence" && event.sources.some(source => source.id === "synthetic-chunk"))).toBe(true);
  expect(local).toHaveBeenCalledOnce(); expect(cloud).not.toHaveBeenCalled();
  expect(JSON.stringify(local.mock.calls[0]![0])).not.toContain("synthetic-chunk");
});
it.each([
  { coverage: "supported", sentences: [{ text: quote, evidence: [{ index: 1, quote: "citation inventée absente du passage" }] }] },
  { coverage: "supported", sentences: [{ text: "La dose est de 999 mg.", evidence: [{ index: 1, quote }] }] },
  { coverage: "supported", sentences: [{ text: "Votre patient va mieux.", evidence: [{ index: 1, quote }] }] },
])("keeps unsafe or unsupported local synthesis behind the literal-source fallback", async answer => {
  const result = await readKnowledge(client, "critères dépression selon DSM");
  local.mockResolvedValue(JSON.stringify(answer));
  const events = await synthesizeKnowledge(result, "critères dépression selon DSM", "fr", new AbortController().signal);
  expect(events.some(event => event.type === "sentence" && event.kind === "inference")).toBe(false);
  expect(events.some(event => event.type === "sentence" && event.sources.length > 0)).toBe(true);
  expect(cloud).not.toHaveBeenCalled();
});
it("refuses a forged retrieval before inference", async () => {
  const result = await readKnowledge(client, "critères dépression selon DSM");
  await synthesizeKnowledge({ ...result }, "critères dépression selon DSM", "fr", new AbortController().signal);
  expect(local).not.toHaveBeenCalled(); expect(cloud).not.toHaveBeenCalled();
});
it("returns literal sources when MiniCPM is unavailable without trying a cloud model", async () => {
  local.mockRejectedValue(new Error("LocalModelUnavailable"));
  const result = await readKnowledge(client, "critères dépression selon DSM");
  const events = await synthesizeKnowledge(result, "critères dépression selon DSM", "fr", new AbortController().signal);
  expect(events.some(event => event.type === "sentence" && event.sources.length > 0)).toBe(true);
  expect(local).toHaveBeenCalledOnce(); expect(cloud).not.toHaveBeenCalled();
});
