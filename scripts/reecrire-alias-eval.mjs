/**
 * reecrire-alias-eval — résout les imports `"@/"` des modules compilés
 * CommonJS vers des relatifs (même rôle que le bloc inline de
 * `checkpoint-jarvis-couche.sh`, factorisé pour les passes M01+).
 *
 *   node scripts/reecrire-alias-eval.mjs <racine .eval-out/...>
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const racine = process.argv[2];
if (racine === undefined) {
  console.error("usage : node scripts/reecrire-alias-eval.mjs <racine>");
  process.exit(2);
}

function marcher(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) {
      marcher(p);
      continue;
    }
    if (!p.endsWith(".js")) continue;
    const s = readFileSync(p, "utf8");
    if (!s.includes("\"@/")) continue;
    const rel = relative(racine, d);
    const pre = rel === "" ? "./" : "../".repeat(rel.split(sep).length);
    writeFileSync(p, s.split("\"@/").join(`"${pre}`));
  }
}

marcher(racine);
