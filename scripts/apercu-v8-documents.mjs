#!/usr/bin/env node
/**
 * apercu-v8-documents — CAPTURE le parcours d'émission, SANS RIEN ÉMETTRE.
 *
 *   node scripts/apercu-v8-documents.mjs        (serveur sur :3000)
 *
 * ⚠️ IL S'ARRÊTE AVANT LA CONFIRMATION, DÉLIBÉRÉMENT. Émettre un certificat
 * écrit une ligne DÉFINITIVE : `030` ne pose aucune porte `update_document` ni
 * `delete_document`, et la table est verrouillée par déclencheur. Un document
 * de démonstration resterait donc dans le dossier d'un patient POUR TOUJOURS,
 * et consommerait un numéro de la série médico-légale. Ce script montre le
 * formulaire et l'aperçu A5 ; la preuve que l'émission fonctionne vient du
 * checkpoint SQL, où elle vit dans une transaction annulée (règle 8).
 *
 * ⚠️ CE N'EST PAS UN CONTRÔLE. Il ne rend ni vert ni rouge : il produit des
 * images à REGARDER. Les verdicts sont dans `checkpoint-v8-documents.sh` et
 * `mesure-v8-documents.mjs`.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREUVES = path.join(RACINE, "checkpoints", "v8-preuves");
const BASE = process.env["MESURE_URL"] ?? "http://localhost:3000";
const COMPTE = { email: "owner.dev@invalid.local", varMdp: "DEV_ACCOUNT_PASSWORD" };

async function motDePasse() {
  const { readFileSync } = await import("node:fs");
  const contenu = readFileSync(path.join(RACINE, ".env"), "utf8");
  const ligne = contenu.split(/\r?\n/).find((l) => l.startsWith(`${COMPTE.varMdp}=`));
  return ligne === undefined ? null : ligne.slice(COMPTE.varMdp.length + 1).trim();
}

async function attendreHydratation(page, selecteur) {
  await page.waitForSelector(selecteur, { state: "visible", timeout: 60_000 });
  await page.waitForFunction(
    (s) => {
      const el = document.querySelector(s);
      return el !== null && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
    },
    selecteur,
    { timeout: 60_000 },
  );
}

mkdirSync(PREUVES, { recursive: true });

const navigateur = await chromium.launch();
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
const page = await contexte.newPage();

const mdp = await motDePasse();
if (mdp === null || mdp === "") {
  console.log(`${COMPTE.varMdp} absent de .env — rien n'a été capturé.`);
  await navigateur.close();
  process.exit(2);
}

await page.goto(`${BASE}/connexion`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await attendreHydratation(page, 'input[type="email"]');
await page.locator('input[type="email"]').pressSequentially(COMPTE.email);
await page.locator('input[type="password"]').pressSequentially(mdp);
await page.locator('button[type="submit"]').click();
await page.waitForURL(/\/patients/, { timeout: 60_000 });

const href = await page.locator('a[href^="/patients/"]').first().getAttribute("href");
const patientId = href === null ? null : href.split("/").pop();
if (patientId === null || patientId === undefined) {
  console.log("aucun dossier visible — rien n'a été capturé.");
  await navigateur.close();
  process.exit(2);
}

await page.goto(`${BASE}/documents?patient=${patientId}`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.waitForSelector("nav[aria-label]", { state: "visible", timeout: 60_000 });
await page.waitForTimeout(2500);

// 1 · Ouvrir le formulaire.
await page.getByRole("button", { name: /Générer un certificat/i }).first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(PREUVES, "emission-1-formulaire.png") });

// 2 · Le certificat d'arrêt de travail — c'est celui qui porte la conversion
//     en lettres, donc celui qu'il faut voir de ses yeux.
await page.getByLabel(/Type de document/i).selectOption("suivi_medical");
await page.waitForTimeout(600);
await page.getByLabel(/Nombre de jours/i).pressSequentially("30");
// Le débounce de la conversion est à 300 ms ; on laisse largement.
await page.waitForTimeout(1800);
await page.getByLabel(/À dater du/i).pressSequentially("01/09/2026");
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(PREUVES, "emission-2-arret-travail.png") });

const lettres = await page.getByLabel(/En toutes lettres/i).inputValue();
console.log(`  jours = 30 → en toutes lettres : « ${lettres} »`);

// 3 · La carte de confirmation. ON S'ARRÊTE LÀ : le bouton n'est pas cliqué.
await page.getByRole("button", { name: /Vérifier le certificat/i }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(PREUVES, "emission-3-confirmation.png") });

console.log(`  captures : ${path.relative(RACINE, PREUVES)}`);
console.log("  AUCUN certificat n'a été émis — le bouton de confirmation n'est pas cliqué.");

await navigateur.close();
process.exit(0);
