/**
 * Instantané de production (§D) : validation du manifeste et portes du
 * réducteur liées à la restauration. Toute régression ici = risque de
 * servir une base partielle ou de restaurer un paquet incohérent.
 */
import { describe, expect, it } from "vitest";

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { validerManifeste, restaurerInstantaneSiPresent } from "../../electron/main/provisionnement";
import { localiserBinaires } from "../../electron/main/pg-binaires";
import { etatInitial, reduire } from "../../electron/main/etat-demarrage";

function manifesteValide(): Record<string, unknown> {
  return {
    snapshot_version: "snap-20261006-1558p",
    schema_version: "117-127_legacy_identity_scope",
    created_at: "2026-10-06T00:00:00.000Z",
    database_version: "16.15",
    patient_count: 1559,
    patients_total_source: 1559,
    fixtures_exclues: 0,
    counts: { "app.patients": 1559 },
    sha256: "a".repeat(64),
  };
}

describe("validerManifeste", () => {
  it("accepte un manifeste complet", () => {
    const m = validerManifeste(manifesteValide());
    expect(m.patient_count).toBe(1559);
  });

  it("refuse la suppression d'un patient source, même marqué synthétique", () => {
    const brut = manifesteValide();
    brut["patient_count"] = 1558;
    brut["fixtures_exclues"] = 1;
    expect(() => validerManifeste(brut)).toThrow(/préservation/);
  });

  it("refuse des compteurs source incohérents ou absents", () => {
    const brut = manifesteValide();
    brut["patients_total_source"] = 1560;
    expect(() => validerManifeste(brut)).toThrow(/préservation/);
    delete brut["patients_total_source"];
    expect(() => validerManifeste(brut)).toThrow(/préservation/);
  });

  it("refuse un champ manquant", () => {
    const brut = manifesteValide();
    delete brut["sha256"];
    expect(() => validerManifeste(brut)).toThrow(/sha256/);
  });

  it("refuse un patient_count absent", () => {
    const brut = manifesteValide();
    delete brut["patient_count"];
    expect(() => validerManifeste(brut)).toThrow(/patient_count/);
  });

  it("refuse une empreinte mal formée", () => {
    const brut = manifesteValide();
    brut["sha256"] = "zzz";
    expect(() => validerManifeste(brut)).toThrow(/sha256/);
  });

  it("refuse un compteur non entier", () => {
    const brut = manifesteValide();
    brut["counts"] = { "app.patients": -1 };
    expect(() => validerManifeste(brut)).toThrow(/compteur/);
  });

  it("refuse un non-objet", () => {
    expect(() => validerManifeste(null)).toThrow();
    expect(() => validerManifeste("snap")).toThrow();
  });
});

describe("restauration et réducteur", () => {
  it("refuse toute restauration sans confirmation d'un cluster juste créé, avant de lancer PostgreSQL", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "mindcare-restore-guard-"));
    const snapshot = path.join(root, "snapshot");
    mkdirSync(snapshot);
    const dump = "Test-only snapshot bytes; no patient data";
    writeFileSync(path.join(snapshot, "base.dump"), dump);
    writeFileSync(path.join(snapshot, "manifest.json"), JSON.stringify({ ...manifesteValide(), sha256: createHash("sha256").update(dump).digest("hex") }));
    writeFileSync(path.join(snapshot, "gates.sql"), "BEGIN READ ONLY; COMMIT;");
    const bin = localiserBinaires(path.join(root, "nonexistent-pg"));
    const target = { bin, hote: "127.0.0.1", port: 1, base: "test_only", superutilisateur: "test_only", motDePasseSuperutilisateur: "" };
    try {
      await expect(restaurerInstantaneSiPresent(bin, target, snapshot, path.join(root, "data")))
        .rejects.toThrow(/cluster.*neuf/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("RESTAURATION_ECHOUEE hors STARTING_DATABASE est ignorée (pas de faux FAILED)", () => {
    const m = etatInitial();
    expect(reduire(m, { type: "RESTAURATION_ECHOUEE", detail: "x" })).toBe(m);
  });
});
