import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface LigneInventaire {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

const VOIX = join(process.cwd(), "resources", "voix");

function inventaire(): LigneInventaire[] {
  return JSON.parse(readFileSync(join(VOIX, "inventory.json"), "utf8")) as LigneInventaire[];
}

/**
 * Walk the real tree, not the inventory: byte-code that exists on disk but is
 * excluded from the inventory ships unpinned through extraResources and makes
 * the package verifier reject a correct package.
 */
function bytecodeSurDisque(dossier: string, trouves: string[] = []): string[] {
  for (const entry of readdirSync(dossier, { withFileTypes: true })) {
    const complet = join(dossier, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__") trouves.push(complet);
      else bytecodeSurDisque(complet, trouves);
    } else if (entry.isFile() && entry.name.endsWith(".pyc")) {
      trouves.push(complet);
    }
  }
  return trouves;
}

describe("voice bundle inventory", () => {
  it("never records byte-code whose .pyc headers embed the install time", () => {
    const lignes = inventaire();
    expect(lignes.length).toBeGreaterThan(0);
    const bytecode = lignes.filter(
      (ligne) => ligne.path.endsWith(".pyc") || ligne.path.split("/").includes("__pycache__"),
    );
    expect(bytecode).toEqual([]);
  });

  it("leaves no byte-code on disk that the inventory could not pin", () => {
    expect(bytecodeSurDisque(VOIX)).toEqual([]);
  });

  it("sorts every path deterministically so the hash does not depend on readdir order", () => {
    const chemins = inventaire().map((ligne) => ligne.path);
    const attendus = [...chemins].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(chemins).toEqual(attendus);
  });

  it("keeps the manifest as the authority for the inventory hash", () => {
    const manifeste = JSON.parse(readFileSync(join(VOIX, "manifest.json"), "utf8")) as {
      schema?: number;
      inventorySha256?: string;
    };
    const empreinte = createHash("sha256")
      .update(readFileSync(join(VOIX, "inventory.json")))
      .digest("hex");
    expect(manifeste.schema).toBe(2);
    expect(manifeste.inventorySha256).toBe(empreinte);
  });

  it("still inventories the Python packages the package verifier pins", () => {
    const chemins = new Set(inventaire().map((ligne) => ligne.path));
    expect([...chemins].some((chemin) => chemin.startsWith("packages/faster_whisper/"))).toBe(true);
    expect([...chemins].some((chemin) => chemin.startsWith("packages/ctranslate2/"))).toBe(true);
    expect([...chemins].some((chemin) => chemin.startsWith("python/"))).toBe(true);
  });
});
