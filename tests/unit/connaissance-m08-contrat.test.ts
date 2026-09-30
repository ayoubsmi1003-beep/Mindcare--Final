/**
 * M08-A/B/G/H/I — contrat de récupération, intégrité de provenance,
 * frontière évidence→réponse, non-réponse, multi-source.
 *
 * Fonctions pures / orchestrateur à portes injectées : aucune base réelle.
 * La preuve live (portes SQL, corpus actif) est portée par
 * `scripts/m08-valider-corpus.mjs` (lecture seule) et l'éval golden.
 */
import { describe, expect, it } from "vitest";

import { PROMPT_CONNAISSANCE } from "../../src/app/api/jarvis/jarvis-chat/prompt";
import { orchestrerRecherche, LIMITES } from "../../src/server/knowledge/recherche";
import { recupererPreuves, type RpcPreuves } from "../../src/server/jarvis/preuves-recherche";
import {
  construireBlocPreuves,
  type PreuveConnnaissance,
} from "../../src/shared/jarvis/preuves";
import { chunksDepuisUnitesDSM } from "../../scripts/charger-connaissance-corpus-dsm.mjs";

/** Ligne de porte récupérable (C4 + active + approuvée + revue à jour). */
function ligne(surcharge: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chunk_id: "c1",
    source_id: "11111111-1111-1111-1111-111111111111",
    source_titre: "Guide anxiété",
    source_version: "2026-09-01",
    section: "Traitement",
    version_chunk: "struct-v1",
    langue: "fr",
    texte: "La sertraline 50 mg est une option de première intention dans l'anxiété.",
    score: 0.9,
    source_statut: "active",
    source_classification: "C4",
    source_approuvee_le: "2026-09-01T10:00:00+01:00",
    source_approuvee_par: "00000000-0000-0000-0000-000000000001",
    source_revue_a_jour: true,
    source_remplacee_par: null,
    ...surcharge,
  };
}

describe("M08-A — le contrat a exactement trois états nommés", () => {
  it("ok : lignes récupérables → evidences avec provenance complète", async () => {
    const { issue, evidences } = await orchestrerRecherche(
      "sertraline 50 mg première intention",
      [ligne()],
      [],
    );
    expect(issue).toBe("pertinent");
    expect(evidences.length).toBeGreaterThan(0);
    for (const e of evidences) {
      expect(e.chunkId).toBe("c1");
      expect(e.sourceId).toBe("11111111-1111-1111-1111-111111111111");
      expect(e.sourceTitre).toBe("Guide anxiété");
      expect(e.sourceVersion).toBe("2026-09-01");
      expect(e.texte).toContain("sertraline 50 mg");
    }
  });

  it("sans-preuve : aucune ligne → issue aucune + evidences vides (jamais un tableau ambigu)", async () => {
    const { issue, evidences } = await orchestrerRecherche("question sans réponse", [], []);
    expect(issue).toBe("aucune");
    expect(evidences).toEqual([]);
  });

  it("panne ≠ sans-preuve : erreur rpc → etat panne avec bloc nommé distinct", async () => {
    const client: RpcPreuves = {
      rpc: async () => ({ data: null, error: { message: "connexion perdue" } }),
    };
    const { preuves, etat } = await recupererPreuves(client, "sertraline");
    expect(etat).toBe("panne");
    expect(preuves).toEqual([]);
    const bloc = construireBlocPreuves(preuves, etat);
    expect(bloc).toContain("PANNE_RECUPERATION");
    expect(bloc).not.toContain("AUCUNE_PREUVE");
  });

  it("sans-preuve : bloc nommé, jamais un vide interprété comme succès", async () => {
    const client: RpcPreuves = { rpc: async <T,>() => ({ data: [] as unknown as T, error: null }) };
    const { preuves, etat } = await recupererPreuves(client, "question sans réponse");
    expect(etat).toBe("sans-preuve");
    const bloc = construireBlocPreuves(preuves, etat);
    expect(bloc).toContain("AUCUNE_PREUVE");
  });

  it("un gros chunk DSM via la passerelle → état ok avec provenance, jamais sans-preuve silencieux (R4.1)", async () => {
    const gros = `Épisode maniaque — Critères diagnostiques DSM. ${"humeur élevée, ".repeat(900)}`;
    expect(gros.length).toBeGreaterThan(LIMITES.BUDGET_OCTETS);
    const client: RpcPreuves = {
      rpc: async <T,>() => ({
        data: [
          {
            chunk_id: "dsm5-test-gros",
            source_id: "11111111-1111-1111-1111-111111111111",
            source_titre: "DSM-5 — Manuel diagnostique",
            source_version: "2015-fr",
            section: "Troubles bipolaires",
            version_chunk: "struct-v2",
            langue: "fr",
            texte: gros,
            score: 0.95,
            source_statut: "active",
            source_classification: "C4",
            source_approuvee_le: "2026-09-01T10:00:00+01:00",
            source_approuvee_par: "00000000-0000-0000-0000-000000000001",
            source_revue_a_jour: true,
            source_remplacee_par: null,
          },
        ] as unknown as T,
        error: null,
      }),
    };
    const { preuves, etat } = await recupererPreuves(client, "critères épisode maniaque", async () => null);
    expect(etat).toBe("ok");
    expect(preuves).toHaveLength(1);
    expect(preuves[0]?.titre).toBe("DSM-5 — Manuel diagnostique");
    expect(preuves[0]?.version).toBe("2015-fr");
    expect(construireBlocPreuves(preuves, etat)).toContain("DSM-5 — Manuel diagnostique");
  });

  it("une évidence pertinente trop volumineuse reste servie (préfixe au budget, provenance exacte), jamais vidée", async () => {
    const gros = "Critères diagnostiques de l'épisode maniaque : humeur élevée. ".repeat(400);
    expect(gros.length).toBeGreaterThan(LIMITES.BUDGET_OCTETS);
    const { issue, evidences } = await orchestrerRecherche(
      "critères épisode maniaque",
      [ligne({ chunk_id: "c-gros", texte: gros })],
      [],
    );
    expect(issue).toBe("pertinent");
    expect(evidences.length).toBe(1);
    expect(evidences[0]?.chunkId).toBe("c-gros");
    expect(evidences[0]?.sourceId).toBe("11111111-1111-1111-1111-111111111111");
    expect(evidences[0]?.texte.length).toBeLessThanOrEqual(LIMITES.BUDGET_OCTETS);
    expect(evidences[0]?.texte).toContain("Critères diagnostiques de l'épisode maniaque");
  });
});

