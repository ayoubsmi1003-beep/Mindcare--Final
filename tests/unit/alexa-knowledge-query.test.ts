import { describe, expect, it } from "vitest";
import { readKnowledge } from "@/server/alexa/knowledge-adapter";
import type { ArgsJarvis, ClientSql } from "@/server/jarvis/client-sql";

const DSM = "DSM-5 — Manuel diagnostique et statistique des troubles mentaux";
const MAUDSLEY = "The Maudsley Prescribing Guidelines in Psychiatry";
const row = (title: string, text: string, extra: Record<string, unknown> = {}) => ({
  chunk_id: title === DSM ? "dsm-chunk" : "maudsley-chunk", source_id: title,
  source_titre: title, source_version: "source-v1", section: null, version_chunk: "chunk-v2",
  langue: title === DSM ? "fr" : "en", texte: text, score: 0.6,
  source_statut: "active", source_classification: "C4", source_approuvee_le: new Date("2026-09-01"),
  source_approuvee_par: "synthetic-reviewer", source_revue_a_jour: true, source_remplacee_par: null,
  unit_id: "unit", parent_texte_hash: "parent-hash", enfant_index: 1, enfants_total: 2, ...extra,
});
function boundary(rows: unknown[]) {
  const calls: { gate: string; args: ArgsJarvis }[] = [];
  const client: ClientSql = { rpc: async <T>(gate: string, args: ArgsJarvis = {}) => {
    calls.push({ gate, args });
    return { data: rows as T, error: null };
  } };
  return { client, calls };
}

