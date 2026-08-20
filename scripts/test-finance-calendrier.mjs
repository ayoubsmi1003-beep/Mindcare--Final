#!/usr/bin/env node
/**
 * test-finance-calendrier — les seules fonctions de la finance qu'on peut
 * éprouver sans base et sans navigateur.
 *
 *   node scripts/test-finance-calendrier.mjs
 *
 * ⚠️ AUCUN LANCEUR DE TESTS N'EST INSTALLÉ DANS CE DÉPÔT, et ce fichier n'en
 * installe pas. `package.json` ne porte ni vitest ni jest ; en ajouter un est
 * une décision de dépôt, pas un effet de bord d'un lot finance (règle 10).
 * On compile donc avec le `tsc` DÉJÀ présent, et on exécute avec le `node`
 * déjà présent. Les assertions sont `node:assert`, de la bibliothèque standard.
 *
 * Ce que ce fichier NE couvre PAS, et il faut le dire : les portes SQL (elles
 * sont dans `checkpoint-v6-finance.sql`, éprouvées en base sous trois rôles) et
 * le rendu (il est dans la mesure au navigateur). Trois instruments, trois
 * périmètres, aucun ne prétend couvrir celui des autres.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(RACINE, "src", "services", "finance-calendrier.ts");

let reussis = 0;
let echoues = 0;

function verifier(intitule, fn) {
  try {
    fn();
    console.log(`  vert   | ${intitule}`);
    reussis += 1;
  } catch (e) {
    console.log(`  ROUGE  | ${intitule}`);
    console.log(`         | ${String(e.message).split("\n")[0]}`);
    echoues += 1;
  }
}

// ---------------------------------------------------------------------------
// Compilation — le module n'importe RIEN, donc `tsc` l'émet seul
// ---------------------------------------------------------------------------
const sortie = mkdtempSync(path.join(tmpdir(), "mindcare-cal-"));
let cal;
try {
  // ⚠️ On appelle le binaire `tsc` de `node_modules` PAR `node`, pas par `npx`.
  // Sous Windows, `execFileSync("npx.cmd", …)` rend EINVAL : `.cmd` exige un
  // shell, et l'activer ouvrirait une interprétation de la ligne de commande
  // qu'on ne veut pas ici. `process.execPath` est le node courant, toujours
  // valide, et le chemin du binaire est résolu depuis la racine du dépôt.
  execFileSync(
    process.execPath,
    [path.join(RACINE, "node_modules", "typescript", "bin", "tsc"),
     SOURCE, "--outDir", sortie, "--target", "es2022", "--module", "es2022",
     "--moduleResolution", "bundler", "--strict"],
    { cwd: RACINE, stdio: "pipe" },
  );
  cal = await import(pathToFileURL(path.join(sortie, "finance-calendrier.js")).href);
} catch (e) {
  console.error("ROUGE — la compilation du module calendrier a échoué :");
  console.error(String(e.stdout ?? e.message));
  process.exit(1);
}

console.log("");
console.log("═══ TEST — calendrier financier (Africa/Algiers) ═══");
console.log("");

// ---------------------------------------------------------------------------
// Le fuseau du cabinet
// ---------------------------------------------------------------------------
// ⚠️ LE TEST QUI COMPTE. 22:30 UTC un 10 mars, c'est déjà le 10 à 23:30 à
// Alger — même journée. Mais 23:30 UTC, c'est le 11 à 00:30 à Alger : journée
// SUIVANTE. Un `toISOString()` rendrait « 2025-03-10 » dans les deux cas, et la
// recette du 11 s'afficherait vide pendant une heure chaque nuit.
verifier("22:30 UTC le 10 → 10 mars à Alger", () => {
  assert.equal(cal.aujourdHuiCabinet(new Date("2025-03-10T22:30:00Z")), "2025-03-10");
});
verifier("23:30 UTC le 10 → 11 mars à Alger (la bascule)", () => {
  assert.equal(cal.aujourdHuiCabinet(new Date("2025-03-10T23:30:00Z")), "2025-03-11");
});
verifier("minuit UTC → toujours le même jour à Alger (UTC+1)", () => {
  assert.equal(cal.aujourdHuiCabinet(new Date("2025-06-15T00:00:00Z")), "2025-06-15");
});

// ---------------------------------------------------------------------------
// Arithmétique de jours
// ---------------------------------------------------------------------------
verifier("nombreDeJours est INCLUSIF — un même jour vaut 1", () => {
  assert.equal(cal.nombreDeJours("2025-03-10", "2025-03-10"), 1);
});
verifier("mars entier = 31 jours", () => {
  assert.equal(cal.nombreDeJours("2025-03-01", "2025-03-31"), 31);
});
verifier("franchit un changement de mois", () => {
  assert.equal(cal.nombreDeJours("2025-02-27", "2025-03-02"), 4);
});
verifier("février 2024 (bissextile) = 29 jours", () => {
  assert.equal(cal.nombreDeJours("2024-02-01", "2024-02-29"), 29);
});
verifier("ajouterJours franchit une fin de mois", () => {
  assert.equal(cal.ajouterJours("2025-03-31", 1), "2025-04-01");
});
verifier("ajouterJours recule au-delà d'un début d'année", () => {
  assert.equal(cal.ajouterJours("2025-01-01", -1), "2024-12-31");
});
verifier("ajouterJours franchit le 29 février", () => {
  assert.equal(cal.ajouterJours("2024-02-28", 1), "2024-02-29");
  assert.equal(cal.ajouterJours("2024-02-29", 1), "2024-03-01");
});

// ⚠️ L'HEURE D'ÉTÉ EUROPÉENNE — le piège classique de l'arithmétique de dates.
// Le 30 mars 2025, l'Europe avance d'une heure. Alger, elle, N'A PAS d'heure
// d'été (UTC+1 toute l'année) — mais le POSTE de développement peut en avoir
// une. L'arithmétique passe par UTC précisément pour que le fuseau du poste ne
// puisse pas décaler un comptage de jours.
verifier("le week-end du changement d'heure européen ne décale rien", () => {
  assert.equal(cal.ajouterJours("2025-03-29", 1), "2025-03-30");
  assert.equal(cal.ajouterJours("2025-03-30", 1), "2025-03-31");
  assert.equal(cal.nombreDeJours("2025-03-29", "2025-03-31"), 3);
});

// ---------------------------------------------------------------------------
// Les bornes de période
// ---------------------------------------------------------------------------
verifier("« Aujourd'hui » borne un seul jour", () => {
  const p = cal.bornesDePeriode("jour", "2025-03-12");
  assert.deepEqual([p.du, p.au], ["2025-03-12", "2025-03-12"]);
});

// La semaine commence LUNDI, comme `date_trunc('week')` en Postgres. Si les
// deux divergeaient, le premier seau de la série déborderait de la période.
verifier("la semaine commence LUNDI — depuis un mercredi", () => {
  const p = cal.bornesDePeriode("semaine", "2025-03-12"); // mercredi
  assert.deepEqual([p.du, p.au], ["2025-03-10", "2025-03-16"]);
});
verifier("la semaine commence LUNDI — depuis un dimanche", () => {
  const p = cal.bornesDePeriode("semaine", "2025-03-16"); // dimanche
  assert.deepEqual([p.du, p.au], ["2025-03-10", "2025-03-16"]);
});
verifier("la semaine commence LUNDI — depuis un lundi", () => {
  const p = cal.bornesDePeriode("semaine", "2025-03-10");
  assert.deepEqual([p.du, p.au], ["2025-03-10", "2025-03-16"]);
});

// ⚠️ LE MOIS EST RENDU ENTIER, PAS TRONQUÉ À AUJOURD'HUI. C'est ce qui permet à
// la porte 036 de comparer les jours écoulés aux N PREMIERS jours du mois
// précédent, et non à ses N derniers.
verifier("« Ce mois » rend le mois ENTIER, même consulté le 10", () => {
  const p = cal.bornesDePeriode("mois", "2025-03-10");
  assert.deepEqual([p.du, p.au], ["2025-03-01", "2025-03-31"]);
});
verifier("février non bissextile finit le 28", () => {
  const p = cal.bornesDePeriode("mois", "2025-02-14");
  assert.deepEqual([p.du, p.au], ["2025-02-01", "2025-02-28"]);
});
verifier("février bissextile finit le 29", () => {
  const p = cal.bornesDePeriode("mois", "2024-02-14");
  assert.deepEqual([p.du, p.au], ["2024-02-01", "2024-02-29"]);
});
verifier("décembre finit le 31", () => {
  const p = cal.bornesDePeriode("mois", "2025-12-05");
  assert.deepEqual([p.du, p.au], ["2025-12-01", "2025-12-31"]);
});
verifier("« Cette année » couvre le 1er janvier au 31 décembre", () => {
  const p = cal.bornesDePeriode("annee", "2025-07-04");
  assert.deepEqual([p.du, p.au], ["2025-01-01", "2025-12-31"]);
});

// ---------------------------------------------------------------------------
// La borne de plage — l'année entière doit PASSER, 2 ans doivent ÉCHOUER
// ---------------------------------------------------------------------------
// Contrôle de cohérence avec la porte : elle refuse au-delà de 366 jours
// d'ÉCART, soit 367 jours inclusifs. Une année bissextile fait 366 jours
// inclusifs — elle doit donc passer, sinon « Cette année » serait refusé un an
// sur quatre, et personne ne le verrait avant 2028.
verifier("une année pleine est acceptée (365 j)", () => {
  assert.equal(cal.periodeEstValide("2025-01-01", "2025-12-31"), true);
});
verifier("une année BISSEXTILE est acceptée (366 j)", () => {
  assert.equal(cal.nombreDeJours("2024-01-01", "2024-12-31"), 366);
  assert.equal(cal.periodeEstValide("2024-01-01", "2024-12-31"), true);
});
verifier("deux ans sont refusés", () => {
  assert.equal(cal.periodeEstValide("2024-01-01", "2025-12-31"), false);
});
verifier("des bornes inversées sont refusées", () => {
  assert.equal(cal.periodeEstValide("2025-03-31", "2025-03-01"), false);
});
verifier("un format non conforme est refusé", () => {
  assert.equal(cal.periodeEstValide("12/03/2025", "2025-03-31"), false);
  assert.equal(cal.periodeEstValide("", ""), false);
});

verifier("estAvantOuEgal compare bien deux dates civiles", () => {
  assert.equal(cal.estAvantOuEgal("2025-03-01", "2025-03-01"), true);
  assert.equal(cal.estAvantOuEgal("2025-03-01", "2025-03-02"), true);
  assert.equal(cal.estAvantOuEgal("2025-03-02", "2025-03-01"), false);
});

// ---------------------------------------------------------------------------
rmSync(sortie, { recursive: true, force: true });

console.log("");
console.log(`─── ${reussis} vert · ${echoues} ROUGE ───`);
if (echoues > 0) {
  console.log("Le calendrier financier est FAUX. Ne pas livrer.");
  process.exit(1);
}
console.log("Calendrier financier conforme.");
process.exit(0);
