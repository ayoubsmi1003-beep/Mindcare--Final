import { afterEach, describe, expect, it, vi } from "vitest";
import { cibleBasePostgresProductionValide } from "../../electron/main/cible-base";
import { verifierMigrations } from "../../electron/main/orchestrateur";

afterEach(() => vi.unstubAllEnvs());

describe("cible PostgreSQL du serveur packagé", () => {
  it("accepte uniquement la base MindCare locale sur le port fixe PostgreSQL 16", () => {
    expect(cibleBasePostgresProductionValide(
      "postgresql://mindcare_app:synthetic@127.0.0.1:54333/mindcare",
    )).toBe(true);
  });

  it.each([
    "postgresql://mindcare_app:synthetic@127.0.0.1:55441/mindcare",
    "postgresql://mindcare_app:synthetic@127.0.0.1:54332/mindcare",
    "postgresql://mindcare_app:synthetic@localhost:54333/mindcare",
    "postgresql://mindcare_app:synthetic@192.0.2.1:54333/mindcare",
    "postgresql://mindcare_app:synthetic@127.0.0.1:54333/other",
    "postgresql://mindcare_app:synthetic@127.0.0.1/mindcare",
    "postgresql://mindcare_app:synthetic@127.0.0.1:54333/mindcare?host=192.0.2.1",
    "not a database URL",
  ])("rejects any other or ambiguous target without connecting", (url) => {
    expect(cibleBasePostgresProductionValide(url)).toBe(false);
  });

  it("rejects a stale target in the Electron preflight before invoking PostgreSQL", async () => {
    vi.stubEnv("MINDCARE_ELECTRON_ENV", "production");
    vi.stubEnv(
      "MINDCARE_DATABASE_URL",
      "postgresql://mindcare_app:synthetic@127.0.0.1:55441/mindcare",
    );

    const result = await verifierMigrations({} as never, "unused-server-path", "unused-env-path");
    expect(result).toMatchObject({ ok: false });
    expect(result.detail).toContain("127.0.0.1:54333/mindcare");
    expect(result.detail).toContain("URL masquée");
  });
});