describe("bounded Alexa lexical question planning", () => {
  it("retrieves a natural DSM question with its clinical terms and exact source restriction", async () => {
    const { client, calls } = boundary([
      row(MAUDSLEY, "Critères de la dépression"), row(DSM, "Critères de la dépression"),
    ]);
    const result = await readKnowledge(client, "Explique-moi les critères de la dépression selon le DSM-5.");
    expect(result.etat).toBe("ok");
    expect(result.preuves.map(proof => proof.titre)).toEqual([DSM]);
    expect(calls).toEqual([{ gate: "search_knowledge_lexical", args: {
      p_requete: "criteres depression", p_langue: "fr", p_limite: 20,
    } }]);
    expect(result.preuves[0]).toMatchObject({ version: "source-v1", versionChunk: "chunk-v2",
      unitId: "unit", parentTexteHash: "parent-hash", enfantIndex: 1, enfantsTotal: 2 });
  });

  it.each(["DSM-5-TR", "DSM5TR", "DSM-IV"])(
    "refuses an unobserved DSM edition before SQL: %s", async edition => {
      const { client, calls } = boundary([row(DSM, "Critères dépression DSM IV")]);
      expect(await readKnowledge(client, `Quels sont les critères de la dépression selon ${edition} ?`))
        .toEqual({ etat: "sans-preuve", preuves: [] });
      expect(calls).toEqual([]);
    });

  it.each(["DSM5", "DSM-5"])(
    "keeps the observed edition %s and the dose and population restrictions", async edition => {
      const { client, calls } = boundary([
        row(MAUDSLEY, "Dose sertraline 5 mg enfants"), row(DSM, "Dose sertraline 5 mg enfants"),
      ]);
      const result = await readKnowledge(client, `Quelle dose de sertraline 5 mg chez les enfants selon ${edition} ?`);
      expect(result.etat).toBe("ok");
      expect(result.preuves.map(proof => proof.titre)).toEqual([DSM]);
      expect(calls).toEqual([{ gate: "search_knowledge_lexical", args: {
        p_requete: "dose sertraline 5 mg enfants", p_langue: "fr", p_limite: 20,
      } }]);
    });

  it.each(["ما هي معايير الاكتئاب حسب DSM؟", "واش يقول DSM على الاكتئاب؟"])(
    "uses documented local topic aliases for %s", async question => {
      const { client, calls } = boundary([row(DSM, "Critères de la dépression")]);
      const result = await readKnowledge(client, question);
      expect(result.etat).toBe("ok");
      expect(result.preuves.map(proof => proof.titre)).toEqual([DSM]);
      expect(calls[0]?.args["p_requete"]).toMatch(/depression/u);
      expect(calls[0]?.args["p_langue"]).toBe("fr");
      expect(calls).toHaveLength(1);
    });

  it("uses English clinical terms for an explicit Maudsley question", async () => {
    const { client, calls } = boundary([
      row(DSM, "Dose sertraline"), row(MAUDSLEY, "Dose sertraline"),
    ]);
    const result = await readKnowledge(client, "Quelle est la dose de sertraline selon Maudsley ?");
    expect(result.etat).toBe("ok");
    expect(result.preuves.map(proof => proof.titre)).toEqual([MAUDSLEY]);
    expect(calls[0]?.args).toEqual({ p_requete: "dose sertraline", p_langue: "en", p_limite: 20 });
  });

  it("translates the known French treatment term when Maudsley is explicitly requested", async () => {
    const { client, calls } = boundary([row(MAUDSLEY, "Treatment depression")]);
    expect((await readKnowledge(client, "Que dit Maudsley sur le traitement de la dépression ?")).etat).toBe("ok");
    expect(calls[0]?.args["p_requete"]).toBe("treatment depression");
  });

  it.each(["selon le livre Inconnu, explique la dépression", "explique la dépression selon Harrison"])(
    "fails closed on an unknown requested book: %s", async question => {
      const { client, calls } = boundary([row(DSM, "Dépression")]);
      expect(await readKnowledge(client, question)).toEqual({ etat: "sans-preuve", preuves: [] });
      expect(calls).toEqual([]);
    });

  it("does not substitute another approved book when the requested book is absent", async () => {
    const { client } = boundary([row(MAUDSLEY, "Critères dépression")]);
    expect(await readKnowledge(client, "critères dépression selon DSM")).toEqual({ etat: "sans-preuve", preuves: [] });
  });

  it("retains type I and II in separate bounded queries for a bipolar comparison", async () => {
    const { client, calls } = boundary([row(DSM, "Trouble bipolaire type I et type II")]);
    expect((await readKnowledge(client, "Quelle différence entre trouble bipolaire type I et type II selon DSM ?")).etat).toBe("ok");
    expect(calls.map(call => call.args["p_requete"])).toEqual([
      "trouble bipolaire type i", "trouble bipolaire type ii",
    ]);
    expect(calls.every(call => call.gate === "search_knowledge_lexical" && call.args["p_limite"] === 20)).toBe(true);
  });

  it("keeps clinical quantity and age restrictions instead of falling back to the drug alone", async () => {
    const { client, calls } = boundary([]);
    await readKnowledge(client, "Quelle dose de sertraline 25 mg chez les enfants selon Maudsley ?");
    expect(calls[0]?.args["p_requete"]).toBe("dose sertraline 25 mg children");
    expect(calls).toHaveLength(1);
  });

  it.each([["5", "5"], ["2,5", "2,5"], ["-25", "-25"], ["1/2", "1/2"], ["٥", "5"], ["٢٫٥", "2.5"]])(
    "retains the numeric dose qualifier %s", async (quantity, canonical) => {
    const { client, calls } = boundary([]);
    await readKnowledge(client, `Quelle dose de sertraline ${quantity} mg selon Maudsley ?`);
    expect(calls[0]?.args["p_requete"]).toBe(`dose sertraline ${canonical} mg`);
    expect(calls).toHaveLength(1);
    });

  it("retains weak evidence as weak without changing the calibration", async () => {
    const { client } = boundary([row(DSM, "Dépression")]);
    expect((await readKnowledge(client, "depression anxiete psychose")).etat).toBe("faible");
  });

  it("still rejects an unapproved source returned by a boundary", async () => {
    const { client } = boundary([row(DSM, "Critères dépression", { source_approuvee_le: null })]);
    expect(await readKnowledge(client, "Quels sont les critères de la dépression selon DSM ?")).toEqual({ etat: "sans-preuve", preuves: [] });
  });

  it("does not collapse an unsupported topic into a generic clinical query", async () => {
    const { client, calls } = boundary([]);
    expect(await readKnowledge(client, "recette couscous")).toEqual({ etat: "sans-preuve", preuves: [] });
    expect(calls[0]?.args["p_requete"]).toBe("recette couscous");
  });

  it("returns panne on the existing RPC failure boundary", async () => {
    const client: ClientSql = { rpc: async () => ({ data: null,
      error: { code: "indisponible", message: "Synthetic boundary unavailable", context: "test" } }) };
    expect(await readKnowledge(client, "dépression")).toEqual({ etat: "panne", preuves: [] });
  });

  it("retains a complete governed passage including the restriction beyond character 800", async () => {
    const passage = `${"Dose sertraline. ".repeat(70)}Ne pas ignorer la restriction finale.`;
    const { client } = boundary([row(MAUDSLEY, passage)]);
    const result = await readKnowledge(client, "dose sertraline selon Maudsley");
    expect(result.etat).toBe("ok");
    expect(result.preuves[0]?.extrait).toBe(passage);
  });

  it("omits an oversized whole passage and flags the omission instead of cutting a dose or negation", async () => {
    const { client } = boundary([row(MAUDSLEY, "Dose sertraline. ".repeat(300))]);
    expect(await readKnowledge(client, "dose sertraline selon Maudsley")).toMatchObject({
      etat: "sans-preuve", preuves: [], omittedLongPassages: true,
    });
  });

  it("qualifies complete retained passages after omitting an oversized candidate", async () => {
    const { client } = boundary([
      row(MAUDSLEY, "Dose sertraline. ".repeat(300), { chunk_id: "too-long" }),
      row(MAUDSLEY, "Dose sertraline. Restriction complete.", { chunk_id: "complete" }),
    ]);
    const result = await readKnowledge(client, "dose sertraline selon Maudsley");
    expect(result).toMatchObject({ etat: "ok", omittedLongPassages: true });
    expect(result.preuves.map(proof => proof.chunkId)).toEqual(["complete"]);
  });

  it("does not reveal the presence of an unapproved oversized passage", async () => {
    const { client } = boundary([row(MAUDSLEY, "Dose sertraline. ".repeat(300), { source_approuvee_le: null })]);
    const result = await readKnowledge(client, "dose sertraline selon Maudsley");
    expect(result).toMatchObject({ etat: "sans-preuve", preuves: [] });
    expect(result).not.toHaveProperty("omittedLongPassages");
  });

  it("keeps a contraindication question distinct from a dose question on the same medication", async () => {
    const { client, calls } = boundary([]);
    await readKnowledge(client, "Quelle dose de sertraline selon Maudsley ?");
    await readKnowledge(client, "Quelles contre-indications de sertraline selon Maudsley ?");
    expect(calls.map(call => call.args["p_requete"])).toEqual(["dose sertraline", "contraindications sertraline"]);
  });
});
