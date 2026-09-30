/**
 * Preuves : panne de recuperation vs absence de preuve — jamais confondues,
 * jamais de reponse vide inutile. TDD RED.
 */
import { describe, expect, it } from "vitest";

import { recupererPreuves, type RpcPreuves } from "../../src/server/jarvis/preuves-recherche";
import { construireBlocPreuves } from "../../src/shared/jarvis/preuves";

const clientVide: RpcPreuves = { rpc: async <T,>() => ({ data: [] as unknown as T, error: null }) };
const clientPanne: RpcPreuves = { rpc: async () => ({ data: null, error: { message: "boom" } }) };

describe("recupererPreuves : etat explicite", () => {
  it("panne lexicale -> etat panne, zero preuve", async () => {
    const r = await recupererPreuves(clientPanne, "question", async () => null);
    expect(r.etat).toBe("panne");
    expect(r.preuves).toEqual([]);
  });
  it("portes ok sans lignes -> etat sans-preuve", async () => {
    const r = await recupererPreuves(clientVide, "question", async () => null);
    expect(r.etat).toBe("sans-preuve");
    expect(r.preuves).toEqual([]);
  });
});

describe("construireBlocPreuves : raison explicite", () => {
  it("panne -> bloc nomme, jamais vide", () => {
    const bloc = construireBlocPreuves([], "panne");
    expect(bloc).toContain("PANNE_RECUPERATION");
  });
  it("sans-preuve -> bloc nomme, jamais vide", () => {
    const bloc = construireBlocPreuves([], "sans-preuve");
    expect(bloc).toContain("AUCUNE_PREUVE");
  });
});
