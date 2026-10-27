import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { chargerPinsInventaireVoix } from "../../scripts/lib/voix-inventory-pins.mjs";

const CONFIG_PIN = "a".repeat(64);
const AUDIO_PIN = "b".repeat(64);

function ecrirePaquet(
  racine: string,
  inventaire: unknown,
  manifeste: unknown,
): void {
  mkdirSync(join(racine, "resources", "voix"), { recursive: true });
  writeFileSync(join(racine, "resources", "voix", "inventory.json"), JSON.stringify(inventaire, null, 2));
  if (manifeste !== undefined) {
    writeFileSync(join(racine, "resources", "voix", "manifest.json"), JSON.stringify(manifeste, null, 2));
  }
}

function manifeste(maintenant: unknown): unknown {
  return { schema: 2, inventorySha256: maintenant, models: [] };
}

function empreinteInventaire(racine: string): string {
  return createHash("sha256")
    .update(readFileSync(join(racine, "resources", "voix", "inventory.json")))
    .digest("hex");
}

describe("package verifier voice inventory pins", () => {
  it("accepts the inventory bytes named by the packaged manifest and pins packages only", () => {
    const racine = mkdtempSync(join(tmpdir(), "mindcare-paquet-voix-"));
    const inventaire = [
      { path: "packages/faster_whisper/__init__.py", bytes: 10, sha256: CONFIG_PIN },
      { path: "python/python.exe", bytes: 20, sha256: AUDIO_PIN },
      { path: "assets/kokoro-v1.0.fp16.onnx", bytes: 30, sha256: AUDIO_PIN },
    ];
    try {
      ecrirePaquet(racine, inventaire, manifeste("placeholder"));
      const attendu = empreinteInventaire(racine);
      ecrirePaquet(racine, inventaire, manifeste(attendu));
      const pins = chargerPinsInventaireVoix(join(racine, "resources", "voix"));
      expect([...pins.entries()]).toEqual([
        ["resources/voix/packages/faster_whisper/__init__.py", CONFIG_PIN],
      ]);
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });

  it("rejects a packaged inventory that does not match the manifest hash", () => {
    const racine = mkdtempSync(join(tmpdir(), "mindcare-paquet-voix-"));
    try {
      ecrirePaquet(racine, [{ path: "packages/x/y.py", bytes: 1, sha256: CONFIG_PIN }], manifeste("0".repeat(64)));
      expect(() => chargerPinsInventaireVoix(join(racine, "resources", "voix"))).toThrow(
        "empreinte inventaire voix invalide",
      );
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });

  it("rejects a missing or malformed manifest instead of trusting the inventory", () => {
    const racine = mkdtempSync(join(tmpdir(), "mindcare-paquet-voix-"));
    try {
      ecrirePaquet(racine, [{ path: "packages/x/y.py", bytes: 1, sha256: CONFIG_PIN }], undefined);
      expect(() => chargerPinsInventaireVoix(join(racine, "resources", "voix"))).toThrow("manifeste voix absent");

      ecrirePaquet(racine, [{ path: "packages/x/y.py", bytes: 1, sha256: CONFIG_PIN }], { schema: 1 });
      expect(() => chargerPinsInventaireVoix(join(racine, "resources", "voix"))).toThrow("manifeste voix invalide");
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });

  it("returns no pins when the packaged bundle has no inventory", () => {
    const racine = mkdtempSync(join(tmpdir(), "mindcare-paquet-voix-"));
    try {
      expect(chargerPinsInventaireVoix(join(racine, "resources", "voix")).size).toBe(0);
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });
});
