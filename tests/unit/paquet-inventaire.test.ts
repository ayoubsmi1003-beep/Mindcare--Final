import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { parcourirPaquet } from "../../scripts/lib/paquet-inventaire.mjs";

describe("package tree inventory", () => {
  it("skips .pyc files and __pycache__ directories from a stale package", () => {
    const racine = mkdtempSync(join(tmpdir(), "mindcare-paquet-"));
    try {
      mkdirSync(join(racine, "resources", "voix", "packages", "mod", "__pycache__"), { recursive: true });
      writeFileSync(join(racine, "resources", "voix", "packages", "mod", "module.py"), "x");
      writeFileSync(
        join(racine, "resources", "voix", "packages", "mod", "__pycache__", "module.cpython-312.pyc"),
        "x",
      );
      writeFileSync(join(racine, "resources", "voix", "packages", "loose.pyc"), "x");
      writeFileSync(join(racine, "resources", "voix", "manifest.json"), "{}");

      const fichiers = parcourirPaquet(racine);

      expect(fichiers).toContain("resources/voix/packages/mod/module.py");
      expect(fichiers).toContain("resources/voix/manifest.json");
      expect(fichiers.some((fichier) => fichier.endsWith(".pyc"))).toBe(false);
      expect(fichiers.some((fichier) => fichier.includes("__pycache__"))).toBe(false);
      expect(fichiers.every((fichier) => !fichier.includes("\\"))).toBe(true);
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });
});
