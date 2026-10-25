/**
 * Mains-libres — interrupteur, persistance, dégradation gracieuse.
 * Lecture seule : on ne dicte rien (pas de micro en headless).
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

test.describe("Mains-libres", () => {
  test.setTimeout(240_000);
  test.beforeEach(async () => {
    test.skip(USER === "" || PASS === "", "MINDCARE_E2E_USER/PASS absents");
  });

  test("M1.1 interrupteur visible et bascule sans erreur", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      if (m.text().includes("401")) return;
      if (m.text().includes("favicon")) return; // pas de favicon en dev : 404 connu, hors périmètre
      consoleErrors.push(m.text());
    });
    await login(page);
    await page.goto("/jarvis");
    await page.waitForFunction(() => document.body.innerText.includes("Parler à Alexa"), undefined, {
      timeout: 90_000,
    });
    const inter = page.getByRole("button", { name: /Mains-libres|Couper le mains-libres/i }).first();
    await expect(inter).toBeVisible({ timeout: 20_000 });
    expect(await inter.getAttribute("aria-pressed")).toBe("false");
    await inter.click();
    await expect(inter).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    // Remise à OFF : le poste ne reste pas armé après le test.
    await inter.click();
    await expect(inter).toHaveAttribute("aria-pressed", "false", { timeout: 20_000 });
    expect(consoleErrors, `console: ${consoleErrors.join("\n")}`).toEqual([]);
  });
});
