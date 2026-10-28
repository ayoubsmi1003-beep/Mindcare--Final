/**
 * eval-registre-sans-suppression — JARVIS ne fait aucune suppression destructive.
 *
 * ═══ POURQUOI CE CONTRÔLE EXISTE ═══
 *
 * L'assistant peut désactiver une charge via l'opération existante, dont la
 * définition met actif à false et conserve l'historique. Toute suppression
 * destructive reste interdite.
 *
 * ⚠️ CACHER UN BOUTON NE SUFFIT PAS. La capacité ne doit pas EXISTER dans la
 * surface exécutable de l'assistant. Un outil présent au registre mais masqué à
 * l'écran reste appelable par le modèle : c'est le modèle qui choisit l'outil,
 * pas l'interface.
 *
 * Là où le produit a besoin d'un retrait, il utilise les mécanismes existants —
 * `deleted_at`, annulation, `void`, transitions d'état — qui laissent une
 * trace. Règle 3 de CLAUDE.md.
 *
 *   node scripts/eval-registre-sans-suppression.mjs <dir js compilé>
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const repertoire = process.argv[2];
if (repertoire === undefined) {
  console.error("usage : node scripts/eval-registre-sans-suppression.mjs <dir js compilé>");
  process.exit(2);
}
const url = (f) => pathToFileURL(join(repertoire, f)).href;

let rouges = 0;
let verts = 0;
function verdict(nom, ok, detail = "") {
  if (ok) verts += 1;
  else rouges += 1;
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${nom.padEnd(56)} | ${detail}`);
}

/**
 * Les formes que prend une suppression, en anglais comme en français. On teste
 * le NOM de l'outil : c'est lui que le modèle voit et choisit.
 */
const INTERDITS = /delete|destroy|purge|drop|erase|remove|supprim|effac|detruir/i;

Object.defineProperty(globalThis, "navigator", {
  value: { mediaDevices: {} },
  configurable: true,
  writable: true,
});
globalThis.window = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };

const { nomsDeLecture } = await import(url("jarvis-capacites.js"));
const { nomsDEcriture } = await import(url("jarvis-ecritures.js"));
const { OUTILS_GELES, OUTILS_ECRITURE } = await import(url("jarvis-tools.js"));

// ═══════════════════════════════════════════════════════════════════════════
// D1 · LE REGISTRE DE LECTURE
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nD1 — les capacités de LECTURE");
{
  const noms = nomsDeLecture();
  const fautifs = noms.filter((n) => INTERDITS.test(n));
  verdict("le registre n'est pas vide", noms.length > 0, `${noms.length} capacité(s)`);
  verdict("la désactivation des charges est disponible", noms.includes("deactivate_charge"), "deactivate_charge");
  verdict("aucune capacité de suppression", fautifs.length === 0, fautifs.join(", ") || "aucune");
}

// ═══════════════════════════════════════════════════════════════════════════
// D2 · LE REGISTRE D'ÉCRITURE — LE PLUS EXPOSÉ
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nD2 — les capacités d'ÉCRITURE");
{
  const noms = nomsDEcriture();
  const fautifs = noms.filter((n) => INTERDITS.test(n));
  verdict("le registre n'est pas vide", noms.length > 0, `${noms.length} capacité(s)`);
  // ⚠️ LE CONTRÔLE CENTRAL DE CETTE ÉVAL.
  verdict("AUCUNE capacité de suppression", fautifs.length === 0, fautifs.join(", ") || "aucune");
  console.log(`        | écritures exposées : ${noms.join(" · ")}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// D3 · L'ALLOWLIST GELÉE
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nD3 — l'allowlist historique");
{
  const geles = [...OUTILS_GELES];
  const ecritures = [...OUTILS_ECRITURE];
  verdict("aucune suppression parmi les outils gelés", !geles.some((n) => INTERDITS.test(n)), geles.join(", "));
  verdict("aucune suppression parmi les écritures gelées", !ecritures.some((n) => INTERDITS.test(n)), ecritures.join(", "));
}

// ═══════════════════════════════════════════════════════════════════════════
// D4 · LES CHARGES SONT DÉSACTIVÉES — LEUR HISTORIQUE EST CONSERVÉ
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nD4 — `delete_charge` désactive la charge et conserve son historique");
{
  const migration = readFileSync(join(process.cwd(), "supabase/migrations/038_charges.sql"), "utf8");
  const fonction = migration.match(/CREATE OR REPLACE FUNCTION app\.delete_charge\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/i)?.[1] ?? "";
  const desactivationConservee = /UPDATE app\.charges SET actif = false[\s\S]*?RETURN p_id/i.test(fonction)
    && !/\bDELETE\s+FROM\s+app\.charges\b/i.test(fonction);
  verdict("delete_charge est une désactivation non destructive", desactivationConservee, desactivationConservee ? "actif = false, historique conservé" : "fonction SQL non conforme");

  const sources = ["jarvis-capacites.ts", "jarvis-ecritures.ts", "jarvis-tools.ts", "jarvis-boucle.ts"];
  const fautifs = [];
  for (const f of sources) {
    let texte;
    try {
      texte = readFileSync(join("src/services", f), "utf8");
    } catch {
      continue;
    }
    // Cherche des écritures destructives, pas l'appel métier `deactivate_charge`.
    const code = texte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    if (/\bdeleteCharge\s*\(|\bDELETE\s+FROM\s+(?:app\.)?(?:charges|patients|consultations|documents)\b/i.test(code)) {
      fautifs.push(f);
    }
  }
  verdict("aucun module Jarvis n'effectue de suppression destructive", fautifs.length === 0, fautifs.join(", ") || "aucun");
}

console.log(
  `\nVERDICT SANS SUPPRESSION : ${rouges === 0 ? `VERT (${verts} vert(s))` : `ROUGE — ${rouges} contrôle(s)`}`,
);
process.exit(rouges === 0 ? 0 : 1);
