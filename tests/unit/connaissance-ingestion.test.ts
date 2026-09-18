/**
 * M07 — Ingestion : 9 champs exigés, fixtures jamais promues (H9).
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * Chaque champ manquant rejette avec SON motif ; C1/C2/C3/UNKNOWN rejetés
 * avant tout embedding ; `fixture: true` rejeté même avec tout le reste
 * parfait ; dossier complet → `ok`.
 */
import { describe, expect, it } from "vitest";

import { validerSource, type DossierIngestion } from "../../src/server/knowledge/ingestion";

function dossierValide(): DossierIngestion {
  return {
    titre: "Guide anxiété",
    version: "2026-09-01",
    langue: "fr",
    classification: "C4",
    provenance: { emetteur: "Société savante", reference: "ISBN-000" },
    hashContenu: "deadbeef12345678",
    approuvePar: "00000000-0000-0000-0000-000000000001",
    approuveLe: "2026-09-01T10:00:00+01:00",
    revue: { relecteur: "00000000-0000-0000-0000-000000000001", revueLe: "2026-09-01", revueDueLe: "2027-09-01" },
    fixture: false,
  };
}

describe("porte d'ingestion (H9)", () => {
  it("dossier complet C4 → ok", () => {
    expect(validerSource(dossierValide())).toEqual({ ok: true });
  });

  it("fixture parfaite → rejetée quand même (jamais de promotion auto)", () => {
    const verdict = validerSource({ ...dossierValide(), fixture: true });
    expect(verdict).toEqual({ ok: false, motif: "fixture-interdite" });
  });

  it.each(["C1", "C2", "C3", "INCONNU"] as const)("classification %s → rejetée avant embedding", (classification) => {
    expect(validerSource({ ...dossierValide(), classification })).toEqual({
      ok: false,
      motif: "classification-non-c4",
    });
  });

  it("titre/version vides → rejetés", () => {
    expect(validerSource({ ...dossierValide(), titre: "  " })).toMatchObject({ ok: false, motif: "titre-manquant" });
    expect(validerSource({ ...dossierValide(), version: "" })).toMatchObject({ ok: false, motif: "version-manquante" });
  });

  it("provenance/hash/approbation/revue incomplets → rejetés avec leur motif", () => {
    expect(validerSource({ ...dossierValide(), provenance: { emetteur: "", reference: "x" } })).toMatchObject({
      ok: false,
      motif: "provenance-incomplete",
    });
    expect(validerSource({ ...dossierValide(), hashContenu: "pas-un-hash" })).toMatchObject({
      ok: false,
      motif: "hash-manquant",
    });
    expect(validerSource({ ...dossierValide(), approuvePar: "" })).toMatchObject({
      ok: false,
      motif: "approbation-incomplete",
    });
    expect(validerSource({ ...dossierValide(), revue: { relecteur: "", revueLe: "2026-09-01", revueDueLe: null } })).toMatchObject({
      ok: false,
      motif: "revue-incomplete",
    });
  });
});
