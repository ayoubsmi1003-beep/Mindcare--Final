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
page.on("console", (c) => console.log("CONSOLE:", c.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 200)));

await page.goto(`${BASE}/connexion`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[type="email"]', { timeout: 30000 });
await page.locator('input[type="email"]').pressSequentially("owner.dev@invalid.local");
await page.locator('input[type="password"]').pressSequentially(env["DOCTOR_ACCOUNT_PASSWORD"]);
await page.locator('button[type="submit"]').click();
await page.waitForURL(/\/(patients|tableauDeBord)/, { timeout: 60000 });

await page.goto(`${BASE}/jarvis`, { waitUntil: "domcontentloaded" });
const SEL = 'input[aria-label="Posez une question, ou dictez-la."]';
await page.waitForSelector(SEL, { timeout: 30000 });
await page.waitForTimeout(1200);

await page.locator(SEL).fill("Raconte toute l'histoire de la psychiatrie depuis Pinel jusqu'a aujourd'hui en detail");
await page.keyboard.press("Enter");
const stop = page.locator('button[aria-label="Arrêter la réponse"]');
await stop.waitFor({ timeout: 20000 });
console.log("STOP visible — attente 2.5s puis clic");
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const b = document.querySelector('button[aria-label="Arrêter la réponse"]');
  const r = b.getBoundingClientRect();
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  window.__hit = el ? (el.tagName + '|' + (el.getAttribute('aria-label') || '') + '|' + String(el.className).slice(0, 70)) : 'rien';
});
console.log('HIT:', await page.evaluate(() => window.__hit));
await page.evaluate(() => { const b = document.querySelectorAll('button'); for (const x of b) { if (x.getAttribute('aria-label') === 'Arrêter la réponse') { x.click(); break; } } }); console.log('clic natif JS');
console.log("clic envoyé");
for (let i = 1; i <= 6; i += 1) {
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() => ({
    stop: !!document.querySelector('button[aria-label="Arrêter la réponse"]'),
    mention: document.body.textContent.includes("Réponse arrêtée à votre demande"),
    saisieOk: !document.querySelector('input[aria-label="Posez une question, ou dictez-la."]').disabled,
    alerte: [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent.slice(0, 60)),
  }));
  console.log(`t+${i * 1.5}s`, JSON.stringify(s));
}
await nav.close();
