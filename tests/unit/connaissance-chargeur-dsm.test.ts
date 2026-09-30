/**
 * M07 R1 — Chargeur de quarantaine DSM-5 (struct-v2, inactif uniquement).
 * TDD RED : ce test echoue tant que le chargeur refuse struct-v2 en quarantaine.
 */
import { describe, expect, it } from "vitest";

import { chunksDepuisUnitesDSM, filtrerUnitesSures } from "../../scripts/charger-connaissance-corpus-dsm.mjs";
import { argsChargeur } from "../../scripts/charger-connaissance-sql.mjs";
import { sqlChunk } from "../../scripts/charger-connaissance-sql.mjs";

const ECHANTILLON = [
  {
    id: "dsm5fr-u-42-A001",
    book_id: "dsm5-fr-2015-elsevier",
    source_version: "sha256:be145e65",
    structural_path: ["Section II", "Troubles neurodeveloppementaux"],
    title: "Echantillon",
    content_type: "definition",
    evidence_wording: "Texte source echantillon.",
    page_start: 101,
    page_end: 101,
    printed_page_start: "42",
    printed_page_end: "42",
  },
  {
    id: "dsm5fr-u-42-A002",
    book_id: "dsm5-fr-2015-elsevier",
    source_version: "sha256:be145e65",
    structural_path: ["Section II", "Troubles neurodeveloppementaux"],
    title: "Echantillon",
    content_type: "definition",
    evidence_wording: "Texte source echantillon.",
    page_start: 101,
    page_end: 101,
    printed_page_start: "42",
    printed_page_end: "42",
  },
];

describe("DSM-5 struct-v2 : quarantaine inactive uniquement", () => {
  it("sqlChunk accepte struct-v2 inactif", () => {
    expect(sqlChunk({ statut: "inactive", versionChunk: "struct-v2" })).toContain("struct-v2");
  });
  it("sqlChunk refuse struct-v2 actif", () => {
    expect(() => sqlChunk({ statut: "active", versionChunk: "struct-v2" })).toThrow();
  });
  it("projection DSM deterministe, inactive, sans activation", () => {
    const a = chunksDepuisUnitesDSM(ECHANTILLON, { sourceUuid: "uuid-test", version: "v-test", langue: "fr" });
    const b = chunksDepuisUnitesDSM(ECHANTILLON, { sourceUuid: "uuid-test", version: "v-test", langue: "fr" });
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    for (const ch of a) {
      expect(ch.statut).toBe("inactive");
      expect(ch.versionChunk).toBe("struct-v2");
    }
    expect(a[0]!.chunkId).not.toBe(a[1]!.chunkId);
    expect(a[1]!.occurrence).toBe(1);
  });
  it("ids DSM namespacies : aucune collision inter-corpus possible", () => {
    const a = chunksDepuisUnitesDSM(
      [{ id: "u-x", evidence_wording: "Texte." }],
      { sourceUuid: "uuid-test", version: "v-test", langue: "fr" },
    );
    expect(a[0]!.chunkId.startsWith("dsm5-")).toBe(true);
  });
  it("unites a marqueur patient exclues de la projection (garde intacte)", () => {
    const units = [
      { id: "u-ok", evidence_wording: "Critere clinique sans identifiant." },
      { id: "u-ko", evidence_wording: "Vignette : Karim presente des symptomes." },
    ];
    expect(filtrerUnitesSures(units).map((u: { id: string }) => u.id)).toEqual(["u-ok"]);
  });
  it("--source filtre le chargement a la source demandee", () => {
    const o = argsChargeur(["--source", "corpus-dsm5"], { manifeste: "m", sortie: "s" });
    expect(o.sources).toEqual(["corpus-dsm5"]);
  });
});
