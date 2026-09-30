/**
 * M08-Taylor — chargeur quarantaine : listes fermées, parité dry-run, zéro actif.
 * Importer le chargeur exécute son dry-run Gate-C (lecture seule ; rapport
 * Taylor-scopé) — même discipline que charger-connaissance.mjs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import {
  chunksDepuisUnitesTaylor,
  entreeTaylor,
  filtrerUnitesSuresTaylor,
  TAYLOR_CHUNKER_PROPOSE,
} from "../../scripts/charger-connaissance-corpus-taylor.mjs";
import { garderLot } from "../../scripts/charger-connaissance-taylor.mjs";
import { uuidDeterministe } from "../../scripts/charger-connaissance-socle.mjs";

const RACINE = process.cwd();
const LIVRE = join(RACINE, "knowledge", "canonical-v2",
  "maudsley-prescribing-guidelines-2021-taylor-14e",
  "sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0");

let LOT = [];
beforeAll(() => {
  const entree = entreeTaylor(RACINE);
  const ctx = {
    sourceUuid: uuidDeterministe("maudsley-prescribing-guidelines-2021-taylor-14e:sha256:14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0"),
    version: entree.version,
    langue: "en",
  };
  const unites = readFileSync(join(LIVRE, "units.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  LOT = chunksDepuisUnitesTaylor(RACINE, filtrerUnitesSuresTaylor(RACINE, unites).gardees, ctx);
}, 120000);

describe("M08-Taylor — listes fermées du chargeur quarantaine", () => {
  it("le lot réel (7859, inactifs, provisoire) passe les gardes", () => {
    expect(LOT).toHaveLength(7859);
    expect(() => garderLot(LOT)).not.toThrow();
  });

  it("statut actif → throw avant tout SQL", () => {
    const lots = LOT.slice(0, 3).map((c, i) => (i === 1 ? { ...c, statut: "active" } : c));
    expect(() => garderLot(lots)).toThrow(/statut chunk Taylor refusé/);
  });

  it.each([["struct-v1"], ["struct-v2"], ["taylor-units-v9"], [""]])("version %s → throw (seul le provisoire déclaré passe)", (v) => {
    const lots = LOT.slice(0, 2).map((c) => ({ ...c, versionChunk: v }));
    expect(() => garderLot(lots)).toThrow(/découpeur Taylor refusé/);
  });

  it("occurrence invalide → throw", () => {
    const lots = LOT.slice(0, 2).map((c, i) => (i === 0 ? { ...c, occurrence: -1 } : c));
    expect(() => garderLot(lots)).toThrow(/occurrence invalide/);
  });

  it("langue non-en → throw (pas de substitution silencieuse)", () => {
    const lots = LOT.slice(0, 2).map((c, i) => (i === 0 ? { ...c, langue: "fr" } : c));
    expect(() => garderLot(lots)).toThrow(/langue chunk Taylor inattendue/);
  });

  it("le label provisoire est explicite (D4 ouvert, jamais struct-v*)", () => {
    expect(TAYLOR_CHUNKER_PROPOSE).toBe("taylor-units-v1-proposed");
    expect(TAYLOR_CHUNKER_PROPOSE.startsWith("struct-")).toBe(false);
  });
});
