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
page.on("console", (c) => console.log("CONSOLE[" + c.type() + "]:", c.text().slice(0, 220)));
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 260)));

await page.goto(`${BASE}/connexion`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[type="email"]', { timeout: 30000 });
await page.locator('input[type="email"]').pressSequentially("owner.dev@invalid.local");
await page.locator('input[type="password"]').pressSequentially(env["DOCTOR_ACCOUNT_PASSWORD"]);
await page.locator('button[type="submit"]').click();
await page.waitForURL(/\/(patients|tableauDeBord)/, { timeout: 60000 });

await page.goto(`${BASE}/jarvis`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[aria-label="Posez une question, ou dictez-la."]', { timeout: 30000 });
await page.waitForTimeout(1500);

// Clic sur la PASTILLE d'envoi au lieu d'Enter.
const envoi = page.locator('button[aria-label="Envoyer"]');
console.log("bouton envoi présent:", await envoi.count(), "enabled:", await envoi.isEnabled().catch(() => "?"));
await page.locator('input[aria-label="Posez une question, ou dictez-la."]').fill("Diagnostic deux");
await envoi.click();

for (let i = 0; i < 8; i += 1) {
  await page.waitForTimeout(4000);
  const etat = await page.evaluate(() => ({
    stop: !!document.querySelector('button[aria-label="Arrêter la réponse"]'),
    ps: [...document.querySelectorAll("p")].map((p) => p.textContent.trim().slice(0, 34)).filter(Boolean),
  }));
  console.log(`t+${(i + 1) * 4}s`, JSON.stringify(etat).slice(0, 420));
}
await nav.close();
