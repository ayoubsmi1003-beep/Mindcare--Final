import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  enregistrerAppareil,
  hacherJeton,
  listerAppareils,
  lireAppareils,
  revoquerAppareil,
  verifierJeton,
} from "../../electron/main/paired-devices";
import {
  listerPostes,
  posteCourant,
  revoquerPoste,
} from "../../src/server/cabinet/appareils";

/**
 * Le registre des postes est lu par DEUX implémentations : le proxy Electron
 * (vérification à chaque requête) et le backend Next.js (liste et révocation).
 * `src/` ne peut pas importer `electron/`, donc le format est dupliqué — et ce
 * test est ce qui empêche les deux copies de diverger en silence.
 */
describe("registre des postes appairés — format partagé", () => {
  let dossier: string;
  let fichier: string;

  beforeEach(() => {
    dossier = mkdtempSync(path.join(tmpdir(), "mc-postes-"));
    fichier = path.join(dossier, "paired-devices.json");
  });

  afterEach(() => {
    rmSync(dossier, { recursive: true, force: true });
  });

  it("enregistre un poste, vérifie son jeton et ne rend jamais le secret en liste", () => {
    const { deviceId, deviceToken } = enregistrerAppareil(fichier, "PC Accueil");

    expect(deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifierJeton(fichier, deviceToken)?.deviceId).toBe(deviceId);
    expect(verifierJeton(fichier, "A".repeat(43))).toBeUndefined();
    expect(verifierJeton(fichier, undefined)).toBeUndefined();
    expect(verifierJeton(fichier, "trop-court")).toBeUndefined();

    const liste = listerAppareils(fichier);
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ deviceId, label: "PC Accueil", revokedAt: null });
    expect(JSON.stringify(liste)).not.toContain(deviceToken);
  });

  it("la révocation est immédiate et idempotente", () => {
    const { deviceId, deviceToken } = enregistrerAppareil(fichier, "PC Accueil");
    expect(revoquerAppareil(fichier, deviceId)).toBe(true);
    expect(verifierJeton(fichier, deviceToken)).toBeUndefined();
    expect(revoquerAppareil(fichier, deviceId)).toBe(true);
    expect(revoquerAppareil(fichier, "pas-un-uuid")).toBe(false);
  });

  it("un fichier corrompu n'autorise AUCUN poste (fail closed)", () => {
    const { deviceToken } = enregistrerAppareil(fichier, "PC Accueil");
    writeFileSync(fichier, "{ ceci n'est pas du JSON");
    expect(verifierJeton(fichier, deviceToken)).toBeUndefined();
    expect(lireAppareils(fichier).devices).toHaveLength(0);

    writeFileSync(fichier, JSON.stringify({ version: 2, devices: [] }));
    expect(lireAppareils(fichier).devices).toHaveLength(0);
  });

  it("le backend lit ce que le processus principal a écrit, et inversement", () => {
    const { deviceId, deviceToken } = enregistrerAppareil(fichier, "PC Accueil");

    // `src/server/cabinet/appareils.ts` résout son chemin depuis ProgramData.
    const programData = mkdtempSync(path.join(tmpdir(), "mc-programdata-"));
    const prive = path.join(programData, "MindCare", "private");
    mkdirSync(prive, { recursive: true });
    writeFileSync(path.join(prive, "paired-devices.json"), JSON.stringify(lireAppareils(fichier)));

    const ancien = process.env["ProgramData"];
    process.env["ProgramData"] = programData;
    try {
      expect(listerPostes()).toHaveLength(1);
      expect(posteCourant(deviceToken)).toBe(deviceId);
      expect(posteCourant("B".repeat(43))).toBeNull();
      expect(revoquerPoste(deviceId)).toBe(true);
      expect(listerPostes()[0]?.revokedAt).not.toBeNull();
    } finally {
      if (ancien === undefined) delete process.env["ProgramData"];
      else process.env["ProgramData"] = ancien;
      rmSync(programData, { recursive: true, force: true });
    }
  });

  it("une empreinte connue correspond au jeton qui l'a produite (et à lui seul)", () => {
    const { deviceToken } = enregistrerAppareil(fichier, "PC Accueil");
    expect(hacherJeton(deviceToken)).toMatch(/^[0-9a-f]{64}$/);
    expect(hacherJeton(deviceToken)).not.toBe(hacherJeton(`${deviceToken}x`));
  });
});
