#!/usr/bin/env node
/**
 * qa-secret-check-temp — CONTRÔLE DES SECRETS COMMITÉS. TEMPORAIRE.
 *
 * ⚠️ NE JOURNALISE AUCUN SECRET. Il compare des ÉGALITÉS et compte des
 * occurrences ; il n'affiche ni valeur, ni préfixe, ni longueur d'un secret.
 *
 * Question posée : le mot de passe présent EN CLAIR dans un fichier de test
 * versionné est-il le mot de passe VIVANT du compte de développement ?
 * Si oui, c'est un secret publié — pas une fixture.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = {};
for (const l of readFileSync(path.join(RACINE, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
  if (m !== null && m[2].trim() !== "") env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
}
const secretsEnv = Object.entries(env).filter(([k]) => /PASSWORD|_KEY$/.test(k));

// ── 1 · littéraux de test qui coïncident avec un secret de .env ──────────────
const racineTest = path.join(RACINE, "tests");
const fichiers = [];
(function marcher(d) {
  for (const e of readdirSync(d)) {
    const p = path.join(d, e);
    if (statSync(p).isDirectory()) marcher(p);
    else if (p.endsWith(".ts") || p.endsWith(".mjs")) fichiers.push(p);
  }
})(racineTest);

console.log(`Contrôle sur ${fichiers.length} fichiers de tests/**\n`);
let publies = 0;
for (const f of fichiers) {
  const texte = readFileSync(f, "utf8");
  // Chaînes littérales longues (20+) : forme d'un secret, pas d'un libellé.
  for (const m of texte.matchAll(/"([^"\n]{20,120})"/g)) {
    const lit = m[1];
    const ligne = texte.slice(0, m.index).split("\n").length;
    const touche = secretsEnv.filter(([, v]) => v === lit).map(([k]) => k);
    if (touche.length > 0) {
      publies += 1;
      console.log(`SECRET PUBLIÉ — ${path.relative(RACINE, f)}:${ligne} correspond à ${touche.join(", ")} de .env`);
    }
  }
}
if (publies === 0) console.log("Aucun littéral de tests/** ne correspond à un secret de .env.");

// ── 2 · les fichiers de test sont-ils versionnés ? ───────────────────────────
console.log(`\nSecrets de .env examinés : ${secretsEnv.length} (noms seuls : ${secretsEnv.map(([k]) => k).join(", ")})`);
