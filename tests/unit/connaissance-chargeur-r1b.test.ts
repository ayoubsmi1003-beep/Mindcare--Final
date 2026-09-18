/**
 * M07 R1 — Chargeur de quarantaine (2/2 : determinisme, medicaments, SQL).
 */
import { describe, expect, it } from "vitest";

import {
  INTERDITS_MEDICAMENT,
  MARQUEURS_PATIENT,
  hacherTexteFNV,
  normaliserTexte,
  sha256Hex,
  uuidDeterministe,
} from "../../scripts/charger-connaissance-socle.mjs";
import { sectionsDeMarkdown } from "../../scripts/charger-connaissance-decoupe.mjs";
import { analyserEtiquette, canoniqueBrut } from "../../scripts/charger-connaissance-medicaments.mjs";
import { sqlChunk, sqlSource } from "../../scripts/charger-connaissance-sql.mjs";

// NOTE M08 : voir connaissance-backfill-r3.test.ts (allowJs local au
// programme de test). Zero effet runtime ; signatures propriete M07.

describe("corpus A deterministe", () => {
  it("uuid + hash stables", () => {
    expect(uuidDeterministe("m07-r1|x|v")).toBe(uuidDeterministe("m07-r1|x|v"));
    expect(uuidDeterministe("m07-r1|x|v")).toMatch(/^[0-9a-f-]{36}$/);
    expect(sha256Hex("a")).toBe(sha256Hex("a"));
    expect(hacherTexteFNV("a")).toBe(hacherTexteFNV("a"));
  });
  it("titres jamais chunks, paragraphes bornes", () => {
    const sections = sectionsDeMarkdown("# T\n\npara un.\n\n## S\n\npara deux.");
    expect(sections.map((s) => s.section)).toEqual(["T", "S"]);
    expect(sections.every((s) => s.texte.length <= 2000)).toBe(true);
  });
  it("fiches sans marqueur patient", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    for (const d of readdirSync("knowledge/sources")) {
      for (const f of readdirSync(`knowledge/sources/${d}`)) {
        const t = readFileSync(`knowledge/sources/${d}/${f}`, "utf8");
        for (const re of MARQUEURS_PATIENT) expect(re.test(t)).toBe(false);
      }
    }
  });
});

describe("corpus B : libelles seuls", () => {
  it("marque/forme/dosage, jamais de conseil", () => {
    const e = analyserEtiquette("AERIUS 5 mg cp pellic");
    expect(e.marque).toBe("AERIUS");
    expect(e.dosage).toBe("5 mg");
    expect(Object.keys(e).sort()).toEqual(["dosage", "forme", "marque"]);
  });
  it("interdits cliniques detectes", () => {
    expect(INTERDITS_MEDICAMENT.some((re) => re.test("posologie usuelle : 2 cp par jour"))).toBe(true);
    expect(INTERDITS_MEDICAMENT.some((re) => re.test("AERIUS 5 mg cp pellic"))).toBe(false);
  });
  it("canonique stable", () => {
    expect(canoniqueBrut("  A  B ")).toBe("A B");
    expect(sha256Hex("A B")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("SQL quarantaine : jamais active", () => {
  it("source : approved NULL, pas de active en dur", () => {
    expect(sqlSource()).toContain("NULL, NULL, NULL, NULL");
    expect(sqlSource()).not.toMatch(/statut[^,]*'active'/);
    expect(sqlSource()).toContain("ON CONFLICT (id) DO UPDATE");
  });
  it("chunk : struct-v1, embedding NULL, upsert par id", () => {
    expect(sqlChunk()).toContain("'struct-v1'");
    expect(sqlChunk()).toContain("ON CONFLICT (id) DO UPDATE");
  });
  it("textes normalises", () => {
    expect(normaliserTexte("  a  b ")).toBe("a b");
  });
});
