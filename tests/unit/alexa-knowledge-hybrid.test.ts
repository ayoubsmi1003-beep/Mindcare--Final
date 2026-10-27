import { describe, expect, it, vi } from "vitest";

import { readKnowledge } from "@/server/alexa/knowledge-adapter";
import type { CandidatFusionne } from "@/server/knowledge/recherche";
import type { CandidatRange, RerankerLocalAsync } from "@/server/knowledge/rerank";
import type { ArgsJarvis, ClientSql } from "@/server/jarvis/client-sql";

const DSM = "DSM-5 — Manuel diagnostique et statistique des troubles mentaux";
const VERSION = "sha256:be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53";
const SECTION = "Section II — Critères diagnostiques et codes › Troubles anxieux › Trouble panique › Critères diagnostiques";

function ligne(chunkId: string, texte: string, extra: Record<string, unknown> = {}) {
  return {
    chunk_id: chunkId, source_id: "dsm-source", source_titre: DSM, source_version: VERSION,
    section: SECTION, version_chunk: "struct-v2", langue: "fr", texte, score: 0.6,
    source_statut: "active", source_classification: "C4",
    source_approuvee_le: new Date("2026-01-01"), source_approuvee_par: "practitioner",
    source_revue_a_jour: true, source_remplacee_par: null,
    unit_id: null, parent_texte_hash: null, enfant_index: null, enfants_total: null,
    ...extra,
  };
}

function clientHybride(options: {
  lexicaux: unknown[];
  vectoriels?: unknown[] | "panne";
  journal?: { gate: string; args: ArgsJarvis }[];
}): ClientSql {
  return {
    rpc: async <T,>(gate: string, args: ArgsJarvis = {}) => {
      options.journal?.push({ gate, args });
      if (gate.startsWith("search_knowledge_vector")) {
        if (options.vectoriels === "panne") return { data: null, error: { code: "indisponible", message: "panne", context: "test" } };
        return { data: (options.vectoriels ?? []) as T, error: null };
      }
      return { data: options.lexicaux as T, error: null };
    },
  };
}

const vecteur = () => {
  const v = new Array<number>(1024).fill(0);
  v[0] = 1;
  return v;
};

describe("readKnowledge : une feuille de section est une préférence, jamais une condition", () => {
  const QUESTION = "Comment le DSM-5 définit-il le trouble dépressif caractérisé ?";
  const clientSection = (section: string, len = 400) => ({
    rpc: async <T,>() => ({ data: [{
      chunk_id: "chunk-feuille", source_id: "dsm", source_titre: DSM, source_version: VERSION,
      section, version_chunk: "struct-v2", langue: "fr",
      texte: `${"Le trouble est documenté par des caractéristiques cliniques précises. ".repeat(Math.ceil(len / 63))} [dsm5-fr-2015-elsevier p.180|src:240]`,
      score: 0.7, source_statut: "active", source_classification: "C4",
      source_approuvee_le: new Date("2026-01-01"), source_approuvee_par: "practitioner",
      source_revue_a_jour: true, source_remplacee_par: null,
      unit_id: null, parent_texte_hash: null, enfant_index: null, enfants_total: null,
    }] as T, error: null }),
  });

  it("rejoue sans la feuille quand la feuille stricte ne rend aucune preuve exploitable", async () => {
    const result = await readKnowledge(clientSection("Section II › Troubles dépressifs › Trouble dépressif caractérisé › Critères diagnostiques"),
      QUESTION);
    expect(result.etat).not.toBe("sans-preuve");
    expect(result.preuves.length).toBeGreaterThan(0);
    expect(result).toMatchObject({ sectionLeafRelaxed: true });
    expect(result.preuves[0]?.page?.libelle).toBe("p. 180");
  });

  it("ne relâche jamais le focus de diagnostic : un autre trouble reste refusé", async () => {
    const result = await readKnowledge(clientSection("Section II › Troubles anxieux › Trouble panique › Critères diagnostiques"),
      QUESTION);
    expect(result.etat).toBe("sans-preuve");
    expect(result.preuves).toEqual([]);
  });

  it("ne rejoue pas quand la passe stricte a déjà une preuve", async () => {
    const result = await readKnowledge(clientSection("Section II › Troubles dépressifs › Trouble dépressif caractérisé › Caractéristiques diagnostiques"),
      QUESTION);
    expect(result.etat).not.toBe("sans-preuve");
    expect(result).not.toHaveProperty("sectionLeafRelaxed");
  });
});

