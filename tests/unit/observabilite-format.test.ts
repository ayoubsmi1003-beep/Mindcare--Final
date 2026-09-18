/**
 * M09 reliquat LOT6 — formats d'affichage (purs, sans DOM).
 *
 * ═══ CE QUI EST EPROUVE ═══
 * `formaterDuree` (ms → « 12 ms » / « 1,2 s », virgule française, bornes) et
 * `formaterDate` (ISO → fr-DZ, invalide → « — »). Les agrégats eux-mêmes
 * sont calculés en base (`get_observability_stats`) et validés par
 * `observabilite-lecture.test.ts` : ici, seul le formatage.
 */
import { describe, expect, it } from "vitest";

import { formaterDate, formaterDuree } from "../../src/components/observabilite/formats";

describe("formaterDuree", () => {
  it("ms sous la seconde, sans décimale", () => {
    expect(formaterDuree(0)).toBe("0 ms");
    expect(formaterDuree(12)).toBe("12 ms");
    expect(formaterDuree(999)).toBe("999 ms");
  });

  it("secondes en virgule française, une décimale", () => {
    expect(formaterDuree(1000)).toBe("1,0 s");
    expect(formaterDuree(1234)).toBe("1,2 s");
    expect(formaterDuree(90000)).toBe("90,0 s");
  });

  it("invalide → tiret honnête, jamais NaN à l'écran", () => {
    expect(formaterDuree(Number.NaN)).toBe("—");
    expect(formaterDuree(-5)).toBe("—");
    expect(formaterDuree(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formaterDate", () => {
  it("ISO valide → chaîne locale non vide, sans l'ISO brut", () => {
    const rendu = formaterDate("2026-09-18T10:00:00.000Z");
    expect(rendu.length).toBeGreaterThan(0);
    expect(rendu).not.toBe("2026-09-18T10:00:00.000Z");
    expect(rendu).toContain("2026");
  });

  it("invalide → tiret honnête", () => {
    expect(formaterDate("pas-une-date")).toBe("—");
    expect(formaterDate("")).toBe("—");
  });
});
