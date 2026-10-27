/**
 * Voice-bundle pins for the package verifier.
 *
 * The packaged `manifest.json` is the authority: `inventorySha256` names the
 * exact inventory bytes that the runtime's own verifier accepts. A packaged
 * bundle whose inventory does not match that manifest is rejected, and only
 * files recorded under `packages/` earn a per-file pin.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const SHA256_HEX = /^[a-f0-9]{64}$/u;

export function chargerPinsInventaireVoix(racineVoix) {
  const inventaireChemin = path.join(racineVoix, "inventory.json");
  if (!existsSync(inventaireChemin)) return new Map();

  const manifesteChemin = path.join(racineVoix, "manifest.json");
  if (!existsSync(manifesteChemin)) throw new Error("manifeste voix absent");

  let manifeste;
  try {
    manifeste = JSON.parse(readFileSync(manifesteChemin, "utf8"));
  } catch {
    throw new Error("manifeste voix illisible");
  }
  if (manifeste?.schema !== 2 || typeof manifeste.inventorySha256 !== "string" || !SHA256_HEX.test(manifeste.inventorySha256)) {
    throw new Error("manifeste voix invalide");
  }

  const contenu = readFileSync(inventaireChemin);
  if (createHash("sha256").update(contenu).digest("hex") !== manifeste.inventorySha256) {
    throw new Error("empreinte inventaire voix invalide");
  }

  const pins = new Map();
  for (const entree of JSON.parse(contenu.toString("utf8"))) {
    if (typeof entree?.path === "string" && entree.path.startsWith("packages/") && SHA256_HEX.test(entree.sha256)) {
      pins.set(`resources/voix/${entree.path}`, entree.sha256);
    }
  }
  return pins;
}
