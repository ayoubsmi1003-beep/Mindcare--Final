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
page.on("console", (c) => {
  const t = c.text();
  if (t.includes("TRACE") || t.includes("tour erreur")) console.log("CONSOLE:", t.slice(0, 140));
});

await page.goto(`${BASE}/connexion`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[type="email"]', { timeout: 30000 });
await page.locator('input[type="email"]').pressSequentially("owner.dev@invalid.local");
await page.locator('input[type="password"]').pressSequentially(env["DOCTOR_ACCOUNT_PASSWORD"]);
await page.locator('button[type="submit"]').click();
await page.waitForURL(/\/(patients|tableauDeBord)/, { timeout: 60000 });

for (let tentative = 1; tentative <= 4; tentative += 1) {
  await page.goto(`${BASE}/jarvis`, { waitUntil: "domcontentloaded" });
  const SEL = 'input[aria-label="Posez une question, ou dictez-la."]';
  await page.waitForSelector(SEL, { timeout: 30000 });
  await page.waitForTimeout(1000);

  await page.locator(SEL).fill(`Rédige un récit détaillé de trois cents mots sur la fondation de l'hôpital Mustapha (tentative ${tentative}).`);
  await page.keyboard.press("Enter");
  const stop = page.locator('button[aria-label="Arrêter la réponse"]');

  // Attendre le PREMIER fragment affiché (jusqu'à 90 s), puis cliquer VITE.
  let premierDelta = false;
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll("p")]
        .some((p) => p.className.includes("rounded-tl-sm") && p.textContent.trim().length > 0),
      undefined,
      { timeout: 90_000 },
    );
    premierDelta = true;
  } catch { /* jamais de delta */ }

  if (!premierDelta || !(await stop.isVisible().catch(() => false))) {
    console.log(`tentative ${tentative}: flux mort avant delta — relance`);
    continue;
  }

  await stop.click();
  const coupé = await stop
    .waitFor({ state: "detached", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(400);
  const mention = await page.getByText("Réponse arrêtée à votre demande").count().catch(() => 0);
  const saisieOk = await page.locator(SEL).isEnabled();
  console.log(`tentative ${tentative}: coupé=${coupé} mention=${mention > 0} saisieOk=${saisieOk}`);
  await nav.close();
  process.exit(coupé ? 0 : 1);
}
console.log("AUCUN flux assez long en 4 tentatives");
await nav.close();
process.exit(2);
