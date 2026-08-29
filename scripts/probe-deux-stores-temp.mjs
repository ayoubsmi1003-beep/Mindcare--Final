import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env["MESURE_URL"] ?? "http://localhost:3000";
const env = {};
for (const l of readFileSync(path.join(RACINE, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(l);
  if (m && m[2].trim() !== "") env[m[1]] = m[2].trim();
}

const nav = await chromium.launch();
const ctx = await nav.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
page.on("console", (c) => console.log("CONSOLE:", c.text().slice(0, 160)));
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 160)));

await page.goto(`${BASE}/connexion`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[type="email"]', { timeout: 30000 });
await page.locator('input[type="email"]').pressSequentially("owner.dev@invalid.local");
await page.locator('input[type="password"]').pressSequentially(env["DOCTOR_ACCOUNT_PASSWORD"]);
await page.locator('button[type="submit"]').click();
await page.waitForURL(/\/(patients|tableauDeBord)/, { timeout: 60000 });

const diag = async (etiquette) => {
  const d = await page.evaluate(() => ({
    hookPresent: typeof window.__mc === "object",
    nbAbonnes: window.__mc?.nbAbonnes,
    etat: window.__mc?.etat,
    tours: window.__mc?.tours,
    nbBoutonsArret: document.querySelectorAll('button[aria-label="Arrêter la réponse"]').length,
    nbSaisies: document.querySelectorAll('input[aria-label="Posez une question, ou dictez-la."]').length,
    nbPanels: document.querySelectorAll("aside").length,
  }));
  console.log(etiquette, JSON.stringify(d));
};

await diag("après login (tableauDeBord):");
await page.goto(`${BASE}/jarvis`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[aria-label="Posez une question, ou dictez-la."]', { timeout: 30000 });
await page.waitForTimeout(1200);
await diag("/jarvis chargé:");

// Stop DIRECT par le hook — court-circuite totalement le DOM.
const arretHook = await page.evaluate(() => {
  if (!window.__mc) return "hook absent";
  window.__mc.interrompre();
  return "interrompre() appelé";
});
console.log("hook stop:", arretHook);
for (let i = 1; i <= 4; i += 1) {
  await page.waitForTimeout(1500);
  await diag(`t+${i * 1.5}s:`);
}
await nav.close();
