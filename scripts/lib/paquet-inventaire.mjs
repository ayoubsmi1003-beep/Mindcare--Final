/**
 * File inventory of a packaged tree.
 *
 * Python byte-code is skipped on purpose: `.pyc` headers embed the install-time
 * source mtime, so it is excluded from the pinned voice inventory and filtered
 * out by electron-builder. A legacy or stale package can still contain it;
 * ignoring it here keeps the package gate tolerant without relaxing the
 * per-file pins for every other file.
 */
import { readdirSync } from "node:fs";
import path from "node:path";

export function parcourirPaquet(racine) {
  const trouves = [];
  const pile = [racine];
  while (pile.length > 0) {
    const courant = pile.pop();
    for (const entree of readdirSync(courant, { withFileTypes: true })) {
      const complet = path.join(courant, entree.name);
      if (entree.isDirectory()) {
        if (entree.name === "__pycache__") continue;
        pile.push(complet);
      } else if (!entree.name.endsWith(".pyc")) {
        trouves.push(path.relative(racine, complet).split(path.sep).join("/"));
      }
    }
  }
  return trouves;
}