describe("M08-B — la provenance ne peut ni fuir ni être inventée", () => {
  it("une ligne inactive/supersédée/non approuvée est écartée même si la porte la rend", async () => {
    const fuyantes = [
      ligne({ chunk_id: "c-inactive", source_statut: "inactive" }),
      ligne({ chunk_id: "c-revue", source_statut: "reviewed", source_approuvee_le: null, source_approuvee_par: null }),
      ligne({ chunk_id: "c-remplacee", source_remplacee_par: "22222222-2222-2222-2222-222222222222" }),
      ligne({ chunk_id: "c-c1", source_classification: "C1" }),
    ];
    const { issue, evidences } = await orchestrerRecherche("sertraline anxiété", fuyantes, []);
    expect(evidences.map((e) => e.chunkId)).toEqual([]);
    // R4.2 : vide seulement quand l'issue l'autorise — ici `aucune`.
    expect(issue).toBe("aucune");
  });

  it("un vocabulaire de gouvernance inconnu est écarté (jamais deviné récupérable)", async () => {
    const inconnues = [
      ligne({ chunk_id: "c-statut-x", source_statut: "archived" }),
      ligne({ chunk_id: "c-classe-x", source_classification: "C9" }),
    ];
    const { issue, evidences } = await orchestrerRecherche("sertraline anxiété", inconnues, []);
    expect(issue).toBe("aucune");
    expect(evidences).toEqual([]);
  });

  it("deux exécutions identiques rendent le même ordre à l'octet (déterminisme)", async () => {
    const lignes = [
      ligne({ chunk_id: "c-b", texte: "La sertraline 50 mg aide l'anxiété selon B." }),
      ligne({ chunk_id: "c-a", texte: "La sertraline 50 mg aide l'anxiété selon A." }),
    ];
    const p1 = await orchestrerRecherche("sertraline 50 mg anxiété", lignes, []);
    const p2 = await orchestrerRecherche("sertraline 50 mg anxiété", lignes, []);
    expect(p1.issue).toBe(p2.issue);
    expect(p1.evidences.map((e) => e.chunkId)).toEqual(p2.evidences.map((e) => e.chunkId));
    expect(p1.evidences.map((e) => e.chunkId).join(",")).not.toBe("");
  });

  it("une ligne malformée (chunk manquant, score absent) est écartée, jamais bricolée", async () => {
    const bancales: unknown[] = [
      { ...ligne(), chunk_id: "" },
      { ...ligne(), score: Number.NaN },
      { ...ligne(), texte: "" },
      "pas-un-objet",
      null,
    ];
    const { issue, evidences } = await orchestrerRecherche("sertraline", bancales, []);
    expect(issue).toBe("aucune");
    expect(evidences).toEqual([]);
  });

  it("le bloc fil préserve titre+version+section+extrait verbatim de l'évidence rendue", () => {
    const preuve: PreuveConnnaissance = {
      titre: "DSM-5 — Manuel diagnostique",
      section: "Section II › Troubles anxieux",
      version: "2015-fr",
      extrait: "L'attaque de panique survient brutalement [dsm5-fr-2015-elsevier p.214|src:235].",
    };
    const bloc = construireBlocPreuves([preuve], "ok");
    expect(bloc).toContain("DSM-5 — Manuel diagnostique");
    expect(bloc).toContain("2015-fr");
    expect(bloc).toContain("Section II › Troubles anxieux");
    expect(bloc).toContain("L'attaque de panique survient brutalement [dsm5-fr-2015-elsevier p.214|src:235].");
  });

  it("le bloc sans-preuve ne cite aucune source et n'invente aucun contenu médical", () => {
    const bloc = construireBlocPreuves([], "sans-preuve");
    expect(bloc).not.toMatch(/DSM|sertraline|mg|critère/i);
    expect(bloc).toContain("AUCUNE_PREUVE");
  });
});

