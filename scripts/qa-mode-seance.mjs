/**
 * QA — LE MODE SÉANCE.
 *
 * Le repli nocturne est la seule audace du produit ; il ne peut pas être
 * livré sur la foi d'un `tsc` vert. Aucune URL fixe ne l'atteint : il faut
 * une consultation OUVERTE, donc il faut en ouvrir une.
 *
 * ⚠️ CE SCRIPT ÉCRIT EN BASE. Il démarre une séance sur une fixture de
 * développement (base cloud synthétique, ADR-016) et la laisse ouverte : la
 * clôture exige un tarif, et fabriquer un montant pour faire joli sur une
 * capture serait exactement la donnée fictive que la règle 8 interdit.
 * À lancer sciemment, jamais contre une base réelle.
 *
 * Usage : node scripts/qa-mode-seance.mjs
 */

import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env["MESURE_URL"] ?? "http://localhost:3000";
const SORTIE = path.join(RACINE, "checkpoints", "v7-preuves", "mode-seance");

const COMPTE = {
  email: "praticien2.dev@invalid.local",
  varMdp: "DOCTOR_ACCOUNT_PASSWORD",
};

function lireEnv() {
  const brut = readFileSync(path.join(RACINE, ".env"), "utf8");
  const env = {};
  for (const ligne of brut.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(ligne);
    if (m !== null && m[2].trim() !== "") env[m[1]] = m[2].trim();
  }
  return env;
}

async function main() {
  const env = lireEnv();
  mkdirSync(SORTIE, { recursive: true });

  const navigateur = await chromium.launch();
  const contexte = await navigateur.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: "fr-FR",
  });
  const page = await contexte.newPage();

  await page.goto(`${BASE}/connexion`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="email"]', { state: "visible" });
  await page.locator('input[type="email"]').pressSequentially(COMPTE.email);
  await page.locator('input[type="password"]').pressSequentially(env[COMPTE.varMdp] ?? "");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 60_000 });

  // 1. Une consultation est peut-être déjà ouverte d'un passage précédent :
  //    on la reprend plutôt que d'en ouvrir une seconde.
  await page.goto(`${BASE}/tableauDeBord`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const reprendre = page.getByRole("link", { name: /reprendre|poursuivre/i }).first();
  const demarrer = page.getByRole("button", { name: /d[ée]marrer la s[ée]ance/i }).first();

  if ((await reprendre.count()) > 0) {
    await reprendre.click();
  } else if ((await demarrer.count()) > 0) {
    await demarrer.click();
  } else {
    console.log("Aucune seance a ouvrir depuis le tableau de bord — rien a capturer.");
    await navigateur.close();
    return;
  }

  await page.waitForURL(/\/consultation\//, { timeout: 60_000 });
  await page.waitForTimeout(3000);

  const etat = await page.evaluate(() => {
    const racine = document.querySelector(".mode-seance");
    const nav = document.querySelector("nav[aria-label]");
    const barre = document.querySelector("header[aria-label]");
    const corps = racine === null ? null : getComputedStyle(racine);
    return {
      modeSeanceActif: racine !== null,
      railPresent: nav !== null,
      barrePresente: barre !== null,
      fond: corps === null ? null : corps.backgroundColor,
      carteRemappee:
        corps === null ? null : corps.getPropertyValue("--card").trim(),
      encreRemappee:
        corps === null ? null : corps.getPropertyValue("--ink-900").trim(),
      url: location.pathname,
    };
  });

  await page.screenshot({ path: path.join(SORTIE, "mode-seance@1920.png") });

  for (const [w, h] of [
    [1366, 768],
    [1024, 768],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SORTIE, `mode-seance@${w}.png`) });
  }

  console.log(JSON.stringify(etat, null, 1));
  console.log(`captures : ${SORTIE}`);
  await navigateur.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
