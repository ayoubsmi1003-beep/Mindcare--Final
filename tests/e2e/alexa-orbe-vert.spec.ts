/**
 * Orbe Alexa vert — surfaces vocales.
 * Auth via MINDCARE_E2E_USER / MINDCARE_E2E_PASS (jamais en dur).
 */
import { test, expect, type Page } from "@playwright/test";

const USER = process.env.MINDCARE_E2E_USER ?? "";
const PASS = process.env.MINDCARE_E2E_PASS ?? "";

async function login(page: Page): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel(/Nom d’utilisateur/i).fill(USER, { timeout: 30_000 });
  await page.getByLabel(/Mot de passe/i).fill(PASS, { timeout: 30_000 });
  await page.getByRole("button", { name: /Se connecter/i }).click();
  await expect(page).toHaveURL(/\/patients/, { timeout: 180_000 });
}

test.describe("Orbe Alexa vert", () => {
  test.setTimeout(180_000);
  test.beforeEach(async () => {
    test.skip(USER === "" || PASS === "", "MINDCARE_E2E_USER/PASS absents");
  });

  test("O1.1 /jarvis montre l'Avatar vert, pas de console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      if (m.text().includes("401")) return;
      if (m.text().includes("favicon")) return; // pas de favicon en dev : 404 connu, hors périmètre
      consoleErrors.push(m.text());
    });
    await login(page);
    await page.goto("/jarvis");
    // Boîte lente : attendre le chrome applicatif avant d'affirmer l'orbe.
    await page.waitForFunction(
      () => document.body.innerText.includes("Parler à Alexa"),
      undefined,
      { timeout: 90_000 },
    );
    // L'orbe est décoratif (aria-hidden sous un bouton libellé) : sélecteur
    // DOM, pas rôle. Bulle globale + Topbar le rendent sur chaque écran.
    const orb = page.locator('[aria-label="Avatar Alexa"]').first();
    await expect(orb).toBeVisible({ timeout: 20_000 });
    const bg = await orb.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain("radial-gradient");
    expect(consoleErrors, `console: ${consoleErrors.join("\n")}`).toEqual([]);
  });
});
