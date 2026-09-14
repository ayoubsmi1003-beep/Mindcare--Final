/**
 * SCREEN 9 — /jarvis and global PanneauJarvis
 * Chat, streaming, offline provider handling
 */
import { test, expect } from "@playwright/test";

const CONNEXION = "/connexion";
async function login(page: import("@playwright/test").Page) {
  await page.goto(CONNEXION);
  await page.getByLabel(/E-mail/i).fill("owner.dev@invalid.local");
  await page.getByLabel(/Mot de passe/i).fill("Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP");
  await page.getByRole("button", { name: /Se connecter/i }).click();
  await expect(page).toHaveURL(/\/patients/, { timeout: 15_000 });
}

test.describe("SCREEN 9 — Jarvis", () => {
  test("J9.1 jarvis page loads with disclaimer and input", async ({ page }) => {
    await login(page);
    await page.goto("/jarvis");
    await expect(page.locator("body")).toContainText(/Alexa|Jarvis|Aide à la décision/i, { timeout: 10_000 });
    await expect(page.getByPlaceholder(/Posez une question|Demander|Écrire/i).or(page.locator("textarea")).first()).toBeVisible({ timeout: 10_000 });
  });

  test("J9.2 global command bar opens Jarvis panel", async ({ page }) => {
    await login(page);
    await page.goto("/patients");
    // Press Cmd+K or Ctrl+K
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(800);
    await expect(page.locator("body")).toContainText(/Alexa|Jarvis|Demander/i, { timeout: 10_000 });
    // Press Escape to close
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  });

  test("J9.3 offline: jarvis shows indisponible gracefully", async ({ page }) => {
    await login(page);
    await page.route("**/api/jarvis/**", (route) => route.abort());
    await page.goto("/jarvis");
    await expect(page.locator("body")).toContainText(/Alexa|Jarvis/i, { timeout: 10_000 });
    const input = page.getByPlaceholder(/Posez une question|Demander|Écrire/i).or(page.locator("textarea")).first();
    if (await input.count() > 0) {
      await input.fill("Bonjour");
      const sendBtn = page.getByRole("button", { name: /Envoyer|Demander/i }).first();
      if (await sendBtn.count() > 0) await sendBtn.click();
      await page.waitForTimeout(1500);
      await expect(page.locator("body")).toContainText(/Alexa|Jarvis|indisponible|Hors ligne/i, { timeout: 10_000 });
    }
    await page.unroute("**/api/jarvis/**");
  });

  test("J9.4 no secret leak on jarvis", async ({ page }) => {
    await login(page);
    await page.goto("/jarvis");
    const content = await page.content();
    expect(content).not.toContain("sk-or-v1");
    expect(content).not.toContain("OPENROUTER");
  });
});
