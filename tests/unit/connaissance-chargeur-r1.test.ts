/**
 * M07 R1 — Chargeur de quarantaine (1/2 : parite + quarantaine + fixtures).
 */
import { describe, expect, it } from "vitest";

import { validerSource } from "../../src/server/knowledge/ingestion";
import {
  FIXTURE_IDS,
  validerDossierLocal,
  validerQuarantaine,
} from "../../scripts/charger-connaissance-socle.mjs";

// NOTE M08 : voir connaissance-backfill-r3.test.ts (allowJs local au
// programme de test). Zero effet runtime ; signatures propriete M07.

function dossierBase(surcharge = {}) {
  return {
    titre: "Fiche", version: "2026-09-15", langue: "fr" as const, classification: "C4" as const,
    provenance: { emetteur: "Cabinet", reference: "docs/X" },
    hashContenu: "abcdef1234567890",
    approuvePar: "p1", approuveLe: "2026-09-15",
    revue: { relecteur: "p1", revueLe: "2026-09-15", revueDueLe: "2026-12-15" },
    fixture: false, ...surcharge,
  };
}

describe("parite validerSource (8 motifs)", () => {
  const cas = [
    [{ titre: "  " }, "titre-manquant"],
    [{ version: "" }, "version-manquante"],
    [{ classification: "C1" }, "classification-non-c4"],
    [{ classification: "C2" }, "classification-non-c4"],
    [{ classification: "C3" }, "classification-non-c4"],
    [{ classification: "INCONNU" }, "classification-non-c4"],
    [{ provenance: { emetteur: "", reference: "x" } }, "provenance-incomplete"],
    [{ hashContenu: "zzz" }, "hash-manquant"],
    [{ approuvePar: "" }, "approbation-incomplete"],
    [{ revue: { relecteur: "", revueLe: "2026-09-15", revueDueLe: null } }, "revue-incomplete"],
    [{ fixture: true }, "fixture-interdite"],
  ];
  for (const [patch, motif] of cas) {
    it(`miroir == vrai module : ${motif}`, () => {
      const d = dossierBase(patch);
      expect(validerDossierLocal(d)).toEqual(validerSource(d));
      expect(validerDossierLocal(d)).toEqual({ ok: false, motif });
    });
  }
  it("dossier complet → ok des deux cotes", () => {
    expect(validerDossierLocal(dossierBase())).toEqual({ ok: true });
    expect(validerSource(dossierBase())).toEqual({ ok: true });
  });
});

describe("quarantaine : approbation en-attente, jamais inventee", () => {
  it("sans approbation → staging ok + en-attente", () => {
    const v = validerQuarantaine(dossierBase({ approuvePar: "", approuveLe: "", revue: { relecteur: "", revueLe: "", revueDueLe: null } }));
    expect(v).toEqual({ ok: true, motif: null, approbation: "en-attente" });
  });
  it("avec approbation → signee", () => {
    expect(validerQuarantaine(dossierBase()).approbation).toBe("signee");
  });
  it("fixture/C1 restent des rejets durs", () => {
    expect(validerQuarantaine(dossierBase({ fixture: true })).ok).toBe(false);
    expect(validerQuarantaine(dossierBase({ classification: "C1" })).ok).toBe(false);
  });
});

describe("fixtures interdites", () => {
  it("les 15 identites fixture du corpus d'eval sont TOUTES listees (parite)", async () => {
    const { readFileSync } = await import("node:fs");
    const evalSrc = readFileSync("scripts/eval-knowledge-retrieval.mjs", "utf8");
    const ids = [...evalSrc.matchAll(/\{ id: "([a-z0-9-]+)", titre/g)].map((m) => m[1] as string);
    expect(ids.length).toBeGreaterThanOrEqual(15);
    for (const id of ids) {
      expect(FIXTURE_IDS.has(id), `fixture non listee : ${id}`).toBe(true);
    }
  });
  it("aucune identite fixture au manifeste R1", async () => {
    const { readFileSync } = await import("node:fs");
    const m = JSON.parse(readFileSync("knowledge/manifest.json", "utf8"));
    for (const s of m.sources) expect(FIXTURE_IDS.has(s.source_id)).toBe(false);
  });
});
