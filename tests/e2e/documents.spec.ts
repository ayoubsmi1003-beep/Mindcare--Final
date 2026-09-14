/**
 * SCREEN 7 — /documents
 * Basic load, readiness, search, viewer, offline
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

test.describe("SCREEN 7 — /documents", () => {
  test("D7.1 documents page loads with search and readiness", async ({ page }) => {
    await login(page);
    await page.goto("/documents");
    await expect(page.locator("body")).toContainText(/Documents|Certificats|Rechercher un document/i, { timeout: 10_000 });
    // Search field
    await expect(page.getByPlaceholder(/N° document|Rechercher/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("D7.2 select patient shows document list (may be empty honest)", async ({ page }) => {
    await login(page);
    await page.goto("/documents");
    await expect(page.locator("body")).toContainText(/Documents/i, { timeout: 10_000 });
    // Should show either recent docs or empty honest
    await expect(page.locator("body")).toContainText(/Aucun document|Documents récents|Choisir un dossier/i, { timeout: 10_000 });
  });

  test("D7.3 offline not crash", async ({ page }) => {
    await login(page);
    await page.route("**/api/db/rpc", (route) => {
      try {
        const j = JSON.parse(route.request().postData()||"{}") as {name?:string};
        if (j.name?.includes("document")) return route.abort();
      } catch {}
      return route.continue();
    });
    await page.goto("/documents");
    await page.waitForTimeout(1500);
    // Should not crash, shows body
    await expect(page.locator("body")).toContainText(/Documents/i, { timeout: 10_000 });
    await page.unroute("**/api/db/rpc");
  });

  test("D7.4 no secret leak in rendered html", async ({ page }) => {
    await login(page);
    await page.goto("/documents");
    const content = await page.content();
    expect(content).not.toContain("sk-or-v1");
    expect(content).not.toContain("GROQ");
  });
});
