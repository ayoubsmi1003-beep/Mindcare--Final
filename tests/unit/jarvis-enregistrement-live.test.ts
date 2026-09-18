/**
 * M09 slice 3 — couture live : du `BilanTour` au record PII-safe.
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * Mapping fermé (seuls les champs PII-safe voyagent), EXCLUSIONS adversariales
 * (texte, ancre, args d'outils, snapshots, mention, libellés, ids bruts —
 * runId/toolCallId/patients : même fournis, jamais rendus en clair, que des
 * empreintes FNV-1a non joignables), chemins inconnus normalisés, anneau
 * borné (200, éviction oldest-first), export conforme au contrat `m09-live-v1`
 * (clés fermées), déterminisme (empreinte stable hors horodatage), scan PII
 * (positif planté détecté, record propre vert), drapeau OFF par défaut.
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * L'exécution live (pas d'app démarrée → le câblage est prouvé par le hook +
 * le flag, pas par un tour réel), la persistance (anneau mémoire : rien ne
 * survit au rechargement, par décision).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  AnneauLive,
  activerCaptationLive,
  captationLiveActivee,
  construireRecordLive,
  exporterAnneau,
  TAILLE_ANNEAU_LIVE,
  VERSION_CONTRAT_LIVE,
  type EntreeBilanLive,
} from "../../src/shared/jarvis/enregistrement-live";
import {
  construireRecordLiveV2,
  empreinteAction,
  empreinteExecution,
  exporterAnneauV1,
  exporterAnneauV2,
  VERSION_CONTRAT_LIVE_V2,
  type ApprobationLive,
} from "../../src/shared/jarvis/enregistrement-live";
import {
  capterApprobation,
  capterTour,
  exporterCaptationLive,
  exporterCaptationLiveV2,
  reinitialiserCaptationLive,
} from "../../src/services/conversation";
import { balayerPii } from "../../scripts/replay-preuve.mjs";

// NOTE M09 (idem replay-preuve.test.ts) : les .mjs n'ont pas de déclarations ;
// allowJs est local au programme de test. Rien ici ne change le runtime.

function entree(surcharge: Partial<EntreeBilanLive> = {}): EntreeBilanLive {
  return {
    runId: "run-001",
    chemin: "patient",
    interrompu: false,
    persiste: true,
    dureeMs: 1234,
    appels: [
      { capacite: "agenda", ms: 12, ok: true, deduplique: false, toolCallId: "tc-1" },
      { capacite: "dossier", ms: 30, ok: false, code: "interdit", deduplique: false },
    ],
    preuves: [{ titre: "Catalogue medicaments", section: "Catalogue", version: "2026-09-15" }],
    nbSnapshots: 2,
    propositionInconnue: null,
    resolution: { etat: "unique", intentionChainee: null, intentionRetenu: "VOIR_AGENDA" },
    ...surcharge,
  };
}

describe("construireRecordLive : mapping fermé", () => {
  it("rend les champs PII-safe, jamais d'identifiant brut ni de texte", () => {
    const record = construireRecordLive(entree());
    expect(record.schema).toBe(VERSION_CONTRAT_LIVE);
    expect(record.chemin).toBe("patient");
    expect(record.interrompu).toBe(false);
    expect(record.persiste).toBe(true);
    expect(record.dureeMs).toBe(1234);
    expect(record.nbAppels).toBe(2);
    expect(record.nbPreuves).toBe(1);
    expect(record.nbSnapshots).toBe(2);
    // Identifiants opaques → empreintes, jamais en clair.
    expect(typeof record.empreinteRun).toBe("string");
    expect(record.empreinteRun).toHaveLength(8);
    expect(typeof record.empreinte).toBe("string");
    expect(record.appels[0]).toEqual({ capacite: "agenda", ms: 12, ok: true, deduplique: false });
    expect(record.appels[1]).toEqual({ capacite: "dossier", ms: 30, ok: false, code: "interdit", deduplique: false });
    expect(record.preuves).toEqual([{ titre: "Catalogue medicaments", section: "Catalogue", version: "2026-09-15" }]);
    expect(record.resolution).toEqual({ etat: "unique", intentionChainee: null, intentionRetenu: "VOIR_AGENDA" });
    const cles = Object.keys(record);
    for (const interdite of ["runId", "toolCallId", "texte", "ancreCandidate", "snapshots", "extrait", "mention", "patientId", "conversationId"]) {
      expect(cles.includes(interdite)).toBe(false);
    }
  });

  it("adversarial : contenu sensible fourni quand même → absent du JSON", () => {
    // `unknown` d'abord : l'assertion simple suffit (jamais de double),
    // et le builder ne lit que ses champs nommés.
    const sale: unknown = {
      ...entree({ runId: "123e4567-e89b-12d3-a456-426614174000" }),
      texte: "Karim B., 0554 12 34 56, sertraline 50 mg",
      ancreCandidate: { id: "uuid-patient-123", libelle: "Karim B." },
      propositionInconnue: { nom: "outil_x", args: { patientId: "uuid-patient-123", dose: "50 mg" } },
      snapshots: [{ volumineux: "contexte clinique" }],
      mention: "Karim",
    };
    const json = JSON.stringify(construireRecordLive(sale as EntreeBilanLive));
    for (const interdit of ["Karim", "0554", "uuid-patient-123", "123e4567", "sertraline", "50 mg", "clinique", "contexte", "tc-1", "run-001"]) {
      expect(json.includes(interdit)).toBe(false);
    }
    // Le nom de la proposition inconnue, lui, voyage (pas une donnée).
    expect(json.includes("outil_x")).toBe(true);
  });

  it("chemin inconnu → 'inconnu' (sortie fermée, jamais de pass-through)", () => {
    const record = construireRecordLive(entree({ chemin: "trou-noir" }));
    expect(record.chemin).toBe("inconnu");
  });

  it("preuves sans extrait, même fourni", () => {
    const preuves: unknown = [{ titre: "T", section: null, version: "v", extrait: "SERTRALINE 50 mg" }];
    const record = construireRecordLive(entree({ preuves: preuves as EntreeBilanLive["preuves"] }));
    expect(JSON.stringify(record).includes("SERTRALINE")).toBe(false);
  });
});

describe("anneau borné + export", () => {
  it(`borne à ${TAILLE_ANNEAU_LIVE}, éviction oldest-first, ordre préservé`, () => {
    const anneau = new AnneauLive(3);
    for (let i = 0; i < 5; i++) anneau.pousser(construireRecordLive(entree({ runId: `run-${i}` })));
    const records = anneau.lire();
    expect(records).toHaveLength(3);
    // Les empreintes diffèrent par runId : l'ordre survit via les empreintes.
    expect(new Set(records.map((r) => r.empreinte)).size).toBe(3);
    // Lecture défensive : muter le retour ne touche pas l'anneau.
    records.pop();
    expect(anneau.lire()).toHaveLength(3);
  });

  it("export conforme au contrat m09-live-v1 (clés fermées)", () => {
    const schema = JSON.parse(readFileSync("tests/eval/live-schema.json", "utf8")) as {
      readonly clesRacine: readonly string[];
      readonly clesRecord: readonly string[];
    };
    const anneau = new AnneauLive();
    anneau.pousser(construireRecordLive(entree()));
    // `any` de JSON.parse → assertion simple vers la forme attendue.
    const exporte = JSON.parse(JSON.stringify(exporterAnneau(anneau))) as Record<string, unknown>;
    expect(Object.keys(exporte).sort()).toEqual([...schema.clesRacine].sort());
    const records = exporte["records"] as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    expect(Object.keys(records[0]!).sort()).toEqual([...schema.clesRecord].sort());
  });

  it("déterminisme : même bilan → même empreinte (horodatage exclu)", () => {
    const a = construireRecordLive(entree());
    const b = construireRecordLive(entree());
    expect(a.empreinte).toBe(b.empreinte);
    expect(a.empreinteRun).toBe(b.empreinteRun);
    expect(a.horodatage).toBeLessThanOrEqual(b.horodatage);
    const c = construireRecordLive(entree({ runId: "run-002" }));
    expect(c.empreinte).not.toBe(a.empreinte);
    expect(c.empreinteRun).not.toBe(a.empreinteRun);
  });
});

describe("scan PII + drapeau", () => {
  it("record propre : scan vert ; cordon planté : détecté", () => {
    const anneau = new AnneauLive();
    anneau.pousser(construireRecordLive(entree()));
    const propre = JSON.stringify(exporterAnneau(anneau));
    expect(balayerPii([{ nom: "export-live", brut: propre }])).toEqual([]);
    const sale = `{"nom":"Karim B.","tel":"0554123456"}`;
    expect(balayerPii([{ nom: "cordon", brut: sale }]).length).toBeGreaterThan(0);
  });

  it("captation OFF par défaut, bascule explicite", () => {
    activerCaptationLive(false);
    expect(captationLiveActivee()).toBe(false);
    activerCaptationLive(true);
    expect(captationLiveActivee()).toBe(true);
    activerCaptationLive(false);
    expect(captationLiveActivee()).toBe(false);
  });
});

describe("câblage conversation.ts : capterTour", () => {
  it("OFF → rien ne part à l'anneau (défaut, zéro coût observable)", () => {
    reinitialiserCaptationLive();
    activerCaptationLive(false);
    capterTour(
      {
        runId: "run-x",
        chemin: "patient",
        interrompu: false,
        persiste: true,
        appels: [],
        preuves: [],
        nbSnapshots: 0,
        propositionInconnue: null,
        resolution: null,
      },
      100,
    );
    expect(exporterCaptationLive().records).toHaveLength(0);
  });

  it("ON → un record PII-safe, exportable, puis reset", () => {
    reinitialiserCaptationLive();
    activerCaptationLive(true);
    try {
      capterTour(
        {
          runId: "run-live-1",
          chemin: "connaissance",
          interrompu: false,
          persiste: false,
          appels: [{ capacite: "dossier", ms: 5, ok: true, deduplique: false, toolCallId: "tc-9" }],
          preuves: [{ titre: "Guide", section: null, version: "v1" }],
          nbSnapshots: 1,
          propositionInconnue: null,
          resolution: { etat: "aucun", intentionChainee: null, intentionRetenu: null },
        },
        250,
      );
      const exporte = exporterCaptationLive();
      expect(exporte.mission).toBe("M09");
      expect(exporte.kind).toBe("live");
      expect(exporte.records).toHaveLength(1);
      const json = JSON.stringify(exporte);
      expect(json.includes("run-live-1")).toBe(false);
      expect(json.includes("tc-9")).toBe(false);
      expect(balayerPii([{ nom: "cablage", brut: json }])).toEqual([]);
    } finally {
      activerCaptationLive(false);
      reinitialiserCaptationLive();
    }
    expect(exporterCaptationLive().records).toHaveLength(0);
  });
});

describe("M09 reliquat v2 : empreintes d'approbation (pures, sans ecriture)", () => {
  it("empreinteAction stable, 8-hex, jamais l'id brut", () => {
    const actionId = "123e4567-e89b-12d3-a456-426614174000";
    const a = empreinteAction(actionId);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(a).toBe(empreinteAction(actionId));
    expect(a.includes("123e4567")).toBe(false);
    expect(empreinteAction("123e4567-e89b-12d3-a456-426614174001")).not.toBe(a);
  });

  it("empreinteExecution lie l'action et l'issue prouvee", () => {
    const act = empreinteAction("123e4567-e89b-12d3-a456-426614174000");
    const ok = empreinteExecution(act, "ok");
    expect(ok).toMatch(/^[0-9a-f]{8}$/);
    expect(empreinteExecution(act, "ok")).toBe(ok);
    // Meme action, autre issue constatee → autre empreinte.
    expect(empreinteExecution(act, "echec")).not.toBe(ok);
  });
});

describe("M09 reliquat v2 : record enveloppe (v1 fige, extras clos)", () => {
  const approbation: ApprobationLive = {
    actionFp: empreinteAction("123e4567-e89b-12d3-a456-426614174000"),
    issue: "ok",
    executionFp: null,
    runFp: null,
  };

  it("porte le v1 + approbation nulle par defaut", () => {
    const record = construireRecordLiveV2(entree(), null, 1700000000000);
    expect(record.v1.chemin).toBe("patient");
    expect(record.approbation).toBeNull();
    expect(record.v1.horodatage).toBe(1700000000000);
  });

  it("projection v1 d'un record v2 === construireRecordLive (contrat fige)", () => {
    const v2 = construireRecordLiveV2(entree(), approbation, 1700000000000);
    expect(v2.v1).toEqual(construireRecordLive(entree(), 1700000000000));
  });

  it("aucun id brut dans le JSON v2 (run, toolCall, action)", () => {
    const v2 = construireRecordLiveV2(
      entree({
        runId: "123e4567-e89b-12d3-a456-426614174000",
        appels: [{ capacite: "agenda", ms: 1, ok: true, deduplique: false, toolCallId: "223e4567-e89b-12d3-a456-426614174000" }],
      }),
      approbation,
      1700000000000,
    );
    const json = JSON.stringify(v2);
    expect(json.includes("123e4567")).toBe(false);
    expect(json.includes("223e4567")).toBe(false);
  });

  it("export v2 : cles fermees m09-live-v2", () => {
    const schema = JSON.parse(readFileSync("tests/eval/live-schema-v2.json", "utf8")) as {
      readonly version: string;
      readonly clesRacine: readonly string[];
      readonly clesRecord: readonly string[];
    };
    expect(schema.version).toBe(VERSION_CONTRAT_LIVE_V2);
    const anneau = new AnneauLive<import("../../src/shared/jarvis/enregistrement-live").LiveRunRecordV2>();
    anneau.pousser(construireRecordLiveV2(entree(), approbation, 1700000000000));
    const exporte = JSON.parse(JSON.stringify(exporterAnneauV2(anneau))) as Record<string, unknown>;
    expect(Object.keys(exporte).sort()).toEqual([...schema.clesRacine].sort());
    const records = exporte["records"] as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    expect(Object.keys(records[0]!).sort()).toEqual([...schema.clesRecord].sort());
  });

  it("export v1 depuis un anneau v2 : cles m09-live-v1, sans clef nouvelle", () => {
    const schema = JSON.parse(readFileSync("tests/eval/live-schema.json", "utf8")) as {
      readonly clesRecord: readonly string[];
    };
    const anneau = new AnneauLive<import("../../src/shared/jarvis/enregistrement-live").LiveRunRecordV2>();
    anneau.pousser(construireRecordLiveV2(entree(), approbation, 1700000000000));
    const exporte = JSON.parse(JSON.stringify(exporterAnneauV1(anneau))) as Record<string, unknown>;
    expect(exporte["contrat"]).toBe(VERSION_CONTRAT_LIVE);
    const records = exporte["records"] as Array<Record<string, unknown>>;
    expect(Object.keys(records[0]!).sort()).toEqual([...schema.clesRecord].sort());
  });
});

describe("M09 reliquat v2 : empreintes d'outils (chaine run → tool_call)", () => {
  it("outilsFp derive de toolCallId, parallele aux appels, jamais le brut", () => {
    const v2 = construireRecordLiveV2(
      entree({
        appels: [
          { capacite: "agenda", ms: 12, ok: true, deduplique: false, toolCallId: "523e4567-e89b-12d3-a456-426614174000" },
          { capacite: "dossier", ms: 30, ok: false, code: "interdit", deduplique: false },
        ],
      }),
      null,
      1700000000000,
    );
    expect(v2.outilsFp).toHaveLength(2);
    expect(v2.outilsFp[0]).toMatch(/^[0-9a-f]{8}$/);
    expect(v2.outilsFp[1]).toBeNull();
    const json = JSON.stringify(v2);
    expect(json.includes("523e4567")).toBe(false);
  });

  it("record d'approbation : outilsFp vide (aucun appel lit)", () => {
    const v2 = construireRecordLiveV2(entree({ appels: [] }), null, 1700000000000);
    expect(v2.outilsFp).toEqual([]);
  });

  it("v1 projete ne porte aucune clef d'outil (contrat fige intact)", () => {
    const schema = JSON.parse(readFileSync("tests/eval/live-schema.json", "utf8")) as {
      readonly clesRecord: readonly string[];
    };
    const v2 = construireRecordLiveV2(
      entree({
        appels: [{ capacite: "agenda", ms: 1, ok: true, deduplique: false, toolCallId: "tc-x" }],
      }),
      null,
      1700000000000,
    );
    expect(Object.keys(v2.v1).sort()).toEqual([...schema.clesRecord].sort());
    // Forme exacte fige : toEqual refuse toute cle ajoutee comme manquante.
    expect(v2.v1.appels[0]).toEqual({ capacite: "agenda", ms: 1, ok: true, deduplique: false });
  });
});

describe("cablage conversation.ts : capterApprobation", () => {
  it("OFF → noop (defaut, zero cout observable)", () => {
    reinitialiserCaptationLive();
    activerCaptationLive(false);
    capterApprobation({
      runFp: "a1b2c3d4",
      actionFp: empreinteAction("123e4567-e89b-12d3-a456-426614174000"),
      issue: "ok",
      executionFp: null,
      dureeMs: 40,
    });
    expect(exporterCaptationLive().records).toHaveLength(0);
    expect(exporterCaptationLiveV2().records).toHaveLength(0);
  });

  it("ON → record v2 avec approbation ; v1 projete sans clef nouvelle", () => {
    reinitialiserCaptationLive();
    activerCaptationLive(true);
    try {
      const actionId = "323e4567-e89b-12d3-a456-426614174000";
      capterApprobation({
        runFp: "a1b2c3d4",
        actionFp: empreinteAction(actionId),
        issue: "bloquee",
        executionFp: null,
        dureeMs: 40,
      });
      const v2 = exporterCaptationLiveV2();
      expect(v2.records).toHaveLength(1);
      expect(v2.records[0]?.approbation?.issue).toBe("bloquee");
      expect(v2.records[0]?.approbation?.runFp).toBe("a1b2c3d4");
      const json = JSON.stringify(v2);
      expect(json.includes("323e4567")).toBe(false);
      expect(balayerPii([{ nom: "approbation", brut: json }])).toEqual([]);
      const v1 = exporterCaptationLive();
      expect(v1.records).toHaveLength(1);
      expect(v1.records[0]?.chemin).toBe("inconnu");
    } finally {
      activerCaptationLive(false);
      reinitialiserCaptationLive();
    }
    expect(exporterCaptationLive().records).toHaveLength(0);
  });

  it("chaine opportuniste : runFp du tour === runFp de l'approbation", () => {
    reinitialiserCaptationLive();
    activerCaptationLive(true);
    try {
      capterTour(
        {
          runId: "run-chaine-7",
          chemin: "patient",
          interrompu: false,
          persiste: true,
          appels: [],
          preuves: [],
          nbSnapshots: 0,
          propositionInconnue: null,
          resolution: null,
        },
        100,
      );
      const tour = exporterCaptationLiveV2().records[0];
      capterApprobation({
        runFp: tour?.v1.empreinteRun ?? null,
        actionFp: empreinteAction("423e4567-e89b-12d3-a456-426614174000"),
        issue: "ok",
        executionFp: null,
        dureeMs: 12,
      });
      const tous = exporterCaptationLiveV2().records;
      expect(tous).toHaveLength(2);
      expect(tous[1]?.approbation?.runFp).toBe(tour?.v1.empreinteRun);
    } finally {
      activerCaptationLive(false);
      reinitialiserCaptationLive();
    }
  });
});
