/**
 * M09 reliquat LOT4 — lecture d'observabilite (portes seules, jamais de SELECT).
 *
 * ═══ CE QUI EST EPROUVE ═══
 * `lireHistoriqueLive` / `lireHistoriqueReplay` /
 * `lireStatsObservabilite` appellent leurs portes par `DbPort.rpc` (surface
 * enumérable pour l'allowlist), valident le jsonb fermé (Zod strict),
 * bornent les limites, et rendent une erreur honnête CONSTANTE quand la
 * porte rend NULL (assistant, hors périmètre, run inconnu : indiscernables,
 * anti-oracle ADR-003) ou quand la charge est malformée.
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * La RLS réelle (checkpoint-m09-097.sql sur base locale), l'UI (LOT5).
 */
import { describe, expect, it, afterEach } from "vitest";

import { setDbPort, type DbPort } from "../../src/services/db";
import { err, ok, type Result } from "../../src/services/result";
import {
  lireHistoriqueLive,
  lireHistoriqueReplay,
  lireStatsObservabilite,
  listerRunsLive,
  listerRunsReplay,
} from "../../src/services/observabilite-lecture";

const RUN = "11111111-1111-4111-8111-111111111111";

function fauxPort(repondre: (nom: string, args: Record<string, string | number | boolean | null>) => Result<readonly unknown[]>): DbPort {
  const inattendu = (): never => {
    throw new Error("port factice : méthode non attendue");
  };
  return {
    select: inattendu,
    rpc: ((nom: string, args: Record<string, string | number | boolean | null>) =>
      Promise.resolve(repondre(nom, args))) as DbPort["rpc"],
    signIn: inattendu,
    signOut: inattendu,
    getSession: inattendu,
    getInstallationStatus: inattendu,
    provisionOwnerAccount: inattendu,
    invokeFunction: inattendu,
    invokeFunctionStream: inattendu,
  };
}

function historiqueLiveCharge(): Record<string, unknown> {
  return {
    contrat: "m09-live-v2",
    run: {
      contrat: "m09-live-v2",
      runId: RUN,
      gateVersion: "m09-live-v2",
      empreinteRun: "a1b2c3d4",
      empreinte: "e5f60718",
      chemin: "patient",
      interrompu: false,
      persiste: true,
      dureeMs: 1234,
      nbAppels: 1,
      nbPreuves: 1,
      nbSnapshots: 0,
      propositionInconnue: null,
      resolutionEtat: "unique",
      intentionChainee: null,
      intentionRetenue: "VOIR_AGENDA",
      retrievalFp: null,
      approvalFp: null,
      executionFp: null,
      issue: null,
      createdAt: "2026-09-18T10:00:00.000Z",
    },
    appels: [{ capacite: "agenda", ms: 12, ok: true, code: null, deduplique: false, toolCallFp: null }],
    preuves: [{ titre: "Guide", section: null, version: "v1", retrievalFp: "b".repeat(64) }],
  };
}

afterEach(() => {
  setDbPort(undefined);
});

describe("lireHistoriqueLive", () => {
  it("rend l'historique valide de la porte get_live_history", async () => {
    let porte = "";
    setDbPort(
      fauxPort((nom, args) => {
        porte = nom;
        expect(args["p_run_id"]).toBe(RUN);
        return ok([historiqueLiveCharge()]);
      }),
    );
    const r = await lireHistoriqueLive(RUN);
    expect(porte).toBe("get_live_history");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.run.chemin).toBe("patient");
    expect(r.data.appels).toHaveLength(1);
    expect(r.data.preuves).toHaveLength(1);
  });

  it("borne la limite 1..500 avant l'appel", async () => {
    const limites: unknown[] = [];
    setDbPort(
      fauxPort((_nom, args) => {
        limites.push(args["p_limit"]);
        return ok([historiqueLiveCharge()]);
      }),
    );
    await lireHistoriqueLive(RUN, 0);
    await lireHistoriqueLive(RUN, 99999);
    expect(limites).toEqual([1, 500]);
  });

  it("porte NULL → erreur honnête constante (jamais d'oracle)", async () => {
    setDbPort(fauxPort(() => ok([null])));
    const r = await lireHistoriqueLive(RUN);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("indisponible");
    expect(typeof r.error.message).toBe("string");
  });

  it("runId malformé → même erreur constante (rien ne fuit)", async () => {
    let appele = false;
    setDbPort(
      fauxPort(() => {
        appele = true;
        return ok([historiqueLiveCharge()]);
      }),
    );
    const r = await lireHistoriqueLive("pas-un-uuid");
    expect(r.ok).toBe(false);
    expect(appele).toBe(false);
  });

  it("charge malformée → erreur, jamais de devinette", async () => {
    const charge = historiqueLiveCharge() as { run: Record<string, unknown> };
    charge.run["chemin"] = "trou-noir";
    setDbPort(fauxPort(() => ok([charge])));
    const r = await lireHistoriqueLive(RUN);
    expect(r.ok).toBe(false);
  });

  it("cle inconnue → erreur (schema ferme)", async () => {
    const charge = historiqueLiveCharge() as { run: Record<string, unknown> };
    charge.run["texte"] = "bonjour";
    setDbPort(fauxPort(() => ok([charge])));
    const r = await lireHistoriqueLive(RUN);
    expect(r.ok).toBe(false);
  });

  it("panne de porte → erreur d'origine relayée, pas de succès", async () => {
    setDbPort(fauxPort(() => err({ code: "indisponible", message: "panne" })));
    const r = await lireHistoriqueLive(RUN);
    expect(r.ok).toBe(false);
  });
});

