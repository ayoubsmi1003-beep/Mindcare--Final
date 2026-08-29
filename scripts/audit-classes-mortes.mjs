/**
 * AUDIT DES CLASSES MORTES.
 *
 * `tailwind.config.ts` REMPLACE chaque échelle au lieu de l'étendre : toute
 * classe dont la valeur n'est pas déclarée n'émet aucun CSS — silencieusement,
 * sans erreur de build. C'est la cause technique des refontes ratées, et ni
 * `tsc` ni `eslint` ne la voient.
 *
 * Ce script compare les classes ÉCRITES dans `src/**` aux classes réellement
 * ÉMISES par le dernier build, et rapporte l'écart.
 *
 * Prérequis : `pnpm build` a tourné (il lit `.next/static/css/*.css`).
 * Usage     : node scripts/audit-classes-mortes.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Les classes que le build a réellement produites. */
function classesEmises() {
  const dossier = path.join(RACINE, ".next", "static", "css");
  let css = "";
  for (const f of readdirSync(dossier)) {
    if (f.endsWith(".css")) css += readFileSync(path.join(dossier, f), "utf8");
  }
  const emises = new Set();
  // Un sélecteur de classe CSS : un point, puis des caractères de nom, où
  // `\X` échappe un caractère spécial (`\:` pour une variante, `\.` pour un
  // demi-pas, `\/` pour un modificateur d'opacité).
  for (const m of css.matchAll(/\.((?:[A-Za-z0-9_-]|\\.)+)/g)) {
    emises.add(m[1].replace(/\\/g, ""));
  }
  return emises;
}

/** Les fichiers source, à plat. */
function sources(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, acc);
    else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

/**
 * On ne teste que les préfixes d'utilitaires connus : un mot quelconque dans
 * une chaîne du code n'est pas une classe, et le signaler noierait le rapport.
 */
const PREFIXES = [
  "bg-", "text-", "border-", "rounded-", "shadow-", "opacity-", "ring-",
  "p-", "px-", "py-", "pt-", "pb-", "pl-", "pr-",
  "m-", "mx-", "my-", "mt-", "mb-", "ml-", "mr-",
  "gap-", "gap-x-", "gap-y-", "space-x-", "space-y-",
  "h-", "w-", "min-h-", "min-w-", "max-w-", "max-h-",
  "grid-cols-", "grid-rows-", "col-span-", "row-span-",
  "tracking-", "leading-", "font-", "duration-", "delay-", "ease-",
  "z-", "blur-", "backdrop-blur-", "animate-", "inset-", "top-", "left-",
  "right-", "bottom-", "fill-", "stroke-", "outline-",
];

function main() {
  const emises = classesEmises();
  const morts = new Map();

  for (const fichier of sources(path.join(RACINE, "src"))) {
    const s = readFileSync(fichier, "utf8");
    for (const m of s.matchAll(/"([^"\n]*)"/g)) {
      for (const tok of m[1].split(/\s+/)) {
        if (tok === "" || !/^[a-z0-9:./-]+$/.test(tok)) continue;
        const base = tok.split(":").pop();
        if (!PREFIXES.some((p) => base.startsWith(p))) continue;
        if (emises.has(tok)) continue;
        if (!morts.has(tok)) morts.set(tok, new Set());
        morts.get(tok).add(path.relative(RACINE, fichier));
      }
    }
  }

  console.log(`classes emises par le build : ${emises.size}`);
  if (morts.size === 0) {
    console.log("\nAUCUNE CLASSE MORTE.");
    return;
  }
  console.log(`\n${morts.size} classe(s) MORTE(S) :`);
  for (const cls of [...morts.keys()].sort()) {
    console.log(`  ${cls.padEnd(30)} ${[...morts.get(cls)].sort()[0]}`);
  }
  process.exitCode = 1;
}

main();