describe("M08-G — la réponse ne peut citer que ce qui a été rendu", () => {
  it("le prompt exige de citer les sources utilisées par titre+version ou de constater l'absence", () => {
    expect(PROMPT_CONNAISSANCE).toMatch(/cite chaque source utilisée par son\s*titre et sa version/i);
    expect(PROMPT_CONNAISSANCE).toMatch(/dis-le en une phrase/i);
  });

  it("le contrat fil ne transporte aucun identifiant interne (pas de chunk à inventer côté modèle)", () => {
    const preuve: PreuveConnnaissance = {
      titre: "Guide anxiété",
      section: null,
      version: "2026-09-01",
      extrait: "extrait gouverné",
    };
    expect(Object.keys(preuve).sort()).toEqual(["extrait", "section", "titre", "version"]);
  });

  it("les numéros de page DSM voyagent DANS le chunk (crochet de traçabilité), jamais ajoutés par la réponse", () => {
    const chunks = chunksDepuisUnitesDSM(
      [
        {
          id: "u-test",
          title: "Attaque de panique",
          evidence_wording: "L'attaque de panique survient brutalement.",
          structural_path: ["Section II"],
          book_id: "dsm5-fr-2015-elsevier",
          printed_page_start: "214",
          page_start: 235,
        },
      ],
      { sourceUuid: "11111111-1111-1111-1111-111111111111", version: "2015-fr", langue: "fr" },
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.texte ?? "").toContain("p.214");
    expect(chunks[0]?.statut).toBe("inactive");
    expect(chunks[0]?.versionChunk).toBe("struct-v2");
  });
});

describe("M08-H/I — non-réponse et multi-source", () => {
  it("question hors corpus → sans-preuve, le bloc interdit de prétendre le contraire", async () => {
    const client: RpcPreuves = { rpc: async <T,>() => ({ data: [] as unknown as T, error: null }) };
    const { etat } = await recupererPreuves(client, "que dit le DSM de la licorne rose ?");
    expect(etat).toBe("sans-preuve");
    expect(construireBlocPreuves([], etat)).toContain("AUCUNE_PREUVE");
  });

  it("deux sources actives restent attribuées séparément, textes jamais fusionnés", async () => {
    const { evidences } = await orchestrerRecherche(
      "sertraline anxiété",
      [
        ligne({ chunk_id: "c-a", source_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", source_titre: "Source A", texte: "La sertraline aide l'anxiété selon A." }),
        ligne({ chunk_id: "c-b", source_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", source_titre: "Source B", texte: "La sertraline demande prudence selon B." }),
      ],
      [],
    );
    expect(evidences.length).toBe(2);
    const bloc = construireBlocPreuves(
      evidences.map((e) => ({ titre: e.sourceTitre, section: e.section, version: e.sourceVersion, extrait: e.texte })),
      "ok",
    );
    expect(bloc).toContain("Source A");
    expect(bloc).toContain("Source B");
    expect(bloc).toContain("selon A.");
    expect(bloc).toContain("selon B.");
  });
});
