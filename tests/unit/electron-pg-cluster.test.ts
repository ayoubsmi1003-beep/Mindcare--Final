/**
 * Les fonctions pures de `pg-cluster.ts` et `pg-binaires.ts` — construction
 * de commandes et de configuration, jamais leur exécution (§C, §K du plan).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { localiserBinaires } from "../../electron/main/pg-binaires";
import {
  NOM_SERVICE,
  VERSION_ATTENDUE,
  commandeArreterService,
  commandeDemarrerService,
  commandeEnregistrerService,
  commandeInitdb,
  contenuEcouteLocale,
  contenuPgHba,
  versionCluster,
  versionCompatible,
} from "../../electron/main/pg-cluster";

describe("localiserBinaires", () => {
  it("résout les quatre binaires sous <resources>/bin", () => {
    const bin = localiserBinaires("C:\\Program Files\\MindCare\\resources\\pgsql");
    expect(bin.initdb).toBe("C:\\Program Files\\MindCare\\resources\\pgsql\\bin\\initdb.exe");
    expect(bin.pgCtl).toBe("C:\\Program Files\\MindCare\\resources\\pgsql\\bin\\pg_ctl.exe");
    expect(bin.psql).toBe("C:\\Program Files\\MindCare\\resources\\pgsql\\bin\\psql.exe");
    expect(bin.postgres).toBe("C:\\Program Files\\MindCare\\resources\\pgsql\\bin\\postgres.exe");
  });
});

describe("versionCluster / versionCompatible", () => {
  const dossiers: string[] = [];
  afterEach(() => {
    for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function dossierTemp(): string {
    const d = mkdtempSync(path.join(os.tmpdir(), "mindcare-pgtest-"));
    dossiers.push(d);
    return d;
  }

  it("rend null quand PG_VERSION est absent (premier lancement)", () => {
    const d = dossierTemp();
    expect(versionCluster(d)).toBeNull();
    expect(versionCompatible(d)).toBe(false);
  });

  it("lit la version quand PG_VERSION est présent", () => {
    const d = dossierTemp();
    writeFileSync(path.join(d, "PG_VERSION"), `${VERSION_ATTENDUE}\n`, "utf8");
    expect(versionCluster(d)).toBe(VERSION_ATTENDUE);
    expect(versionCompatible(d)).toBe(true);
  });

  it("refuse une version majeure incompatible (§N du plan)", () => {
    const d = dossierTemp();
    // 15 : la version qu'une documentation antérieure croyait suffisante,
    // avant que l'exécution réelle contre PostgreSQL 15 ne montre que
    // 020_gatekeeper_role.sql (GRANT ... WITH INHERIT) exige la 16.
    writeFileSync(path.join(d, "PG_VERSION"), "15\n", "utf8");
    expect(versionCluster(d)).toBe("15");
    expect(versionCompatible(d)).toBe(false);
  });
});

describe("commandeInitdb", () => {
  it("pose UTF8, ICU fr-DZ, scram-sha-256, et ne met jamais le mot de passe en clair dans les arguments", () => {
    const bin = localiserBinaires("C:\\res\\pgsql");
    const c = commandeInitdb(bin, "C:\\ProgramData\\MindCare\\data", "C:\\temp\\pwfile.tmp");
    expect(c.cmd).toBe(bin.initdb);
    expect(c.args).toContain("--encoding=UTF8");
    expect(c.args).toContain("--icu-locale=fr-DZ");
    expect(c.args).toContain("--auth-local=scram-sha-256");
    expect(c.args.join(" ")).not.toMatch(/motdepasse|password=\S/i);
    expect(c.args).toContain("--pwfile=C:\\temp\\pwfile.tmp");
  });
});

describe("configuration d'écoute et pg_hba", () => {
  it("n'écoute jamais que sur localhost", () => {
    expect(contenuEcouteLocale(5432)).toContain("listen_addresses = 'localhost'");
    expect(contenuEcouteLocale(5432)).not.toMatch(/0\.0\.0\.0|'\*'/);
  });

  it("pg_hba n'autorise que du mot de passe salé, jamais trust", () => {
    const conf = contenuPgHba();
    expect(conf).not.toMatch(/\btrust\b/);
    expect(conf).toMatch(/127\.0\.0\.1\/32\s+scram-sha-256/);
    expect(conf).toMatch(/::1\/128\s+scram-sha-256/);
  });
});

describe("commandes de service Windows", () => {
  it("enregistre sous le nom de service attendu, avec démarrage automatique", () => {
    const bin = localiserBinaires("C:\\res\\pgsql");
    const c = commandeEnregistrerService(bin, "C:\\ProgramData\\MindCare\\data", "C:\\ProgramData\\MindCare\\logs");
    expect(c.args).toContain(NOM_SERVICE);
    expect(c.args).toContain("--startup=auto");
  });

  it("démarrer/arrêter ciblent le même service que l'enregistrement", () => {
    expect(commandeDemarrerService().args).toContain(NOM_SERVICE);
    expect(commandeArreterService().args).toContain(NOM_SERVICE);
  });
});
