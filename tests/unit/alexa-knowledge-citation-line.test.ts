import { afterEach, expect, it, vi } from "vitest";

const { local } = vi.hoisted(() => ({ local: vi.fn() }));
vi.mock("@/server/alexa/local-model", () => ({ inferLocalText: local }));
vi.mock("@/server/egress/external-call", () => ({ llm: () => { throw new Error("UnexpectedCloudText"); } }));

import { readKnowledge } from "@/server/alexa/knowledge-adapter";
import { synthesizeKnowledge } from "@/server/alexa/knowledge-synthesis";
import type { ClientSql } from "@/server/jarvis/client-sql";

const DSM = "DSM-5 — Manuel diagnostique et statistique des troubles mentaux";
const DSM_VERSION = "sha256:be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53";
const SECTION = "Section II — Critères diagnostiques et codes › Troubles anxieux › Trouble panique › Critères diagnostiques";
const PHRASE = "Le trouble panique se caractérise par des attaques de panique récurrentes et inattendues.";
const MARQUEUR = "[dsm5-fr-2015-elsevier p.205|src:264]";

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

it("ajoute une ligne de sources vérifiée, avec édition et page lues dans le chunk", async () => {
  const result = await readKnowledge(clientPour(`${PHRASE} ${MARQUEUR}`), "Explique le trouble panique selon DSM");
  local.mockResolvedValue(JSON.stringify({ coverage: "supported",
    sentences: [{ text: PHRASE, evidence: [{ index: 1, quoteId: "q1" }] }] }));
  const events = await synthesizeKnowledge(result, "Explique le trouble panique selon DSM", "fr",
    new AbortController().signal, { compact: true });
  expect(events).toHaveLength(1);
  const event = events[0]!;
  expect(event.type).toBe("sentence");
  if (event.type !== "sentence") return;
  expect(event.kind).toBe("inference");
  expect(event.text).toBe(`${PHRASE} Source : ${DSM} (5e éd., 2015), p. 205.`);
  // La citation n'est pas seulement du texte : la source porte la page.
  expect(event.sources[0]?.provenance).toMatchObject({ edition: "5e éd.", annee: 2015, pageImprimee: 205, pagePdf: 264 });
});

it("n'invente aucune page quand le chunk n'en porte pas, et ne cite pas une source inutilisée", async () => {
  const result = await readKnowledge(clientPour(`${PHRASE} Sans marqueur de page.`), "Explique le trouble panique selon DSM");
  local.mockResolvedValue(JSON.stringify({ coverage: "supported",
    sentences: [{ text: PHRASE, evidence: [{ index: 1, quoteId: "q1" }] }] }));
  const events = await synthesizeKnowledge(result, "Explique le trouble panique selon DSM", "fr",
    new AbortController().signal, { compact: true });
  const event = events[0]!;
  if (event.type !== "sentence") throw new Error("sentence attendue");
  expect(event.text).toBe(`${PHRASE} Source : ${DSM} (5e éd., 2015).`);
  expect(event.text).not.toMatch(/\bp\.\s*\d/u);
  expect(event.sources[0]?.provenance).not.toHaveProperty("pageImprimee");
  expect(event.sources[0]?.label).not.toMatch(/\bp\.\s*\d/u);
});

it("refuse une page soufflée par le modèle : le nombre non ancré fait échouer la synthèse", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const result = await readKnowledge(clientPour(`${PHRASE} ${MARQUEUR}`), "Explique le trouble panique selon DSM");
    local.mockResolvedValue(JSON.stringify({ coverage: "supported",
      sentences: [{ text: `${PHRASE} Voir page 999.`, evidence: [{ index: 1, quoteId: "q1" }] }] }));
    const events = await synthesizeKnowledge(result, "Explique le trouble panique selon DSM", "fr",
      new AbortController().signal, { compact: true });
    expect(events.some(e => e.type === "sentence" && e.kind === "inference")).toBe(false);
    expect(warn).toHaveBeenCalledWith("[alexa-knowledge] source-fallback", "number");
  } finally { warn.mockRestore(); }
});