describe("lireHistoriqueReplay", () => {
  function chargeReplay(): Record<string, unknown> {
    return {
      contrat: "m09-replay-v1",
      run: {
        contrat: "m09-replay-v1",
        runId: RUN,
        kind: "simulate",
        verdict: "PASS",
        passCount: 2,
        failCount: 0,
        notRunCount: 0,
        casCount: 1,
        goldensHash: "a".repeat(64),
        createdAt: "2026-09-18T10:00:00.000Z",
      },
      cas: [{ famille: "intentions", id: "M01-01", empreinte: "b".repeat(64), verdict: "PASS" }],
    };
  }

  it("rend l'historique replay de la porte get_replay_history", async () => {
    let porte = "";
    setDbPort(
      fauxPort((nom) => {
        porte = nom;
        return ok([chargeReplay()]);
      }),
    );
    const r = await lireHistoriqueReplay(RUN);
    expect(porte).toBe("get_replay_history");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.run.verdict).toBe("PASS");
    expect(r.data.cas).toHaveLength(1);
  });

  it("porte NULL → erreur honnête constante", async () => {
    setDbPort(fauxPort(() => ok([null])));
    const r = await lireHistoriqueReplay(RUN);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("indisponible");
  });
});

describe("listerRunsLive", () => {
  function entete(): Record<string, unknown> {
    return {
      runId: RUN,
      gateVersion: "m09-live-v2",
      chemin: "patient",
      interrompu: false,
      persiste: true,
      dureeMs: 100,
      nbAppels: 1,
      nbPreuves: 0,
      nbSnapshots: 0,
      issue: null,
      createdAt: "2026-09-18T10:00:00.000Z",
    };
  }

  it("rend la liste de list_live_runs", async () => {
    let porte = "";
    setDbPort(
      fauxPort((nom) => {
        porte = nom;
        // La porte rend UNE ligne portant le tableau (jsonb) : data[0] est le tableau.
        return ok([[entete(), entete()]]);
      }),
    );
    const r = await listerRunsLive();
    expect(porte).toBe("list_live_runs");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toHaveLength(2);
  });

  it("borne la limite 1..100", async () => {
    const limites: unknown[] = [];
    setDbPort(
      fauxPort((_nom, args) => {
        limites.push(args["p_limit"]);
        return ok([]);
      }),
    );
    await listerRunsLive(0);
    await listerRunsLive(99999);
    expect(limites).toEqual([1, 100]);
  });

  it("porte NULL → liste vide honnête (jamais d'oracle, jamais d'erreur)", async () => {
    setDbPort(fauxPort(() => ok([null])));
    const r = await listerRunsLive();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual([]);
  });

  it("charge malformée → erreur", async () => {
    const mauvaise = entete();
    mauvaise["chemin"] = "trou-noir";
    setDbPort(fauxPort(() => ok([[mauvaise]])));
    const r = await listerRunsLive();
    expect(r.ok).toBe(false);
  });
});

describe("listerRunsReplay", () => {
  function entete(): Record<string, unknown> {
    return {
      runId: RUN,
      kind: "simulate",
      verdict: "PASS",
      passCount: 2,
      failCount: 0,
      notRunCount: 0,
      casCount: 1,
      createdAt: "2026-09-18T10:00:00.000Z",
    };
  }

  it("rend la liste de list_replay_runs", async () => {
    let porte = "";
    setDbPort(
      fauxPort((nom) => {
        porte = nom;
        return ok([[entete()]]);
      }),
    );
    const r = await listerRunsReplay();
    expect(porte).toBe("list_replay_runs");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data[0]!.verdict).toBe("PASS");
  });

  it("porte NULL → liste vide honnête", async () => {
    setDbPort(fauxPort(() => ok([null])));
    const r = await listerRunsReplay();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual([]);
  });
});

describe("lireStatsObservabilite", () => {
  function chargeStats(): Record<string, unknown> {
    return {
      contrat: "m09-stats-v1",
      fenetreJours: 30,
      live: { runs: 3, p50Ms: 100, p95Ms: 900, parChemin: { patient: 2, connaissance: 1 } },
      replay: { runs: 1, pass: 10, fail: 0, notRun: 2 },
    };
  }

  it("rend les agregats de get_observability_stats (PG calcule, service formate)", async () => {
    let porte = "";
    setDbPort(
      fauxPort((nom, args) => {
        porte = nom;
        expect(args["p_jours"]).toBe(30);
        return ok([chargeStats()]);
      }),
    );
    const r = await lireStatsObservabilite(30);
    expect(porte).toBe("get_observability_stats");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.live.p50Ms).toBeLessThanOrEqual(r.data.live.p95Ms);
    expect(r.data.replay.pass).toBe(10);
  });

  it("borne la fenetre 1..365", async () => {
    const fenetres: unknown[] = [];
    setDbPort(
      fauxPort((_nom, args) => {
        fenetres.push(args["p_jours"]);
        return ok([chargeStats()]);
      }),
    );
    await lireStatsObservabilite(0);
    await lireStatsObservabilite(99999);
    expect(fenetres).toEqual([1, 365]);
  });

  it("porte NULL → erreur honnête constante", async () => {
    setDbPort(fauxPort(() => ok([null])));
    const r = await lireStatsObservabilite();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("indisponible");
  });
});
