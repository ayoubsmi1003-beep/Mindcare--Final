import { describe, expect, it } from "vitest";
import { planRequest } from "@/shared/alexa/request-plan";
import { knowledgeResponseEvents, type KnowledgeResult } from "@/server/alexa/knowledge-response";

describe("explicit mixed patient and approved-book requests", () => {
  it.each([
    ["résume ce dossier et cite les références", "summary"],
    ["les cinq dernières consultations selon le DSM", "history"],
    ["traitement actuel et références du livre", "treatments"],
    ["لخص هذا المريض حسب المراجع", "summary"],
    ["traitement الحالي حسب DSM", "treatments"],
  ])("adds governed retrieval to %s", (text, intent) => {
    expect(planRequest(text, null)).toMatchObject({ intent, includeKnowledge: true });
  });

  it.each(["traitement actuel", "les cinq dernières consultations", "résumé du cas"])("keeps ordinary record requests local: %s", text => {
    expect(planRequest(text, null)).not.toHaveProperty("includeKnowledge");
  });

  it.each(["explique le traitement de la dépression selon le livre", "définition DSM de la dépression", "اشرح العلاج حسب المراجع"])("routes general medical questions without patient access: %s", text => {
    expect(planRequest(text, null)).toMatchObject({ intent: "knowledge" });
    expect(planRequest(text, null)).not.toHaveProperty("includeKnowledge");
  });

  it("retains confirmation priority and freshly classifies an explicit book request", () => {
    expect(planRequest("modifie le traitement actuel selon le DSM", null)).toMatchObject({ intent: "proposal" });
    const previous = { intent: "treatments" as const, count: 1 };
    expect(planRequest("définition DSM de la dépression", previous)).toMatchObject({ intent: "knowledge" });
  });
});

describe("separate attributed knowledge response", () => {
  const proof = { titre: "Approved source", section: "Recorded section", version: "v2", extrait: "Source excerpt",
    sourceId: "source", chunkId: "chunk", versionChunk: "chunk-v3", unitId: "unit", parentTexteHash: "hash",
    enfantIndex: 1, enfantsTotal: 2 };
  it("retains exact lineage and version without inventing a page or patient conclusion", () => {
    const events = knowledgeResponseEvents({ etat: "ok", preuves: [proof] }, "fr", true);
    expect(events[0]?.text).toContain("ne constituent pas une conclusion");
    expect(events[1]).toMatchObject({ kind: "knowledge", text: proof.extrait, sources: [{
      id: "chunk", type: "knowledge", version: "v2", label: "Approved source · Recorded section · v2",
      provenance: { sourceId: "source", chunkId: "chunk", versionChunk: "chunk-v3", unitId: "unit",
        parentTexteHash: "hash", enfantIndex: 1, enfantsTotal: 2 },
    }] });
    expect(events[1]?.sources[0]?.provenance).not.toHaveProperty("page");
  });
  it.each(["faible", "sans-preuve", "panne"] as const)("does not present excerpts as proof after %s", etat => {
    const result: KnowledgeResult = etat === "panne" ? { etat, preuves: [] } : { etat, preuves: [proof] };
    const events = knowledgeResponseEvents(result, "fr", true);
    expect(events).toHaveLength(1);
    expect(events[0]?.sources).toEqual([]);
    expect(events[0]?.text).not.toContain(proof.extrait);
  });
  it("keeps Arabic response text and locally removes known identities from excerpts", () => {
    const events = knowledgeResponseEvents({ etat: "ok", preuves: [{ ...proof, extrait: "Synthetic Name: source" }] }, "ar", true, ["Synthetic", "Name"]);
    expect(events[0]?.text).toContain("مراجع عامة");
    expect(events[1]?.text).not.toContain("Synthetic");
    expect(events[1]?.text).not.toContain("Name");
  });
  it.each(["ok", "sans-preuve"] as const)("discloses whole oversized passage omission after %s", etat => {
    const events = knowledgeResponseEvents({ etat, preuves: etat === "ok" ? [proof] : [], omittedLongPassages: true }, "fr");
    expect(events.at(-1)?.text).toMatch(/passages.*longs.*pas.*affichés/iu);
    if (etat === "ok") expect(events[0]?.text).toBe(proof.extrait);
  });
});
