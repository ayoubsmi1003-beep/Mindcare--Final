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

await page.locator(SEL).fill("Explique le trouble panique en trois points");
await page.keyboard.press("Enter");
const stop = page.locator('button[aria-label="Arrêter la réponse"]');
await stop.waitFor({ timeout: 30000 });
console.log("STOP visible");

// Capture PHASE native : tout clic DOM est journalisé, React ou pas.
await page.evaluate(() => {
  window.__clics = [];
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target;
      window.__clics.push(
        `${t.tagName}:${t.getAttribute?.("aria-label") ?? ""}:${!!t.closest("button")}`,
      );
    },
    true,
  );
});

await page.waitForTimeout(2000);
const avant = await page.evaluate(() => ({ etat: window.__mc ? window.__mc.etat : "(hook retiré)", nb: window.__clics.length }));
console.log("avant clic:", JSON.stringify(avant));

await stop.click();
console.log("clic playwright envoyé");

for (let i = 1; i <= 4; i += 1) {
  await page.waitForTimeout(1500);
  const d = await page.evaluate(() => ({
    clics: window.__clics,
    stopDom: !!document.querySelector('button[aria-label="Arrêter la réponse"]'),
    mention: document.body.textContent.includes("Réponse arrêtée à votre demande"),
    saisieOk: !document.querySelector('input[aria-label="Posez une question, ou dictez-la."]').disabled,
    alerte: [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent.slice(0, 50)),
  }));
  console.log(`t+${i * 1.5}s`, JSON.stringify(d));
}
await nav.close();