describe("readKnowledge : jambe vectorielle explicite et dégradation nommée", () => {
  it("n'appelle aucune porte vectorielle quand la jambe est éteinte", async () => {
    const journal: { gate: string; args: ArgsJarvis }[] = [];
    const client = clientHybride({ lexicaux: [ligne("l1", "Le trouble panique se caractérise par des attaques récurrentes.")], journal });
    const result = await readKnowledge(client, "Quels sont les critères du trouble panique selon le DSM-5 ?", undefined,
      { vectorActif: false });
    expect(result.etat).toBe("ok");
    expect(journal.length).toBeGreaterThan(0);
    expect(journal.every((c) => c.gate === "search_knowledge_lexical")).toBe(true);
    expect(result).not.toHaveProperty("vectoriel");
  });

  it("interroge les deux portes en parallèle de l'embedding et fusionne les preuves", async () => {
    const journal: { gate: string; args: ArgsJarvis }[] = [];
    const client = clientHybride({
      lexicaux: [ligne("lexical", "Le trouble panique se caractérise par des attaques récurrentes.")],
      vectoriels: [ligne("vectoriel", "Le trouble panique se caractérise par des attaques inattendues.", { score: 0.91 })],
      journal,
    });
    const result = await readKnowledge(client, "Quels sont les critères du trouble panique selon le DSM-5 ?", undefined,
      { vectorActif: true, vecteurRequete: async () => vecteur() });
    expect(result.etat).toBe("ok");
    expect(result.preuves.map((p) => p.chunkId).sort()).toEqual(["lexical", "vectoriel"]);
    const vectorCall = journal.find((c) => c.gate === "search_knowledge_vector");
    expect(vectorCall).toBeDefined();
    expect(typeof vectorCall?.args["p_embedding_json"]).toBe("string");
    expect(String(vectorCall?.args["p_embedding_json"]).startsWith("[1,0,")).toBe(true);
    expect(result).not.toHaveProperty("vectoriel");
  });

  it("dégrade en lexical NOMBLÉ quand la porte vectorielle échoue, sans perdre la réponse", async () => {
    const client = clientHybride({
      lexicaux: [ligne("lexical", "Le trouble panique se caractérise par des attaques récurrentes.")],
      vectoriels: "panne",
    });
    const result = await readKnowledge(client, "Quels sont les critères du trouble panique selon le DSM-5 ?", undefined,
      { vectorActif: true, vecteurRequete: async () => vecteur() });
    expect(result.etat).toBe("ok");
    expect(result.preuves.map((p) => p.chunkId)).toEqual(["lexical"]);
    expect(result).toMatchObject({ vectoriel: "indisponible" });
  });

  it("dégrade en lexical NOMBLÉ quand le modèle local est absent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const client = clientHybride({ lexicaux: [ligne("lexical", "Le trouble panique se caractérise par des attaques récurrentes.")] });
      const result = await readKnowledge(client, "Quels sont les critères du trouble panique selon le DSM-5 ?", undefined,
        { vectorActif: true, vecteurRequete: async () => null });
      expect(result).toMatchObject({ etat: "ok", vectoriel: "indisponible" });
    } finally { warn.mockRestore(); }
  });

  it("applique le cross-encoder injecté et signale le repli quand il échoue", async () => {
    const journal: { gate: string; args: ArgsJarvis }[] = [];
    const client = clientHybride({
      lexicaux: [
        ligne("a", "Le trouble panique se caractérise par des attaques récurrentes.", { chunk_id: "a" }),
        ligne("b", "Le trouble panique se caractérise par des attaques inattendues.", { chunk_id: "b" }),
      ],
      journal,
    });
    const ordre: string[] = [];
    const reranker: RerankerLocalAsync = {
      nom: "test-cross-encoder", version: "v-test",
      reranker: () => [],
      rerankerAsync: async (_q: string, candidats: readonly CandidatFusionne[], topN = 5): Promise<CandidatRange[]> => {
        ordre.push(...candidats.map((c) => c.chunkId));
        return candidats.slice(0, topN).map((candidat) => ({ candidat, score: 0.9, apparies: [] }));
      },
    };
    const result = await readKnowledge(client, "Quels sont les critères du trouble panique selon le DSM-5 ?", undefined,
      { vectorActif: false, rerankerLocal: reranker });
    expect(ordre.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("reranker");
  });

  it("signale un repli de reranker au lieu de prétendre avoir reranké", async () => {
    const client = clientHybride({ lexicaux: [ligne("a", "Le trouble panique se caractérise par des attaques récurrentes.")] });
    const reranker: RerankerLocalAsync = {
      nom: "test-cross-encoder", version: "v-test",
      reranker: () => [],
      rerankerAsync: async () => { throw new Error("panne simulée"); },
    };
    const result = await readKnowledge(client, "Quels sont les critères du trouble panique selon le DSM-5 ?", undefined,
      { vectorActif: false, rerankerLocal: reranker });
    expect(result).toMatchObject({ reranker: "repli" });
  });

  it("choisit la porte SECONDAIRE quand le couple modele/version est fourni", async () => {
    const journal: { gate: string; args: ArgsJarvis }[] = [];
    const client = clientHybride({
      lexicaux: [ligne("a", "Le trouble panique se caractérise par des attaques récurrentes.")],
      vectoriels: [ligne("v", "Le trouble panique se caractérise par des attaques inattendues.", { score: 0.91 })],
      journal,
    });
    const result = await readKnowledge(client, "Quels sont les critères du trouble panique selon le DSM-5 ?", undefined,
      { vectorActif: true, vecteurRequete: async () => vecteur(),
        vectorielSecondaire: { modele: "intfloat/multilingual-e5-small", version: "614241f" } });
    const secondaire = journal.find((c) => c.gate === "search_knowledge_vector_v2");
    expect(secondaire).toBeDefined();
    expect(secondaire?.args).toMatchObject({ p_modele: "intfloat/multilingual-e5-small", p_version: "614241f", p_limite: 24 });
    expect(journal.some((c) => c.gate === "search_knowledge_vector")).toBe(false);
    expect(result.etat).toBe("ok");
  });

  it("garde l'ancienne porte quand aucun index secondaire n'est configuré", async () => {
    const journal: { gate: string; args: ArgsJarvis }[] = [];
    const client = clientHybride({
      lexicaux: [ligne("a", "Le trouble panique se caractérise par des attaques récurrentes.")],
      vectoriels: [],
      journal,
    });
    await readKnowledge(client, "Quels sont les critères du trouble panique selon le DSM-5 ?", undefined,
      { vectorActif: true, vecteurRequete: async () => vecteur() });
    expect(journal.some((c) => c.gate === "search_knowledge_vector")).toBe(true);
    expect(journal.some((c) => c.gate === "search_knowledge_vector_v2")).toBe(false);
  });

  it("n'injecte jamais la page d'un autre ouvrage venu de la branche vectorielle", async () => {
    const client = clientHybride({
      lexicaux: [],
      vectoriels: [ligne("vectoriel", "Critères du trouble panique. [maudsley-prescribing-guidelines-2021-taylor-14e p.248|src:269]", { score: 0.91 })],
    });
    const result = await readKnowledge(client, "Quels sont les critères du trouble panique selon le DSM-5 ?", undefined,
      { vectorActif: true, vecteurRequete: async () => vecteur() });
    expect(result.etat).toBe("ok");
    expect(result.preuves[0]?.page).toBeUndefined();
  });
});
